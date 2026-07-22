-- Caja + vendedor en el rollup de margenes (2026-07-22).
--
-- Agrega atributos de factura a margen_final_roll (ya existen en margen_final):
--   id_caja        caja/punto de venta
--   vend_cc        codigo cajero/vendedor
--   vend_cc_desc   nombre cajero/vendedor
--
-- Son atributos de la FACTURA (constantes por documento_fc + id_tipdoc_fc + sede),
-- asi que entran como MAX() sin cambiar el PK/GROUP BY del roll.
--
-- IDEMPOTENTE. Tras aplicar: refresh incremental del rango con datos de cliente
-- (desde 20260701) o full: npm run margen:refresh-roll

ALTER TABLE margen_final_roll
  ADD COLUMN IF NOT EXISTS id_caja TEXT,
  ADD COLUMN IF NOT EXISTS vend_cc TEXT,
  ADD COLUMN IF NOT EXISTS vend_cc_desc TEXT;

COMMENT ON COLUMN margen_final_roll.id_caja IS
  'Caja/punto de venta (MAX por factura desde margen_final.id_caja).';
COMMENT ON COLUMN margen_final_roll.vend_cc IS
  'Codigo cajero/vendedor (MAX por factura desde margen_final.vend_cc).';
COMMENT ON COLUMN margen_final_roll.vend_cc_desc IS
  'Nombre cajero/vendedor (MAX por factura desde margen_final.vend_cc_desc).';

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
    id_caja,
    vend_cc,
    vend_cc_desc,
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
    MAX(NULLIF(trim(id_caja), '')) AS id_caja,
    MAX(NULLIF(trim(vend_cc), '')) AS vend_cc,
    MAX(NULLIF(trim(vend_cc_desc), '')) AS vend_cc_desc,
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
  'Pobla margen_final_roll (factura+item). Incluye documento_docfc/id_terc/nombre_terc/id_caja/vend_cc/vend_cc_desc como MAX() por factura.';
