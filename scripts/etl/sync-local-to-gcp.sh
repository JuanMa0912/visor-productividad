#!/usr/bin/env bash
# Sube el dia a dia de las tablas de HECHOS desde el Postgres LOCAL a Cloud SQL (GCP).
#
# Estrategia: UPSERT por clave natural (INSERT ... ON CONFLICT DO UPDATE). No borra.
# Las PK/UNIQUE son identicas en local y GCP, asi que es imposible duplicar.
#
# Tablas (allowlist fija; NO toca tablas de estado de la app ni matviews):
#   ventas_cajas, ventas_fruver, ventas_carnes, ventas_asadero, ventas_pollo_pesc,
#   ventas_industria, rotacion_base_item_dia_sede, asistencia_horas
# (ventas_item_diario NO va aqui: lo maneja un ETL aparte del local.)
#
# Ventana:
#   - default (sin flags) = solo AYER (rapido, para no retrasar la subida del dia).
#   - --days N            = ultimos N dias terminando ayer (reconciliacion; ej. sabado --days 18).
#   - --date YYYY-MM-DD   = un solo dia (re-correr/backfill manual).
#
# Otros flags:
#   --dry-run     solo cuenta filas en local, no escribe en GCP.
#   --no-refresh  no refresca la matview de rotacion al final.
#   --verify      corre verify-data-freshness.sh al terminar.
#   -h|--help     ayuda.
#
# Credenciales:
#   - DESTINO (GCP):  ENV_FILE (default /opt/visor-productividad/.env.local), vars DB_*.
#   - ORIGEN (local): SRC_ENV_FILE (default /opt/visor-productividad/.env.etl), vars SRC_DB_*.
#
# Uso tipico (en el server 192.168.35.232, como el usuario de la app):
#   sudo -u visor bash /opt/visor-productividad/scripts/etl/sync-local-to-gcp.sh
#   sudo -u visor bash .../sync-local-to-gcp.sh --days 18          # reconciliacion semanal
#   sudo -u visor bash .../sync-local-to-gcp.sh --date 2026-06-22  # un dia puntual
#
# Codigos de salida: 0 = OK | 3 = WARNING (sin datos de ayer) | 1 = ERROR.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Credenciales: por default en la raiz del deploy (donde corre la app y vive .env.local),
# resuelta desde la ubicacion del script. Funciona en cualquier ruta de deploy
# (/home/prodapp/visor-productividad, /opt/visor-productividad, etc.). Override con
# ENV_FILE / SRC_ENV_FILE si los .env estan en otro lado.
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.local}"
SRC_ENV_FILE="${SRC_ENV_FILE:-$REPO_ROOT/.env.etl}"
LOG_FILE="${LOG_FILE:-/var/log/visor-etl-sync.log}"

DAYS=1
ONE_DATE=""
DRY_RUN=0
NO_REFRESH=0
RUN_VERIFY=0
MODE_DAILY=1   # 1 solo cuando es la corrida diaria (default, sin --days ni --date)

usage() { sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --days)      DAYS="${2:?--days requiere un numero}"; MODE_DAILY=0; shift 2 ;;
    --days=*)    DAYS="${1#*=}"; MODE_DAILY=0; shift ;;
    --date)      ONE_DATE="${2:?--date requiere YYYY-MM-DD}"; MODE_DAILY=0; shift 2 ;;
    --date=*)    ONE_DATE="${1#*=}"; MODE_DAILY=0; shift ;;
    --dry-run)   DRY_RUN=1; shift ;;
    --no-refresh) NO_REFRESH=1; shift ;;
    --verify)    RUN_VERIFY=1; shift ;;
    -h|--help)   usage; exit 0 ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

if ! [[ "$DAYS" =~ ^[0-9]+$ ]] || [[ "$DAYS" -lt 1 ]]; then
  echo "ERROR: --days debe ser un entero >= 1" >&2; exit 2
