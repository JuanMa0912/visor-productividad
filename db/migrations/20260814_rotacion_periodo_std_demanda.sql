-- ============================================================================
-- Migracion: DIC de DEMANDA en rotacion_item_periodo_std (venta PDV + consumo por kit)
-- ============================================================================
-- REQUISITO: aplicar ANTES 20260814_rotacion_salidas_kits_codbar.sql (crea
-- rotacion_salidas_dia) y tener esa tabla ya cargada por
-- scripts/etl/rotacion-dim/etl_rotacion_dim.py. La funcion aborta con mensaje
-- explicito si la tabla no existe: es preferible fallar ruidoso a seguir
-- publicando el DIC viejo, que esta mal.
--
-- QUE CAMBIA
-- ----------
-- Hoy:    rotation = inventory_units * tracked_days / total_units
-- Ahora:  rotation = inventory_units * tracked_days / (total_units + uds_equivalentes)
--
-- `uds_equivalentes` = salidas del documento **EK (ENSAMBLE DE KIT)**, o sea el consumo
-- del item cuando se vende dentro de un multipack / arroba / reempaque. El POS cobra en
-- el codigo padre y descuenta el inventario del hijo, y esa salida no viaja por
-- cmmovimiento_pdv. Sin este termino el hijo sale con DIC absurdo y el padre sale
-- "Agotado" mientras vende.
--
-- IMPACTO MEDIDO (ventana 2026-07-13 -> 2026-08-12, 206.706 filas del snapshot):
--   cambian 892 filas = 0,43% del tablero. Concentrado y severo, no extendido.
--     372 filas bajan MAS del 50%   ·   480 bajan menos del 50%
--      13 salen de "sin venta" (999999) a un DIC real
--   En las filas tocadas: mercamio promedio 595,1 -> 14,2 dias | mtodo 230,0 -> 15,2
--   Peor caso: HUEVO ROSADO AA und GRANEL mtodo 001, de 38.180 dias a 2,6.
--
-- DECISION DE NEGOCIO TOMADA: **DIC de demanda** = RV (venta PDV) + EK (consumo por kit).
-- Deliberadamente NO entran al denominador:
--   · ST / TB  traslados      -> consumen stock de la sede pero la demanda es de otra
--   · FS/Na/FN averias        -> consumen stock, no son demanda
--   · AA/AJ/IF ajustes        -> son correcciones contables, no movimiento real
-- Todos siguen guardados en rotacion_salidas_dia: cambiar el criterio es editar esta
-- funcion, sin re-ETL.
--
-- Tambien se corrige el status "Futuro agotado", que usaba total_units: si el DIC usa
-- demanda y el status no, los dos se contradicen en pantalla.
--
-- QUIEN CONSUME `rotation` (verificado en el codigo, no supuesto)
-- ---------------------------------------------------------------
-- SI cambia con esta migracion: /rotacion (tabla, los dos resumenes de bloque, y el
-- correo diario critical-digest).
-- NO cambia, y por eso queda DESALINEADO hasta que se decida que hacer:
--   · /analisis-de-inventario  -> ignora esta columna: calcula su propio DI en JS en
--     src/lib/analisis-inventario/di.ts (inv_cierre * dias / unidades_vendidas). Va a
--     mostrar el DIC viejo para los hijos de kit. Su `diValue` (por costo) ademas no
--     tiene equivalente de kits: aqui solo se corrigieron unidades.
--   · /inventario-x-item       -> nunca lee `rotation`; calcula su propio rotation_days
--     desde la tabla cruda.
--   · refresh_rotacion_dinastia_item_periodo_std() -> copia con la formula vieja. Hoy es
--     inocuo porque el ETL no carga dinastia en rotacion_salidas_dia. El dia que se
--     cargue, hay que tocar esa funcion tambien.
-- ============================================================================

SET statement_timeout = 0;
SET lock_timeout = '30s';

ALTER TABLE rotacion_item_periodo_std
  ADD COLUMN IF NOT EXISTS uds_equivalentes numeric NOT NULL DEFAULT 0;
ALTER TABLE rotacion_item_periodo_std
  ADD COLUMN IF NOT EXISTS demanda_units numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN rotacion_item_periodo_std.uds_equivalentes IS
  'Unidades consumidas via documento EK (ensamble de kit) en el periodo. Es la venta que el POS cobro en el codigo padre pero descuenta de este item.';
