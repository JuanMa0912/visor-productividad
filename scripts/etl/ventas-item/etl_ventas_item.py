#!/usr/bin/env python3
"""
ETL de ventas por item: carga desde las BD POS de origen
(192.168.35.217: mercamio / mtodo / bogota) a produXdia.ventas_item_diario (232).

Reemplaza al script que corria en un PC Windows con tarea programada a las 07:00
(ETL_ventasXitem_Masive_load.py). Motivos del port, todos verificados en datos:

 1. LA FECHA LA MANDA EL CALENDARIO, NO UN CURSOR.
    El script viejo calculaba el dia a cargar con
    `get_last_loaded_day() = MAX(fecha_dcto) WHERE status='done'`. El cargue
    historico del 2026-07-29 marco como 'done' con 0 filas los dias 20260730 y
    20260731 (dias que aun no existian) -> el incremental calculaba
    start_day = 20260801 y concluia "nada nuevo". Quedo bloqueado hasta agosto.
    Aqui el rango sale de la fecha de corrida (ayer, o --days N), nunca de la BD.

 2. UN DIA VACIO NO ES UN DIA CARGADO.
    El viejo hacia mark_control_day(status='done') aunque el POS devolviera 0
    filas -> el pase de reparacion nunca lo reintentaba. Aqui un dia sin filas
    queda status='empty' y el ETL termina con exit 3 (warning) para que
    systemd lo marque failed y se note. Ver tambien el timer de fin de semana.

 3. ACUMULADOS CORRECTOS.
    und_acum / venta_sin_impuesto_acum son acumulados DEL MES. El viejo los
    calculaba con una ventana sobre el rango consultado, y en modo diario ese
    rango era UN dia -> und_acum == und_dia siempre (verificado: el 20260729
    quedo con 32.460/32.460 filas con acum == dia). Aqui la consulta arranca
    SIEMPRE el 1 del mes y la ventana particiona por mes
    (PARTITION BY id_co, id_item, LEFT(fecha_dcto,6)), asi el acumulado es
    correcto tambien cuando el rango cruza de mes; luego se insertan solo los
    dias objetivo.

 4. NO se toca el padding de descripcion / linea. `linea` es parte del indice
    unico natural que usa el ON CONFLICT del sync a GCP; trimarla romperia la
    correspondencia con las 7.26M filas historicas y el upsert duplicaria en vez
    de actualizar (comprobado en vivo, ver el comentario en SQL_TEMPLATE).
    Normalizar el padding queda como mantenimiento aparte. Ver README.

Idempotente por "reemplazar el dia": por cada empresa y dia hace
DELETE (empresa, fecha_dcto) + INSERT, en una transaccion. Re-correr NO duplica.

Config: UN solo .env.etl en la raiz del deploy, COMPARTIDO con sync-local-to-gcp.sh
y con cargar_margen.py (ver scripts/etl/env.etl.example). Override con ETL_ENV_FILE.
El destino (produXdia 232) sale de DB_*_LOCAL; el origen POS (217) de DB_*_POS.

Uso:
  python3 etl_ventas_item.py                      # ayer (lo que corre el timer diario)
  python3 etl_ventas_item.py --days 7             # ultimos 7 dias hasta ayer (fin de semana)
  python3 etl_ventas_item.py --date 20260729      # un dia
  python3 etl_ventas_item.py --desde 20260701 --hasta 20260729
  python3 etl_ventas_item.py --dry-run            # solo cuenta filas en origen

Codigos de salida: 0 OK | 1 error | 2 uso invalido | 3 warning (algun dia sin ventas).
"""
import argparse
import datetime
import hashlib
import io
import os
import re
import sys
from pathlib import Path

import psycopg2

REPO_ROOT = Path(__file__).resolve().parents[3]  # scripts/etl/ventas-item/ -> raiz del repo
ENV_FILE = Path(os.environ.get("ETL_ENV_FILE", REPO_ROOT / ".env.etl"))