fi
if [[ -n "$ONE_DATE" ]] && ! [[ "$ONE_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "ERROR: --date debe ser YYYY-MM-DD" >&2; exit 2
fi

log() {
  local msg; msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
  echo "$msg"
  if [[ -w "$LOG_FILE" || ( ! -e "$LOG_FILE" && -w "$(dirname "$LOG_FILE")" ) ]]; then
    echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
  fi
}

# --- Cargar credenciales ---------------------------------------------------
[[ -f "$ENV_FILE" ]]     || { log "ERROR: no encuentro ENV_FILE (GCP): $ENV_FILE"; exit 1; }
[[ -f "$SRC_ENV_FILE" ]] || { log "ERROR: no encuentro SRC_ENV_FILE (local): $SRC_ENV_FILE"; exit 1; }

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
# shellcheck source=/dev/null
source "$SRC_ENV_FILE"
set +a

: "${DB_HOST:?DB_HOST (GCP) no definido en $ENV_FILE}"
: "${DB_NAME:?DB_NAME (GCP) no definido en $ENV_FILE}"
: "${DB_USER:?DB_USER (GCP) no definido en $ENV_FILE}"
: "${DB_PASSWORD:?DB_PASSWORD (GCP) no definido en $ENV_FILE}"
: "${SRC_DB_PASSWORD:?SRC_DB_PASSWORD (local) no definido en $SRC_ENV_FILE}"

SRC_DB_HOST="${SRC_DB_HOST:-localhost}"
SRC_DB_PORT="${SRC_DB_PORT:-5432}"
SRC_DB_NAME="${SRC_DB_NAME:-produXdia}"
SRC_DB_USER="${SRC_DB_USER:-postgres}"

# SSL GCP: igual que src/lib/db/index.ts y refresh-rotacion-matview.sh.
db_ssl="$(echo "${DB_SSL:-}" | tr '[:upper:]' '[:lower:]')"
if   [[ "$db_ssl" == "true"  || "$db_ssl" == "1" || "$db_ssl" == "require" ]]; then GCP_SSL=require
elif [[ "$db_ssl" == "false" || "$db_ssl" == "0" || "$db_ssl" == "disable" ]]; then GCP_SSL=disable
elif [[ "$DB_HOST" == "localhost" || "$DB_HOST" == "127.0.0.1" || "$DB_HOST" == "::1" ]]; then GCP_SSL=disable
else GCP_SSL=require; fi

src_ssl="$(echo "${SRC_DB_SSL:-}" | tr '[:upper:]' '[:lower:]')"
if   [[ "$src_ssl" == "true" || "$src_ssl" == "require" ]]; then SRC_SSL=require
elif [[ "$src_ssl" == "false" || "$src_ssl" == "disable" ]]; then SRC_SSL=disable
elif [[ "$SRC_DB_HOST" == "localhost" || "$SRC_DB_HOST" == "127.0.0.1" || "$SRC_DB_HOST" == "::1" ]]; then SRC_SSL=disable
else SRC_SSL=disable; fi

SRC_PSQL=(env "PGPASSWORD=$SRC_DB_PASSWORD" "PGSSLMODE=$SRC_SSL" psql
  --host="$SRC_DB_HOST" --port="$SRC_DB_PORT" --username="$SRC_DB_USER"
  --dbname="$SRC_DB_NAME" --no-password --set ON_ERROR_STOP=on)
GCP_PSQL=(env "PGPASSWORD=$DB_PASSWORD" "PGSSLMODE=$GCP_SSL" psql
  --host="$DB_HOST" --port="${DB_PORT:-5432}" --username="$DB_USER"
  --dbname="$DB_NAME" --no-password --set ON_ERROR_STOP=on)

# --- Ventana de fechas -----------------------------------------------------
if [[ -n "$ONE_DATE" ]]; then
  DESDE="$ONE_DATE"; HASTA="$ONE_DATE"
else
  HASTA="$(date -d 'yesterday' +%F)"
  DESDE="$(date -d "$DAYS days ago" +%F)"
fi
DESDEC="${DESDE//-/}"; HASTAC="${HASTA//-/}"

# --- Configuracion por tabla ----------------------------------------------
TABLES=(ventas_cajas ventas_fruver ventas_carnes ventas_asadero ventas_pollo_pesc
        ventas_industria rotacion_base_item_dia_sede asistencia_horas)
CANARIES="ventas_cajas rotacion_base_item_dia_sede asistencia_horas"

declare -A KEY DATECOL DATETYPE EXCLUDE
VENTAS_FULL="empresa_bd,centro_operacion,sede,caja,fecha_dcto,id_tipdoc_fc,documento_fc,id_vend_cc,categoria,linea"
KEY[ventas_cajas]="empresa_bd,centro_operacion,fecha_dcto,id_tipdoc_fc,consecutivo_doc,id_vend_cc"
KEY[ventas_fruver]="$VENTAS_FULL"
KEY[ventas_carnes]="$VENTAS_FULL"
KEY[ventas_asadero]="$VENTAS_FULL"
KEY[ventas_pollo_pesc]="$VENTAS_FULL"
KEY[ventas_industria]="empresa_bd,centro_operacion,sede,caja,fecha_dcto,id_tipdoc_fc,documento_fc,id_vend_cc,categoria"
KEY[rotacion_base_item_dia_sede]="empresa,fecha_dia,sede,bodega_local,id_item"
KEY[asistencia_horas]="numero,fecha"

for t in ventas_cajas ventas_fruver ventas_carnes ventas_asadero ventas_pollo_pesc ventas_industria; do
  DATECOL[$t]="fecha_dcto"; DATETYPE[$t]="text"; EXCLUDE[$t]=""
done
DATECOL[rotacion_base_item_dia_sede]="fecha_dia"; DATETYPE[rotacion_base_item_dia_sede]="date"; EXCLUDE[rotacion_base_item_dia_sede]=""
DATECOL[asistencia_horas]="fecha"; DATETYPE[asistencia_horas]="date"; EXCLUDE[asistencia_horas]="id_asistencia"

build_where() {
  local tbl="$1" col="${DATECOL[$1]}"
  if [[ "${DATETYPE[$tbl]}" == "text" ]]; then
    echo "$col BETWEEN '$DESDEC' AND '$HASTAC'"
  else
    echo "$col BETWEEN '$DESDE'::date AND '$HASTA'::date"
  fi
}

# Columnas comunes (existentes en ambos), en orden de GCP, menos la excluida.
build_cols() {
  local tbl="$1" exclude="${EXCLUDE[$1]}" localset out="" c
  localset=" $("${SRC_PSQL[@]}" -tA -c \
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='$tbl';" \
    | tr '\n' ' ') "
  while IFS= read -r c; do
    [[ -z "$c" || "$c" == "$exclude" ]] && continue
    [[ "$localset" == *" $c "* ]] || continue
    out+="${out:+, }$c"
  done < <("${GCP_PSQL[@]}" -tA -c \
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='$tbl' ORDER BY ordinal_position;")
  printf '%s' "$out"
}

build_set() {  # cols_csv keys_csv -> "a = EXCLUDED.a, b = EXCLUDED.b"
  local cols="$1" keys="$2" out="" c
  IFS=',' read -ra arr <<< "$cols"
  for c in "${arr[@]}"; do
    c="${c// /}"
    case ",$keys," in *",$c,"*) continue ;; esac
    out+="${out:+, }$c = EXCLUDED.$c"
  done
  printf '%s' "$out"
}

TMPFILES=()
cleanup() { local f; for f in "${TMPFILES[@]:-}"; do [[ -n "${f:-}" ]] && rm -f "$f"; done; }
trap cleanup EXIT

CANARY_EMPTY=()
WARN=0

process_table() {
  local tbl="$1" where cols keylist conflict setclause drop_stmt on_conflict tmp cnt
  where="$(build_where "$tbl")"
  cnt="$("${SRC_PSQL[@]}" -tA -c "SELECT count(*) FROM public.$tbl WHERE $where")"
  log "[$tbl] local tiene $cnt filas en [$DESDE..$HASTA]"

  if [[ "$cnt" == "0" ]]; then
    case " $CANARIES " in *" $tbl "*) CANARY_EMPTY+=("$tbl") ;; esac
    [[ "$DRY_RUN" -eq 1 ]] || { log "[$tbl] sin filas; skip"; return 0; }
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then log "[$tbl] dry-run: no escribe"; return 0; fi

  cols="$(build_cols "$tbl")"
  [[ -n "$cols" ]] || { log "[$tbl] ERROR: sin columnas comunes resueltas"; return 1; }
  keylist="${KEY[$tbl]}"; conflict="($keylist)"
  setclause="$(build_set "$cols" "$keylist")"
  if [[ -n "$setclause" ]]; then on_conflict="DO UPDATE SET $setclause"; else on_conflict="DO NOTHING"; fi
  drop_stmt=""; [[ -n "${EXCLUDE[$tbl]}" ]] && drop_stmt="ALTER TABLE _stg DROP COLUMN ${EXCLUDE[$tbl]};"

  tmp="$(mktemp "${TMPDIR:-/tmp}/etl_${tbl}_XXXXXX.csv")"; TMPFILES+=("$tmp")
  "${SRC_PSQL[@]}" -c "COPY (SELECT $cols FROM public.$tbl WHERE $where) TO STDOUT WITH (FORMAT csv)" > "$tmp"

  "${GCP_PSQL[@]}" <<SQL
\set ON_ERROR_STOP on
BEGIN;
SET statement_timeout = 0;
CREATE TEMP TABLE _stg (LIKE public.$tbl INCLUDING DEFAULTS) ON COMMIT DROP;
$drop_stmt
\copy _stg ($cols) FROM '$tmp' WITH (FORMAT csv)
INSERT INTO public.$tbl ($cols)
SELECT $cols FROM _stg
ON CONFLICT $conflict $on_conflict;
COMMIT;
SQL
  rm -f "$tmp"
  log "[$tbl] upsert OK ($cnt filas)"
}

