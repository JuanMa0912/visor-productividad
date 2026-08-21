#!/usr/bin/env bash
# Sube el dia a dia de las tablas de HECHOS desde el Postgres LOCAL a Cloud SQL (GCP).
#
# Estrategia POR DEFECTO: UPSERT por clave natural (INSERT ... ON CONFLICT DO UPDATE),
# que no borra. Las PK/UNIQUE son identicas en local y GCP, asi que es imposible duplicar.
#
# CUIDADO - DOS TABLAS NO SIGUEN ESA ESTRATEGIA. `asistencia_horas` y `margen_final` van
# SIEMPRE en modo replace: borran en GCP las fechas presentes en el local y reinsertan,
# aunque no pases --replace. Consecuencia: para esas dos, lo que quede en el local es
# exactamente lo que quedara en GCP, asi que un dia que falte en el local DESAPARECE de
# GCP. Es deliberado (el biometrico re-importa y corrige, a veces con MENOS filas, y un
# upsert dejaria huerfanas que nadie limpia), pero conviene mirar el local antes de un
# rango grande. Seguro en un aspecto: si el local esta vacio en la ventana, no borra nada.
#
# Tablas (allowlist fija; NO toca tablas de estado de la app ni matviews):
#   ventas_cajas, ventas_fruver, ventas_carnes, ventas_asadero, ventas_pollo_pesc,
#   ventas_industria, rotacion_base_item_dia_sede, ventas_item_diario,
#   rotacion_salidas_dia (movimientos de inventario NO-RV; el documento EK alimenta
#                      el DIC de demanda de /rotacion),
#   ventas_proveedor_dia, inventario_proveedor_dia,
#   proveedor_pos_catalogo, proveedor_item, proveedor_tercero,
#   rotacion_kit_composicion y rotacion_item_codbar
#                      (catalogos sin fecha: se suben completos),
#   orden_compra / orden_compra_linea
#                     (NO van en el diario 07:50; las sube visor-etl-orden-compra 08:00
#                      con --only; upsert de toda la tabla local, sin borrar GCP),
#   asistencia_horas  (modo replace SIEMPRE, ver aviso de arriba)
#   margen_final      (modo replace SIEMPRE; --margen-full para snapshot completo)
# (ventas_item_diario y margen_final: sus ETLs de carga al local corren aparte; aqui solo
#  los replicamos local->GCP. margen_final NO tiene clave natural -> borra ventana en GCP
#  y reinserta, excluyendo su id serial.)
#
# Ventana:
#   - default (sin flags)        = solo AYER (rapido, para no retrasar la subida del dia).
#   - --days N                   = ultimos N dias terminando ayer (reconciliacion; ej. sabado --days 18).
#   - --date YYYY-MM-DD          = un solo dia (re-correr/backfill manual).
#   - --desde A --hasta B        = rango fijo [A..B] (backfill historico; independiente del dia de corrida).
#
# Otros flags:
#   --only T[,T]  solo procesa esa(s) tabla(s) de la allowlist (backfill quirurgico).
#                 repetible y/o separado por comas. Ej: --only ventas_item_diario.
#   --dry-run     solo cuenta filas en local, no escribe en GCP.
#   --no-refresh  no refresca la matview de rotacion al final (NO afecta el rollup de margen).
#   --no-roll     no refresca el rollup margen_final_roll (por defecto SI se refresca cuando
#                 se sincronizo margen_final; el tablero de margenes lee de esa tabla).
#   --replace     para las tablas seleccionadas, en vez de upsert REEMPLAZA en GCP las FECHAS
#                 presentes en el local (borra-esas-fechas + reinserta). Usalo cuando el local
#                 perdio filas (re-importacion/limpieza) y GCP quedo con HUERFANAS que el upsert
#                 no borra. Seguro: no toca fechas que el local no tenga, y si el local esta
#                 vacio en la ventana no borra nada.
#   --verify      chequea la fecha maxima por tabla en GCP al terminar.
#   --margen-full carga TODA margen_final local -> GCP (borra la tabla en GCP antes).
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
RANGE_FROM=""
RANGE_TO=""
DRY_RUN=0
NO_REFRESH=0
NO_ROLL=0
FORCE_REPLACE=0
RUN_VERIFY=0
MARGEN_FULL=0
ONLY_TABLES=""
MODE_DAILY=1   # 1 solo cuando es la corrida diaria (default, sin --days ni --date)

