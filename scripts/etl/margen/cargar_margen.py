#!/usr/bin/env python3
"""
ETL de margenes: carga "movimiento unificado" desde las BD POS de origen
(192.168.35.217: mercamio / mtodo / bogota) a produXdia.margen_final (232).

- Reusa la query de consulta_Movimiento_bd.py (CTE de kits + exclusion de Z%).
- Idempotente por "reemplazar el dia": por cada empresa y dia del rango hace
  DELETE (fecha_dcto, empresa) + COPY, en una transaccion. Re-correr NO duplica.
- Carga rapida: COPY postgres->postgres (formato texto, NULL-safe). PG16 mejoro
  COPY +300% vs INSERT fila a fila.
- Por ahora SOLO carga a la BD. Si en el futuro se quiere volver a generar el CSV,
  ver la nota en consolidate_csv() (desactivada).

Config: UN solo .env.etl en la raiz del deploy, COMPARTIDO con sync-local-to-gcp.sh
(ver scripts/etl/env.etl.example). Override la ruta con ETL_ENV_FILE.
El destino (produXdia 232) sale de DB_*_LOCAL; el origen POS (217) de DB_*_POS.

Destinos: SIEMPRE local (DB_*_LOCAL). Con --gcp tambien sube a GCP (DB_*_GCP);
mismo COPY del POS (una lectura, dos escrituras), borra-dia+inserta en ambos.

Uso (python3 del sistema; el server no tiene venv):
  python3 cargar_margen.py                       # ayer, solo local
  python3 cargar_margen.py --gcp                 # ayer, local + GCP
  python3 cargar_margen.py --date 20260623 --gcp # un dia, local + GCP
  python3 cargar_margen.py --desde 20260601 --hasta 20260623 --gcp   # rango
  python3 cargar_margen.py --dry-run             # solo cuenta filas en origen, no escribe

Codigos de salida: 0 OK | 1 error | 2 uso invalido.
"""
import argparse
import datetime
import io
import os
import re
import sys
from pathlib import Path

import psycopg2

REPO_ROOT = Path(__file__).resolve().parents[3]  # scripts/etl/margen/ -> raiz del repo
ENV_FILE = Path(os.environ.get("ETL_ENV_FILE", REPO_ROOT / ".env.etl"))

# Metadata por empresa (no secreta). La clave sale del .env unico (pwd_env).
EMPRESAS = [
    {"empresa": "mercamio", "id_empresa": "02", "db": "mercamio", "user": "mercamio", "pwd_env": "DB_PWD_POS_MERCAMIO"},
    {"empresa": "mtodo",    "id_empresa": "01", "db": "mtodo",    "user": "mtodo",    "pwd_env": "DB_PWD_POS_MTODO"},
    {"empresa": "bogota",   "id_empresa": "01", "db": "bogota",   "user": "bogota",   "pwd_env": "DB_PWD_POS_BOGOTA"},
]

# Columnas destino (orden EXACTO de margen_final, sin el id serial).
COLS = (
    "empresa, id_empresa, fecha_dcto, id_co, id_caja, hora_final, id_item, "
    "item_descripcion, id_tipo, id_linea1, nombre_linea1, id_linea2, nombre_linea2, "
    "id_linea, nombre_linea, id_unidad, cantidad, precio_uni, dscto_netos, vlrtot_bru, "
    "vlrimpcon1, ven_totales, precio_unitario, tot_costo, costo_unitario, documento_fc, "
    "id_tipdoc_fc, vend_cc, vend_cc_desc"
)