COMMENT ON COLUMN rotacion_item_periodo_std.demanda_units IS
  'total_units + uds_equivalentes. Denominador real del DIC.';

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

  IF to_regclass('public.rotacion_salidas_dia') IS NULL THEN
    RAISE EXCEPTION 'Falta rotacion_salidas_dia. Aplica db/migrations/20260814_rotacion_salidas_kits_codbar.sql y carga la tabla con scripts/etl/rotacion-dim/etl_rotacion_dim.py antes de refrescar el snapshot.';
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
    uds_equivalentes,
    demanda_units,
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
  -- Consumo por ensamble de kit en la MISMA ventana. `unidades` viene firmado del ERP
  -- (salidas negativas), por eso el signo cambiado. Se suma sobre bodega porque el
  -- matview ya colapso ese nivel.
  equiv AS (
    SELECT
      s.empresa,
      s.sede    AS sede_id,
      s.id_item AS item,
      GREATEST(SUM(-s.unidades), 0)::numeric AS uds_equivalentes
    FROM rotacion_salidas_dia s
    WHERE s.fecha_dia BETWEEN v_start AND v_end
      AND s.doc_inv_tipo = 'EK'
      AND s.ind_es = 2
    GROUP BY 1, 2, 3
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
      -- primer dia del periodo en que el item existio de verdad en la sede.
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
      a.*,
      COALESCE(eq.uds_equivalentes, 0)::numeric AS uds_equivalentes,
      (COALESCE(a.total_units, 0) + COALESCE(eq.uds_equivalentes, 0))::numeric
        AS demanda_units,
      NULL::text AS nombre_bodega,
      -- ventana de exposicion en dias, acotada a [1, dias del periodo].
      CASE
        WHEN a.primera_fecha_actividad IS NULL THEN NULL
        ELSE LEAST(
          GREATEST((v_end - a.primera_fecha_actividad) + 1, 1),
          v_periodo_days
        )
      END::int AS dias_activos,
      -- DIC DE DEMANDA: el denominador es venta PDV + consumo por ensamble de kit.
      CASE
        WHEN COALESCE(a.inventory_units, 0) <= 0
          OR COALESCE(a.inventory_value, 0) <= 0 THEN 0::numeric
        WHEN (COALESCE(a.total_units, 0) + COALESCE(eq.uds_equivalentes, 0)) <= 0
          OR COALESCE(a.tracked_days, 0) <= 0 THEN 999999::numeric
        ELSE (COALESCE(a.inventory_units, 0) * a.tracked_days::numeric)
             / NULLIF(COALESCE(a.total_units, 0) + COALESCE(eq.uds_equivalentes, 0), 0)
      END AS rotation,
      CASE
        WHEN a.last_movement_date IS NULL THEN NULL
        ELSE (v_end - a.last_movement_date)
      END::int AS effective_days
    FROM aggregated a
    LEFT JOIN equiv eq
      ON  eq.empresa = a.empresa
      AND eq.sede_id = a.sede_id
      AND eq.item    = a.item
  ),
  classified AS (
    SELECT
      *,
      CASE
        WHEN inventory_units <= 0 OR inventory_value <= 0 THEN 'Agotado'
        -- "Futuro agotado" tambien contra la demanda: si usara total_units,
        -- contradiria al DIC que se muestra al lado.
        WHEN demanda_units > 0
          AND tracked_days > 0
          AND inventory_units > 0
          AND inventory_units <= ((demanda_units / tracked_days) * v_future_stockout_days)
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
    uds_equivalentes,
    demanda_units,
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
  VALUES (1, v_start, v_end, now(), v_count)
  ON CONFLICT (id) DO UPDATE
    SET periodo_start = EXCLUDED.periodo_start,
        periodo_end   = EXCLUDED.periodo_end,
        refreshed_at  = EXCLUDED.refreshed_at,
        row_count     = EXCLUDED.row_count;

  ANALYZE rotacion_item_periodo_std;

  out_periodo_start := v_start;
  out_periodo_end   := v_end;
  out_row_count     := v_count;
  RETURN NEXT;
END;
$$;
