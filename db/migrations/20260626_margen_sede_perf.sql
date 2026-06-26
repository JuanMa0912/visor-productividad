-- Performance del tablero /margenes (Fase C - quick wins).
--
-- El tablero filtra por (empresa, id_co) NORMALIZADOS y una ventana de fechas, y agrega
-- millones de filas/mes con varios COUNT(DISTINCT). Medido en 232 (PG18, ~8M filas/mes):
--   KPI de 1 sede/mes: ~12s (Parallel Seq Scan de toda la tabla + sorts a DISCO).
--
-- Fix (sin rollup, sin extensiones):
--  1) Indice LIDERADO POR SEDE (este archivo): permite Bitmap Index Scan a las filas de
--     la(s) sede(s) en vez de escanear las 8M.
--  2) La app sube `work_mem` por consulta (SET work_mem='128MB'): los sorts de los
--     COUNT(DISTINCT) caben en RAM (sin disco) y el planner elige el indice.
--  Resultado medido juntos: ~12s -> ~4s. Repeticiones: instantaneas via cache de la app.
--
-- APLICAR EN LOCAL (192.168.35.232) Y EN GCP. En tablas grandes y vivas, crear los indices
-- CONCURRENTLY a mano (no se puede dentro de una migracion transaccional):
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS <nombre> ON margen_final (...);
-- Este archivo usa IF NOT EXISTS (no-concurrente) para instalaciones nuevas/idempotencia.

-- (1) Indice sede-first: clave del fix.
CREATE INDEX IF NOT EXISTS margen_final_idx_sede_norm_fecha
  ON margen_final (
    lower(trim(COALESCE(empresa, ''))),
    lpad(trim(COALESCE(id_co, '')), 3, '0'),
    fecha_dcto
  );

-- (2) Indices de 20260625_margen_final_filter_perf.sql repetidos aqui por idempotencia
--     (en 232 nunca se habian aplicado; asegurar que existan en todos los entornos).
CREATE INDEX IF NOT EXISTS margen_final_idx_fecha_sede_norm
  ON margen_final (
    fecha_dcto,
    lower(trim(COALESCE(empresa, ''))),
    lpad(trim(COALESCE(id_co, '')), 3, '0')
  );

CREATE INDEX IF NOT EXISTS margen_final_idx_fecha_tipo
  ON margen_final (fecha_dcto, id_tipo)
  WHERE id_tipo IS NOT NULL;

ANALYZE margen_final;