usage() { sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --days)      DAYS="${2:?--days requiere un numero}"; MODE_DAILY=0; shift 2 ;;
    --days=*)    DAYS="${1#*=}"; MODE_DAILY=0; shift ;;
    --date)      ONE_DATE="${2:?--date requiere YYYY-MM-DD}"; MODE_DAILY=0; shift 2 ;;
    --date=*)    ONE_DATE="${1#*=}"; MODE_DAILY=0; shift ;;
    --desde|--from) RANGE_FROM="${2:?--desde requiere YYYY-MM-DD}"; MODE_DAILY=0; shift 2 ;;
    --desde=*|--from=*) RANGE_FROM="${1#*=}"; MODE_DAILY=0; shift ;;
    --hasta|--to)   RANGE_TO="${2:?--hasta requiere YYYY-MM-DD}"; MODE_DAILY=0; shift 2 ;;
    --hasta=*|--to=*)   RANGE_TO="${1#*=}"; MODE_DAILY=0; shift ;;
    --only)      ONLY_TABLES+=" ${2:?--only requiere nombre(s) de tabla}"; shift 2 ;;
    --only=*)    ONLY_TABLES+=" ${1#*=}"; shift ;;
    --table)     ONLY_TABLES+=" ${2:?--table requiere nombre(s) de tabla}"; shift 2 ;;
    --table=*)   ONLY_TABLES+=" ${1#*=}"; shift ;;
    --dry-run)   DRY_RUN=1; shift ;;
    --no-refresh) NO_REFRESH=1; shift ;;
    --no-roll)   NO_ROLL=1; shift ;;
    --replace)   FORCE_REPLACE=1; shift ;;
    --verify)    RUN_VERIFY=1; shift ;;
    --margen-full) MARGEN_FULL=1; shift ;;
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
for _d in "$RANGE_FROM" "$RANGE_TO"; do
  [[ -z "$_d" ]] && continue
  [[ "$_d" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "ERROR: fecha debe ser YYYY-MM-DD: $_d" >&2; exit 2; }
done
if [[ -n "$RANGE_FROM" || -n "$RANGE_TO" ]]; then
  [[ -n "$RANGE_FROM" && -n "$RANGE_TO" ]] || { echo "ERROR: --desde y --hasta van juntos" >&2; exit 2; }
  [[ -z "$ONE_DATE" ]] || { echo "ERROR: --date no se combina con --desde/--hasta" >&2; exit 2; }
  [[ "$RANGE_FROM" > "$RANGE_TO" ]] && { echo "ERROR: --desde ($RANGE_FROM) es mayor que --hasta ($RANGE_TO)" >&2; exit 2; }
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
if [[ -n "$RANGE_FROM" ]]; then
  DESDE="$RANGE_FROM"; HASTA="$RANGE_TO"
elif [[ -n "$ONE_DATE" ]]; then
  DESDE="$ONE_DATE"; HASTA="$ONE_DATE"
else
  HASTA="$(date -d 'yesterday' +%F)"
  DESDE="$(date -d "$DAYS days ago" +%F)"
fi
DESDEC="${DESDE//-/}"; HASTAC="${HASTA//-/}"

# --- Configuracion por tabla ----------------------------------------------
# OJO CON EL ORDEN: proveedor_pos_catalogo va PRIMERO porque el tablero /proveedores hace
# join contra el; si subieran antes los hechos, habria una ventana en la que el tablero
# mostraria proveedores sin nombre.
# rotacion_kit_composicion / rotacion_item_codbar son CATALOGOS y van primero por la misma
# razon que los de proveedor: el tablero hace LEFT JOIN contra ellos.
TABLES=(proveedor_pos_catalogo proveedor_item proveedor_tercero
        rotacion_kit_composicion rotacion_item_codbar
        ventas_cajas ventas_fruver ventas_carnes ventas_asadero ventas_pollo_pesc
        ventas_industria rotacion_base_item_dia_sede rotacion_salidas_dia
        asistencia_horas ventas_item_diario
        ventas_proveedor_dia inventario_proveedor_dia orden_compra orden_compra_linea
        margen_final)
CANARIES="ventas_cajas rotacion_base_item_dia_sede asistencia_horas"

# --only / --table: filtra la allowlist a un subconjunto (backfill quirurgico).
ONLY_TABLES="${ONLY_TABLES//,/ }"   # acepta comas ademas de repetir el flag
if [[ -n "${ONLY_TABLES// /}" ]]; then
  for o in $ONLY_TABLES; do
    case " ${TABLES[*]} " in
      *" $o "*) ;;
      *) echo "ERROR: --only '$o' no esta en la allowlist: ${TABLES[*]}" >&2; exit 2 ;;
    esac
  done
fi
table_selected() {  # 0 si la tabla esta seleccionada (o si no hay filtro)
  local t="$1" o
  [[ -z "${ONLY_TABLES// /}" ]] && return 0
  for o in $ONLY_TABLES; do [[ "$o" == "$t" ]] && return 0; done
  return 1
}

# Tablas con timer propio. El diario/reconcile SIN --only no las toca.
# Siguen en la allowlist para `$SYNC --only orden_compra --only orden_compra_linea`.
SKIP_IN_DEFAULT_SYNC=(orden_compra orden_compra_linea)
in_default_skip() {
  local t="$1" s
  for s in "${SKIP_IN_DEFAULT_SYNC[@]}"; do [[ "$s" == "$t" ]] && return 0; done
  return 1
}
should_process() {
  local t="$1"
  table_selected "$t" || return 1
  if [[ -z "${ONLY_TABLES// /}" ]] && in_default_skip "$t"; then
    return 1
  fi
  return 0
}

