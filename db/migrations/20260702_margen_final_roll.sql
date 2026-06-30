-- Rollup factura+ítem: reduce filas escaneadas en agregaciones del tablero /margenes.
-- Poblar con: SELECT refresh_margen_final_roll(); (o npm run margen:refresh-roll)
-- Tras cada carga ETL diaria de margen_final.

CREATE TABLE IF NOT EXISTS margen_final_roll (
  fecha_dcto TEXT NOT NULL,
  empresa_norm TEXT NOT NULL,
  id_co_norm TEXT NOT NULL,
  id_tipo TEXT NOT NULL DEFAULT '',
  id_linea1 TEXT NOT NULL DEFAULT '',
  id_linea2 TEXT NOT NULL DEFAULT '',
  id_item TEXT NOT NULL DEFAULT '',
  documento_fc TEXT NOT NULL DEFAULT '',
  id_tipdoc_fc TEXT NOT NULL DEFAULT '',
  nombre_linea1 TEXT,
  nombre_linea2 TEXT,
  item_descripcion TEXT,
  ventas_netas NUMERIC(18, 4) NOT NULL DEFAULT 0,
  costo_total NUMERIC(18, 4) NOT NULL DEFAULT 0,
  margen_pesos NUMERIC(18, 4) NOT NULL DEFAULT 0,
  cantidad NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ventas_con_iva NUMERIC(18, 4) NOT NULL DEFAULT 0,
  CONSTRAINT margen_final_roll_pk PRIMARY KEY (
    fecha_dcto,
    empresa_norm,
    id_co_norm,
    id_tipo,
    id_linea1,
    id_linea2,
    id_item,
    documento_fc,
    id_tipdoc_fc
  )
);

COMMENT ON TABLE margen_final_roll IS
  'Agregado por factura+ítem/día/sede; alimenta consultas pesadas del tablero de margen.';

CREATE INDEX IF NOT EXISTS margen_final_roll_idx_sede_fecha
  ON margen_final_roll (empresa_norm, id_co_norm, fecha_dcto);

CREATE INDEX IF NOT EXISTS margen_final_roll_idx_fecha_sede
  ON margen_final_roll (fecha_dcto, empresa_norm, id_co_norm);

CREATE INDEX IF NOT EXISTS margen_final_roll_idx_sede_fecha_tipo
  ON margen_final_roll (empresa_norm, id_co_norm, fecha_dcto, id_tipo);

-- Nivel 0 (MERCADO): filtra id_tipo = 4 sin expresión en cada fila.
CREATE INDEX IF NOT EXISTS margen_final_roll_idx_sede_fecha_mercado
  ON margen_final_roll (empresa_norm, id_co_norm, fecha_dcto)
  WHERE id_tipo = '4';

-- Índice parcial en detalle para fallback si el rollup aún no está poblado.
CREATE INDEX IF NOT EXISTS margen_final_idx_sede_fecha_mercado
  ON margen_final (
    lower(trim(COALESCE(empresa, ''))),
    lpad(trim(COALESCE(id_co, '')), 3, '0'),
    fecha_dcto
  )
  WHERE trim(coalesce(id_tipo::text, '')) = '4';

CREATE OR REPLACE FUNCTION refresh_margen_final_roll()
RETURNS TABLE (inserted_rows BIGINT, elapsed_ms BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
  t0 TIMESTAMPTZ := clock_timestamp();
  n BIGINT;
BEGIN
  TRUNCATE margen_final_roll;

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
    COALESCE(SUM(COALESCE(vlrtot_bru, 0)), 0),
    COALESCE(SUM(COALESCE(tot_costo, 0)), 0),
    COALESCE(SUM(COALESCE(vlrtot_bru, 0) - COALESCE(tot_costo, 0)), 0),
    COALESCE(SUM(COALESCE(cantidad, 0)), 0),
    COALESCE(SUM(COALESCE(ven_totales, 0)), 0)
  FROM margen_final
  WHERE fecha_dcto IS NOT NULL
    AND fecha_dcto ~ '^[0-9]{8}$'
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9;

  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE margen_final_roll;

  RETURN QUERY
  SELECT
    n,
    (EXTRACT(EPOCH FROM (clock_timestamp() - t0)) * 1000)::BIGINT;
END;
$$;
