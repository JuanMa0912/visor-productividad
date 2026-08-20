-- Semana+sede+familia+bucket de D/0/S aproximado desde rotacion_item_dia_clean.
-- Sirve la tendencia de /rotacion Grafico > Resultado de gestion.
-- demandaD del roll = DI >= 45 en ventana de 30 dias (no es ABCD D del correo).
-- 0 = sin venta con inventario de apertura; S = sin venta e inventario nuevo.
--
-- Tras aplicar:
--   SELECT * FROM refresh_rotacion_gestion_semana_roll();
-- El refresh nocturno de rotacion lo invoca al final.

CREATE TABLE IF NOT EXISTS rotacion_gestion_semana_roll (
  semana_fin date NOT NULL,
  empresa text NOT NULL,
  sede_id text NOT NULL,
  familia text NOT NULL CHECK (familia IN ('manufactura', 'perecederos')),
  bucket text NOT NULL CHECK (bucket IN ('demandaD', 'cero', 'restock')),
  item_count integer NOT NULL DEFAULT 0,
  inventory_value numeric NOT NULL DEFAULT 0,
  inventory_units numeric NOT NULL DEFAULT 0,
  demanda_units numeric NOT NULL DEFAULT 0,
  tracked_days integer NOT NULL DEFAULT 30,
  refreshed_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT rotacion_gestion_semana_roll_pk PRIMARY KEY (
    semana_fin,
    empresa,
    sede_id,
    familia,
    bucket
  )
);

COMMENT ON TABLE rotacion_gestion_semana_roll IS
  'Tendencia semanal de criticos (ventana 30d). demandaD=DI>=45; cero=sin venta con inv. inicial; restock=sin venta e inv. nuevo.';

CREATE INDEX IF NOT EXISTS rotacion_gestion_semana_roll_idx_semana
  ON rotacion_gestion_semana_roll (semana_fin DESC);

CREATE INDEX IF NOT EXISTS rotacion_gestion_semana_roll_idx_sede
  ON rotacion_gestion_semana_roll (empresa, sede_id, semana_fin DESC);

CREATE OR REPLACE FUNCTION refresh_rotacion_gestion_semana_roll(
  p_weeks integer DEFAULT NULL
)
RETURNS TABLE (out_weeks integer, out_row_count bigint, out_elapsed_ms bigint)
LANGUAGE plpgsql
SET statement_timeout = 0
AS $$
DECLARE
  t0 timestamptz := clock_timestamp();
  n bigint := 0;
  has_source boolean;
  has_rows boolean;
  v_max date;
  v_min date;
  v_weeks integer;
  v_week date;
  v_start date;
  v_end date;
  v_tracked integer;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_matviews
    WHERE matviewname = 'rotacion_item_dia_clean'
  ) INTO has_source;

  IF NOT has_source THEN
    RETURN QUERY SELECT 0, 0::bigint, (
      EXTRACT(EPOCH FROM (clock_timestamp() - t0)) * 1000
    )::bigint;
    RETURN;
  END IF;

  SELECT MIN(fecha)::date, MAX(fecha)::date
  INTO v_min, v_max
  FROM rotacion_item_dia_clean;

  IF v_min IS NULL OR v_max IS NULL THEN
    RETURN QUERY SELECT 0, 0::bigint, (
      EXTRACT(EPOCH FROM (clock_timestamp() - t0)) * 1000
    )::bigint;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM rotacion_gestion_semana_roll LIMIT 1
  ) INTO has_rows;

  IF p_weeks IS NOT NULL THEN
    v_weeks := GREATEST(p_weeks, 2);
  ELSIF has_rows THEN
    v_weeks := 3;
  ELSE
    v_weeks := 26;
  END IF;

  -- Domingo de la semana ISO (date_trunc week = lunes).
  v_end := (date_trunc('week', v_max::timestamp)::date + 6);
  IF v_end > v_max THEN
    v_end := v_max;
  END IF;

  FOR i IN 0 .. (v_weeks - 1) LOOP
    v_week := v_end - (i * 7);
    IF v_week < v_min THEN
      EXIT;
    END IF;
    v_start := v_week - 29;
    IF v_start < v_min THEN
      v_start := v_min;
    END IF;
    v_tracked := (v_week - v_start) + 1;

    DELETE FROM rotacion_gestion_semana_roll
    WHERE semana_fin = v_week;

    INSERT INTO rotacion_gestion_semana_roll (
      semana_fin,
      empresa,
      sede_id,
      familia,
      bucket,
      item_count,
      inventory_value,
      inventory_units,
      demanda_units,
      tracked_days,
      refreshed_at
    )
    WITH win AS (
      SELECT
        d.empresa,
        d.sede_id,
        d.item,
        MAX(d.linea_n1_codigo) AS linea_n1_codigo,
        SUM(COALESCE(d.venta_sin_impuesto_dia, 0)) AS ventas,
        SUM(COALESCE(d.unidades_vendidas_dia, 0)) AS unidades,
        (
          ARRAY_AGG(d.inventory_units_dia ORDER BY d.fecha ASC)
        )[1] AS opening_units,
        (
          ARRAY_AGG(d.inventory_units_dia ORDER BY d.fecha DESC)
        )[1] AS closing_units,
        (
          ARRAY_AGG(d.inventory_value_dia ORDER BY d.fecha DESC)
        )[1] AS closing_value
      FROM rotacion_item_dia_clean d
      WHERE d.fecha BETWEEN v_start AND v_week
        AND d.empresa IS DISTINCT FROM 'dinastia'
      GROUP BY d.empresa, d.sede_id, d.item
    ),
    tagged AS (
      SELECT
        empresa,
        sede_id,
        CASE
          WHEN COALESCE(linea_n1_codigo, '') IN ('01', '02', '03', '04', '12')
            THEN 'perecederos'
          ELSE 'manufactura'
        END AS familia,
        CASE
          WHEN COALESCE(unidades, 0) <= 0
            AND COALESCE(ventas, 0) <= 0
            AND COALESCE(closing_units, 0) > 0
            AND COALESCE(opening_units, 0) <= 0
            THEN 'restock'
          WHEN COALESCE(unidades, 0) <= 0
            AND COALESCE(ventas, 0) <= 0
            AND COALESCE(closing_units, 0) > 0
            THEN 'cero'
          WHEN COALESCE(closing_units, 0) > 0
            AND COALESCE(unidades, 0) > 0
            AND (closing_units * v_tracked / unidades) >= 45
            THEN 'demandaD'
          ELSE NULL
        END AS bucket,
        closing_units,
        closing_value,
        GREATEST(unidades, 0) AS demanda_units
      FROM win
    )
    SELECT
      v_week,
      empresa,
      sede_id,
      familia,
      bucket,
      COUNT(*)::integer,
      COALESCE(SUM(closing_value), 0),
      COALESCE(SUM(closing_units), 0),
      COALESCE(SUM(demanda_units), 0),
      v_tracked,
      NOW()
    FROM tagged
    WHERE bucket IS NOT NULL
    GROUP BY empresa, sede_id, familia, bucket;
  END LOOP;

  SELECT COUNT(*) INTO n FROM rotacion_gestion_semana_roll;

  RETURN QUERY SELECT v_weeks, n, (
    EXTRACT(EPOCH FROM (clock_timestamp() - t0)) * 1000
  )::bigint;
END;
$$;

COMMENT ON FUNCTION refresh_rotacion_gestion_semana_roll(integer) IS
  'Puebla rotacion_gestion_semana_roll. Sin argumento: 26 semanas si la tabla esta vacia, 3 si ya hay datos.';