# KEY      = columnas de identidad (no se actualizan en el upsert).
# CONFLICT = target del ON CONFLICT; default "(KEY)". Override cuando el indice unico
#            usa expresiones (p.ej. COALESCE) en vez de columnas planas.
# EXCLUDE  = columnas que NO se insertan (serial id, FKs); lista separada por comas.
# MODE     = "upsert" (default), "replace" (borra-fechas-presentes-en-local + reinserta)
#            o "snapshot" (borra TODA la tabla en GCP + reinserta; no usar en el diario).
#            replace fijo: margen_final (sin clave natural) y asistencia_horas (el biometrico
#            re-importa con menos filas -> el upsert dejaria huerfanas). El resto: upsert.
declare -A KEY DATECOL DATETYPE EXCLUDE CONFLICT MODE
VENTAS_FULL="empresa_bd,centro_operacion,sede,caja,fecha_dcto,id_tipdoc_fc,documento_fc,id_vend_cc,categoria,linea"
KEY[ventas_cajas]="empresa_bd,centro_operacion,fecha_dcto,id_tipdoc_fc,consecutivo_doc,id_vend_cc"
KEY[ventas_fruver]="$VENTAS_FULL"
KEY[ventas_carnes]="$VENTAS_FULL"
KEY[ventas_asadero]="$VENTAS_FULL"
KEY[ventas_pollo_pesc]="$VENTAS_FULL"
KEY[ventas_industria]="empresa_bd,centro_operacion,sede,caja,fecha_dcto,id_tipdoc_fc,documento_fc,id_vend_cc,categoria"
KEY[rotacion_base_item_dia_sede]="empresa,fecha_dia,sede,bodega_local,id_item"
# rotacion_salidas_dia: movimientos de inventario NO-RV (el EK alimenta el DIC de demanda).
# ~1.000 filas/dia contra las 210.000 de la base: por eso es tabla aparte y no columnas.
KEY[rotacion_salidas_dia]="empresa,fecha_dia,sede,bodega_local,id_item,doc_inv_tipo,ind_es"
KEY[rotacion_kit_composicion]="empresa,id_item_padre,id_item_hijo"
KEY[rotacion_item_codbar]="empresa,id_item"
KEY[asistencia_horas]="numero,fecha"
# ventas_item_diario: PK serial (id) + FK (source_load_id) -> se excluyen. Su unico
# natural usa COALESCE, asi que el ON CONFLICT va con la expresion (no columnas planas).
KEY[ventas_item_diario]="fecha_dcto,empresa,empresa_norm,id_co,id_co_norm,id_item,linea"
CONFLICT[ventas_item_diario]="(fecha_dcto, COALESCE(empresa_norm, empresa), COALESCE(id_co_norm, id_co), id_item, linea)"
# Proveedores (tablero /proveedores). A diferencia de ventas_item_diario, sus indices unicos
# usan columnas PLANAS a proposito, asi que el ON CONFLICT default "(KEY)" sirve tal cual.
KEY[proveedor_pos_catalogo]="empresa,id_cricla1"
KEY[proveedor_item]="empresa,id_item"
KEY[proveedor_tercero]="empresa,codigo,sucursal"
KEY[ventas_proveedor_dia]="empresa,fecha_dcto,id_co,id_cricla1"
KEY[inventario_proveedor_dia]="empresa,fecha_dia,id_co,id_cricla1"
KEY[orden_compra]="empresa,id_co,tipdoc,documento_oc"
KEY[orden_compra_linea]="empresa,id_co,tipdoc,documento_oc,id_item,id_terc"

for t in ventas_cajas ventas_fruver ventas_carnes ventas_asadero ventas_pollo_pesc ventas_industria; do
  DATECOL[$t]="fecha_dcto"; DATETYPE[$t]="text"; EXCLUDE[$t]=""
done
DATECOL[rotacion_base_item_dia_sede]="fecha_dia"; DATETYPE[rotacion_base_item_dia_sede]="date"; EXCLUDE[rotacion_base_item_dia_sede]=""
DATECOL[rotacion_salidas_dia]="fecha_dia"; DATETYPE[rotacion_salidas_dia]="date"; EXCLUDE[rotacion_salidas_dia]=""
# Los dos catalogos de rotacion NO tienen fecha -> MODE=full (upsert entero, transaccional),
# igual que proveedor_pos_catalogo. El ETL los reemplaza por empresa en el 232, asi que el
# upsert no puede dejar huerfanas mientras la empresa siga existiendo.
DATECOL[rotacion_kit_composicion]=""; DATETYPE[rotacion_kit_composicion]=""; EXCLUDE[rotacion_kit_composicion]=""; MODE[rotacion_kit_composicion]="full"
DATECOL[rotacion_item_codbar]=""; DATETYPE[rotacion_item_codbar]=""; EXCLUDE[rotacion_item_codbar]=""; MODE[rotacion_item_codbar]="full"
DATECOL[asistencia_horas]="fecha"; DATETYPE[asistencia_horas]="date"; EXCLUDE[asistencia_horas]="id_asistencia"; MODE[asistencia_horas]="replace"  # replace SIEMPRE: el biometrico re-importa/corrige (a veces con MENOS filas) y el upsert dejaria huerfanas en GCP -> borra-fechas-presentes + reinserta cada sync
DATECOL[ventas_item_diario]="fecha_dcto"; DATETYPE[ventas_item_diario]="text"; EXCLUDE[ventas_item_diario]="id,source_load_id"
DATECOL[margen_final]="fecha_dcto"; DATETYPE[margen_final]="text"; EXCLUDE[margen_final]="id"; MODE[margen_final]="replace"
DATECOL[ventas_proveedor_dia]="fecha_dcto"; DATETYPE[ventas_proveedor_dia]="text"; EXCLUDE[ventas_proveedor_dia]="id,source_load_id"
# proveedor_pos_catalogo es un CATALOGO: NO tiene columna de fecha. MODE=full -> build_where
# devuelve "true" y se sube entero en un unico upsert transaccional. No usa "replace":
# el upsert nunca borra, y el catalogo tampoco borra filas en el local (los proveedores que
# salen del POS se marcan activo=false), asi que no puede quedar huerfano.
# El 232 es la fuente de verdad tambien para el NIT: lo que se edite en GCP se pisa.
DATECOL[proveedor_pos_catalogo]=""; DATETYPE[proveedor_pos_catalogo]=""; EXCLUDE[proveedor_pos_catalogo]=""; MODE[proveedor_pos_catalogo]="full"
# proveedor_item: puente item->proveedor, tambien SIN fecha -> MODE=full (~48k filas x empresa).
DATECOL[proveedor_item]=""; DATETYPE[proveedor_item]=""; EXCLUDE[proveedor_item]=""; MODE[proveedor_item]="full"
# proveedor_tercero: maestro comercial POS (terceros ind_pro=1). Catalogo sin fecha.
DATECOL[proveedor_tercero]=""; DATETYPE[proveedor_tercero]=""; EXCLUDE[proveedor_tercero]=""; MODE[proveedor_tercero]="full"
# inventario_proveedor_dia: fecha DATE (viene de rotacion), no text YYYYMMDD como el resto.
DATECOL[inventario_proveedor_dia]="fecha_dia"; DATETYPE[inventario_proveedor_dia]="date"; EXCLUDE[inventario_proveedor_dia]="id"
# orden_compra: el diario 07:50 NO la toca. La sube visor-etl-orden-compra 08:00
# con --only. MODE=full (sin ventana): hay que subir tambien incompletas viejas
# cuyo fecha_dcto no es "ayer". UPSERT, no borra GCP.
DATECOL[orden_compra]=""; DATETYPE[orden_compra]=""; EXCLUDE[orden_compra]="id"; MODE[orden_compra]="full"
# orden_compra_linea: mismo timer 08:00. MODE=full, sin id serial.
DATECOL[orden_compra_linea]=""; DATETYPE[orden_compra_linea]=""; EXCLUDE[orden_compra_linea]=""; MODE[orden_compra_linea]="full"

