-- Refresh del rollup sin statement_timeout + soporte por rango de fechas (chunk mensual).

DROP FUNCTION IF EXISTS refresh_margen_final_roll();

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
  'Pobla margen_final_roll. Sin args: full refresh. Con p_from/p_to: reemplaza solo ese rango YYYYMMDD.';
