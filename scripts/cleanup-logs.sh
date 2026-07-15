#!/usr/bin/env bash
# Limpieza semanal de logs y sesiones del visor.
#
# Borra de Cloud SQL los registros de mas de 7 dias en:
#   - app_user_activity_log (heartbeats de actividad)
#   - app_user_login_logs   (historial de logins)
#   - app_user_sessions     (sesiones expiradas o antiguas)
# Y de mas de AUDIT_RETENTION_DAYS (default 90) en:
#   - app_user_login_attempt_log
#   - app_user_admin_audit
#
# Lee las credenciales desde /opt/visor-productividad/.env.local (las mismas
# que usa el servicio visor.service) y conecta via SSL.
#
# Uso:
#   sudo -u visor /opt/visor-productividad/scripts/cleanup-logs.sh
#   sudo -u visor /opt/visor-productividad/scripts/cleanup-logs.sh --dry-run
#
# Pensado para correr via systemd timer:
#   /etc/systemd/system/visor-cleanup-logs.service
#   /etc/systemd/system/visor-cleanup-logs.timer

set -euo pipefail

RETENTION_DAYS="${RETENTION_DAYS:-7}"
AUDIT_RETENTION_DAYS="${AUDIT_RETENTION_DAYS:-90}"
ENV_FILE="${ENV_FILE:-/opt/visor-productividad/.env.local}"
LOG_FILE="${LOG_FILE:-/var/log/visor-cleanup.log}"
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
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
if [[ "${DB_SSL:-false}" == "true" ]]; then
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

count_rows() {
  local sql="$1"
  "${PSQL[@]}" -c "$sql" | tr -d '[:space:]'
}

table_exists() {
  local table="$1"
  local exists
  exists=$(count_rows "SELECT to_regclass('public.${table}') IS NOT NULL;")
  [[ "$exists" == "t" ]]
}

run_delete() {
  local table="$1"
  local where="$2"
  local before after deleted
  if ! table_exists "$table"; then
    log "${table}: omitida (tabla no existe)"
    return
  fi
  before=$(count_rows "SELECT COUNT(*) FROM ${table};")

  if [[ "$DRY_RUN" -eq 1 ]]; then
    deleted=$(count_rows "SELECT COUNT(*) FROM ${table} WHERE ${where};")
    log "[dry-run] ${table}: borraria ${deleted} de ${before} filas"
    return
  fi

  "${PSQL[@]}" -c "DELETE FROM ${table} WHERE ${where};" > /dev/null
  after=$(count_rows "SELECT COUNT(*) FROM ${table};")
  deleted=$(( before - after ))
  log "${table}: borradas ${deleted} filas (antes ${before}, ahora ${after})"
}

log "Iniciando limpieza semanal (retencion=${RETENTION_DAYS} dias, audit=${AUDIT_RETENTION_DAYS} dias, dry_run=${DRY_RUN})"

run_delete app_user_activity_log "observed_at < NOW() - INTERVAL '${RETENTION_DAYS} days'"
run_delete app_user_login_logs   "logged_at  < NOW() - INTERVAL '${RETENTION_DAYS} days'"
run_delete app_user_sessions     "expires_at < NOW() OR created_at < NOW() - INTERVAL '${RETENTION_DAYS} days'"
run_delete app_user_login_attempt_log "logged_at < NOW() - INTERVAL '${AUDIT_RETENTION_DAYS} days'"
run_delete app_user_admin_audit  "created_at < NOW() - INTERVAL '${AUDIT_RETENTION_DAYS} days'"

if [[ "$DRY_RUN" -eq 0 ]]; then
  log "Ejecutando VACUUM ANALYZE..."
  "${PSQL[@]}" -c "VACUUM (ANALYZE) app_user_activity_log;" > /dev/null
  "${PSQL[@]}" -c "VACUUM (ANALYZE) app_user_login_logs;"   > /dev/null
  "${PSQL[@]}" -c "VACUUM (ANALYZE) app_user_sessions;"     > /dev/null
  "${PSQL[@]}" -c "VACUUM (ANALYZE) app_user_login_attempt_log;" > /dev/null || true
  "${PSQL[@]}" -c "VACUUM (ANALYZE) app_user_admin_audit;" > /dev/null || true
fi

log "Limpieza completada"
