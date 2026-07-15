-- Rebuild de margen_item_dia_roll sin dejar la tabla vacia a lectores.
-- Antes: TRUNCATE + INSERT (~7 min) → /informe-variacion sin datos.
-- Ahora: llena una tabla staging y hace RENAME atómico.

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

  -- Rebuild completo: staging + swap (lecturas siguen viendo datos viejos hasta el RENAME).
  IF p_from IS NULL OR p_to IS NULL THEN
    DROP TABLE IF EXISTS margen_item_dia_roll_building;
    CREATE TABLE margen_item_dia_roll_building (
      LIKE margen_item_dia_roll INCLUDING DEFAULTS INCLUDING IDENTITY
    );

    INSERT INTO margen_item_dia_roll_building (
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
    GROUP BY
      fecha_dcto,
      empresa_norm,
      id_co_norm,
      id_tipo,
      id_linea1,
      id_linea2,
      id_item;

    GET DIAGNOSTICS n = ROW_COUNT;

    ALTER TABLE margen_item_dia_roll_building
      ADD CONSTRAINT margen_item_dia_roll_building_pk PRIMARY KEY (
        fecha_dcto,
        empresa_norm,
        id_co_norm,
        id_tipo,
        id_linea1,
        id_linea2,
        id_item
      );

    CREATE INDEX margen_item_dia_roll_building_idx_fecha_sede
      ON margen_item_dia_roll_building (fecha_dcto, empresa_norm, id_co_norm);
    CREATE INDEX margen_item_dia_roll_building_idx_sede_fecha
      ON margen_item_dia_roll_building (empresa_norm, id_co_norm, fecha_dcto);

    DROP TABLE IF EXISTS margen_item_dia_roll_old;
    BEGIN
      ALTER TABLE margen_item_dia_roll RENAME TO margen_item_dia_roll_old;
    EXCEPTION
      WHEN undefined_table THEN
        NULL;
    END;
    ALTER TABLE margen_item_dia_roll_building RENAME TO margen_item_dia_roll;
    DROP TABLE IF EXISTS margen_item_dia_roll_old;

    -- Nombres estables (old ya dropeada; no hay colision).
    ALTER INDEX IF EXISTS margen_item_dia_roll_building_pk
      RENAME TO margen_item_dia_roll_pk;
    ALTER INDEX IF EXISTS margen_item_dia_roll_building_idx_fecha_sede
      RENAME TO margen_item_dia_roll_idx_fecha_sede;
    ALTER INDEX IF EXISTS margen_item_dia_roll_building_idx_sede_fecha
      RENAME TO margen_item_dia_roll_idx_sede_fecha;

    ANALYZE margen_item_dia_roll;

    RETURN QUERY
    SELECT
      n,
      (EXTRACT(EPOCH FROM (clock_timestamp() - t0)) * 1000)::BIGINT;
    RETURN;
  END IF;

  -- Incremental por ventana: DELETE + INSERT (ventana corta; downtime minimo).
  DELETE FROM margen_item_dia_roll
  WHERE fecha_dcto >= p_from
    AND fecha_dcto <= p_to;

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
    AND fecha_dcto >= p_from
    AND fecha_dcto <= p_to
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

COMMENT ON FUNCTION refresh_margen_item_dia_roll(TEXT, TEXT) IS
  'Rebuild completo via staging+rename (sin vaciar a lectores); incremental DELETE+INSERT por rango.';