# Metadata por empresa (no secreta). La clave sale del .env unico (pwd_env).
EMPRESAS = [
    {"empresa": "mercamio", "db": "mercamio", "user": "mercamio", "pwd_env": "DB_PWD_POS_MERCAMIO"},
    {"empresa": "mtodo",    "db": "mtodo",    "user": "mtodo",    "pwd_env": "DB_PWD_POS_MTODO"},
    {"empresa": "bogota",   "db": "bogota",   "user": "bogota",   "pwd_env": "DB_PWD_POS_BOGOTA"},
]

TABLE_DIARIO = "public.ventas_item_diario"
TABLE_CARGAS = "public.ventas_item_cargas"
TABLE_SEDE_MAP = "public.ventas_item_sede_map"
TABLE_CTRL_DIAS = "public.ventas_item_carga_dias"

# Firma en ventas_item_cargas.loaded_by. Se conserva el nombre historico para no
# romper reportes/consultas que ya filtran por el; el origen nuevo va en notes.
LOADED_BY = "etl_ventas_x_item"

# Columnas que viajan del POS al staging, en orden posicional del COPY.
STG_COLS = (
    "fecha_dcto, id_co, id_item, descripcion, linea, "
    "und_dia, venta_sin_impuesto_dia, und_acum, venta_sin_impuesto_acum"
)

# Query origen. Las fechas van inline (validadas YYYYMMDD) porque COPY no acepta
# parametros; mismo criterio que cargar_margen.py.
#
#   {acum_ini}  = 1 del mes del PRIMER dia del rango  -> arranque de la ventana de acumulado
#   {fecha_ini} = primer dia a INSERTAR
#   {fecha_fin} = ultimo dia a INSERTAR
#
# El filtro de la CTE `base` abre en {acum_ini} para que el acumulado mensual sea
# correcto, y el WHERE final recorta a [{fecha_ini}..{fecha_fin}] para no traer de
# vuelta dias que no vamos a tocar.
SQL_TEMPLATE = r"""
WITH base AS (
  SELECT
    v.fecha_dcto,
    v.id_co,
    v.id_item,
    SUM(v.cantidad)  AS und_dia,
    SUM(v.ven_netas) AS venta_sin_impuesto_dia
  FROM public.cmmovimiento_pdv v
  WHERE v.fecha_dcto BETWEEN '{acum_ini}' AND '{fecha_fin}'
    AND (v.id_tipdoc_fc IS NULL OR v.id_tipdoc_fc NOT LIKE 'Z%')
  GROUP BY v.fecha_dcto, v.id_co, v.id_item
),
det AS (
  SELECT
    b.fecha_dcto,
    b.id_co,
    b.id_item,
    b.und_dia,
    b.venta_sin_impuesto_dia,
    -- OJO: descripcion y linea van SIN BTRIM a proposito.
    -- `linea` forma parte del indice unico natural que usa el ON CONFLICT del
    -- sync a GCP. Las 7.26M filas historicas vienen con el padding de los CHAR
    -- de SIESA (6.66M con espacios). Si aqui se trimara, la clave dejaria de
    -- calzar con lo que ya esta en GCP y el upsert INSERTARIA en vez de
    -- actualizar -> filas duplicadas. Se comprobo en vivo el 2026-07-30:
    -- el dia 20260729 quedo con 62.475 filas en GCP (30.015 viejas con padding
    -- + 32.460 nuevas sin el) hasta que se corrigio con --replace.
    -- Normalizar el padding es posible (0 colisiones en toda la tabla) pero es
    -- una migracion de 6.6M filas en local Y en GCP: va aparte, no aqui.
    i.descripcion                                 AS descripcion,
    COALESCE(l.cmlineas_descripcion, '')          AS linea
  FROM base b
  JOIN public.items i
    ON i.id_item = b.id_item
  LEFT JOIN public.lineas l
    ON l.id_linea = i.id_linea
   AND l.id_tipo  = i.id_tipo
),
acum AS (
  SELECT
    det.*,
    SUM(det.und_dia) OVER (
      PARTITION BY det.id_co, det.id_item, LEFT(det.fecha_dcto, 6)
      ORDER BY det.fecha_dcto
    ) AS und_acum,
    SUM(det.venta_sin_impuesto_dia) OVER (
      PARTITION BY det.id_co, det.id_item, LEFT(det.fecha_dcto, 6)
      ORDER BY det.fecha_dcto
    ) AS venta_sin_impuesto_acum
  FROM det
)
SELECT
  BTRIM(fecha_dcto)   AS fecha_dcto,
  BTRIM(id_co)        AS id_co,
  BTRIM(id_item)      AS id_item,
  descripcion,
  linea,
  COALESCE(und_dia, 0),
  COALESCE(venta_sin_impuesto_dia, 0),
  COALESCE(und_acum, 0),
  COALESCE(venta_sin_impuesto_acum, 0)
FROM acum
WHERE fecha_dcto BETWEEN '{fecha_ini}' AND '{fecha_fin}'
ORDER BY fecha_dcto, id_item
"""

