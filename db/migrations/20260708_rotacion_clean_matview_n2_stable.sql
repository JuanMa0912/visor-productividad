-- ============================================================================
-- Migracion: rotacion_item_dia_clean — N2 estable + indice filtro
-- ============================================================================
-- Mejora la atribucion de sublinea (N2) en la agregacion diaria:
--   - Antes: MAX(linea_n2_codigo) / MAX(sublinea) podia elegir un codigo
--     lexicografico incorrecto si el mismo item tenia filas con N2 distinto.
--   - Ahora: array_agg ordenado por carga_ts DESC e inventario DESC toma la
--     fila mas reciente / con mayor peso comercial.
--
-- Requisito: rotacion_base_item_dia_sede con id_linea_nivel_2 poblado (ETL v3).
-- Tras aplicar: REFRESH MATERIALIZED VIEW rotacion_item_dia_clean y luego
--   SELECT * FROM refresh_rotacion_item_periodo_std();
-- ============================================================================

SET statement_timeout = 0;
SET lock_timeout = 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'rotacion_base_item_dia_sede'
  ) THEN
    RAISE NOTICE 'Tabla rotacion_base_item_dia_sede no existe. Abortando migracion.';
    RETURN;
  END IF;

  RAISE NOTICE 'Recreando rotacion_item_dia_clean con N2 estable...';
  EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS rotacion_item_dia_clean CASCADE';

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
        COALESCE(NULLIF(TRIM(nombre_linea_nivel_2), ''), 'Sin sublinea') AS sublinea,
        (
          CASE
            WHEN NULLIF(TRIM(id_linea_nivel_2::text), '') IS NULL THEN NULL::text
            WHEN NULLIF(TRIM(id_linea_nivel_2::text), '') ~ '^[0-9]+$'
              THEN LPAD(NULLIF(TRIM(id_linea_nivel_2::text), ''), 4, '0')
            ELSE NULLIF(TRIM(id_linea_nivel_2::text), '')
          END
        ) AS linea_n2_codigo,
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
      (
        ARRAY_AGG(
          sublinea
          ORDER BY
            CASE
              WHEN sublinea IS NOT NULL AND sublinea <> 'Sin sublinea' THEN 0
              ELSE 1
            END,
            carga_ts DESC NULLS LAST,
            (can_disponible_foto * costo_uni_inventario) DESC NULLS LAST,
            venta_sin_impuesto DESC NULLS LAST
        ) FILTER (WHERE sublinea IS NOT NULL AND sublinea <> 'Sin sublinea')
      )[1] AS sublinea,
      (
        ARRAY_AGG(
          linea_n2_codigo
          ORDER BY
            CASE
              WHEN linea_n2_codigo IS NOT NULL AND linea_n2_codigo <> '' THEN 0
              ELSE 1
            END,
            carga_ts DESC NULLS LAST,
            (can_disponible_foto * costo_uni_inventario) DESC NULLS LAST,
            venta_sin_impuesto DESC NULLS LAST
        ) FILTER (WHERE linea_n2_codigo IS NOT NULL AND linea_n2_codigo <> '')
      )[1] AS linea_n2_codigo,
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

  EXECUTE $sql$
    CREATE INDEX IF NOT EXISTS rotacion_clean_idx_n1_n2_fecha
    ON rotacion_item_dia_clean (empresa, sede_id, linea_n1_codigo, linea_n2_codigo, fecha DESC)
    WHERE linea_n2_codigo IS NOT NULL
  $sql$;

  EXECUTE 'ANALYZE rotacion_item_dia_clean';

  RAISE NOTICE 'Migracion rotacion_item_dia_clean N2 estable completada.';
END $$;
