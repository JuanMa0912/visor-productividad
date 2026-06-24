#!/usr/bin/env bash
# Sube el dia a dia de las tablas de HECHOS desde el Postgres LOCAL a Cloud SQL (GCP).
#
# Estrategia: UPSERT por clave natural (INSERT ... ON CONFLICT DO UPDATE). No borra.
# Las PK/UNIQUE son identicas en local y GCP, asi que es imposible duplicar.
#
# Tablas (allowlist fija; NO toca tablas de estado de la app ni matviews):
#   ventas_cajas, ventas_fruver, ventas_carnes, ventas_asadero, ventas_pollo_pesc,
#   ventas_industria, rotacion_base_item_dia_sede, asistencia_horas, ventas_item_diario,
#   margen_final
# (ventas_item_diario y margen_final: sus ETLs de carga al local corren aparte; aqui solo
#  los replicamos local->GCP. margen_final NO tiene clave natural -> modo "replace": borra
#  la ventana en GCP y reinserta, excluyendo su id serial.)
#
# Ventana:
#   - default (sin flags) = solo AYER (rapido, para no retrasar la subida del dia).
#   - --days N            = ultimos N dias terminando ayer (reconciliacion; ej. sabado --days 18).
#   - --date YYYY-MM-DD   = un solo dia (re-correr/backfill manual).
#
# Otros flags:
#   --dry-run     solo cuenta filas en local, no escribe en GCP.
#   --no-refresh  no refresca la matview de rotacion al final.
#   --verify      chequea la fecha maxima por tabla en GCP al terminar.
#   -h|--help     ayuda.
#
# Config: UN solo archivo .env.etl en la raiz del deploy, con nombres EXPLICITOS
# por extremo (no se confunde local con GCP). Override la ruta con ETL_ENV_FILE=...
#   Origen local:  DB_HOST_LOCAL DB_PORT_LOCAL DB_NAME_LOCAL DB_USER_LOCAL DB_PASSWORD_LOCAL [DB_SSL_LOCAL]
#   Destino GCP:   DB_HOST_GCP   DB_PORT_GCP   DB_NAME_GCP   DB_USER_GCP   DB_PASSWORD_GCP   [DB_SSL_GCP]
#
# Uso tipico (en 192.168.35.232, como el usuario dueno del deploy):
#   sudo -u prodapp bash /home/prodapp/visor-productividad/scripts/etl/sync-local-to-gcp.sh
#   sudo -u prodapp bash .../sync-local-to-gcp.sh --days 18          # reconciliacion semanal
#   sudo -u prodapp bash .../sync-local-to-gcp.sh --date 2026-06-22  # un dia puntual
#
# Codigos de salida: 0 = OK | 3 = WARNING (sin datos de ayer) | 1 = ERROR.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

ETL_ENV_FILE="${ETL_ENV_FILE:-$REPO_ROOT/.env.etl}"
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

# --- Cargar config (un solo archivo, nombres explicitos por extremo) --------
[[ -f "$ETL_ENV_FILE" ]] || { log "ERROR: no encuentro la config del ETL: $ETL_ENV_FILE (ver scripts/etl/env.etl.example)"; exit 1; }

set -a
# shellcheck source=/dev/null
source "$ETL_ENV_FILE"
set +a

: "${DB_HOST_GCP:?DB_HOST_GCP no definido en $ETL_ENV_FILE}"
: "${DB_NAME_GCP:?DB_NAME_GCP no definido en $ETL_ENV_FILE}"
: "${DB_USER_GCP:?DB_USER_GCP no definido en $ETL_ENV_FILE}"
: "${DB_PASSWORD_GCP:?DB_PASSWORD_GCP no definido en $ETL_ENV_FILE}"
: "${DB_PASSWORD_LOCAL:?DB_PASSWORD_LOCAL no definido en $ETL_ENV_FILE}"

