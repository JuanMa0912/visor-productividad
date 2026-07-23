-- ============================================================================
-- Dinastia: matview diaria + snapshot periodo_std (paridad con rotacion legacy)
-- ============================================================================
-- Fuente: rotacion_dinastia
-- Objetos:
--   rotacion_dinastia_item_dia_clean          (matview)
--   rotacion_dinastia_item_periodo_std        (tabla snapshot)
--   rotacion_dinastia_item_periodo_std_meta
--   refresh_rotacion_dinastia_item_periodo_std()
--
-- Matview se crea WITH NO DATA para no bloquear el apply; poblar con:
--   REFRESH MATERIALIZED VIEW rotacion_dinastia_item_dia_clean;
--   SELECT * FROM refresh_rotacion_dinastia_item_periodo_std();
-- o scripts/refresh-rotacion-matview.sh (ya incluye Dinastia).
-- ============================================================================

SET statement_timeout = 0;
SET lock_timeout = 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'rotacion_dinastia'
  ) THEN
    RAISE NOTICE 'Tabla rotacion_dinastia no existe. Abortando matview Dinastia.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_matviews WHERE matviewname = 'rotacion_dinastia_item_dia_clean'
  ) THEN
    RAISE NOTICE 'rotacion_dinastia_item_dia_clean ya existe; recreando...';
    EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS rotacion_dinastia_item_dia_clean CASCADE';
  END IF;

  RAISE NOTICE 'Creando rotacion_dinastia_item_dia_clean (WITH NO DATA)...';
  EXECUTE $sql$
    CREATE MATERIALIZED VIEW rotacion_dinastia_item_dia_clean AS
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
        COALESCE(fecha_carga, fecha_dia::timestamp) AS carga_ts,
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
      FROM rotacion_dinastia
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
    WITH NO DATA
  $sql$;

  EXECUTE $sql$
    CREATE UNIQUE INDEX IF NOT EXISTS rotacion_dinastia_clean_uq_fecha_emp_sede_item
    ON rotacion_dinastia_item_dia_clean (fecha, empresa, sede_id, item)
  $sql$;

  EXECUTE $sql$
    CREATE INDEX IF NOT EXISTS rotacion_dinastia_clean_idx_empresa_sede_fecha
    ON rotacion_dinastia_item_dia_clean (empresa, sede_id, fecha DESC)
  $sql$;

  EXECUTE $sql$
    CREATE INDEX IF NOT EXISTS rotacion_dinastia_clean_idx_fecha
    ON rotacion_dinastia_item_dia_clean (fecha DESC)
  $sql$;

  EXECUTE $sql$
    CREATE INDEX IF NOT EXISTS rotacion_dinastia_clean_idx_n1_n2_fecha
    ON rotacion_dinastia_item_dia_clean (
      empresa, sede_id, linea_n1_codigo, linea_n2_codigo, fecha DESC
    )
    WHERE linea_n2_codigo IS NOT NULL
  $sql$;

  RAISE NOTICE 'Matview rotacion_dinastia_item_dia_clean creada (vacía; falta REFRESH).';
END $$;