DDL_STAGING = """
CREATE TEMP TABLE IF NOT EXISTS stg_ventas_item (
  fecha_dcto              text,
  id_co                   text,
  id_item                 text,
  descripcion             text,
  linea                   text,
  und_dia                 numeric(18,4),
  venta_sin_impuesto_dia  numeric(18,4),
  und_acum                numeric(18,4),
  venta_sin_impuesto_acum numeric(18,4)
);
"""


def log(msg: str) -> None:
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def load_env(path: Path) -> dict:
    """Parser minimo de .env (KEY=VALUE, ignora # y comillas)."""
    if not path.exists():
        log(f"ERROR: no encuentro la config del ETL: {path} "
            f"(ver scripts/etl/env.etl.example)")
        sys.exit(1)
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip("'\"")
    return env


def require(env: dict, key: str) -> str:
    val = env.get(key) or os.environ.get(key)
    if not val:
        log(f"ERROR: falta {key} en {ENV_FILE}")
        sys.exit(1)
    return val


def valid_date(s: str) -> str:
    if not re.fullmatch(r"\d{8}", s or ""):
        raise argparse.ArgumentTypeError(f"fecha invalida (use YYYYMMDD): {s}")
    datetime.datetime.strptime(s, "%Y%m%d")  # valida calendario
    return s


def daterange(desde: str, hasta: str):
    d0 = datetime.datetime.strptime(desde, "%Y%m%d").date()
    d1 = datetime.datetime.strptime(hasta, "%Y%m%d").date()
    if d1 < d0:
        log("ERROR: --hasta es anterior a --desde")
        sys.exit(2)
    d = d0
    while d <= d1:
        yield d.strftime("%Y%m%d")
        d += datetime.timedelta(days=1)


def month_start(yyyymmdd: str) -> str:
    """1 del mes de esa fecha. Arranque de la ventana de acumulado mensual."""
    return yyyymmdd[:6] + "01"


def build_query(empresa: str, acum_ini: str, fecha_ini: str, fecha_fin: str) -> str:
    return SQL_TEMPLATE.format(acum_ini=acum_ini, fecha_ini=fecha_ini, fecha_fin=fecha_fin)


def insert_carga_header(cur, empresa: str, dia: str, src_hash: str, src_rows: int) -> int:
    cur.execute(
        f"""
        INSERT INTO {TABLE_CARGAS} (source_name, source_hash, source_rows, loaded_by, notes)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id;
        """,
        (f"217->{empresa}", src_hash, src_rows, LOADED_BY,
         f"pipeline 232 etl_ventas_item {empresa} {dia}"),
    )
    return cur.fetchone()[0]


def mark_control_day(cur, empresa: str, dia: str, load_id, rows: int, status: str,
                     last_error=None) -> None:
    cur.execute(
        f"""
        INSERT INTO {TABLE_CTRL_DIAS}
            (empresa, fecha_dcto, source_load_id, source_rows, status, last_error, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, now())
        ON CONFLICT (empresa, fecha_dcto) DO UPDATE SET
          source_load_id = EXCLUDED.source_load_id,
          source_rows    = EXCLUDED.source_rows,
          status         = EXCLUDED.status,
          last_error     = EXCLUDED.last_error,
          updated_at     = now();
        """,
        (empresa, dia, load_id, rows, status, last_error),
    )


