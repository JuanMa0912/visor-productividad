-- Vista materializada con la data de `margenes_linea_co_dia` ya normalizada
-- (TRIM, formato de fecha unificado, agregada por dia/empresa/sede/linea).
--
-- Contexto: la query original en /api/margenes hacia full table scan + TRIM +
-- COALESCE + TO_CHAR + GROUP BY sobre expresiones computadas en cada llamada,
-- saturando la CPU del Cloud SQL (2 vCPUs). Esta vista hace ese trabajo UNA
-- VEZ por dia (via systemd timer visor-refresh-margenes.timer) y deja la data
-- lista para consultas con WHERE indexado.
--
-- Refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY (requiere el indice UNIQUE
-- de abajo) para no bloquear lecturas mientras se actualiza.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'margenes_linea_co_dia'
  ) THEN

    -- IMPORTANT: usar CREATE MATERIALIZED VIEW IF NOT EXISTS no aplica
    -- aqui porque modifica la definicion. Si necesitas cambiar columnas,
    -- DROP MATERIALIZED VIEW IF EXISTS margenes_linea_co_dia_clean CASCADE;
    -- antes de re-ejecutar esta migracion.
    IF NOT EXISTS (
      SELECT 1 FROM pg_matviews WHERE matviewname = 'margenes_linea_co_dia_clean'
    ) THEN
      -- nombre_linea1 se trata como agregado (MAX) en vez de ser parte del
      -- GROUP BY: en la tabla cruda el mismo id_linea1 a veces tiene varias
      -- variantes de label (case mixto, acentos, espacios), y queremos UNA
      -- sola fila por (fecha, empresa, centro, linea) para poder armar el
      -- indice UNIQUE que REFRESH CONCURRENTLY requiere.
      EXECUTE $sql$
        CREATE MATERIALIZED VIEW margenes_linea_co_dia_clean AS
        SELECT
          CASE
            WHEN fecha_dcto::text ~ '^[0-9]{8}$'
              THEN TO_DATE(fecha_dcto::text, 'YYYYMMDD')
            ELSE fecha_dcto::date
          END AS fecha,
          COALESCE(TRIM(empresa), '') AS empresa,
          LPAD(TRIM(COALESCE(centro_operacion::text, '')), 3, '0') AS centro_operacion,
          COALESCE(TRIM(id_linea1::text), '') AS id_linea1,
          MAX(NULLIF(TRIM(COALESCE(nombre_linea1, '')), '')) AS nombre_linea1,
          COALESCE(SUM(venta_sin_iva), 0)::numeric AS venta_sin_iva,
          COALESCE(SUM(iva), 0)::numeric AS iva,
          COALESCE(SUM(venta_con_iva), 0)::numeric AS venta_con_iva,
          COALESCE(SUM(costo_total), 0)::numeric AS costo_total,
          COALESCE(SUM(utilidad_bruta), 0)::numeric AS utilidad_bruta
        FROM margenes_linea_co_dia
        WHERE fecha_dcto IS NOT NULL
          AND centro_operacion IS NOT NULL
        GROUP BY 1, 2, 3, 4
        WITH DATA
      $sql$;
    END IF;

    -- Indice UNIQUE: requerido para REFRESH ... CONCURRENTLY. La combinacion
    -- (fecha, empresa, centro_operacion, id_linea1) es unica por la propia
    -- definicion del GROUP BY de la vista.
    EXECUTE $idx$
      CREATE UNIQUE INDEX IF NOT EXISTS margenes_clean_uq_fecha_emp_centro_linea
      ON margenes_linea_co_dia_clean (fecha, empresa, centro_operacion, id_linea1)
    $idx$;

    -- Indice principal para rangos de fecha (la query mas comun de la UI).
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS margenes_clean_idx_fecha
      ON margenes_linea_co_dia_clean (fecha DESC)
    $idx$;

    -- Indice secundario por sede + fecha (para vistas pivot por sede).
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS margenes_clean_idx_centro_fecha
      ON margenes_linea_co_dia_clean (centro_operacion, fecha DESC)
    $idx$;

    ANALYZE margenes_linea_co_dia_clean;
  END IF;
END $$;