CREATE TABLE IF NOT EXISTS rotacion_dinastia_item_periodo_std_meta (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  periodo_start date NOT NULL,
  periodo_end date NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT NOW(),
  row_count bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rotacion_dinastia_item_periodo_std (
  empresa text NOT NULL,
  sede_id text NOT NULL,
  sede_name text NOT NULL,
  linea text NOT NULL,
  linea_n1_codigo text,
  linea_n2_codigo text,
  sublinea text,
  item text NOT NULL,
  descripcion text NOT NULL,
  unidad text,
  bodega text,
  nombre_bodega text,
  categoria text,
  nombre_categoria text,
  categoria_key text,
  linea01 text,
  nombre_linea01 text,
  total_sales numeric NOT NULL,
  total_cost numeric NOT NULL,
  total_margin numeric NOT NULL,
  margin_daily_avg_pct numeric NOT NULL,
  total_units numeric NOT NULL,
  opening_inventory_units numeric NOT NULL,
  min_inventory_units numeric NOT NULL,
  inventory_units numeric NOT NULL,
  inventory_value numeric NOT NULL,
  rotation numeric NOT NULL,
  tracked_days integer NOT NULL,
  sales_effective_days integer NOT NULL,
  last_movement_date date,
  last_purchase_date date,
  effective_days integer,
  status text NOT NULL,
  PRIMARY KEY (empresa, sede_id, item)
);

CREATE INDEX IF NOT EXISTS rotacion_dinastia_periodo_std_idx_empresa_sede
  ON rotacion_dinastia_item_periodo_std (empresa, sede_id);

CREATE INDEX IF NOT EXISTS rotacion_dinastia_periodo_std_idx_empresa_sede_sales
  ON rotacion_dinastia_item_periodo_std (
    empresa, sede_id, total_sales DESC, inventory_value DESC
  );

CREATE INDEX IF NOT EXISTS rotacion_dinastia_periodo_std_idx_linea_n1
  ON rotacion_dinastia_item_periodo_std (empresa, sede_id, linea_n1_codigo);

CREATE INDEX IF NOT EXISTS rotacion_dinastia_periodo_std_idx_linea_n2
  ON rotacion_dinastia_item_periodo_std (empresa, sede_id, linea_n2_codigo);

CREATE INDEX IF NOT EXISTS rotacion_dinastia_periodo_std_idx_categoria_key
  ON rotacion_dinastia_item_periodo_std (empresa, sede_id, categoria_key);

CREATE OR REPLACE FUNCTION refresh_rotacion_dinastia_item_periodo_std()
RETURNS TABLE (
  out_periodo_start date,
  out_periodo_end date,
  out_row_count bigint
)
LANGUAGE plpgsql
SET statement_timeout = 0
AS $$
DECLARE
  v_max_date date;
  v_min_date date;
  v_days_prev integer;
  v_start date;
  v_end date;
  v_count bigint;
  v_future_stockout_days constant numeric := 7;
  v_low_rotation_days constant numeric := 45;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_matviews WHERE matviewname = 'rotacion_dinastia_item_dia_clean'
  ) THEN
    RAISE NOTICE 'rotacion_dinastia_item_dia_clean no existe; skip refresh_rotacion_dinastia_item_periodo_std';
    RETURN;
  END IF;

  SELECT MAX(fecha), MIN(fecha)
    INTO v_max_date, v_min_date
  FROM rotacion_dinastia_item_dia_clean;

  IF v_max_date IS NULL THEN
    RAISE NOTICE 'rotacion_dinastia_item_dia_clean vacia; skip refresh_rotacion_dinastia_item_periodo_std';
    RETURN;
  END IF;

  v_days_prev := EXTRACT(
    DAY FROM (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 day')
  )::integer;
  v_end := v_max_date;
  v_start := v_end - (v_days_prev - 1);
  IF v_start < v_min_date THEN
    v_start := v_min_date;
  END IF;
  IF v_start > v_end THEN
    v_start := v_end;
  END IF;

  TRUNCATE rotacion_dinastia_item_periodo_std;

  INSERT INTO rotacion_dinastia_item_periodo_std (
    empresa,
    sede_id,
    sede_name,
    linea,
    linea_n1_codigo,
    linea_n2_codigo,
    sublinea,
    item,
    descripcion,
    unidad,
    bodega,
    nombre_bodega,
    categoria,
    nombre_categoria,
    categoria_key,
    linea01,
    nombre_linea01,
    total_sales,
    total_cost,
    total_margin,
    margin_daily_avg_pct,
    total_units,
    opening_inventory_units,
    min_inventory_units,
    inventory_units,
    inventory_value,
    rotation,
    tracked_days,
    sales_effective_days,
    last_movement_date,
    last_purchase_date,
    effective_days,
    status
  )
  WITH base AS (
    SELECT
      fecha,
      empresa,
      sede_id,
      sede_name,
      item,
      descripcion,
      unidad,
      linea,
      linea_n1_codigo,
      linea_n2_codigo,
      sublinea,
      bodega,
      categoria,
      nombre_categoria,
      categoria_key,
      venta_sin_impuesto_dia,
      cost_value_dia,
      margin_value_dia,
      unidades_vendidas_dia,
      inventory_units_dia,
      inventory_value_dia,
      ultima_venta_pdv,
      ultima_venta_inventario,
      fecha_ultima_compra,
      fecha_ultima_entrada,
      carga_ts
    FROM rotacion_dinastia_item_dia_clean
    WHERE fecha BETWEEN v_start AND v_end
  ),
  ranked AS (
    SELECT
      base.*,
      MIN(fecha) OVER (PARTITION BY empresa, sede_id, item) AS first_fecha,
      MAX(fecha) OVER (PARTITION BY empresa, sede_id, item) AS latest_fecha,
      ROW_NUMBER() OVER (
        PARTITION BY empresa, sede_id, item
        ORDER BY fecha DESC, carga_ts DESC NULLS LAST
      ) AS latest_rank
    FROM base
  ),
  aggregated AS (
    SELECT
      empresa,
      sede_id,
      MAX(sede_name) AS sede_name,
      MAX(linea) AS linea,
      MAX(linea_n1_codigo) AS linea_n1_codigo,
      MAX(linea_n2_codigo) AS linea_n2_codigo,
      MAX(sublinea) AS sublinea,
      item,
      MAX(descripcion) AS descripcion,
      MAX(unidad) AS unidad,
      SUM(venta_sin_impuesto_dia)::numeric AS total_sales,
      SUM(cost_value_dia)::numeric AS total_cost,
      SUM(margin_value_dia)::numeric AS total_margin,
      COALESCE(
        AVG(
          CASE
            WHEN venta_sin_impuesto_dia > 0
            THEN (margin_value_dia / venta_sin_impuesto_dia) * 100
            ELSE NULL
          END
        ),
        0
      )::numeric AS margin_daily_avg_pct,
      SUM(unidades_vendidas_dia)::numeric AS total_units,
      MAX(
        CASE
          WHEN COALESCE(fecha_ultima_compra, fecha_ultima_entrada)
               BETWEEN v_start AND v_end
          THEN COALESCE(fecha_ultima_compra, fecha_ultima_entrada)
          WHEN COALESCE(ultima_venta_pdv, ultima_venta_inventario)
               BETWEEN v_start AND v_end
          THEN COALESCE(ultima_venta_pdv, ultima_venta_inventario)
          ELSE NULL
        END
      ) AS last_movement_date,
      MAX(COALESCE(ultima_venta_pdv, ultima_venta_inventario)) AS last_purchase_date,
      SUM(
        CASE WHEN fecha = first_fecha THEN inventory_units_dia ELSE 0 END
      )::numeric AS opening_inventory_units,
      MIN(inventory_units_dia)::numeric AS min_inventory_units,
      SUM(
        CASE WHEN fecha = latest_fecha THEN inventory_units_dia ELSE 0 END
      )::numeric AS inventory_units,
      SUM(
        CASE WHEN fecha = latest_fecha THEN inventory_value_dia ELSE 0 END
      )::numeric AS inventory_value,
      MAX(CASE WHEN latest_rank = 1 THEN bodega END) AS bodega,
      MAX(CASE WHEN latest_rank = 1 THEN categoria END) AS categoria,
      MAX(CASE WHEN latest_rank = 1 THEN nombre_categoria END) AS nombre_categoria,
      MAX(CASE WHEN latest_rank = 1 THEN categoria_key END) AS categoria_key,
      MAX(CASE WHEN latest_rank = 1 THEN linea_n1_codigo END) AS linea01,
      MAX(CASE WHEN latest_rank = 1 THEN linea END) AS nombre_linea01,
      COUNT(DISTINCT fecha)::int AS tracked_days,
      COUNT(
        DISTINCT CASE
          WHEN unidades_vendidas_dia > 0 THEN fecha
          ELSE NULL
        END
      )::int AS sales_effective_days
    FROM ranked
    GROUP BY
      empresa,
      sede_id,
      item
  ),
  enriched AS (
    SELECT
      *,
      NULL::text AS nombre_bodega,
      CASE
        WHEN COALESCE(inventory_units, 0) <= 0
          OR COALESCE(inventory_value, 0) <= 0 THEN 0::numeric
        WHEN COALESCE(total_units, 0) <= 0
          OR COALESCE(tracked_days, 0) <= 0 THEN 999999::numeric
        ELSE (COALESCE(inventory_units, 0) * tracked_days::numeric)
             / NULLIF(total_units, 0)
      END AS rotation,
      CASE
        WHEN last_movement_date IS NULL THEN NULL
        ELSE (v_end - last_movement_date)
      END::int AS effective_days
    FROM aggregated
  ),
  classified AS (
    SELECT
      *,
      CASE
        WHEN inventory_units <= 0 OR inventory_value <= 0 THEN 'Agotado'
        WHEN total_units > 0
          AND tracked_days > 0
          AND inventory_units > 0
          AND inventory_units <= ((total_units / tracked_days) * v_future_stockout_days)
          THEN 'Futuro agotado'
        WHEN COALESCE(rotation, 0) > v_low_rotation_days THEN 'Baja rotacion'
        ELSE 'En seguimiento'
      END AS status
    FROM enriched
  )
  SELECT
    empresa,
    sede_id,
    sede_name,
    linea,
    linea_n1_codigo,
    linea_n2_codigo,
    sublinea,
    item,
    descripcion,
    unidad,
    bodega,
    nombre_bodega,
    categoria,
    nombre_categoria,
    categoria_key,
    linea01,
    nombre_linea01,
    total_sales,
    total_cost,
    total_margin,
    margin_daily_avg_pct,
    total_units,
    opening_inventory_units,
    min_inventory_units,
    inventory_units,
    inventory_value,
    rotation,
    tracked_days,
    sales_effective_days,
    last_movement_date,
    last_purchase_date,
    effective_days,
    status
  FROM classified;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO rotacion_dinastia_item_periodo_std_meta (
    id,
    periodo_start,
    periodo_end,
    refreshed_at,
    row_count
  )
  VALUES (1, v_start, v_end, NOW(), v_count)
  ON CONFLICT (id) DO UPDATE SET
    periodo_start = EXCLUDED.periodo_start,
    periodo_end = EXCLUDED.periodo_end,
    refreshed_at = EXCLUDED.refreshed_at,
    row_count = EXCLUDED.row_count;

  ANALYZE rotacion_dinastia_item_periodo_std;

  out_periodo_start := v_start;
  out_periodo_end := v_end;
  out_row_count := v_count;
  RETURN NEXT;
END;
$$;

COMMENT ON MATERIALIZED VIEW rotacion_dinastia_item_dia_clean IS
  'Matview diaria limpia/agregada sobre rotacion_dinastia (paridad con rotacion_item_dia_clean).';

COMMENT ON TABLE rotacion_dinastia_item_periodo_std IS
  'Snapshot rolling default para rotacion Dinastia (paridad con rotacion_item_periodo_std).';