DB_HOST_LOCAL="${DB_HOST_LOCAL:-localhost}"
DB_PORT_LOCAL="${DB_PORT_LOCAL:-5432}"
DB_NAME_LOCAL="${DB_NAME_LOCAL:-produXdia}"
DB_USER_LOCAL="${DB_USER_LOCAL:-postgres}"
DB_PORT_GCP="${DB_PORT_GCP:-5432}"

# SSL por extremo (default: require para GCP no-loopback; disable para local).
resolve_ssl() {  # raw_value host -> imprime require|disable
  local raw host; raw="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')"; host="$2"
  if   [[ "$raw" == "true"  || "$raw" == "1" || "$raw" == "require" ]]; then echo require
  elif [[ "$raw" == "false" || "$raw" == "0" || "$raw" == "disable" ]]; then echo disable
  elif [[ "$host" == "localhost" || "$host" == "127.0.0.1" || "$host" == "::1" ]]; then echo disable
  else echo require; fi
}
GCP_SSL="$(resolve_ssl "${DB_SSL_GCP:-}" "$DB_HOST_GCP")"
LOCAL_SSL="$(resolve_ssl "${DB_SSL_LOCAL:-}" "$DB_HOST_LOCAL")"

SRC_PSQL=(env "PGPASSWORD=$DB_PASSWORD_LOCAL" "PGSSLMODE=$LOCAL_SSL" psql
  --host="$DB_HOST_LOCAL" --port="$DB_PORT_LOCAL" --username="$DB_USER_LOCAL"
  --dbname="$DB_NAME_LOCAL" --no-password --set ON_ERROR_STOP=on)
GCP_PSQL=(env "PGPASSWORD=$DB_PASSWORD_GCP" "PGSSLMODE=$GCP_SSL" psql
  --host="$DB_HOST_GCP" --port="$DB_PORT_GCP" --username="$DB_USER_GCP"
  --dbname="$DB_NAME_GCP" --no-password --set ON_ERROR_STOP=on)

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
        ventas_industria rotacion_base_item_dia_sede asistencia_horas ventas_item_diario
        margen_final)
CANARIES="ventas_cajas rotacion_base_item_dia_sede asistencia_horas"

# KEY      = columnas de identidad (no se actualizan en el upsert).
# CONFLICT = target del ON CONFLICT; default "(KEY)". Override cuando el indice unico
#            usa expresiones (p.ej. COALESCE) en vez de columnas planas.
# EXCLUDE  = columnas que NO se insertan (serial id, FKs); lista separada por comas.
# MODE     = "upsert" (default) o "replace" (borra-ventana+inserta, tablas sin clave natural).
declare -A KEY DATECOL DATETYPE EXCLUDE CONFLICT MODE
VENTAS_FULL="empresa_bd,centro_operacion,sede,caja,fecha_dcto,id_tipdoc_fc,documento_fc,id_vend_cc,categoria,linea"
KEY[ventas_cajas]="empresa_bd,centro_operacion,fecha_dcto,id_tipdoc_fc,consecutivo_doc,id_vend_cc"
KEY[ventas_fruver]="$VENTAS_FULL"
KEY[ventas_carnes]="$VENTAS_FULL"
KEY[ventas_asadero]="$VENTAS_FULL"
KEY[ventas_pollo_pesc]="$VENTAS_FULL"
KEY[ventas_industria]="empresa_bd,centro_operacion,sede,caja,fecha_dcto,id_tipdoc_fc,documento_fc,id_vend_cc,categoria"
KEY[rotacion_base_item_dia_sede]="empresa,fecha_dia,sede,bodega_local,id_item"
KEY[asistencia_horas]="numero,fecha"
# ventas_item_diario: PK serial (id) + FK (source_load_id) -> se excluyen. Su unico
# natural usa COALESCE, asi que el ON CONFLICT va con la expresion (no columnas planas).
KEY[ventas_item_diario]="fecha_dcto,empresa,empresa_norm,id_co,id_co_norm,id_item,linea"
CONFLICT[ventas_item_diario]="(fecha_dcto, COALESCE(empresa_norm, empresa), COALESCE(id_co_norm, id_co), id_item, linea)"

