-- Agregado dia+sede+item sin factura: acelera /informe-variacion.
-- Se alimenta desde margen_final_roll (mas liviano que margen_final).
-- Tras refrescar el roll de margen: SELECT refresh_margen_item_dia_roll();
-- o: npm run margen:refresh-roll (ya invoca este paso al final).

CREATE TABLE IF NOT EXISTS margen_item_dia_roll (
  fecha_dcto TEXT NOT NULL,
  empresa_norm TEXT NOT NULL,
  id_co_norm TEXT NOT NULL,
  id_tipo TEXT NOT NULL DEFAULT '',
  id_linea1 TEXT NOT NULL DEFAULT '',
  id_linea2 TEXT NOT NULL DEFAULT '',
  id_item TEXT NOT NULL DEFAULT '',
  nombre_linea1 TEXT,
  nombre_linea2 TEXT,
  item_descripcion TEXT,
  cantidad NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ventas_netas NUMERIC(18, 4) NOT NULL DEFAULT 0,
  CONSTRAINT margen_item_dia_roll_pk PRIMARY KEY (
    fecha_dcto,
    empresa_norm,
    id_co_norm,
    id_tipo,
    id_linea1,
    id_linea2,
    id_item
  )
);

COMMENT ON TABLE margen_item_dia_roll IS
  'Agregado por dia/sede/item (sin factura). Fuente preferida de /api/informe-variacion.';

CREATE INDEX IF NOT EXISTS margen_item_dia_roll_idx_fecha_sede
  ON margen_item_dia_roll (fecha_dcto, empresa_norm, id_co_norm);

CREATE INDEX IF NOT EXISTS margen_item_dia_roll_idx_sede_fecha
  ON margen_item_dia_roll (empresa_norm, id_co_norm, fecha_dcto);

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
    ventas_netas
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
    COALESCE(SUM(COALESCE(ventas_netas, 0)), 0)
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
