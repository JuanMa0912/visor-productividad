-- Margen en rollup dia+item para /informe-variacion (tabla resumen por sede).

ALTER TABLE margen_item_dia_roll
  ADD COLUMN IF NOT EXISTS costo_total NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS margen_pesos NUMERIC(18, 4) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION refresh_margen_item_dia_roll(
  p_from TEXT DEFAULT NULL,
  p_to TEXT DEFAULT NULL
)
RETURNS TABLE (inserted_rows BIGINT, elapsed_ms BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
  t0 TIMESTAMPTZ := clock_timestamp();
  n BIGINT;
  has_source BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'margen_final_roll'
  ) INTO has_source;

  IF NOT has_source THEN
    RAISE EXCEPTION 'margen_final_roll no existe; aplica 20260702_margen_final_roll.sql primero';
  END IF;

  IF p_from IS NULL OR p_to IS NULL THEN
    TRUNCATE margen_item_dia_roll;
  ELSE
    DELETE FROM margen_item_dia_roll
    WHERE fecha_dcto >= p_from
      AND fecha_dcto <= p_to;
  END IF;

  INSERT INTO margen_item_dia_roll (
    fecha_dcto,
    empresa_norm,
    id_co_norm,
    id_tipo,
    id_linea1,
    id_linea2,
    id_item,
    nombre_linea1,
    nombre_linea2,
    item_descripcion,
    cantidad,
    ventas_netas,
    costo_total,
    margen_pesos
  )
  SELECT
    fecha_dcto,
    empresa_norm,
    id_co_norm,
    id_tipo,
    id_linea1,
    id_linea2,
    id_item,
    MAX(NULLIF(trim(nombre_linea1), '')) AS nombre_linea1,
    MAX(NULLIF(trim(nombre_linea2), '')) AS nombre_linea2,
    MAX(NULLIF(trim(item_descripcion), '')) AS item_descripcion,
    COALESCE(SUM(COALESCE(cantidad, 0)), 0),
    COALESCE(SUM(COALESCE(ventas_netas, 0)), 0),
    COALESCE(SUM(COALESCE(costo_total, 0)), 0),
    COALESCE(SUM(COALESCE(margen_pesos, 0)), 0)
  FROM margen_final_roll
  WHERE fecha_dcto IS NOT NULL
    AND fecha_dcto ~ '^[0-9]{8}$'
    AND (p_from IS NULL OR fecha_dcto >= p_from)
    AND (p_to IS NULL OR fecha_dcto <= p_to)
  GROUP BY
    fecha_dcto,
    empresa_norm,
    id_co_norm,
    id_tipo,
    id_linea1,
    id_linea2,
    id_item;

  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE margen_item_dia_roll;

  RETURN QUERY
  SELECT
    n,
    (EXTRACT(EPOCH FROM (clock_timestamp() - t0)) * 1000)::BIGINT;
END;
$$;