for t in ventas_cajas ventas_fruver ventas_carnes ventas_asadero ventas_pollo_pesc ventas_industria; do
  DATECOL[$t]="fecha_dcto"; DATETYPE[$t]="text"; EXCLUDE[$t]=""
done
DATECOL[rotacion_base_item_dia_sede]="fecha_dia"; DATETYPE[rotacion_base_item_dia_sede]="date"; EXCLUDE[rotacion_base_item_dia_sede]=""
DATECOL[asistencia_horas]="fecha"; DATETYPE[asistencia_horas]="date"; EXCLUDE[asistencia_horas]="id_asistencia"
DATECOL[ventas_item_diario]="fecha_dcto"; DATETYPE[ventas_item_diario]="text"; EXCLUDE[ventas_item_diario]="id,source_load_id"
# margen_final: SIN clave natural (solo id serial). Modo "replace" -> borra la ventana en
# GCP y reinserta (excluye el id serial). Lo alimenta el ETL de margenes en local (07:15).
DATECOL[margen_final]="fecha_dcto"; DATETYPE[margen_final]="text"; EXCLUDE[margen_final]="id"; MODE[margen_final]="replace"

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
  local tbl="$1" exclude=",${EXCLUDE[$1]}," localset out="" c
  localset=" $("${SRC_PSQL[@]}" -tA -c \
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='$tbl';" \
    | tr '\n' ' ') "
  while IFS= read -r c; do
    [[ -z "$c" ]] && continue
    [[ "$exclude" == *",$c,"* ]] && continue
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
  local tbl="$1" where cols keylist conflict setclause drop_stmt on_conflict tmp cnt _ec mode
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
  mode="${MODE[$tbl]:-upsert}"

  tmp="$(mktemp "${TMPDIR:-/tmp}/etl_${tbl}_XXXXXX.csv")"; TMPFILES+=("$tmp")
  "${SRC_PSQL[@]}" -c "COPY (SELECT $cols FROM public.$tbl WHERE $where) TO STDOUT WITH (FORMAT csv)" > "$tmp"

  # Modo "replace" (tablas sin clave natural, p.ej. margen_final): borra la ventana en GCP
  # y reinserta. La guarda cnt==0 de arriba evita borrar si local esta vacio para la ventana.
  if [[ "$mode" == "replace" ]]; then
    "${GCP_PSQL[@]}" <<SQL
