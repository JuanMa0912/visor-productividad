#!/usr/bin/env bash
# Refresca margen_item_dia_roll (fuente de /informe-variacion).
#
# Se alimenta desde margen_final_roll. El sync diario (07:50) ya intenta
# refrescarla al subir margen_final; este job es el equivalente operativo a
# visor-refresh-rotacion: garantiza el refresh aunque el sync omita margen
# o falle el paso inline.
#
# Uso:
#   sudo -u visor /bin/bash /opt/visor-productividad/scripts/refresh-variacion-roll.sh
#   sudo -u visor /bin/bash .../refresh-variacion-roll.sh --full
#   sudo -u visor /bin/bash .../refresh-variacion-roll.sh --from 20260601 --to 20260714
#
# Por defecto (timer diario): ventana incremental ~60 dias (sin vaciar historico).
# --full: rebuild completo (staging+swap tras migracion 20260715).

set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/visor-productividad/.env.local}"
LOG_FILE="${LOG_FILE:-/var/log/visor-refresh-variacion.log}"
LOCK_FILE="${LOCK_FILE:-/tmp/visor-refresh-variacion.lock}"
FROM=""
TO=""
FULL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from)
      FROM="${2:-}"
      shift 2
      ;;
    --to)
      TO="${2:-}"
      shift 2
      ;;
    --full)
      FULL=1
      shift
      ;;
    *)
      echo "Argumento desconocido: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$FULL" -eq 1 && ( -n "$FROM" || -n "$TO" ) ]]; then
  echo "ERROR: --full no se combina con --from/--to." >&2
  exit 2
fi

if [[ -n "$FROM" || -n "$TO" ]]; then
  if [[ ! "$FROM" =~ ^[0-9]{8}$ || ! "$TO" =~ ^[0-9]{8}$ ]]; then
    echo "ERROR: --from y --to deben ser YYYYMMDD (ambos)." >&2
    exit 2
  fi
fi

log() {
  local msg
  msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
  echo "$msg"
  if [[ -w "$LOG_FILE" || ( ! -e "$LOG_FILE" && -w "$(dirname "$LOG_FILE")" ) ]]; then
    echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
  fi
}

# Evita dos rebuilds a la vez (timer + start manual, o sync + timer).
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "Otro refresh-variacion ya esta en curso; salgo sin hacer nada."
  exit 0
fi

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

run_psql_maintenance() {
  "${PSQL[@]}" -c "SET statement_timeout = 0;" -c "$1"
}

table_exists=$("${PSQL[@]}" -c "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='margen_item_dia_roll' LIMIT 1;" | tr -d '[:space:]')
if [[ -z "$table_exists" ]]; then
  log "Tabla margen_item_dia_roll no existe; skip. Aplica db/migrations/20260708_margen_item_dia_roll.sql (y 20260710_..._margin.sql)."
  exit 0
fi

fn_exists=$("${PSQL[@]}" -c "SELECT 1 FROM pg_proc WHERE proname='refresh_margen_item_dia_roll' LIMIT 1;" | tr -d '[:space:]')
if [[ -z "$fn_exists" ]]; then
  log "Funcion refresh_margen_item_dia_roll no existe; skip. Aplica migraciones de margen_item_dia_roll."
  exit 0
fi

start_ts=$(date +%s)
if [[ -n "$FROM" ]]; then
  log "Iniciando refresh_margen_item_dia_roll('${FROM}', '${TO}')"
  result_line=$(run_psql_maintenance "SELECT inserted_rows, elapsed_ms FROM refresh_margen_item_dia_roll('${FROM}', '${TO}');" | head -n 1)
elif [[ "$FULL" -eq 1 ]]; then
  log "Iniciando refresh_margen_item_dia_roll() completo (--full)"
  result_line=$(run_psql_maintenance "SELECT inserted_rows, elapsed_ms FROM refresh_margen_item_dia_roll();" | head -n 1)
else
  # Ventana corta: mes anterior + mes actual (cubre MoM; YoY historico ya esta en la tabla).
  TO="$(date -u +%Y%m%d)"
  FROM="$(date -u -d '60 days ago' +%Y%m%d 2>/dev/null || date -u -v-60d +%Y%m%d)"
  log "Iniciando refresh_margen_item_dia_roll('${FROM}', '${TO}') (incremental diario)"
  result_line=$(run_psql_maintenance "SELECT inserted_rows, elapsed_ms FROM refresh_margen_item_dia_roll('${FROM}', '${TO}');" | head -n 1)
fi

run_psql_maintenance "ANALYZE margen_item_dia_roll;" > /dev/null

row_count=$("${PSQL[@]}" -c "SELECT COUNT(*) FROM margen_item_dia_roll;" | tr -d '[:space:]')
max_fecha=$("${PSQL[@]}" -c "SELECT COALESCE(MAX(fecha_dcto), '') FROM margen_item_dia_roll;" | tr -d '[:space:]')
elapsed=$(( $(date +%s) - start_ts ))
log "Refresh completado: fn=[${result_line:-?}] filas=${row_count} max_fecha=${max_fecha} ${elapsed}s"
