-- ============================================================================
-- Migracion: rotacion_item_dia_clean (vista materializada)
-- ============================================================================
-- Pre-procesa la tabla rotacion_base_item_dia_sede para resolver el cuello de
-- botella reportado por GCP: queries con TRIM/COALESCE/LPAD/CASE sobre 6.5M
-- filas que saturan CPU al 100%.
--
-- Estrategia:
--   1. Limpia strings UNA VEZ en el refresh (TRIM/COALESCE/LPAD/normalizacion
--      de sede). El endpoint /api/rotacion ya NO repite esto en cada request.
--   2. Pre-filtra categorias excluidas (3/V, PRODUCTO TERMINADO, SERVICIOS DE
--      VENTA) y sedes hidden (CEDI, CEI, IMP, PPT, etc).
--   3. Agrega por (fecha, empresa, sede_id, item) sumando sobre bodega_local.
--      Esto reduce ~5x el numero de filas finales: en lugar de tener 1 fila
--      por (fecha, empresa, sede, bodega, item) tenemos 1 fila por
--      (fecha, empresa, sede, item) con la suma de inventario / venta / costo
--      de todas las bodegas. La dimension bodega se conserva como MAX
--      (orden alfabetico) para mantener la columna en la respuesta del API.
--   4. Pre-calcula las metricas que necesita el query principal:
--      - venta_sin_impuesto_dia, cost_value_dia, margin_value_dia,
--        unidades_vendidas_dia (todas SUM por dia)
--      - inventory_units_dia, inventory_value_dia (snapshot diario)
--
-- Costo estimado: matview ~5M filas, ~1-1.5 GB. Refresh nocturno tarda ~3-5 min.
--
-- Es idempotente: re-correr no crea nada duplicado.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'rotacion_base_item_dia_sede'
  ) THEN
    RAISE NOTICE 'Tabla rotacion_base_item_dia_sede no existe. Abortando migracion.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_matviews WHERE matviewname = 'rotacion_item_dia_clean'
  ) THEN
    RAISE NOTICE 'Creando vista materializada rotacion_item_dia_clean...';
    EXECUTE $sql$
      CREATE MATERIALIZED VIEW rotacion_item_dia_clean AS
      WITH cleaned AS (
        SELECT
          fecha_dia AS fecha,
          COALESCE(NULLIF(TRIM(empresa::text), ''), 'sin_empresa') AS empresa,
          COALESCE(NULLIF(TRIM(sede::text), ''), 'sin_sede') AS sede_id,
          COALESCE(
            NULLIF(TRIM(nombre_sede), ''),
            NULLIF(TRIM(sede), ''),
            'Sin sede'
          ) AS sede_name,
          COALESCE(NULLIF(TRIM(id_item::text), ''), 'sin_item') AS item,
          COALESCE(
            NULLIF(TRIM(nombre_item), ''),
            NULLIF(TRIM(id_item), ''),
            'Sin descripcion'
          ) AS descripcion,
          NULLIF(TRIM(id_unidad), '') AS unidad,
          COALESCE(NULLIF(TRIM(nombre_linea_nivel_1), ''), 'Sin linea') AS linea,
          (
            CASE
              WHEN NULLIF(TRIM(id_linea_nivel_1::text), '') IS NULL THEN NULL::text
              WHEN NULLIF(TRIM(id_linea_nivel_1::text), '') ~ '^[0-9]+$'
                THEN LPAD(NULLIF(TRIM(id_linea_nivel_1::text), ''), 2, '0')
              ELSE NULLIF(TRIM(id_linea_nivel_1::text), '')
            END
          ) AS linea_n1_codigo,
          NULLIF(TRIM(bodega_local), '') AS bodega,
          NULLIF(TRIM(id_categoria), '') AS categoria,
          NULLIF(TRIM(nombre_categoria), '') AS nombre_categoria,
          COALESCE(venta_sin_impuesto, 0)::numeric AS venta_sin_impuesto,
          COALESCE(total_costo, 0)::numeric AS total_costo,
          COALESCE(cantidad_vendida, 0)::numeric AS cantidad_vendida,
          GREATEST(COALESCE(can_disponible_foto, 0), 0)::numeric AS can_disponible_foto,
          COALESCE(costo_uni_inventario, 0)::numeric AS costo_uni_inventario,
          ultima_venta_pdv,
          ultima_venta_inventario,
          fecha_ultima_compra,
          fecha_ultima_entrada,
          COALESCE(fecha_actualizacion, fecha_carga, fecha_dia::timestamp) AS carga_ts,
          (
            CASE
              WHEN NULLIF(TRIM(id_categoria::text), '') IS NULL THEN '__sin_cat__'
              ELSE NULLIF(TRIM(id_categoria::text), '')
            END
          ) AS categoria_key,
          lower(regexp_replace(translate(
            COALESCE(
              NULLIF(TRIM(nombre_sede::text), ''),
              NULLIF(TRIM(sede::text), ''),
              'Sin sede'
            ),
            'áéíóúÁÉÍÓÚñÑ',
            'aeiouAEIOUnN'
          ), '[^a-zA-Z0-9]+', '', 'g')) AS sede_normalized
        FROM rotacion_base_item_dia_sede
        WHERE NULLIF(TRIM(id_item::text), '') IS NOT NULL
      ),
      filtered AS (
        SELECT *
        FROM cleaned
        WHERE NOT (categoria_key = ANY(ARRAY['3', 'V']::text[]))
          AND UPPER(TRIM(COALESCE(nombre_categoria, ''))) <> ALL(
            ARRAY['PRODUCTO TERMINADO', 'SERVICIOS DE VENTA']::text[]
          )
          AND sede_normalized <> ALL(ARRAY[
            'adm', 'cedicavasa', 'centrodistribucioncavasa', 'importados',
            'cei', 'imp', 'ppt',
            'mercamiocei', 'mercamioimp', 'mercamioppt'
          ]::text[])
      )
      SELECT
        fecha,
        empresa,
        sede_id,
        MAX(sede_name) AS sede_name,
        item,
        MAX(descripcion) AS descripcion,
        MAX(unidad) AS unidad,
        MAX(linea) AS linea,
        MAX(linea_n1_codigo) AS linea_n1_codigo,
        MAX(bodega) AS bodega,
        MAX(categoria) AS categoria,
        MAX(nombre_categoria) AS nombre_categoria,
        MAX(categoria_key) AS categoria_key,
        SUM(venta_sin_impuesto)::numeric AS venta_sin_impuesto_dia,
        SUM(ROUND(total_costo::numeric, 2))::numeric AS cost_value_dia,
        SUM(ROUND((venta_sin_impuesto - total_costo)::numeric, 2))::numeric AS margin_value_dia,
        SUM(cantidad_vendida)::numeric AS unidades_vendidas_dia,
        SUM(can_disponible_foto)::numeric AS inventory_units_dia,
        SUM(can_disponible_foto * costo_uni_inventario)::numeric AS inventory_value_dia,
        MAX(ultima_venta_pdv) AS ultima_venta_pdv,
        MAX(ultima_venta_inventario) AS ultima_venta_inventario,
        MAX(fecha_ultima_compra) AS fecha_ultima_compra,
        MAX(fecha_ultima_entrada) AS fecha_ultima_entrada,
        MAX(carga_ts) AS carga_ts
      FROM filtered
      GROUP BY 1, 2, 3, 5
      WITH DATA
    $sql$;
    RAISE NOTICE 'Vista materializada creada. Creando indices...';
  ELSE
    RAISE NOTICE 'Vista materializada rotacion_item_dia_clean ya existe. Saltando creacion.';
  END IF;

  EXECUTE $sql$
    CREATE UNIQUE INDEX IF NOT EXISTS rotacion_clean_uq_fecha_emp_sede_item
    ON rotacion_item_dia_clean (fecha, empresa, sede_id, item)
  $sql$;

  EXECUTE $sql$
    CREATE INDEX IF NOT EXISTS rotacion_clean_idx_empresa_sede_fecha
    ON rotacion_item_dia_clean (empresa, sede_id, fecha DESC)
  $sql$;

  EXECUTE $sql$
    CREATE INDEX IF NOT EXISTS rotacion_clean_idx_fecha
    ON rotacion_item_dia_clean (fecha DESC)
  $sql$;

  EXECUTE 'ANALYZE rotacion_item_dia_clean';

  RAISE NOTICE 'Migracion rotacion_item_dia_clean completada.';
END $$;
