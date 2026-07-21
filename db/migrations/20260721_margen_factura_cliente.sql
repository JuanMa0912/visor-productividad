-- Factura + cliente en el tablero de margenes (2026-07-21).
--
-- Agrega 3 campos a la cadena margen_final (crudo) -> margen_final_roll (rollup
-- factura+item que lee el tablero):
--   documento_docfc  cmmovimiento_pdv.documento_docfc (documento POS acumulado, 16)
--   id_terc          cmmovimiento_pdv.id_terc          (tercero/cliente de la factura)
--   nombre_terc      terceros.descripcion (maestro) via LEFT JOIN por (codigo, sucursal)
--
-- APLICAR EN AMBOS EXTREMOS (232 local y GCP). Verificado 2026-07-21: margen_final,
-- margen_final_roll y refresh_margen_final_roll existen y estan poblados en los dos
-- (49.18M filas de roll iguales). El README viejo decia "roll solo en GCP" -> ESTA
-- DESACTUALIZADO: el roll y la funcion tambien viven en 232.
--
-- GRANO: los 3 campos son atributos de la FACTURA (constantes dentro de un mismo
-- documento_fc + id_tipdoc_fc), asi que en el roll entran como MAX() dentro del grano
-- factura+item existente (igual que nombre_linea1/item_descripcion). NO se agregan al
-- PK/GROUP BY -> el grano del roll NO cambia, sin explosion de filas.
--
-- margen_item_dia_roll (/informe-variacion, grano dia+item SIN factura) NO se toca:
-- no tiene columna de factura donde estos campos tengan sentido.
--
-- IDEMPOTENTE (ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE): re-aplicar no rompe.
--
-- BACKFILL: las filas historicas quedan con NULL en los 3 campos hasta re-correr el ETL
-- de esas fechas (cargar_margen.py --desde .. --hasta ..) -> sync-local-to-gcp.sh (el
-- sync arrastra las columnas nuevas solo: descubre columnas por information_schema, no
-- hay lista que tocar) -> refresh del roll de ese rango. Hacia adelante, el timer 07:15
-- ya trae los 3 campos.

-- 1) Crudo. Aplicar en 232 Y GCP.
ALTER TABLE margen_final
  ADD COLUMN IF NOT EXISTS documento_docfc TEXT,
  ADD COLUMN IF NOT EXISTS id_terc         TEXT,
  ADD COLUMN IF NOT EXISTS nombre_terc     TEXT;

COMMENT ON COLUMN margen_final.documento_docfc IS
  'cmmovimiento_pdv.documento_docfc: documento POS acumulado (char 16 en origen).';
COMMENT ON COLUMN margen_final.id_terc IS
  'cmmovimiento_pdv.id_terc: tercero/cliente de la factura.';
COMMENT ON COLUMN margen_final.nombre_terc IS
  'terceros.descripcion (maestro) via LEFT JOIN por (codigo, sucursal); NULL en contado sin tercero.';

-- 2) Rollup factura+item. Aplicar en 232 Y GCP.
ALTER TABLE margen_final_roll
  ADD COLUMN IF NOT EXISTS documento_docfc TEXT,
  ADD COLUMN IF NOT EXISTS id_terc         TEXT,
  ADD COLUMN IF NOT EXISTS nombre_terc     TEXT;

-- 3) Refresh del rollup: agrega los 3 campos como MAX() por factura. El GROUP BY 1..9
--    (grano) queda IDENTICO a la version vigente (migracion 20260703); solo cambian las
--    columnas seleccionadas/insertadas. Aplicar en 232 Y GCP.
CREATE OR REPLACE FUNCTION refresh_margen_final_roll(
  p_from TEXT DEFAULT NULL,
  p_to TEXT DEFAULT NULL
)
RETURNS TABLE (inserted_rows BIGINT, elapsed_ms BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
  t0 TIMESTAMPTZ := clock_timestamp();
  n BIGINT;
  v_from TEXT;
  v_to TEXT;
BEGIN
  PERFORM set_config('statement_timeout', '0', true);
  PERFORM set_config('lock_timeout', '0', true);
  PERFORM set_config('work_mem', '256MB', true);

  IF p_from IS NULL AND p_to IS NULL THEN
    TRUNCATE margen_final_roll;
    v_from := '00000000';
    v_to := '99999999';
  ELSE
    v_from := COALESCE(p_from, '00000000');
    v_to := COALESCE(p_to, '99999999');
    DELETE FROM margen_final_roll
    WHERE fecha_dcto >= v_from
      AND fecha_dcto <= v_to;
  END IF;

  INSERT INTO margen_final_roll (
    fecha_dcto,
    empresa_norm,
    id_co_norm,
    id_tipo,
    id_linea1,
    id_linea2,
    id_item,
    documento_fc,
    id_tipdoc_fc,
    nombre_linea1,
    nombre_linea2,
    item_descripcion,
    documento_docfc,
    id_terc,
    nombre_terc,
    ventas_netas,
    costo_total,
    margen_pesos,
    cantidad,
    ventas_con_iva
  )
  SELECT
    fecha_dcto,
    lower(trim(COALESCE(empresa, ''))) AS empresa_norm,
    lpad(trim(COALESCE(id_co, '')), 3, '0') AS id_co_norm,
    trim(COALESCE(id_tipo::text, '')) AS id_tipo,
    trim(COALESCE(id_linea1::text, '')) AS id_linea1,
    trim(COALESCE(id_linea2::text, '')) AS id_linea2,
    trim(COALESCE(id_item::text, '')) AS id_item,
    trim(COALESCE(documento_fc::text, '')) AS documento_fc,
    trim(COALESCE(id_tipdoc_fc::text, '')) AS id_tipdoc_fc,
    MAX(NULLIF(trim(nombre_linea1), '')) AS nombre_linea1,
    MAX(NULLIF(trim(nombre_linea2), '')) AS nombre_linea2,
    MAX(NULLIF(trim(item_descripcion), '')) AS item_descripcion,
    MAX(NULLIF(trim(documento_docfc), '')) AS documento_docfc,
    MAX(NULLIF(trim(id_terc), '')) AS id_terc,
    MAX(NULLIF(trim(nombre_terc), '')) AS nombre_terc,
    COALESCE(SUM(COALESCE(vlrtot_bru, 0)), 0),
    COALESCE(SUM(COALESCE(tot_costo, 0)), 0),
    COALESCE(SUM(COALESCE(vlrtot_bru, 0) - COALESCE(tot_costo, 0)), 0),
    COALESCE(SUM(COALESCE(cantidad, 0)), 0),
    COALESCE(SUM(COALESCE(ven_totales, 0)), 0)
  FROM margen_final
  WHERE fecha_dcto IS NOT NULL
    AND fecha_dcto ~ '^[0-9]{8}$'
    AND fecha_dcto >= v_from
    AND fecha_dcto <= v_to
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9;

  GET DIAGNOSTICS n = ROW_COUNT;

  IF p_from IS NULL AND p_to IS NULL THEN
    ANALYZE margen_final_roll;
  END IF;

  RETURN QUERY
  SELECT
    n,
    (EXTRACT(EPOCH FROM (clock_timestamp() - t0)) * 1000)::BIGINT;
END;
$$;

COMMENT ON FUNCTION refresh_margen_final_roll(TEXT, TEXT) IS
  'Pobla margen_final_roll (factura+item). Sin args: full refresh. Con p_from/p_to: reemplaza solo ese rango YYYYMMDD. Incluye documento_docfc/id_terc/nombre_terc como MAX() por factura.';
