-- ============================================================================
-- Migracion: dias_activos (exposicion real por item) en los snapshots periodo_std
-- ============================================================================
-- PROBLEMA
--   rotacion_base_item_dia_sede es DENSA: emite una fila por item x sede x dia
--   aunque el item no exista todavia en esa sede (venta 0, inventario 0). Por eso
--   tracked_days = COUNT(DISTINCT fecha) vale el periodo completo para el 99.3%
--   de los items (verificado: 15754 de 15865 en bogota/001, julio 2026) y NO
--   sirve como denominador de dias.
--   Consecuencia: un item que aparecio a mitad de mes recibe el divisor del mes
--   completo y su DI queda inflado ~10x
--   (005184 MORA COMUN*500g, bogota/001: DI 12.9 d reales 1.3 d).
--
-- SOLUCION
--   Se agregan dos columnas al snapshot:
--     primera_fecha_actividad date  -- MIN(fecha) con venta > 0 O inventario > 0
--     dias_activos             integer -- (v_end - primera_fecha_actividad) + 1
--   acotado a [1, dias del periodo]. Es la VENTANA DE EXPOSICION del item, no un
--   conteo de dias con movimiento: una vez que el item existe, los dias sin venta
--   siguen contando (son informacion real de baja rotacion).
--   NULL = el item no tuvo ninguna actividad en el periodo (catalogo denso).
--
-- USO AGUAS ARRIBA (no lo hace esta migracion)
--   El tablero /analisis-de-inventario deja de multiplicar por dias calendario y
--   pasa a sumar TASAS DIARIAS por item antes de agregar:
--     DI_grupo = SUM(inventory) / SUM(total_units / dias_activos)
--   que es la unica forma aditiva correcta (ver notas en el PR).
--
-- NO SE TOCA
--   Las columnas tracked_days, sales_effective_days, rotation y status quedan
--   IGUAL. rotation la consumen /rotacion e /inventario-x-item; cambiarla aqui
--   moveria numeros fuera del alcance de este cambio.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
-- APLICAR EN AMBOS EXTREMOS (232 local y GCP).
-- Despues de aplicar, repoblar (las columnas quedan NULL hasta el refresh):
--   SELECT * FROM refresh_rotacion_item_periodo_std();
--   SELECT * FROM refresh_rotacion_dinastia_item_periodo_std();
-- ============================================================================

SET statement_timeout = 0;
SET lock_timeout = 0;

-- ----------------------------------------------------------------------------
-- 1. Columnas nuevas (nullable a proposito: NULL = sin actividad en el periodo)
-- ----------------------------------------------------------------------------

ALTER TABLE rotacion_item_periodo_std
  ADD COLUMN IF NOT EXISTS primera_fecha_actividad date,
  ADD COLUMN IF NOT EXISTS dias_activos integer;

ALTER TABLE IF EXISTS rotacion_dinastia_item_periodo_std
  ADD COLUMN IF NOT EXISTS primera_fecha_actividad date,
  ADD COLUMN IF NOT EXISTS dias_activos integer;

COMMENT ON COLUMN rotacion_item_periodo_std.primera_fecha_actividad IS
  'Primer dia del periodo con venta > 0 o inventario > 0. NULL = sin actividad.';
COMMENT ON COLUMN rotacion_item_periodo_std.dias_activos IS
  'Ventana de exposicion: (periodo_end - primera_fecha_actividad) + 1, acotada al periodo. Denominador de DI.';

-- Sin indice: dias_activos solo se usa como divisor dentro de agregados ya
-- filtrados por (empresa, sede_id) + nivel, nunca como predicado de busqueda.

-- ----------------------------------------------------------------------------
-- 2. refresh_rotacion_item_periodo_std() -- legacy (mercamio / bogota / mtodo)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION refresh_rotacion_item_periodo_std()
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
  v_periodo_days integer;
  v_future_stockout_days constant numeric := 7;
  v_low_rotation_days constant numeric := 45;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_matviews WHERE matviewname = 'rotacion_item_dia_clean'
  ) THEN
    RAISE NOTICE 'rotacion_item_dia_clean no existe; skip refresh_rotacion_item_periodo_std';
    RETURN;
  END IF;

  SELECT MAX(fecha), MIN(fecha)
    INTO v_max_date, v_min_date
  FROM rotacion_item_dia_clean;

  IF v_max_date IS NULL THEN
    RAISE NOTICE 'rotacion_item_dia_clean vacia; skip refresh_rotacion_item_periodo_std';
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

  v_periodo_days := (v_end - v_start) + 1;

  TRUNCATE rotacion_item_periodo_std;

  INSERT INTO rotacion_item_periodo_std (
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
    primera_fecha_actividad,
    dias_activos,
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
    FROM rotacion_item_dia_clean
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
      )::int AS sales_effective_days,
      -- NUEVO: primer dia del periodo en que el item existio de verdad en la sede.
      -- La tabla base es densa (fila con ceros aunque el item no exista), por eso
      -- se filtra por actividad y no se usa MIN(fecha) a secas.
      MIN(fecha) FILTER (
        WHERE COALESCE(unidades_vendidas_dia, 0) > 0
           OR COALESCE(inventory_units_dia, 0) > 0
      ) AS primera_fecha_actividad
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
      -- NUEVO: ventana de exposicion en dias, acotada a [1, dias del periodo].
      CASE
        WHEN primera_fecha_actividad IS NULL THEN NULL
        ELSE LEAST(
          GREATEST((v_end - primera_fecha_actividad) + 1, 1),
          v_periodo_days
        )
      END::int AS dias_activos,
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
    primera_fecha_actividad,
    dias_activos,
    last_movement_date,
    last_purchase_date,
    effective_days,
    status
  FROM classified;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO rotacion_item_periodo_std_meta (
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

  ANALYZE rotacion_item_periodo_std;

  out_periodo_start := v_start;
  out_periodo_end := v_end;
  out_row_count := v_count;
  RETURN NEXT;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. refresh_rotacion_dinastia_item_periodo_std() -- paridad tenant Dinastia
--    (el cuerpo plpgsql no se valida al crear; si la tabla no existe todavia,
--     la funcion se crea igual y sale por la guarda de pg_matviews)
-- ----------------------------------------------------------------------------

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
  v_periodo_days integer;
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

  v_periodo_days := (v_end - v_start) + 1;

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
    primera_fecha_actividad,
    dias_activos,
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
      )::int AS sales_effective_days,
      MIN(fecha) FILTER (
        WHERE COALESCE(unidades_vendidas_dia, 0) > 0
           OR COALESCE(inventory_units_dia, 0) > 0
      ) AS primera_fecha_actividad
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
        WHEN primera_fecha_actividad IS NULL THEN NULL
        ELSE LEAST(
          GREATEST((v_end - primera_fecha_actividad) + 1, 1),
          v_periodo_days
        )
      END::int AS dias_activos,
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
    primera_fecha_actividad,
    dias_activos,
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
