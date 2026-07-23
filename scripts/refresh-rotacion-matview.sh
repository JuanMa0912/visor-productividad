#!/usr/bin/env bash
# Refresca vistas materializadas de rotacion (legacy + Dinastia).
#
# Legacy: rotacion_item_dia_clean + refresh_rotacion_item_periodo_std()
# Dinastia: rotacion_dinastia_item_dia_clean + refresh_rotacion_dinastia_item_periodo_std()
#
# Uso:
#   sudo -u visor /bin/bash /opt/visor-productividad/scripts/refresh-rotacion-matview.sh
#   sudo -u visor /bin/bash .../refresh-rotacion-matview.sh --no-concurrent
#   sudo -u visor /bin/bash .../refresh-rotacion-matview.sh --periodo-only
#
# Pensado para correr via systemd timer:
#   /etc/systemd/system/visor-refresh-rotacion.service
#   /etc/systemd/system/visor-refresh-rotacion.timer

set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/visor-productividad/.env.local}"
LOG_FILE="${LOG_FILE:-/var/log/visor-refresh-rotacion.log}"
CONCURRENT=1
PERIODO_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --no-concurrent) CONCURRENT=0 ;;
    --periodo-only) PERIODO_ONLY=1 ;;
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

# Cloud SQL suele tener statement_timeout (~5-15 min). REFRESH CONCURRENTLY sobre
# ~6M filas puede superarlo; desactivamos timeout en la sesion de mantenimiento.
run_psql_maintenance() {
  "${PSQL[@]}" -c "SET statement_timeout = 0;" -c "$1"
}

refresh_named_matview() {
  local name=$1
  local concurrent=$2
  if [[ "$concurrent" -eq 1 ]]; then
    run_psql_maintenance "REFRESH MATERIALIZED VIEW CONCURRENTLY ${name};"
  else
    run_psql_maintenance "REFRESH MATERIALIZED VIEW ${name};"
  fi
}

refresh_one_matview() {
  local name=$1
  local concurrent=$2
  if [[ "$concurrent" -eq 1 ]]; then
    if ! refresh_named_matview "$name" 1; then
      log "WARN: REFRESH CONCURRENTLY ${name} fallo; reintentando sin CONCURRENTLY"
      refresh_named_matview "$name" 0
    fi
  else
    refresh_named_matview "$name" 0
  fi
  run_psql_maintenance "ANALYZE ${name};" > /dev/null
  local row_count
  row_count=$("${PSQL[@]}" -c "SELECT COUNT(*) FROM ${name};" | tr -d '[:space:]')
  echo "$row_count"
}

refresh_periodo_fn() {
  local fn_name=$1
  local exists
  exists=$("${PSQL[@]}" -c "SELECT 1 FROM pg_proc WHERE proname = '${fn_name}' LIMIT 1;" | tr -d '[:space:]')
  if [[ -z "$exists" ]]; then
    log "Funcion ${fn_name} no existe; aplica la migracion correspondiente primero."
    return 0
  fi
  local periodo_start_ts periodo_line periodo_elapsed
  periodo_start_ts=$(date +%s)
  log "Iniciando ${fn_name}()"
  periodo_line=$(run_psql_maintenance "SELECT out_periodo_start, out_periodo_end, out_row_count FROM ${fn_name}();" | head -n 1)
  periodo_elapsed=$(( $(date +%s) - periodo_start_ts ))
  if [[ -n "$periodo_line" ]]; then
    log "Periodo std ${fn_name}: ${periodo_line} (${periodo_elapsed}s)"
  else
    log "Periodo std ${fn_name}: sin filas (matview vacia o skip) (${periodo_elapsed}s)"
  fi
}

matview_exists() {
  local name=$1
  local exists
  exists=$("${PSQL[@]}" -c "SELECT 1 FROM pg_matviews WHERE matviewname = '${name}' LIMIT 1;" | tr -d '[:space:]')
  [[ -n "$exists" ]]
}

legacy_exists=0
dinastia_exists=0
if matview_exists "rotacion_item_dia_clean"; then
  legacy_exists=1
fi
if matview_exists "rotacion_dinastia_item_dia_clean"; then
  dinastia_exists=1
fi

if [[ "$legacy_exists" -eq 0 && "$dinastia_exists" -eq 0 ]]; then
  log "Ninguna matview de rotacion existe; skip. Aplica migraciones 20260616 / 20260723 primero."
  exit 0
fi

if [[ "$PERIODO_ONLY" -eq 0 ]]; then
  if [[ "$legacy_exists" -eq 1 ]]; then
    start_ts=$(date +%s)
    log "Iniciando REFRESH MATERIALIZED VIEW rotacion_item_dia_clean (concurrent=${CONCURRENT})"
    row_count=$(refresh_one_matview "rotacion_item_dia_clean" "$CONCURRENT")
    elapsed=$(( $(date +%s) - start_ts ))
    log "Refresh legacy completado: ${row_count} filas, ${elapsed}s"
  else
    log "Vista rotacion_item_dia_clean no existe; skip legacy."
  fi

  if [[ "$dinastia_exists" -eq 1 ]]; then
    start_ts=$(date +%s)
    # Primera carga / sin indice UNIQUE usable: preferir sin CONCURRENTLY.
    log "Iniciando REFRESH MATERIALIZED VIEW rotacion_dinastia_item_dia_clean (concurrent=0)"
    row_count=$(refresh_one_matview "rotacion_dinastia_item_dia_clean" 0)
    elapsed=$(( $(date +%s) - start_ts ))
    log "Refresh Dinastia completado: ${row_count} filas, ${elapsed}s"
  else
    log "Vista rotacion_dinastia_item_dia_clean no existe; skip Dinastia."
  fi
else
  log "Modo --periodo-only: omitiendo REFRESH de matviews diarias"
fi

refresh_periodo_fn "refresh_rotacion_item_periodo_std"
refresh_periodo_fn "refresh_rotacion_dinastia_item_periodo_std"
