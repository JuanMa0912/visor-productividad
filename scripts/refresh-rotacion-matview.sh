#!/usr/bin/env bash
# Refresca la vista materializada rotacion_item_dia_clean.
#
# La vista vive en Cloud SQL (produxdia) y pre-procesa rotacion_base_item_dia_sede:
# limpia strings (TRIM/COALESCE/LPAD), pre-filtra categorias/sedes excluidas, y
# agrega por (fecha, empresa, sede_id, item) ignorando bodega_local. El endpoint
# /api/rotacion lee de esta vista en vez de la tabla cruda, evitando que el
# planner tenga que sortear 478k filas por sede en cada request.
#
# Uso:
#   sudo -u visor /opt/visor-productividad/scripts/refresh-rotacion-matview.sh
#   sudo -u visor /opt/visor-productividad/scripts/refresh-rotacion-matview.sh --no-concurrent
#
# Pensado para correr via systemd timer:
#   /etc/systemd/system/visor-refresh-rotacion.service
#   /etc/systemd/system/visor-refresh-rotacion.timer

set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/visor-productividad/.env.local}"
LOG_FILE="${LOG_FILE:-/var/log/visor-refresh-rotacion.log}"
CONCURRENT=1

for arg in "$@"; do
  case "$arg" in
    --no-concurrent) CONCURRENT=0 ;;
    *) echo "Argumento desconocido: $arg" >&2; exit 2 ;;
  esac
done

log() {
  local msg
  msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
  echo "$msg"
  if [[ -w "$LOG_FILE" || ( ! -e "$LOG_FILE" && -w "$(dirname "$LOG_FILE")" ) ]]; then
    echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
  fi
}

if [[ ! -f "$ENV_FILE" ]]; then
  log "ERROR: no encuentro $ENV_FILE"
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

: "${DB_HOST:?DB_HOST no esta definido en $ENV_FILE}"
: "${DB_NAME:?DB_NAME no esta definido en $ENV_FILE}"
: "${DB_USER:?DB_USER no esta definido en $ENV_FILE}"
: "${DB_PASSWORD:?DB_PASSWORD no esta definido en $ENV_FILE}"

export PGPASSWORD="${DB_PASSWORD}"
# Alineado con src/lib/db/index.ts: SSL ON salvo loopback o DB_SSL=false explícito.
db_ssl="$(echo "${DB_SSL:-}" | tr '[:upper:]' '[:lower:]')"
if [[ "$db_ssl" == "true" || "$db_ssl" == "1" || "$db_ssl" == "require" ]]; then
  export PGSSLMODE=require
elif [[ "$db_ssl" == "false" || "$db_ssl" == "0" || "$db_ssl" == "disable" ]]; then
  export PGSSLMODE=disable
elif [[ "${DB_HOST:-localhost}" == "localhost" || "${DB_HOST}" == "127.0.0.1" || "${DB_HOST}" == "::1" ]]; then
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
  --quiet
  --tuples-only
  --no-align
  --set ON_ERROR_STOP=on
)

# Verifica que la vista exista. Si no esta, salimos con codigo 0 (no es error,
# probablemente la migracion 20260616_rotacion_clean_matview.sql todavia no se
# aplico). El endpoint hace fallback a la tabla cruda.
exists=$("${PSQL[@]}" -c "SELECT 1 FROM pg_matviews WHERE matviewname = 'rotacion_item_dia_clean' LIMIT 1;" | tr -d '[:space:]')
if [[ -z "$exists" ]]; then
  log "Vista rotacion_item_dia_clean no existe; skip. Aplica db/migrations/20260616_rotacion_clean_matview.sql primero."
  exit 0
fi

start_ts=$(date +%s)
log "Iniciando REFRESH MATERIALIZED VIEW rotacion_item_dia_clean (concurrent=${CONCURRENT})"

if [[ "$CONCURRENT" -eq 1 ]]; then
  "${PSQL[@]}" -c "REFRESH MATERIALIZED VIEW CONCURRENTLY rotacion_item_dia_clean;" > /dev/null
else
  "${PSQL[@]}" -c "REFRESH MATERIALIZED VIEW rotacion_item_dia_clean;" > /dev/null
fi

# ANALYZE despues del refresh para estadisticas frescas (el planner usa esto).
"${PSQL[@]}" -c "ANALYZE rotacion_item_dia_clean;" > /dev/null

row_count=$("${PSQL[@]}" -c "SELECT COUNT(*) FROM rotacion_item_dia_clean;" | tr -d '[:space:]')
elapsed=$(( $(date +%s) - start_ts ))
log "Refresh completado: ${row_count} filas, ${elapsed}s"

periodo_fn_exists=$("${PSQL[@]}" -c "SELECT 1 FROM pg_proc WHERE proname = 'refresh_rotacion_item_periodo_std' LIMIT 1;" | tr -d '[:space:]')
if [[ -n "$periodo_fn_exists" ]]; then
  periodo_start_ts=$(date +%s)
  log "Iniciando refresh_rotacion_item_periodo_std()"
  periodo_line=$("${PSQL[@]}" -c "SELECT out_periodo_start, out_periodo_end, out_row_count FROM refresh_rotacion_item_periodo_std();" | head -n 1)
  periodo_elapsed=$(( $(date +%s) - periodo_start_ts ))
  if [[ -n "$periodo_line" ]]; then
    log "Periodo std refresh: ${periodo_line} (${periodo_elapsed}s)"
  else
    log "Periodo std refresh: sin filas (matview vacia o skip) (${periodo_elapsed}s)"
  fi
else
  log "Funcion refresh_rotacion_item_periodo_std no existe; aplica db/migrations/20260617_rotacion_periodo_std.sql"
fi
