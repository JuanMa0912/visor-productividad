#!/usr/bin/env bash
# Comprueba filas y fecha maxima de tablas ETL en Cloud SQL.
# Uso en app-server:
#   sudo -u visor bash /opt/visor-productividad/scripts/etl/verify-data-freshness.sh
#   FECHA_OBJETIVO=2026-06-17 sudo -u visor bash .../verify-data-freshness.sh
#
# Lee credenciales de ENV_FILE (default .env.local del proyecto).

set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/visor-productividad/.env.local}"
FECHA_OBJETIVO="${FECHA_OBJETIVO:-2026-06-17}"
FECHA_OBJETIVO_COMPACT="${FECHA_OBJETIVO//-/}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: no encuentro $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

: "${DB_HOST:?DB_HOST no definido en $ENV_FILE}"
: "${DB_NAME:?DB_NAME no definido}"
: "${DB_USER:?DB_USER no definido}"
: "${DB_PASSWORD:?DB_PASSWORD no definido}"

export PGPASSWORD="${DB_PASSWORD}"
db_ssl="$(echo "${DB_SSL:-}" | tr '[:upper:]' '[:lower:]')"
if [[ "$db_ssl" == "true" || "$db_ssl" == "1" || "$db_ssl" == "require" ]]; then
  export PGSSLMODE=require
elif [[ "$db_ssl" == "false" || "$db_ssl" == "0" || "$db_ssl" == "disable" ]]; then
  export PGSSLMODE=disable
elif [[ "${DB_HOST:-localhost}" == "localhost" || "${DB_HOST}" == "127.0.0.1" ]]; then
  export PGSSLMODE=disable
else
  export PGSSLMODE=require
fi

PSQL=(psql
  --host="${DB_HOST}"
  --port="${DB_PORT:-5432}"
  --username="${DB_USER}"
  --dbname="${DB_NAME}"
  --no-password
  --set ON_ERROR_STOP=on
)

echo "=== Verificacion ETL ==="
echo "Objetivo: datos hasta ${FECHA_OBJETIVO} (${FECHA_OBJETIVO_COMPACT} en columnas YYYYMMDD)"
echo "Host: ${DB_HOST}  DB: ${DB_NAME}"
echo ""

"${PSQL[@]}" -v fecha_obj="${FECHA_OBJETIVO}" -v fecha_compact="${FECHA_OBJETIVO_COMPACT}" <<'EOSQL'
\pset border 2
\pset format aligned

WITH checks AS (
  SELECT 'rotacion_base_item_dia_sede'::text AS tabla,
         COUNT(*)::bigint AS filas,
         MAX(fecha_dia)::date AS hasta_date,
         NULL::text AS hasta_text
  FROM rotacion_base_item_dia_sede

  UNION ALL
  SELECT 'rotacion_item_dia_clean (matview)',
         COUNT(*)::bigint,
         MAX(fecha)::date,
         NULL::text
  FROM rotacion_item_dia_clean

  UNION ALL
  SELECT 'margenes_linea_co_dia',
         COUNT(*)::bigint,
         MAX(
           CASE
             WHEN fecha_dcto::text ~ '^[0-9]{8}$'
               THEN TO_DATE(fecha_dcto::text, 'YYYYMMDD')
             ELSE fecha_dcto::date
           END
         ),
         NULL::text
  FROM margenes_linea_co_dia
  WHERE fecha_dcto IS NOT NULL

  UNION ALL
  SELECT 'margenes_linea_co_dia_clean (matview)',
         COUNT(*)::bigint,
         MAX(fecha)::date,
         NULL::text
  FROM margenes_linea_co_dia_clean

  UNION ALL
  SELECT 'margen_final',
         COUNT(*)::bigint,
         NULL::date,
         MAX(fecha_dcto)::text
  FROM margen_final
  WHERE fecha_dcto IS NOT NULL
    AND fecha_dcto ~ '^[0-9]{8}$'

  UNION ALL
  SELECT 'ventas_item_diario',
         COUNT(*)::bigint,
         NULL::date,
         MAX(fecha_dcto)::text
  FROM ventas_item_diario

  UNION ALL
  SELECT 'ventas_item_cargas',
         COUNT(*)::bigint,
         NULL::date,
         NULL::text
  FROM ventas_item_cargas

  UNION ALL
  SELECT 'ventas_cajas', COUNT(*)::bigint, NULL::date, MAX(fecha_dcto)::text
  FROM ventas_cajas

  UNION ALL
  SELECT 'ventas_fruver', COUNT(*)::bigint, NULL::date, MAX(fecha_dcto)::text
  FROM ventas_fruver

  UNION ALL
  SELECT 'ventas_industria', COUNT(*)::bigint, NULL::date, MAX(fecha_dcto)::text
  FROM ventas_industria

  UNION ALL
  SELECT 'ventas_carnes', COUNT(*)::bigint, NULL::date, MAX(fecha_dcto)::text
  FROM ventas_carnes

  UNION ALL
  SELECT 'ventas_pollo_pesc', COUNT(*)::bigint, NULL::date, MAX(fecha_dcto)::text
  FROM ventas_pollo_pesc

  UNION ALL
  SELECT 'ventas_asadero', COUNT(*)::bigint, NULL::date, MAX(fecha_dcto)::text
  FROM ventas_asadero

  UNION ALL
  SELECT 'asistencia_horas',
         COUNT(*)::bigint,
         MAX(fecha::date),
         NULL::text
  FROM asistencia_horas
),
normalized AS (
  SELECT
    tabla,
    filas,
    COALESCE(hasta_date::text, hasta_text, '-') AS hasta,
    CASE
      WHEN filas = 0 THEN 'VACIA'
      WHEN hasta_date IS NOT NULL AND hasta_date >= DATE :'fecha_obj' THEN 'OK'
      WHEN hasta_text IS NOT NULL AND hasta_text >= :'fecha_compact' THEN 'OK'
      WHEN hasta_date IS NOT NULL THEN 'ATRASADA'
      WHEN hasta_text IS NOT NULL AND hasta_text ~ '^[0-9]{8}$'
        AND TO_DATE(hasta_text, 'YYYYMMDD') >= DATE :'fecha_obj' THEN 'OK'
      WHEN hasta_text IS NOT NULL THEN 'ATRASADA'
      WHEN tabla = 'ventas_item_cargas' AND filas > 0 THEN 'OK (sin fecha)'
      ELSE 'REVISAR'
    END AS estado
  FROM checks
)
SELECT tabla, filas, hasta, estado
FROM normalized
ORDER BY
  CASE estado
    WHEN 'OK' THEN 1
    WHEN 'OK (sin fecha)' THEN 2
    WHEN 'REVISAR' THEN 3
    WHEN 'ATRASADA' THEN 4
    WHEN 'VACIA' THEN 5
    ELSE 6
  END,
  tabla;
EOSQL

echo ""
echo "Leyenda: OK = hasta objetivo | ATRASADA = falta sync | VACIA = sin filas | REVISAR = formato fecha raro"
