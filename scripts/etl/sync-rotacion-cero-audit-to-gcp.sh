#!/usr/bin/env bash
# Replica rotacion_cero_item_estado_audit (historial S.inventario) local -> GCP.
#
# No forma parte del sync diario de hechos (sync-local-to-gcp.sh). Correr a mano
# cuando haya que alinear el historial de auditoria entre 232 y Cloud SQL.
#
# Estrategia:
#   - Exporta toda la tabla del origen.
#   - Inserta en GCP con ON CONFLICT (id) DO NOTHING (idempotente).
#   - changed_by se anula si el UUID no existe en app_users de GCP (evita FK).
#   - Ajusta la secuencia bigserial al MAX(id).
#
# Flags:
#   --replace   TRUNCATE la tabla en GCP antes de cargar (solo si quieres espejo exacto).
#   --dry-run   Solo cuenta filas en local; no escribe en GCP.
#   -h|--help   Ayuda.
#
# Config: mismo .env.etl que sync-local-to-gcp.sh (ver scripts/etl/README-sync.md).
#
# Uso (en 192.168.35.232, como prodapp):
#   sudo -u prodapp bash scripts/etl/sync-rotacion-cero-audit-to-gcp.sh
#   sudo -u prodapp bash scripts/etl/sync-rotacion-cero-audit-to-gcp.sh --replace

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ETL_ENV_FILE="${ETL_ENV_FILE:-$REPO_ROOT/.env.etl}"
TABLE="rotacion_cero_item_estado_audit"
STAGING="_etl_stg_rotacion_cero_audit"

DRY_RUN=0
REPLACE=0

usage() { sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --replace) REPLACE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

[[ -f "$ETL_ENV_FILE" ]] || {
  log "ERROR: no encuentro $ETL_ENV_FILE (copia scripts/etl/env.etl.example)"
  exit 1
}

set -a
# shellcheck source=/dev/null
source "$ETL_ENV_FILE"
set +a

: "${DB_HOST_GCP:?}"
: "${DB_NAME_GCP:?}"
: "${DB_USER_GCP:?}"
: "${DB_PASSWORD_GCP:?}"
: "${DB_PASSWORD_LOCAL:?}"

DB_HOST_LOCAL="${DB_HOST_LOCAL:-localhost}"
DB_PORT_LOCAL="${DB_PORT_LOCAL:-5432}"
DB_NAME_LOCAL="${DB_NAME_LOCAL:-produXdia}"
DB_USER_LOCAL="${DB_USER_LOCAL:-postgres}"
DB_PORT_GCP="${DB_PORT_GCP:-5432}"

resolve_ssl() {
  local raw host
  raw="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')"
  host="$2"
  if [[ "$raw" == "true" || "$raw" == "1" || "$raw" == "require" ]]; then echo require
  elif [[ "$raw" == "false" || "$raw" == "0" || "$raw" == "disable" ]]; then echo disable
  elif [[ "$host" == "localhost" || "$host" == "127.0.0.1" || "$host" == "::1" ]]; then echo disable
  else echo require; fi
}

LOCAL_SSL="$(resolve_ssl "${DB_SSL_LOCAL:-}" "$DB_HOST_LOCAL")"
GCP_SSL="$(resolve_ssl "${DB_SSL_GCP:-}" "$DB_HOST_GCP")"

SRC_PSQL=(env "PGPASSWORD=$DB_PASSWORD_LOCAL" "PGSSLMODE=$LOCAL_SSL" psql
  --host="$DB_HOST_LOCAL" --port="$DB_PORT_LOCAL" --username="$DB_USER_LOCAL"
  --dbname="$DB_NAME_LOCAL" --no-password --set ON_ERROR_STOP=on)
DST_PSQL=(env "PGPASSWORD=$DB_PASSWORD_GCP" "PGSSLMODE=$GCP_SSL" psql
  --host="$DB_HOST_GCP" --port="$DB_PORT_GCP" --username="$DB_USER_GCP"
  --dbname="$DB_NAME_GCP" --no-password --set ON_ERROR_STOP=on)

log "Origen(local): $DB_USER_LOCAL@$DB_HOST_LOCAL:$DB_PORT_LOCAL/$DB_NAME_LOCAL"
log "Destino(GCP):  $DB_USER_GCP@$DB_HOST_GCP:$DB_PORT_GCP/$DB_NAME_GCP"

local_cnt="$("${SRC_PSQL[@]}" -tA -c "SELECT count(*) FROM public.$TABLE")"
gcp_cnt="$("${DST_PSQL[@]}" -tA -c "SELECT count(*) FROM public.$TABLE" 2>/dev/null || echo "?")"
log "[$TABLE] local=$local_cnt filas | GCP=$gcp_cnt filas (antes)"

if [[ "$local_cnt" == "0" ]]; then
  log "Sin filas en origen; nada que replicar."
  exit 0
fi

if [[ "$DRY_RUN" == "1" ]]; then
  log "DRY-RUN: no se escribe en GCP."
  exit 0
fi

tmp="$(mktemp "/tmp/${TABLE}.XXXXXX.csv")"
trap 'rm -f "$tmp"' EXIT

log "Exportando CSV desde local..."
"${SRC_PSQL[@]}" -c "\copy (
  SELECT id, empresa, sede_id, item, context, estado_anterior, estado_nuevo, changed_at, changed_by
  FROM public.$TABLE
  ORDER BY id
) TO STDOUT WITH (FORMAT csv, HEADER true)" > "$tmp"

if [[ "$REPLACE" == "1" ]]; then
  log "TRUNCATE en GCP (--replace)..."
  "${DST_PSQL[@]}" -c "TRUNCATE TABLE public.$TABLE RESTART IDENTITY;"
fi

log "Cargando staging e insertando en GCP..."
"${DST_PSQL[@]}" <<SQL
BEGIN;
CREATE TEMP TABLE ${STAGING} (
  id bigint,
  empresa text,
  sede_id text,
  item text,
  context text,
  estado_anterior text,
  estado_nuevo text,
  changed_at timestamptz,
  changed_by uuid
);
\copy ${STAGING} FROM '${tmp}' WITH (FORMAT csv, HEADER true)
INSERT INTO public.${TABLE} (
  id, empresa, sede_id, item, context, estado_anterior, estado_nuevo, changed_at, changed_by
)
SELECT
  s.id,
  s.empresa,
  s.sede_id,
  s.item,
  s.context,
  s.estado_anterior,
  s.estado_nuevo,
  s.changed_at,
  CASE
    WHEN s.changed_by IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.app_users u WHERE u.id = s.changed_by) THEN s.changed_by
    ELSE NULL
  END
FROM ${STAGING} s
ON CONFLICT (id) DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('public.${TABLE}', 'id'),
  COALESCE((SELECT MAX(id) FROM public.${TABLE}), 1),
  true
);
COMMIT;
SQL

final_cnt="$("${DST_PSQL[@]}" -tA -c "SELECT count(*) FROM public.$TABLE")"
inserted=$((final_cnt - gcp_cnt))
[[ "$REPLACE" == "1" ]] && inserted="$final_cnt"
log "[$TABLE] GCP=$final_cnt filas (insertadas aprox: $inserted)"
log "Listo."