# Query identica a tu consulta_Movimiento_bd.py, con 2 cambios:
#  - se agrega 'id_empresa' como literal (2da columna) para alinear con margen_final;
#  - las fechas van inline (validadas YYYYMMDD) porque COPY no acepta parametros.
SQL_TEMPLATE = r"""
WITH mv AS (
  SELECT *
  FROM cmmovimiento_pdv
  WHERE fecha_dcto BETWEEN '{fecha_ini}' AND '{fecha_fin}'
    AND id_tipdoc_fc NOT LIKE 'Z%'      -- excluir notas credito (ZZ/ZX/ZY...)
),
costo_kit AS (
  SELECT
    vk.id_cod_item_p AS id_kit,
    SUM(
      COALESCE(ic.ultimo_costo_ed, 0)
      * COALESCE(vk.cantidad, 0)
      * COALESCE(vk.factor, 1)
    ) AS costo_unitario_kit
  FROM v_kits vk
  JOIN items ic ON ic.id_item = vk.id_cod_item_c
  GROUP BY vk.id_cod_item_p
)
SELECT
    '{empresa}'    AS empresa,
    '{id_empresa}' AS id_empresa,
    m.fecha_dcto,
    m.id_co,
    m.id_caja,
    m.hora_final,
    m.id_item,
    i.descripcion AS item_descripcion,
    i.id_tipo,
    i.id_linea1,
    l1.cmlineas_descripcion AS nombre_linea1,
    i.id_linea2,
    l2.cmlineas_descripcion AS nombre_linea2,
    i.id_linea,
    l3.cmlineas_descripcion AS nombre_linea,
    m.id_unidad,
    m.cantidad,
    m.precio_uni,
    m.dscto_netos,
    m.vlrtot_bru,
    m.vlrimpcon1,
    (m.vlrtot_bru + m.vlrimpcon1) AS ven_totales,
    ROUND( (m.vlrtot_bru + m.vlrimpcon1) / NULLIF(m.cantidad,0), 2 ) AS precio_unitario,
    CASE
      WHEN m.tot_costo > 0 THEN m.tot_costo
      ELSE ROUND( COALESCE(ck.costo_unitario_kit, i.ultimo_costo_ed, 0) * m.cantidad, 2 )
    END AS tot_costo,
    CASE
      WHEN m.tot_costo > 0 THEN ROUND( m.tot_costo / NULLIF(m.cantidad,0), 2 )
      ELSE ROUND( COALESCE(ck.costo_unitario_kit, i.ultimo_costo_ed, 0), 2 )
    END AS costo_unitario,
    m.documento_fc,
    m.id_tipdoc_fc,
    m.vend_cc,
    m.vend_cc_desc
FROM mv AS m
JOIN items  AS i  ON m.id_item = i.id_item
JOIN lineas AS l1 ON i.id_linea1 = l1.id_linea AND i.id_tipo = l1.id_tipo
JOIN lineas AS l2 ON i.id_linea2 = l2.id_linea AND i.id_tipo = l2.id_tipo
JOIN lineas AS l3 ON i.id_linea  = l3.id_linea AND i.id_tipo = l3.id_tipo
LEFT JOIN costo_kit AS ck ON ck.id_kit = i.id_item
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


def build_query(db: dict, fecha_ini: str, fecha_fin: str) -> str:
    return SQL_TEMPLATE.format(
        empresa=db["empresa"], id_empresa=db["id_empresa"],
        fecha_ini=fecha_ini, fecha_fin=fecha_fin,
    )


def _dsn_local(env: dict) -> dict:
    return dict(
        host=require(env, "DB_HOST_LOCAL"), port=env.get("DB_PORT_LOCAL", "5432"),
        dbname=require(env, "DB_NAME_LOCAL"), user=require(env, "DB_USER_LOCAL"),
        password=require(env, "DB_PASSWORD_LOCAL"),
    )


def _dsn_gcp(env: dict) -> dict:
    raw = (env.get("DB_SSL_GCP") or "require").strip().lower()
    sslmode = "disable" if raw in ("false", "0", "disable") else "require"
    return dict(
        host=require(env, "DB_HOST_GCP"), port=env.get("DB_PORT_GCP", "5432"),
        dbname=require(env, "DB_NAME_GCP"), user=require(env, "DB_USER_GCP"),
        password=require(env, "DB_PASSWORD_GCP"), sslmode=sslmode,
    )


def cargar(env: dict, desde: str, hasta: str, dry_run: bool, to_gcp: bool) -> int:
    src_host = require(env, "DB_HOST_POS")
    src_port = env.get("DB_PORT_POS", "5432")

    # Destinos: local siempre; GCP si --gcp. Si GCP no conecta, se sigue con local.
    conns = []  # [(nombre, conexion)]
    if not dry_run:
        conns.append(("local", psycopg2.connect(**_dsn_local(env))))
        if to_gcp:
            try:
                conns.append(("gcp", psycopg2.connect(**_dsn_gcp(env))))
            except Exception as e:  # noqa: BLE001
                log(f"WARN: no pude conectar a GCP ({e}); se carga SOLO local.")
        for _, c in conns:
            c.autocommit = False

    total = 0
    try:
        for db in EMPRESAS:
            pwd = require(env, db["pwd_env"])
            with psycopg2.connect(host=src_host, port=src_port, dbname=db["db"],
                                  user=db["user"], password=pwd) as src:
                for dia in daterange(desde, hasta):
                    q = build_query(db, dia, dia)
                    if dry_run:
                        with src.cursor() as c:
                            c.execute(f"SELECT count(*) FROM ({q}) s")
                            n = c.fetchone()[0]
                        log(f"[{db['empresa']} {dia}] DRY-RUN: {n} filas en origen")
                        total += n
                        continue
                    # 1) COPY out del origen UNA vez (formato texto = NULL-safe)
                    buf = io.StringIO()
                    with src.cursor() as sc:
                        sc.copy_expert(f"COPY ({q}) TO STDOUT", buf)
                    # 2) a cada destino: borra-dia+empresa + COPY, transaccional
                    rows = 0
                    for name, conn in conns:
                        buf.seek(0)
                        try:
                            with conn.cursor() as tc:
                                tc.execute(
                                    "DELETE FROM margen_final WHERE fecha_dcto = %s AND empresa = %s",
                                    (dia, db["empresa"]),
                                )
                                tc.copy_expert(f"COPY margen_final ({COLS}) FROM STDIN", buf)
                                rows = tc.rowcount
                            conn.commit()
                            log(f"[{db['empresa']} {dia} -> {name}] cargadas {rows} filas")
                        except Exception:
                            conn.rollback()
                            raise
                    total += rows
        return total
    finally:
        for _, c in conns:
            c.close()


def main() -> int:
    ap = argparse.ArgumentParser(description="ETL margenes origen(217) -> produXdia.margen_final (232)")
    ap.add_argument("--date", type=valid_date, help="un solo dia YYYYMMDD")
    ap.add_argument("--desde", type=valid_date, help="inicio del rango YYYYMMDD")
    ap.add_argument("--hasta", type=valid_date, help="fin del rango YYYYMMDD")
    ap.add_argument("--dry-run", action="store_true", help="solo cuenta filas en origen")
    ap.add_argument("--gcp", action="store_true",
                    help="ademas de local, sube tambien a GCP (DB_*_GCP del .env.etl)")
    args = ap.parse_args()

    if args.date and (args.desde or args.hasta):
        log("ERROR: usa --date O (--desde/--hasta), no ambos"); return 2
    if bool(args.desde) ^ bool(args.hasta):
        log("ERROR: --desde y --hasta van juntos"); return 2

    if args.date:
        desde = hasta = args.date
    elif args.desde:
        desde, hasta = args.desde, args.hasta
    else:
        ayer = (datetime.date.today() - datetime.timedelta(days=1)).strftime("%Y%m%d")
        desde = hasta = ayer

    env = load_env(ENV_FILE)
    destinos = f"{env.get('DB_HOST_LOCAL')}/{env.get('DB_NAME_LOCAL')}"
    if args.gcp:
        destinos += f"  +  GCP {env.get('DB_HOST_GCP')}/{env.get('DB_NAME_GCP')}"
    log(f"=== ETL margenes | [{desde}..{hasta}] | dry_run={args.dry_run} | gcp={args.gcp} ===")
    log(f"Origen POS: {env.get('DB_HOST_POS')} (mercamio/mtodo/bogota)  ->  Destino(s): {destinos}")
    try:
        total = cargar(env, desde, hasta, args.dry_run, args.gcp)
    except Exception as e:  # noqa: BLE001
        log(f"ERROR: {e}")
        return 1
    log(f"=== Terminado OK | total filas: {total} ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