process_table_margen_full() {
  local tbl="margen_final" cols tmp cnt drop_stmt _ec
  cnt="$("${SRC_PSQL[@]}" -tA -c "SELECT count(*) FROM public.$tbl")"
  log "[$tbl] local tiene $cnt filas (carga completa --margen-full)"
  if [[ "$cnt" == "0" ]]; then
    log "[$tbl] sin filas en local; skip"
    return 0
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then log "[$tbl] dry-run: no escribe"; return 0; fi

  cols="$(build_cols "$tbl")"
  [[ -n "$cols" ]] || { log_cols_vacias "$tbl"; return 1; }
  drop_stmt=""
  for _ec in ${EXCLUDE[$tbl]//,/ }; do drop_stmt+="ALTER TABLE _stg DROP COLUMN $_ec;"; done
  tmp="$(mktemp "${TMPDIR:-/tmp}/etl_${tbl}_XXXXXX.csv")"; TMPFILES+=("$tmp")
  "${SRC_PSQL[@]}" -c "COPY (SELECT $cols FROM public.$tbl) TO STDOUT WITH (FORMAT csv)" > "$tmp"
  "${GCP_PSQL[@]}" <<SQL
\set ON_ERROR_STOP on
BEGIN;
SET statement_timeout = 0;
DELETE FROM public.$tbl;
CREATE TEMP TABLE _stg (LIKE public.$tbl INCLUDING DEFAULTS) ON COMMIT DROP;
$drop_stmt
\copy _stg ($cols) FROM '$tmp' WITH (FORMAT csv)
INSERT INTO public.$tbl ($cols)
SELECT $cols FROM _stg;
COMMIT;
SQL
  rm -f "$tmp"
  log "[$tbl] carga completa OK ($cnt filas)"
}

build_where() {
  local tbl="$1" col="${DATECOL[$1]:-}"
  # Tablas de CATALOGO (sin columna de fecha): no hay ventana que aplicar, se sincronizan
  # enteras. Devolver "true" deja intacto el resto del flujo (cnt, COPY, upsert).
  if [[ -z "$col" ]]; then
    echo "true"
  elif [[ "${DATETYPE[$tbl]}" == "text" ]]; then
    echo "$col BETWEEN '$DESDEC' AND '$HASTAC'"
  else
    echo "$col BETWEEN '$DESDE'::date AND '$HASTA'::date"
  fi
}

# Columnas comunes (existentes en ambos), en orden de GCP, menos la excluida.
# Conectividad real a cada extremo. Devuelve 0 si responde a un SELECT 1.
# OJO: no basta con que el host haga ping. Cuando la IP publica del 232 se cae de las
# redes autorizadas del Cloud SQL, el ICMP pasa y el 5432 se queda colgado hasta el
# timeout; por eso el chequeo tiene que ser una consulta, no un ping.
db_alcanzable() {  # $1 = local|gcp
  local out
  if [[ "$1" == "gcp" ]]; then
    out="$("${GCP_PSQL[@]}" -tA -c 'SELECT 1' 2>&1)" || { printf '%s' "$out"; return 1; }
  else
    out="$("${SRC_PSQL[@]}" -tA -c 'SELECT 1' 2>&1)" || { printf '%s' "$out"; return 1; }
  fi
  [[ "$out" == "1" ]] || { printf '%s' "$out"; return 1; }
  return 0
}

# Preflight: falla ANTES de recorrer tablas si un extremo no responde.
# Sin esto el script itera las 15 tablas y cada una reporta "sin columnas comunes
# resueltas", que manda a quien lee el log a buscar una columna que no falta.
# Asi se perdieron 2 dias en agosto de 2026 (ver README-sync.md).
preflight_conexiones() {
  local err
  if ! err="$(db_alcanzable local)"; then
    log "ERROR: la base LOCAL ($DB_HOST_LOCAL/$DB_NAME_LOCAL) no responde."
    log "ERROR: detalle: ${err//$'\n'/ | }"
    exit 2
  fi
  if ! err="$(db_alcanzable gcp)"; then
    log "ERROR: GCP ($DB_HOST_GCP/$DB_NAME_GCP) no responde. NO es un problema de esquema."
    log "ERROR: detalle: ${err//$'\n'/ | }"
    log "ERROR: si dice 'Expiro el tiempo de conexion' o 'timeout', la causa mas probable es"
    log "ERROR: que la IP publica de esta maquina cambio y ya no esta en las redes autorizadas"
    log "ERROR: del Cloud SQL. IP actual: $(curl -s --max-time 5 https://ifconfig.me 2>/dev/null || echo '(no se pudo consultar)')"
    log "ERROR: autorizala en la consola de GCP (SQL > Conexiones > Redes autorizadas) y reintenta."
    exit 2
  fi
}

# Diagnostico para cuando build_cols devuelve vacio. Solo se paga cuando ya hay error.
# Distingue las tres causas, que hasta ahora se reportaban todas con el mismo mensaje.
log_cols_vacias() {
  local tbl="$1" err n
  if ! err="$(db_alcanzable gcp)"; then
    log "[$tbl] ERROR: se perdio la conexion con GCP a mitad del sync (no es un problema de esquema)."
    log "[$tbl] ERROR: detalle: ${err//$'\n'/ | }"
    return 0
  fi
  n="$("${GCP_PSQL[@]}" -tA -c \
    "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='$tbl';" 2>/dev/null || echo "?")"
  if [[ "$n" == "0" ]]; then
    log "[$tbl] ERROR: la tabla NO existe en GCP. Falta correr su migracion alla (ver db/migrations/)."
  else
    log "[$tbl] ERROR: sin columnas comunes entre local y GCP (GCP tiene $n columnas)."
    log "[$tbl] ERROR: revisa que EXCLUDE[$tbl]='${EXCLUDE[$tbl]:-}' no este dejando fuera todo."
  fi
}

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
# El `return 0` NO es decorativo: sin el, cuando TMPFILES queda vacio (dry-run, o todas las
# tablas omitidas) el ultimo comando del trap es un `[[ -n '' ]]` que devuelve 1, y ese 1 se
# vuelve el codigo de salida del script pisando incluso un `exit 3` de WARNING. Es decir, el
# codigo de salida dependia de si habian quedado archivos temporales.
cleanup() { local f; for f in "${TMPFILES[@]:-}"; do [[ -n "${f:-}" ]] && rm -f "$f"; done; return 0; }
trap cleanup EXIT

CANARY_EMPTY=()
WARN=0
INCOMPLETOS_OMITIDOS=()

# ── Dias INCOMPLETOS: cargados con inventario pero sin una sola venta ─────────
# El ETL de rotacion (v3, fuera de este repo) escribe la foto de inventario aunque el POS
# no haya cerrado el dia, y avisa con exit 3 diciendo textualmente "re-correr ANTES de que
# el sync lo suba a GCP". Nada impedia que el sync lo subiera igual 20 minutos despues.
# Paso 4 dias seguidos (18, 19, 20 y 21 de agosto de 2026). El del 18 inflo el DIC medio
# global un 4,6% y marco 115 items como "sin venta" sin serlo.
#
# NO se consulta una tabla de control porque no existe una comun: cada ETL deja su marca
# a su manera y el de rotacion vive fuera del repo. La senal se lee de los propios datos y
# es inequivoca: una (empresa, fecha) con filas cargadas y cantidad_vendida = 0 no es un
# dia flojo, es un dia que el POS aun no habia cerrado. Un dia flojo de verdad si tiene
# ventas: el 2026-08-07, el peor medido, trajo 43.716 lineas en mercamio.
declare -A INCOMPLETE_CHECK
INCOMPLETE_CHECK[rotacion_base_item_dia_sede]="empresa|fecha_dia|cantidad_vendida"

# Lista las (empresa, fecha) incompletas de la ventana, una por linea, separadas por '|'.
dias_incompletos() {
  local tbl="$1" spec="${INCOMPLETE_CHECK[$1]:-}" col_emp col_fec col_val
  [[ -n "$spec" ]] || return 0
  IFS='|' read -r col_emp col_fec col_val <<< "$spec"
  "${SRC_PSQL[@]}" -tA -F'|' -c "
    SELECT $col_emp, $col_fec
    FROM public.$tbl
    WHERE $(build_where "$tbl")
    GROUP BY 1, 2
    HAVING count(*) > 0 AND COALESCE(sum($col_val), 0) = 0
    ORDER BY 2, 1;" 2>/dev/null
}

# Filtro SQL que EXCLUYE esas combinaciones del COPY. Cadena vacia si no hay ninguna,
# de modo que el camino feliz no cambia ni una coma.
filtro_sin_incompletos() {
  local tbl="$1" spec="${INCOMPLETE_CHECK[$1]:-}" col_emp col_fec emp fec extra=""
  [[ -n "$spec" ]] || { printf ''; return 0; }
  IFS='|' read -r col_emp col_fec _ <<< "$spec"
  while IFS='|' read -r emp fec; do
    [[ -z "${emp:-}" ]] && continue
    extra+=" AND NOT ($col_emp = '$emp' AND $col_fec = '$fec')"
    INCOMPLETOS_OMITIDOS+=("$tbl:$emp@$fec")
  done < <(dias_incompletos "$tbl")
  printf '%s' "$extra"
}

process_table() {
  local tbl="$1" where cols keylist conflict setclause drop_stmt on_conflict tmp cnt _ec mode datecol
  # Una tabla de la allowlist que aun no existe en el local NO puede tumbar el sync entero:
  # durante un despliegue el script llega antes que la migracion, y sin esto el diario de
  # las 07:35 muere con un error crudo de psql arrastrando a las tablas que si estaban bien.
  if ! "${SRC_PSQL[@]}" -tAc "SELECT to_regclass('public.$tbl')" 2>/dev/null | grep -q .; then
    log "[$tbl] AVISO: no existe en el local todavia; se omite. Corre su migracion en el 232."
    WARN=1
    return 0
  fi
  where="$(build_where "$tbl")"
  cnt="$("${SRC_PSQL[@]}" -tA -c "SELECT count(*) FROM public.$tbl WHERE $where")"
  log "[$tbl] local tiene $cnt filas en [$DESDE..$HASTA]"

  if [[ "$cnt" == "0" ]]; then
    case " $CANARIES " in *" $tbl "*) CANARY_EMPTY+=("$tbl") ;; esac
    [[ "$DRY_RUN" -eq 1 ]] || { log "[$tbl] sin filas; skip"; return 0; }
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then log "[$tbl] dry-run: no escribe"; return 0; fi

  cols="$(build_cols "$tbl")"
  [[ -n "$cols" ]] || { log_cols_vacias "$tbl"; return 1; }
  mode="${MODE[$tbl]:-upsert}"
  # --replace: forzar borra-fechas + reinserta. NO aplica a tablas sin columna de fecha
  # (catalogos): ahi "replace" no tiene sentido y abortaria con "replace requiere DATECOL".
  if [[ "$FORCE_REPLACE" -eq 1 && -n "${DATECOL[$tbl]:-}" ]]; then
    mode="replace"
  elif [[ "$FORCE_REPLACE" -eq 1 && "$mode" == "snapshot" ]]; then
    log "[$tbl] --replace ignorado: ya va en MODE=snapshot (reemplazo completo)"
  elif [[ "$FORCE_REPLACE" -eq 1 ]]; then
    log "[$tbl] --replace ignorado: es un catalogo sin columna de fecha (se sube completo por upsert)"
  fi

  # Excluye del COPY las (empresa, fecha) que el local tiene a medias. Se calcula aqui,
  # justo antes de leer, para que el aviso salga con la fila exacta que se omite.
  local skip_sql; skip_sql="$(filtro_sin_incompletos "$tbl")"
  if [[ -n "$skip_sql" ]]; then
    local om
    for om in "${INCOMPLETOS_OMITIDOS[@]}"; do
      [[ "$om" == "$tbl:"* ]] && log "[$tbl] OMITIDO ${om#*:}: cargado sin una sola venta; el POS no habia cerrado el dia. NO se sube a GCP."
    done
    log "[$tbl] re-corre el ETL de esa fecha y vuelve a lanzar el sync cuando el POS tenga el dia."
    WARN=1
  fi

  tmp="$(mktemp "${TMPDIR:-/tmp}/etl_${tbl}_XXXXXX.csv")"; TMPFILES+=("$tmp")
  "${SRC_PSQL[@]}" -c "COPY (SELECT $cols FROM public.$tbl WHERE $where$skip_sql) TO STDOUT WITH (FORMAT csv)" > "$tmp"

  # Modo "replace": reemplaza en GCP SOLO las fechas presentes en el local (via staging), no toda
  # la ventana -> nunca borra dias que el local no tenga (seguro para corridas parciales/automaticas).
  # La guarda cnt==0 de arriba ya evita tocar GCP si el local no tiene filas en la ventana.
  if [[ "$mode" == "snapshot" ]]; then
    drop_stmt=""
    for _ec in ${EXCLUDE[$tbl]//,/ }; do drop_stmt+="ALTER TABLE _stg DROP COLUMN $_ec;"; done
    "${GCP_PSQL[@]}" <<SQL
\set ON_ERROR_STOP on
BEGIN;
SET statement_timeout = 0;
CREATE TEMP TABLE _stg (LIKE public.$tbl INCLUDING DEFAULTS) ON COMMIT DROP;
$drop_stmt
\copy _stg ($cols) FROM '$tmp' WITH (FORMAT csv)
DELETE FROM public.$tbl;
INSERT INTO public.$tbl ($cols) SELECT $cols FROM _stg;
COMMIT;
SQL
    rm -f "$tmp"
    log "[$tbl] snapshot OK ($cnt filas; reemplazo completo en GCP)"
    return 0
  fi

  # Si se omitio alguna empresa por dia incompleto, NO se puede usar replace: su DELETE
  # borra por FECHA, no por (empresa, fecha), asi que se llevaria por delante la empresa
  # omitida aunque en GCP estuviera correcta de una carga anterior. El upsert no borra.
  if [[ "$mode" == "replace" && -n "$skip_sql" ]]; then
    log "[$tbl] replace -> upsert por esta corrida: hay una empresa omitida y el DELETE por fecha borraria su dato bueno en GCP."
    mode="upsert"
  fi

  if [[ "$mode" == "replace" ]]; then
    datecol="${DATECOL[$tbl]}"
    [[ -n "$datecol" ]] || { log "[$tbl] ERROR: replace requiere DATECOL definido"; return 1; }
    drop_stmt=""
    for _ec in ${EXCLUDE[$tbl]//,/ }; do drop_stmt+="ALTER TABLE _stg DROP COLUMN $_ec;"; done
    "${GCP_PSQL[@]}" <<SQL
\set ON_ERROR_STOP on
BEGIN;
SET statement_timeout = 0;
CREATE TEMP TABLE _stg (LIKE public.$tbl INCLUDING DEFAULTS) ON COMMIT DROP;
$drop_stmt
\copy _stg ($cols) FROM '$tmp' WITH (FORMAT csv)
DELETE FROM public.$tbl t WHERE t.$datecol IN (SELECT DISTINCT $datecol FROM _stg);
INSERT INTO public.$tbl ($cols) SELECT $cols FROM _stg;
COMMIT;
SQL
    rm -f "$tmp"
    log "[$tbl] replace OK ($cnt filas; reemplazo por fechas presentes en local)"
    if [[ "$tbl" == "asistencia_horas" ]]; then
      "${GCP_PSQL[@]}" -c "ANALYZE public.asistencia_horas;" >/dev/null 2>&1 || true
    fi
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
    # WARN=1 a proposito (antes solo logueaba): si el snapshot no se refresca, el tablero
    # sigue sirviendo el periodo anterior SIN que nada falle, y eso pasa desapercibido.
    # Causa tipica desde 2026-08-14: falta rotacion_salidas_dia en GCP -> la funcion aborta
    # con EXCEPTION en vez de publicar un DIC sin el consumo por kit.
    "${GCP_PSQL[@]}" -c "SET statement_timeout=0;" -c "SELECT refresh_rotacion_item_periodo_std();" >/dev/null 2>&1 \
      || { log "WARN: refresh de periodo_std fallo; el tablero sirve el periodo ANTERIOR. Revisa que rotacion_salidas_dia exista y este cargada en GCP."; WARN=1; }
  fi
  log "Refresh de matviews OK."
}

# Refresca rollups de margen en GCP para la ventana sincronizada.
# - margen_final_roll: tablero /margenes (factura+item)
# - margen_item_dia_roll: /informe-variacion (dia+item, sin factura)
# Si margen_final cambia y estos rolls no se refrescan, la UI muestra datos viejos aunque
# el crudo ya este al dia. Las funciones soportan rango (p_from,p_to): reemplazan SOLO esa
# ventana; sin args reconstruyen todo.
refresh_margen_roll() {
  local fn item_fn
  table_selected margen_final || return 0   # solo tiene sentido si se sincronizo margen_final
  fn="$("${GCP_PSQL[@]}" -tAc "SELECT 1 FROM pg_proc WHERE proname='refresh_margen_final_roll' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
  if [[ -z "$fn" ]]; then log "Funcion refresh_margen_final_roll no existe en GCP; omito rollup."; return 0; fi
  if [[ "$MARGEN_FULL" -eq 1 ]]; then
    log "Refrescando margen_final_roll COMPLETO (--margen-full)..."
    "${GCP_PSQL[@]}" -c "SET statement_timeout=0;" -c "SELECT refresh_margen_final_roll();" >/dev/null 2>&1 \
      || { log "WARN: refresh de margen_final_roll fallo; el tablero de margenes puede quedar atrasado."; return 0; }
  else
    # $DESDEC/$HASTAC = ventana YYYYMMDD ya validada (8 digitos) -> se inyecta como literal SQL.
    log "Refrescando margen_final_roll [$DESDEC..$HASTAC]..."
    "${GCP_PSQL[@]}" -c "SET statement_timeout=0;" -c "SELECT refresh_margen_final_roll('$DESDEC', '$HASTAC');" >/dev/null 2>&1 \
      || { log "WARN: refresh de margen_final_roll fallo; el tablero de margenes puede quedar atrasado."; return 0; }
  fi
  "${GCP_PSQL[@]}" -c "ANALYZE margen_final_roll;" >/dev/null 2>&1 || true
  log "Refresh de margen_final_roll OK."

  # Dinastia: roll dedicado (si existe).
  dinastia_fn="$("${GCP_PSQL[@]}" -tAc "SELECT 1 FROM pg_proc WHERE proname='refresh_margen_dinastia_roll' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
  if [[ -n "$dinastia_fn" ]]; then
    if [[ "$MARGEN_FULL" -eq 1 ]]; then
      log "Refrescando margen_dinastia_roll COMPLETO..."
      "${GCP_PSQL[@]}" -c "SET statement_timeout=0;" -c "SELECT refresh_margen_dinastia_roll();" >/dev/null 2>&1 \
        || { log "WARN: refresh de margen_dinastia_roll fallo."; }
    else
      log "Refrescando margen_dinastia_roll [$DESDEC..$HASTAC]..."
      "${GCP_PSQL[@]}" -c "SET statement_timeout=0;" -c "SELECT refresh_margen_dinastia_roll('$DESDEC', '$HASTAC');" >/dev/null 2>&1 \
        || { log "WARN: refresh de margen_dinastia_roll fallo."; }
    fi
    "${GCP_PSQL[@]}" -c "ANALYZE margen_dinastia_roll;" >/dev/null 2>&1 || true
    log "Refresh de margen_dinastia_roll OK."
  else
    log "Funcion refresh_margen_dinastia_roll no existe en GCP; omito rollup Dinastia."
  fi

  # Informe de variacion: depende de margen_item_dia_roll (alimentado desde margen_final_roll).
  item_fn="$("${GCP_PSQL[@]}" -tAc "SELECT 1 FROM pg_proc WHERE proname='refresh_margen_item_dia_roll' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
  if [[ -z "$item_fn" ]]; then
    log "Funcion refresh_margen_item_dia_roll no existe en GCP; omito rollup de informe-variacion."
    return 0
  fi
  if [[ "$MARGEN_FULL" -eq 1 ]]; then
    log "Refrescando margen_item_dia_roll COMPLETO (informe-variacion)..."
    "${GCP_PSQL[@]}" -c "SET statement_timeout=0;" -c "SELECT refresh_margen_item_dia_roll();" >/dev/null 2>&1 \
      || { log "WARN: refresh de margen_item_dia_roll fallo; /informe-variacion puede quedar atrasado."; return 0; }
  else
    log "Refrescando margen_item_dia_roll [$DESDEC..$HASTAC] (informe-variacion)..."
    "${GCP_PSQL[@]}" -c "SET statement_timeout=0;" -c "SELECT refresh_margen_item_dia_roll('$DESDEC', '$HASTAC');" >/dev/null 2>&1 \
      || { log "WARN: refresh de margen_item_dia_roll fallo; /informe-variacion puede quedar atrasado."; return 0; }
  fi
  "${GCP_PSQL[@]}" -c "ANALYZE margen_item_dia_roll;" >/dev/null 2>&1 || true
  log "Refresh de margen_item_dia_roll OK."
}

# Expresion de "fecha maxima" (como texto YYYYMMDD) por tabla, para el verify.
declare -A MAXEXPR
for t in ventas_cajas ventas_fruver ventas_carnes ventas_asadero ventas_pollo_pesc \
         ventas_industria ventas_item_diario ventas_proveedor_dia margen_final; do
  MAXEXPR[$t]="max(fecha_dcto)"
done
MAXEXPR[rotacion_base_item_dia_sede]="to_char(max(fecha_dia),'YYYYMMDD')"
MAXEXPR[asistencia_horas]="to_char(max(fecha),'YYYYMMDD')"
# El catalogo no tiene fecha de negocio; se verifica por su ultima actualizacion, que el
# upsert refresca en cada sync.
MAXEXPR[proveedor_pos_catalogo]="to_char(max(updated_at),'YYYYMMDD')"
MAXEXPR[proveedor_item]="to_char(max(updated_at),'YYYYMMDD')"
MAXEXPR[proveedor_tercero]="to_char(max(updated_at),'YYYYMMDD')"
MAXEXPR[inventario_proveedor_dia]="to_char(max(fecha_dia),'YYYYMMDD')"
# OC: fecha_dcto puede ser futura; loaded_at dice si el incremental de 08:00 corrio.
MAXEXPR[orden_compra]="to_char(max(loaded_at),'YYYYMMDD')"
MAXEXPR[orden_compra_linea]="to_char(max(loaded_at),'YYYYMMDD')"
MAXEXPR[rotacion_salidas_dia]="to_char(max(fecha_dia),'YYYYMMDD')"
# Catalogos de rotacion: sin fecha de negocio, se verifican por fecha_carga (el upsert la
# refresca en cada sync), igual que los catalogos de proveedor.
MAXEXPR[rotacion_kit_composicion]="to_char(max(fecha_carga),'YYYYMMDD')"
MAXEXPR[rotacion_item_codbar]="to_char(max(fecha_carga),'YYYYMMDD')"

# Chequeo simple: fecha maxima por tabla en GCP vs el objetivo (HASTA).
# Respeta --only para no referenciar tablas que tal vez no existan aun en GCP.
verify_freshness() {
  log "Verificando frescura en GCP (objetivo $HASTA)..."
  local cte="" t existentes
  # Una sola consulta con las tablas que SI existen en GCP. Sin esto, una tabla recien
  # agregada a la allowlist pero todavia sin migrar alla hace fallar el UNION completo y
  # el verify no reporta NINGUNA de las demas, que es justo cuando mas se necesita.
  existentes=" $("${GCP_PSQL[@]}" -tAc \
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null \
    | tr '\n' ' ') "
  for t in "${TABLES[@]}"; do
    should_process "$t" || continue
    if [[ "$existentes" != *" $t "* ]]; then
      log "verify: $t aun no existe en GCP; se omite del chequeo."
      continue
    fi
    # Sin MAXEXPR no se puede verificar esa tabla. Se avisa y se sigue: con `set -u` una
    # entrada faltante abortaria el script DESPUES de haber subido todo bien, y la unidad
    # systemd quedaria en fallo por una tabla nueva sin configurar.
    if [[ -z "${MAXEXPR[$t]:-}" ]]; then
      log "WARN: $t no tiene MAXEXPR; queda FUERA del verify (agregala en la seccion MAXEXPR)."
      continue
    fi
    if [[ -z "$cte" ]]; then
      cte="SELECT '$t' t, ${MAXEXPR[$t]} d FROM $t"
    else
      cte+=" UNION ALL SELECT '$t', ${MAXEXPR[$t]} FROM $t"
    fi
  done
  [[ -n "$cte" ]] || { log "verify: sin tablas que verificar."; return 0; }
  # $HASTAC es YYYYMMDD ya validado (8 digitos) -> se inyecta como literal SQL.
  # OJO: psql NO interpola :'var' dentro de -c, por eso aqui no se usa variable de psql.
  "${GCP_PSQL[@]}" -P pager=off -c "
    WITH m AS ($cte)
    SELECT t AS tabla, COALESCE(d,'-') AS hasta,
           CASE WHEN d IS NULL      THEN 'SIN DATOS'
                WHEN d >= '$HASTAC' THEN 'OK'
                ELSE 'ATRASADA' END AS estado
    FROM m ORDER BY estado DESC, tabla;" || log "WARN: verificacion fallo."
}

log "=== ETL local -> GCP | ventana [$DESDE..$HASTA] | dias=$DAYS | dry_run=$DRY_RUN ==="
log "Config: $ETL_ENV_FILE"
log "Origen(local): $DB_HOST_LOCAL/$DB_NAME_LOCAL  ->  Destino(GCP): $DB_HOST_GCP/$DB_NAME_GCP (ssl=$GCP_SSL)"

preflight_conexiones

for t in "${TABLES[@]}"; do
  if [[ -z "${ONLY_TABLES// /}" ]] && in_default_skip "$t"; then
    log "[$t] omitida: la sube su timer propio. Use --only $t para forzar."
    continue
  fi
  table_selected "$t" || continue
  if [[ "$t" == "margen_final" && "$MARGEN_FULL" -eq 1 ]]; then
    continue
  fi
  process_table "$t"
done

if [[ "$MARGEN_FULL" -eq 1 ]] && table_selected margen_final; then
  process_table_margen_full
fi

if [[ "$MARGEN_FULL" -eq 1 ]]; then
  log "Nota: --margen-full reemplazo completo de margen_final en GCP; el resto de tablas uso ventana [$DESDE..$HASTA]."
fi

if [[ "$MODE_DAILY" -eq 1 && "${#CANARY_EMPTY[@]}" -gt 0 ]]; then
  log "WARNING: sin datos de AYER ($HASTA) en: ${CANARY_EMPTY[*]}."
  log "WARNING: probablemente el cierre del local (7:45am) aun no termina. Reintenta manual cuando haya datos (ver README-sync.md)."
  WARN=1
fi

if [[ "$DRY_RUN" -eq 0 && "$NO_REFRESH" -eq 0 ]]; then
  refresh_matviews
fi

# El rollup de margen se refresca aunque venga --no-refresh (ese flag es para la matview de
# rotacion). Se salta solo con --dry-run o --no-roll: sin esto, sincronizar margen_final deja
# el tablero de margenes mostrando datos viejos porque lee de margen_final_roll.
if [[ "$DRY_RUN" -eq 0 && "$NO_ROLL" -eq 0 ]]; then
  refresh_margen_roll
fi

if [[ "$RUN_VERIFY" -eq 1 ]]; then
  verify_freshness
fi

if [[ "$WARN" -eq 1 ]]; then
  log "=== ETL terminado con WARNING (exit 3) ==="
  exit 3
fi
log "=== ETL terminado OK ==="