def cargar(env: dict, desde: str, hasta: str, dry_run: bool):
    """Devuelve (total_filas, lista de '<empresa>@<dia>' que quedaron vacios)."""
    src_host = require(env, "DB_HOST_POS")
    src_port = env.get("DB_PORT_POS", "5432")
    tgt_dsn = dict(
        host=require(env, "DB_HOST_LOCAL"), port=env.get("DB_PORT_LOCAL", "5432"),
        dbname=require(env, "DB_NAME_LOCAL"), user=require(env, "DB_USER_LOCAL"),
        password=require(env, "DB_PASSWORD_LOCAL"),
    )

    acum_ini = month_start(desde)
    total = 0
    vacios = []

    tgt = None if dry_run else psycopg2.connect(**tgt_dsn)
    try:
        if tgt:
            tgt.autocommit = False
            with tgt.cursor() as c:
                c.execute(DDL_STAGING)
            tgt.commit()

        for db in EMPRESAS:
            empresa = db["empresa"]
            pwd = require(env, db["pwd_env"])
            q = build_query(empresa, acum_ini, desde, hasta)

            with psycopg2.connect(host=src_host, port=src_port, dbname=db["db"],
                                  user=db["user"], password=pwd) as src:
                if dry_run:
                    with src.cursor() as c:
                        c.execute(f"SELECT count(*) FROM ({q}) s")
                        n = c.fetchone()[0]
                    log(f"[{empresa} {desde}..{hasta}] DRY-RUN: {n} filas en origen "
                        f"(ventana de acumulado desde {acum_ini})")
                    total += n
                    continue

                # 1) COPY out del origen a un buffer (formato texto = NULL-safe)
                buf = io.StringIO()
                with src.cursor() as sc:
                    sc.copy_expert(f"COPY ({q}) TO STDOUT", buf)

            payload = buf.getvalue()
            src_hash = hashlib.sha1(payload.encode("utf-8")).hexdigest()

            # 2) staging en destino (una sola vez por empresa; el rango completo)
            with tgt.cursor() as tc:
                tc.execute("TRUNCATE stg_ventas_item;")
                tc.copy_expert(
                    f"COPY stg_ventas_item ({STG_COLS}) FROM STDIN", io.StringIO(payload)
                )
            tgt.commit()

            # 3) reemplazar dia por dia, transaccional
            for dia in daterange(desde, hasta):
                try:
                    with tgt.cursor() as tc:
                        tc.execute(
                            "SELECT count(*) FROM stg_ventas_item WHERE fecha_dcto = %s",
                            (dia,),
                        )
                        n_dia = tc.fetchone()[0]

                        if n_dia == 0:
                            # OJO: NO se marca 'done'. Un dia vacio es un dia PENDIENTE:
                            # el POS pudo no haber cerrado todavia. Se deja 'empty' para
                            # que el refresco del fin de semana lo vuelva a intentar.
                            tc.execute(
                                f"DELETE FROM {TABLE_DIARIO} "
                                f"WHERE empresa = %s AND fecha_dcto = %s",
                                (empresa, dia),
                            )
                            mark_control_day(tc, empresa, dia, None, 0, "empty")
                            tgt.commit()
                            vacios.append(f"{empresa}@{dia}")
                            log(f"[{empresa} {dia}] SIN VENTAS: 0 filas en el POS "
                                f"-> status=empty (se reintenta en el refresco)")
                            continue

                        load_id = insert_carga_header(tc, empresa, dia, src_hash, n_dia)

                        # Borrar el dia antes de reinsertar (idempotente)
                        tc.execute(
                            f"DELETE FROM {TABLE_DIARIO} "
                            f"WHERE empresa = %s AND fecha_dcto = %s",
                            (empresa, dia),
                        )

                        # sede sale del mapa que vive en el DESTINO (no en el POS)
                        tc.execute(
                            f"""
                            INSERT INTO {TABLE_DIARIO} (
                                empresa, fecha_dcto, id_co, id_item, descripcion, linea,
                                und_dia, venta_sin_impuesto_dia, und_acum, venta_sin_impuesto_acum,
                                empresa_norm, id_co_norm, sede, source_load_id
                            )
                            SELECT
                                %s, s.fecha_dcto, s.id_co, s.id_item, s.descripcion, s.linea,
                                s.und_dia, s.venta_sin_impuesto_dia, s.und_acum, s.venta_sin_impuesto_acum,
                                %s, s.id_co, m.sede, %s
                            FROM stg_ventas_item s
                            LEFT JOIN {TABLE_SEDE_MAP} m
                                   ON m.empresa_norm = %s AND m.id_co_norm = s.id_co
                            WHERE s.fecha_dcto = %s;
                            """,
                            (empresa, empresa, load_id, empresa, dia),
                        )
                        n_ins = tc.rowcount

                        mark_control_day(tc, empresa, dia, load_id, n_ins, "done")
                    tgt.commit()
                    log(f"[{empresa} {dia}] cargadas {n_ins} filas (load_id={load_id})")
                    total += n_ins
                except Exception as e:  # noqa: BLE001
                    tgt.rollback()
                    with tgt.cursor() as tc:
                        mark_control_day(tc, empresa, dia, None, 0, "error", str(e)[:2000])
                    tgt.commit()
                    log(f"[{empresa} {dia}] ERROR: {e}")
                    raise

        return total, vacios
    except Exception:
        if tgt:
            tgt.rollback()
        raise
    finally:
        if tgt:
            tgt.close()


