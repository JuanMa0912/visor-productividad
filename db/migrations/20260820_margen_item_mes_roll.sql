-- Agregado mes+sede+item para /informe-variacion con rangos YTD / multi-mes.
-- Se alimenta desde margen_item_dia_roll (no requiere tabla nueva en GCP).
-- Tras refresh diario: SELECT refresh_margen_item_mes_roll();
-- npm run margen:refresh-roll y scripts/refresh-variacion-roll.sh lo invocan.

CREATE TABLE IF NOT EXISTS margen_item_mes_roll (
  anio_mes TEXT NOT NULL,
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
  costo_total NUMERIC(18, 4) NOT NULL DEFAULT 0,
  margen_pesos NUMERIC(18, 4) NOT NULL DEFAULT 0,
  CONSTRAINT margen_item_mes_roll_pk PRIMARY KEY (
    anio_mes,
    empresa_norm,
    id_co_norm,
    id_tipo,
    id_linea1,
    id_linea2,
    id_item
  )
);

COMMENT ON TABLE margen_item_mes_roll IS
  'Agregado mensual (YYYYMM) desde margen_item_dia_roll. Acelera comparativos YTD de /informe-variacion.';

CREATE INDEX IF NOT EXISTS margen_item_mes_roll_idx_mes_sede
  ON margen_item_mes_roll (anio_mes, empresa_norm, id_co_norm);

CREATE OR REPLACE FUNCTION refresh_margen_item_mes_roll(
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
  v_from_month TEXT;
  v_to_month TEXT;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'margen_item_dia_roll'
  ) INTO has_source;

  IF NOT has_source THEN
    RAISE EXCEPTION 'margen_item_dia_roll no existe; aplica 20260708_margen_item_dia_roll.sql primero';
  END IF;

  IF p_from IS NULL OR p_to IS NULL THEN
    DROP TABLE IF EXISTS margen_item_mes_roll_building;
    CREATE TABLE margen_item_mes_roll_building (
      LIKE margen_item_mes_roll INCLUDING DEFAULTS INCLUDING IDENTITY
    );

    INSERT INTO margen_item_mes_roll_building (
      anio_mes,
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
      LEFT(fecha_dcto, 6) AS anio_mes,
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
    FROM margen_item_dia_roll
    WHERE fecha_dcto IS NOT NULL
      AND fecha_dcto ~ '^[0-9]{8}$'
    GROUP BY
      LEFT(fecha_dcto, 6),
      empresa_norm,
      id_co_norm,
      id_tipo,
      id_linea1,
      id_linea2,
      id_item;

    GET DIAGNOSTICS n = ROW_COUNT;

    ALTER TABLE margen_item_mes_roll_building
      ADD CONSTRAINT margen_item_mes_roll_building_pk PRIMARY KEY (
        anio_mes,
        empresa_norm,
        id_co_norm,
        id_tipo,
        id_linea1,
        id_linea2,
        id_item
      );

    CREATE INDEX margen_item_mes_roll_building_idx_mes_sede
      ON margen_item_mes_roll_building (anio_mes, empresa_norm, id_co_norm);

    DROP TABLE IF EXISTS margen_item_mes_roll_old;
    BEGIN
      ALTER TABLE margen_item_mes_roll RENAME TO margen_item_mes_roll_old;
    EXCEPTION
      WHEN undefined_table THEN
        NULL;
    END;
    ALTER TABLE margen_item_mes_roll_building RENAME TO margen_item_mes_roll;
    DROP TABLE IF EXISTS margen_item_mes_roll_old;

    ALTER INDEX IF EXISTS margen_item_mes_roll_building_pk
      RENAME TO margen_item_mes_roll_pk;
    ALTER INDEX IF EXISTS margen_item_mes_roll_building_idx_mes_sede
      RENAME TO margen_item_mes_roll_idx_mes_sede;

    ANALYZE margen_item_mes_roll;

    RETURN QUERY
    SELECT
      n,
      (EXTRACT(EPOCH FROM (clock_timestamp() - t0)) * 1000)::BIGINT;
    RETURN;
  END IF;

  v_from_month := LEFT(p_from, 6);
  v_to_month := LEFT(p_to, 6);

  DELETE FROM margen_item_mes_roll
  WHERE anio_mes >= v_from_month
    AND anio_mes <= v_to_month;

  INSERT INTO margen_item_mes_roll (
    anio_mes,
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
    LEFT(fecha_dcto, 6) AS anio_mes,
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
  FROM margen_item_dia_roll
  WHERE fecha_dcto IS NOT NULL
    AND fecha_dcto ~ '^[0-9]{8}$'
    AND LEFT(fecha_dcto, 6) >= v_from_month
    AND LEFT(fecha_dcto, 6) <= v_to_month
  GROUP BY
    LEFT(fecha_dcto, 6),
    empresa_norm,
    id_co_norm,
    id_tipo,
    id_linea1,
    id_linea2,
    id_item;

  GET DIAGNOSTICS n = ROW_COUNT;
  ANALYZE margen_item_mes_roll;

  RETURN QUERY
  SELECT
    n,
    (EXTRACT(EPOCH FROM (clock_timestamp() - t0)) * 1000)::BIGINT;
END;
$$;

COMMENT ON FUNCTION refresh_margen_item_mes_roll(TEXT, TEXT) IS
  'Rebuild mensual via staging+rename; incremental DELETE+INSERT por meses de la ventana.';