log "=== ETL local -> GCP | ventana [$DESDE..$HASTA] | dias=$DAYS | dry_run=$DRY_RUN ==="
log "Origen: $SRC_DB_HOST/$SRC_DB_NAME  ->  Destino: $DB_HOST/$DB_NAME (ssl=$GCP_SSL)"

for t in "${TABLES[@]}"; do
  process_table "$t"
done

if [[ "$MODE_DAILY" -eq 1 && "${#CANARY_EMPTY[@]}" -gt 0 ]]; then
  log "WARNING: sin datos de AYER ($HASTA) en: ${CANARY_EMPTY[*]}."
  log "WARNING: probablemente el cierre del local (7:45am) aun no termina. Reintenta manual cuando haya datos (ver README-sync.md)."
  WARN=1
fi

if [[ "$DRY_RUN" -eq 0 && "$NO_REFRESH" -eq 0 ]]; then
  log "Refrescando matview de rotacion en GCP (CONCURRENTLY)..."
  ENV_FILE="$ENV_FILE" bash "$REPO_ROOT/scripts/refresh-rotacion-matview.sh" \
    || log "WARN: refresh de matview fallo; el tablero de rotacion puede quedar un ciclo atrasado."
fi

if [[ "$RUN_VERIFY" -eq 1 ]]; then
  log "Verificando frescura de datos en GCP..."
  FECHA_OBJETIVO="$HASTA" ENV_FILE="$ENV_FILE" bash "$SCRIPT_DIR/verify-data-freshness.sh" || true
fi

if [[ "$WARN" -eq 1 ]]; then
  log "=== ETL terminado con WARNING (exit 3) ==="
  exit 3
fi
log "=== ETL terminado OK ==="