\set ON_ERROR_STOP on
BEGIN;
SET statement_timeout = 0;
DELETE FROM public.$tbl WHERE $where;
\copy public.$tbl ($cols) FROM '$tmp' WITH (FORMAT csv)
COMMIT;
SQL
    rm -f "$tmp"
    log "[$tbl] replace OK ($cnt filas)"
    return 0
  fi

  # Modo "upsert" (default): staging temporal + INSERT ... ON CONFLICT.
  keylist="${KEY[$tbl]}"; conflict="${CONFLICT[$tbl]:-($keylist)}"
  setclause="$(build_set "$cols" "$keylist")"
  if [[ -n "$setclause" ]]; then on_conflict="DO UPDATE SET $setclause"; else on_conflict="DO NOTHING"; fi
  drop_stmt=""
  for _ec in ${EXCLUDE[$tbl]//,/ }; do drop_stmt+="ALTER TABLE _stg DROP COLUMN $_ec;"; done

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

# Refresca las matviews de rotacion en GCP (la app lee de ahi). Inline, usa la
# conexion GCP ya construida; no depende de scripts/env externos.
refresh_matviews() {
  local mv="rotacion_item_dia_clean" exists fn
  exists="$("${GCP_PSQL[@]}" -tAc "SELECT 1 FROM pg_matviews WHERE matviewname='$mv' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
  if [[ -z "$exists" ]]; then log "Matview $mv no existe en GCP; omito refresh."; return 0; fi
  log "Refrescando $mv (CONCURRENTLY)..."
  if ! "${GCP_PSQL[@]}" -c "SET statement_timeout=0;" -c "REFRESH MATERIALIZED VIEW CONCURRENTLY $mv;" >/dev/null 2>&1; then
    log "WARN: REFRESH CONCURRENTLY fallo; reintento sin CONCURRENTLY (bloquea lecturas brevemente)"
    "${GCP_PSQL[@]}" -c "SET statement_timeout=0;" -c "REFRESH MATERIALIZED VIEW $mv;" >/dev/null 2>&1 \
      || { log "WARN: refresh de $mv fallo; el tablero de rotacion puede quedar un ciclo atrasado."; return 0; }
  fi
  "${GCP_PSQL[@]}" -c "ANALYZE $mv;" >/dev/null 2>&1 || true
  fn="$("${GCP_PSQL[@]}" -tAc "SELECT 1 FROM pg_proc WHERE proname='refresh_rotacion_item_periodo_std' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
  if [[ -n "$fn" ]]; then
    log "Refrescando snapshot rotacion_item_periodo_std()..."
    "${GCP_PSQL[@]}" -c "SET statement_timeout=0;" -c "SELECT refresh_rotacion_item_periodo_std();" >/dev/null 2>&1 \
      || log "WARN: refresh de periodo_std fallo."
  fi
  log "Refresh de matviews OK."
}

# Chequeo simple: fecha maxima por tabla en GCP vs el objetivo (HASTA).
verify_freshness() {
  log "Verificando frescura en GCP (objetivo $HASTA)..."
  "${GCP_PSQL[@]}" -v obj="$HASTAC" -P pager=off -c "
    WITH m AS (
      SELECT 'ventas_cajas' t, max(fecha_dcto) d FROM ventas_cajas
      UNION ALL SELECT 'ventas_fruver', max(fecha_dcto) FROM ventas_fruver
      UNION ALL SELECT 'ventas_carnes', max(fecha_dcto) FROM ventas_carnes
      UNION ALL SELECT 'ventas_asadero', max(fecha_dcto) FROM ventas_asadero
      UNION ALL SELECT 'ventas_pollo_pesc', max(fecha_dcto) FROM ventas_pollo_pesc
      UNION ALL SELECT 'ventas_industria', max(fecha_dcto) FROM ventas_industria
      UNION ALL SELECT 'rotacion_base_item_dia_sede', to_char(max(fecha_dia),'YYYYMMDD') FROM rotacion_base_item_dia_sede
      UNION ALL SELECT 'asistencia_horas', to_char(max(fecha),'YYYYMMDD') FROM asistencia_horas
    )
    SELECT t AS tabla, COALESCE(d,'-') AS hasta,
           CASE WHEN d >= :'obj' THEN 'OK' ELSE 'ATRASADA' END AS estado
    FROM m ORDER BY estado DESC, tabla;" || log "WARN: verificacion fallo."
}

log "=== ETL local -> GCP | ventana [$DESDE..$HASTA] | dias=$DAYS | dry_run=$DRY_RUN ==="
log "Config: $ETL_ENV_FILE"
log "Origen(local): $DB_HOST_LOCAL/$DB_NAME_LOCAL  ->  Destino(GCP): $DB_HOST_GCP/$DB_NAME_GCP (ssl=$GCP_SSL)"

for t in "${TABLES[@]}"; do
  process_table "$t"
done

if [[ "$MODE_DAILY" -eq 1 && "${#CANARY_EMPTY[@]}" -gt 0 ]]; then
  log "WARNING: sin datos de AYER ($HASTA) en: ${CANARY_EMPTY[*]}."
  log "WARNING: probablemente el cierre del local (7:45am) aun no termina. Reintenta manual cuando haya datos (ver README-sync.md)."
  WARN=1
fi

if [[ "$DRY_RUN" -eq 0 && "$NO_REFRESH" -eq 0 ]]; then
  refresh_matviews
fi

if [[ "$RUN_VERIFY" -eq 1 ]]; then
  verify_freshness
fi

if [[ "$WARN" -eq 1 ]]; then
  log "=== ETL terminado con WARNING (exit 3) ==="
  exit 3
fi
log "=== ETL terminado OK ==="