def main() -> int:
    ap = argparse.ArgumentParser(
        description="ETL ventas x item: POS(217) -> produXdia.ventas_item_diario (232)"
    )
    ap.add_argument("--date", type=valid_date, help="un solo dia YYYYMMDD")
    ap.add_argument("--desde", type=valid_date, help="inicio del rango YYYYMMDD")
    ap.add_argument("--hasta", type=valid_date, help="fin del rango YYYYMMDD")
    ap.add_argument("--days", type=int, help="ultimos N dias terminando AYER (refresco)")
    ap.add_argument("--dry-run", action="store_true", help="solo cuenta filas en origen")
    args = ap.parse_args()

    if args.date and (args.desde or args.hasta):
        log("ERROR: usa --date O (--desde/--hasta), no ambos"); return 2
    if bool(args.desde) ^ bool(args.hasta):
        log("ERROR: --desde y --hasta van juntos"); return 2
    if args.days is not None and (args.date or args.desde):
        log("ERROR: --days no se combina con --date ni --desde/--hasta"); return 2
    if args.days is not None and args.days < 1:
        log("ERROR: --days debe ser >= 1"); return 2

    ayer = datetime.date.today() - datetime.timedelta(days=1)
    if args.date:
        desde = hasta = args.date
    elif args.desde:
        desde, hasta = args.desde, args.hasta
    elif args.days:
        desde = (ayer - datetime.timedelta(days=args.days - 1)).strftime("%Y%m%d")
        hasta = ayer.strftime("%Y%m%d")
    else:
        desde = hasta = ayer.strftime("%Y%m%d")

    # Tope duro: nunca escribir dias futuros. Fue lo que dejo el ETL viejo bloqueado
    # (marco 20260730/31 como 'done' con 0 filas y el cursor salto a agosto).
    hoy = datetime.date.today().strftime("%Y%m%d")
    if hasta >= hoy:
        log(f"ERROR: --hasta={hasta} es hoy o futuro. El maximo es ayer ({ayer:%Y%m%d}).")
        return 2

    env = load_env(ENV_FILE)
    log(f"=== ETL ventas x item | [{desde}..{hasta}] | dry_run={args.dry_run} ===")
    log(f"Origen POS: {env.get('DB_HOST_POS')} (mercamio/mtodo/bogota)  ->  "
        f"Destino: {env.get('DB_HOST_LOCAL')}/{env.get('DB_NAME_LOCAL')}.ventas_item_diario")
    log(f"Ventana de acumulado mensual desde: {month_start(desde)}")

    try:
        total, vacios = cargar(env, desde, hasta, args.dry_run)
    except Exception as e:  # noqa: BLE001
        log(f"ERROR: {e}")
        return 1

    if vacios:
        log(f"=== AVISO: {len(vacios)} dia(s) sin ventas: {', '.join(vacios)}. "
            f"Exit 3: quedaron status='empty' y NO se subieron. Revisar el POS y "
            f"re-correr antes del sync a GCP de las 07:50. ===")
        log(f"=== Terminado CON AVISOS | total filas: {total} ===")
        return 3

    log(f"=== Terminado OK | total filas: {total} ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
