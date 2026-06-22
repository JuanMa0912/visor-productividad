-- Queries mas lentas en PostgreSQL (requiere extension pg_stat_statements).
-- Ejecutar en Cloud SQL como usuario con permisos de lectura.
--
-- Si la extension no existe:
--   CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
-- (puede requerir reinicio o flag en Cloud SQL)

-- Top 20 por tiempo total acumulado
SELECT
  LEFT(regexp_replace(query, '\s+', ' ', 'g'), 120) AS query_preview,
  calls,
  ROUND(total_exec_time::numeric / 1000, 1) AS total_sec,
  ROUND(mean_exec_time::numeric, 0) AS mean_ms,
  ROUND(max_exec_time::numeric, 0) AS max_ms,
  rows
FROM pg_stat_statements
WHERE query NOT ILIKE '%pg_stat_statements%'
  AND query NOT ILIKE '%pg_catalog%'
ORDER BY total_exec_time DESC
LIMIT 20;

-- Top 20 por latencia media (minimo 10 ejecuciones)
SELECT
  LEFT(regexp_replace(query, '\s+', ' ', 'g'), 120) AS query_preview,
  calls,
  ROUND(mean_exec_time::numeric, 0) AS mean_ms,
  ROUND(max_exec_time::numeric, 0) AS max_ms,
  ROUND(total_exec_time::numeric / 1000, 1) AS total_sec
FROM pg_stat_statements
WHERE calls >= 10
  AND query NOT ILIKE '%pg_stat_statements%'
  AND query NOT ILIKE '%pg_catalog%'
ORDER BY mean_exec_time DESC
LIMIT 20;

-- Queries activas ahora (cola / bloqueos)
SELECT
  pid,
  usename,
  state,
  wait_event_type,
  wait_event,
  EXTRACT(EPOCH FROM (now() - query_start))::int AS segundos,
  LEFT(regexp_replace(query, '\s+', ' ', 'g'), 100) AS query
FROM pg_stat_activity
WHERE state = 'active'
  AND pid <> pg_backend_pid()
ORDER BY segundos DESC;
