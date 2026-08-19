#!/usr/bin/env python3
"""
ETL de ORDENES DE COMPRA: carga desde las BD POS de origen
(192.168.35.217: mercamio / mtodo / bogota) a produXdia.orden_compra (232).

Snapshot de CABECERA (una fila por OC) mas LINEAS (item + tercero real).
La cabecera alimenta el tablero de OC. Las lineas alimentan el desglose de
costos: quien trajo el item, no el criterio POS (p.ej. MERCAMIO FRUVER).
Ver db/migrations/20260813_orden_compra.sql y 20260818_orden_compra_linea.sql.

CARGA INCREMENTAL (default del timer 08:00)
-------------------------------------------
1) Dias nuevos: si en dest ya estan el 1..12, manana solo se lee fecha_dcto = 13.
2) Abiertas: relee del POS las OC ya cargadas con ind_estado <> CUMPLIDO (2) para
   actualizar cantidad_ent / estado. No toca las ya cumplidas. No descubre OC
   historicas que nunca se cargaron (eso no termina a tiempo).
Si la tabla esta vacia, hay que hacer una carga inicial (--mes-actual / --desde).
GCP: `$SYNC --only orden_compra --only orden_compra_linea`
(upsert de las tablas locales; son chicas).

SLA DE 7 DIAS
-------------
NO se persiste. El tablero calcula fecha_dcto + 7. fecha_entrega viaja porque es la
promesa real del POS (en fruver suele ser +1/+2). Confirmacion del sistema:
usuario_conf / fecha_conf / hora_conf.

TIPOS
-----
OC comercial, FR fruver, OM mercaderista, OS servicio al cliente.
ET/EF NO viven en cmmovimiento_ocompra: salen de cmmovimiento_inventario
(entrada ind_es=1, bodega 01) y se escriben solo en orden_compra_linea
(no contaminan el tablero de OC). Costos prefiere esos costos sobre FR.
Si una empresa POS no tiene cmmovimiento_ocompra, se salta (no borra lo ya cargado).

Config: el mismo .env.etl de la raiz del deploy. Override con ETL_ENV_FILE.

Uso:
  python3 etl_orden_compra.py                         # incremental: dias que faltan + abiertas
  python3 etl_orden_compra.py --incremental           # idem, explicito
  python3 etl_orden_compra.py --solo-abiertas         # solo refresca incompletas ya en dest
  python3 etl_orden_compra.py --no-abiertas           # incremental sin refrescar incompletas
  python3 etl_orden_compra.py --mes-actual            # backfill upsert del mes (no borra otros meses)
  python3 etl_orden_compra.py --desde 20260801 --hasta 20260831
  python3 etl_orden_compra.py --dias 30               # upsert ultimos 30d, no borra el resto
  python3 etl_orden_compra.py --reemplazar --desde 20260801 --hasta 20260812
  python3 etl_orden_compra.py --empresa mercamio
  python3 etl_orden_compra.py --solo-et-ef --mes-actual
  python3 etl_orden_compra.py --dry-run

Codigos de salida: 0 OK | 1 error | 2 uso invalido | 3 warning (alguna empresa sin filas).
"""
from __future__ import annotations

import argparse
import datetime
import io
import os
import re
import sys
from pathlib import Path

import psycopg2

REPO_ROOT = Path(__file__).resolve().parents[3]
ENV_FILE = Path(os.environ.get("ETL_ENV_FILE", REPO_ROOT / ".env.etl"))

EMPRESAS = [
    {"empresa": "mercamio", "db": "mercamio", "user": "mercamio", "pwd_env": "DB_PWD_POS_MERCAMIO"},
    {"empresa": "mtodo",    "db": "mtodo",    "user": "mtodo",    "pwd_env": "DB_PWD_POS_MTODO"},
    {"empresa": "bogota",   "db": "bogota",   "user": "bogota",   "pwd_env": "DB_PWD_POS_BOGOTA"},
]

TIPDOCS = ("OC", "FR", "OM", "OS", "ET", "EF")
TIPDOC_NOM = {
    "OC": "Orden de compra comercial",
    "FR": "Orden de compra fruver",
    "OM": "Orden de compra mercaderista",
    "OS": "Orden de compra servicio al cliente",
    "ET": "Entrada en transito",
    "EF": "Entrada de factura",
}

TABLE = "public.orden_compra"
TABLE_LINEA = "public.orden_compra_linea"
TABLE_SEDE_MAP = "public.ventas_item_sede_map"
ABIERTAS_CHUNK = 400

STG_COLS = (
    "id_co, tipdoc, documento_oc, fecha_dcto, fecha_entrega, id_terc, id_suc_terc, "
    "terc_nombre, terc_nit, ind_estado, estado_nom, usuario_ing, usuario_conf, "
    "fecha_conf, hora_conf, comprador_nom, n_lineas, n_items, cantidad, cantidad_ent, "
    "tot_bruto, tot_venta"
)
STG_LINEA_COLS = (
    "id_co, tipdoc, documento_oc, fecha_dcto, id_item, id_terc, id_suc_terc, "
    "terc_nombre, terc_nit, cantidad, cantidad_ent, tot_bruto"
)

# Fechas inline (validadas YYYYMMDD): COPY no acepta parametros. BTRIM en llaves
# porque los CHAR de SIESA traen padding y partiriamos la clave natural.
SQL_CABECERA = r"""
WITH lineas AS (
  SELECT
    BTRIM(oc.id_co)                         AS id_co,
    BTRIM(oc.id_tipdoc)                     AS tipdoc,
    BTRIM(oc.documento_oc)                  AS documento_oc,
    BTRIM(oc.fecha_dcto)                    AS fecha_dcto,
    NULLIF(BTRIM(oc.fecha_entrega), '')     AS fecha_entrega,
    NULLIF(BTRIM(oc.id_terc), '')           AS id_terc,
    NULLIF(BTRIM(oc.id_suc), '')            AS id_suc_terc,
    BTRIM(oc.ind_estado)                    AS ind_estado,
    NULLIF(BTRIM(oc.estado_nom), '')        AS estado_nom,
    NULLIF(BTRIM(oc.id_item), '')           AS id_item,
    oc.cantidad,
    oc.cantidad_ent,
    oc.tot_bruto,
    oc.tot_venta,
    NULLIF(BTRIM(oc.comprador_nom), '')     AS comprador_nom,
    NULLIF(BTRIM(oc.usuario_ing), '')       AS usuario_ing,
    NULLIF(BTRIM(oc.usuario_conf), '')      AS usuario_conf,
    NULLIF(BTRIM(oc.fecha_conf), '')        AS fecha_conf,
    NULLIF(BTRIM(oc.hora_conf), '')         AS hora_conf
  FROM public.cmmovimiento_ocompra oc
  WHERE BTRIM(oc.id_tipdoc) IN ('OC','FR','OM','OS','ET','EF')
    AND ({filtro})
),
agg AS (
  SELECT
    id_co,
    tipdoc,
    documento_oc,
    min(fecha_dcto)                         AS fecha_dcto,
    min(fecha_entrega)                      AS fecha_entrega,
    max(id_terc)                            AS id_terc,
    max(id_suc_terc)                        AS id_suc_terc,
    max(ind_estado)                         AS ind_estado,
    max(estado_nom)                         AS estado_nom,
    max(usuario_ing)                        AS usuario_ing,
    max(usuario_conf)                       AS usuario_conf,
    min(fecha_conf)                         AS fecha_conf,
    max(hora_conf)                          AS hora_conf,
    max(comprador_nom)                      AS comprador_nom,
    count(*)::int                           AS n_lineas,
    count(DISTINCT id_item)::int            AS n_items,
    COALESCE(sum(cantidad), 0)              AS cantidad,
    COALESCE(sum(cantidad_ent), 0)          AS cantidad_ent,
    COALESCE(sum(tot_bruto), 0)             AS tot_bruto,
    COALESCE(sum(tot_venta), 0)             AS tot_venta
  FROM lineas
  GROUP BY id_co, tipdoc, documento_oc
)
SELECT
  a.id_co,
  a.tipdoc,
  a.documento_oc,
  a.fecha_dcto,
  a.fecha_entrega,
  a.id_terc,
  a.id_suc_terc,
  terc.terc_nombre,
  terc.terc_nit,
  a.ind_estado,
  a.estado_nom,
  a.usuario_ing,
  a.usuario_conf,
  a.fecha_conf,
  a.hora_conf,
  a.comprador_nom,
  a.n_lineas,
  a.n_items,
  a.cantidad,
  a.cantidad_ent,
  a.tot_bruto,
  a.tot_venta
FROM agg a
LEFT JOIN LATERAL (
  SELECT
    NULLIF(BTRIM(t.descripcion), '') AS terc_nombre,
    NULLIF(BTRIM(t.nit), '')         AS terc_nit
  FROM public.terceros t
  WHERE a.id_terc IS NOT NULL
    AND BTRIM(t.codigo) = a.id_terc
  ORDER BY
    CASE WHEN a.id_suc_terc IS NOT NULL
              AND BTRIM(COALESCE(t.sucursal, '')) = a.id_suc_terc
         THEN 0 ELSE 1 END,
    t.sucursal
  LIMIT 1
) terc ON true
ORDER BY a.tipdoc, a.documento_oc, a.id_co
"""

# Mismas lineas del POS, sin agrupar: item + tercero real (p.ej. quien trajo el tomate).
SQL_LINEAS = r"""
WITH agg AS (
  SELECT
    BTRIM(oc.id_co)                         AS id_co,
    BTRIM(oc.id_tipdoc)                     AS tipdoc,
    BTRIM(oc.documento_oc)                  AS documento_oc,
    BTRIM(oc.fecha_dcto)                    AS fecha_dcto,
    NULLIF(BTRIM(oc.id_item), '')           AS id_item,
    COALESCE(NULLIF(BTRIM(oc.id_terc), ''), '') AS id_terc,
    NULLIF(BTRIM(oc.id_suc), '')            AS id_suc_terc,
    COALESCE(SUM(oc.cantidad), 0)           AS cantidad,
    COALESCE(SUM(oc.cantidad_ent), 0)       AS cantidad_ent,
    COALESCE(SUM(oc.tot_bruto), 0)          AS tot_bruto
  FROM public.cmmovimiento_ocompra oc
  WHERE BTRIM(oc.id_tipdoc) IN ('OC','FR','OM','OS','ET','EF')
    AND NULLIF(BTRIM(oc.id_item), '') IS NOT NULL
    AND ({filtro})
  GROUP BY 1, 2, 3, 4, 5, 6, 7
)
SELECT
  a.id_co,
  a.tipdoc,
  a.documento_oc,
  a.fecha_dcto,
  a.id_item,
  a.id_terc,
  a.id_suc_terc,
  terc.terc_nombre,
  terc.terc_nit,
  a.cantidad,
  a.cantidad_ent,
  a.tot_bruto
FROM agg a
LEFT JOIN LATERAL (
  SELECT
    NULLIF(BTRIM(t.descripcion), '') AS terc_nombre,
    NULLIF(BTRIM(t.nit), '')         AS terc_nit
  FROM public.terceros t
  WHERE a.id_terc <> ''
    AND BTRIM(t.codigo) = a.id_terc
  ORDER BY
    CASE WHEN a.id_suc_terc IS NOT NULL
              AND BTRIM(COALESCE(t.sucursal, '')) = a.id_suc_terc
         THEN 0 ELSE 1 END,
    t.sucursal
  LIMIT 1
) terc ON true
ORDER BY a.tipdoc, a.documento_oc, a.id_co, a.id_item
"""

# ET/EF reales: inventario POS (no OC). Solo lineas; ind_es=1 = entrada.
SQL_INV_LINEAS = r"""
WITH agg AS (
  SELECT
    CASE
      WHEN LEFT(BTRIM(m.id_local), 3) ~ '^[0-9]+$'
        THEN LPAD(LEFT(BTRIM(m.id_local), 3), 3, '0')
      ELSE LEFT(BTRIM(m.id_local), 3)
    END AS id_co,
    BTRIM(m.doc_inv_tipo) AS tipdoc,
    BTRIM(m.documento_inv) AS documento_oc,
    BTRIM(m.fecha_fc) AS fecha_dcto,
    NULLIF(BTRIM(m.id_item), '') AS id_item,
    COALESCE(NULLIF(BTRIM(m.id_terc), ''), '') AS id_terc,
    NULLIF(BTRIM(m.id_suc), '') AS id_suc_terc,
    COALESCE(SUM(m.cantidad_1), 0) AS cantidad,
    COALESCE(SUM(m.cantidad_1), 0) AS cantidad_ent,
    COALESCE(SUM(m.costot), 0) AS tot_bruto
  FROM public.cmmovimiento_inventario m
  WHERE BTRIM(m.doc_inv_tipo) IN ('ET', 'EF')
    AND BTRIM(COALESCE(m.ind_es, '')) = '1'
    AND RIGHT(BTRIM(m.id_local), 2) = '01'
    AND LEFT(BTRIM(m.id_local), 3) <> 'PPT'
    AND NULLIF(BTRIM(m.id_item), '') IS NOT NULL
    AND NULLIF(BTRIM(m.documento_inv), '') IS NOT NULL
    AND m.fecha_fc BETWEEN '{fecha_ini}' AND '{fecha_fin}'
  GROUP BY 1, 2, 3, 4, 5, 6, 7
)
SELECT
  a.id_co,
  a.tipdoc,
  a.documento_oc,
  a.fecha_dcto,
  a.id_item,
  a.id_terc,
  a.id_suc_terc,
  terc.terc_nombre,
  terc.terc_nit,
  a.cantidad,
  a.cantidad_ent,
  a.tot_bruto
FROM agg a
LEFT JOIN LATERAL (
  SELECT
    NULLIF(BTRIM(t.descripcion), '') AS terc_nombre,
    NULLIF(BTRIM(t.nit), '')         AS terc_nit
  FROM public.terceros t
  WHERE a.id_terc <> ''
    AND BTRIM(t.codigo) = a.id_terc
  ORDER BY
    CASE WHEN a.id_suc_terc IS NOT NULL
              AND BTRIM(COALESCE(t.sucursal, '')) = a.id_suc_terc
         THEN 0 ELSE 1 END,
    t.sucursal
  LIMIT 1
) terc ON true
ORDER BY a.tipdoc, a.documento_oc, a.id_co, a.id_item
"""

DDL_STG = """
CREATE TEMP TABLE IF NOT EXISTS stg_orden_compra (
  id_co          text,
  tipdoc         text,
  documento_oc   text,
  fecha_dcto     text,
  fecha_entrega  text,
  id_terc        text,
  id_suc_terc    text,
  terc_nombre    text,
  terc_nit       text,
  ind_estado     text,
  estado_nom     text,
  usuario_ing    text,
  usuario_conf   text,
  fecha_conf     text,
  hora_conf      text,
  comprador_nom  text,
  n_lineas       integer,
  n_items        integer,
  cantidad       numeric(18,4),
  cantidad_ent   numeric(18,4),
  tot_bruto      numeric(18,4),
  tot_venta      numeric(18,4)
);
"""

DDL_STG_LINEA = """
CREATE TEMP TABLE IF NOT EXISTS stg_orden_compra_linea (
  id_co          text,
  tipdoc         text,
  documento_oc   text,
  fecha_dcto     text,
  id_item        text,
  id_terc        text,
  id_suc_terc    text,
  terc_nombre    text,
  terc_nit       text,
  cantidad       numeric(18,4),
  cantidad_ent   numeric(18,4),
  tot_bruto      numeric(18,4)
);
"""


def log(msg: str) -> None:
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def load_env(path: Path) -> dict:
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


def target_dsn(env: dict) -> dict:
    return dict(
        host=require(env, "DB_HOST_LOCAL"), port=env.get("DB_PORT_LOCAL", "5432"),
        dbname=require(env, "DB_NAME_LOCAL"), user=require(env, "DB_USER_LOCAL"),
        password=require(env, "DB_PASSWORD_LOCAL"),
    )


def valid_date(s: str) -> str:
    if not s or len(s) != 8 or not s.isdigit():
        raise argparse.ArgumentTypeError(f"fecha invalida (use YYYYMMDD): {s}")
    datetime.datetime.strptime(s, "%Y%m%d")
    return s


def add_days(yyyymmdd: str, days: int) -> str:
    d = datetime.datetime.strptime(yyyymmdd, "%Y%m%d").date()
    return (d + datetime.timedelta(days=days)).strftime("%Y%m%d")


def iter_days(desde: str, hasta: str) -> list[str]:
    out: list[str] = []
    cur = datetime.datetime.strptime(desde, "%Y%m%d").date()
    end = datetime.datetime.strptime(hasta, "%Y%m%d").date()
    while cur <= end:
        out.append(cur.strftime("%Y%m%d"))
        cur += datetime.timedelta(days=1)
    return out


def dias_de_filtro_between(filtro: str) -> list[str] | None:
    """Si el filtro es un BETWEEN de fechas, parte en dias (el POS mata COPY largos)."""
    m = re.search(
        r"fecha_dcto\s+BETWEEN\s+'(\d{8})'\s+AND\s+'(\d{8})'",
        filtro,
        flags=re.IGNORECASE,
    )
    if not m:
        return None
    dias = iter_days(m.group(1), m.group(2))
    return dias if len(dias) > 1 else None


def ayer_yyyymmdd(hoy: datetime.date | None = None) -> str:
    hoy = hoy or datetime.date.today()
    return (hoy - datetime.timedelta(days=1)).strftime("%Y%m%d")


def sql_lit(s: str) -> str:
    return "'" + (s or "").replace("'", "''") + "'"


def filtro_claves(keys: list[tuple[str, str, str]]) -> str:
    tuples = ",".join(f"({sql_lit(a)},{sql_lit(b)},{sql_lit(c)})" for a, b, c in keys)
    return (
        "(BTRIM(oc.id_co), BTRIM(oc.id_tipdoc), BTRIM(oc.documento_oc)) IN "
        f"({tuples})"
    )


def claves_abiertas(
    cur, empresa: str, fecha_dcto_lt: str | None = None,
) -> list[tuple[str, str, str]]:
    extra = ""
    params: list = [empresa]
    if fecha_dcto_lt:
        extra = " AND fecha_dcto < %s"
        params.append(fecha_dcto_lt)
    cur.execute(
        f"""
        SELECT id_co, tipdoc, documento_oc
          FROM {TABLE}
         WHERE empresa = %s
           AND BTRIM(COALESCE(ind_estado, '')) <> '2'
           {extra}
        """,
        params,
    )
    return [(r[0], r[1], r[2]) for r in cur.fetchall()]


def max_fecha_pasada(cur, empresa: str, hasta: str) -> str | None:
    cur.execute(
        f"SELECT max(fecha_dcto) FROM {TABLE} "
        f"WHERE empresa = %s AND fecha_dcto <= %s",
        (empresa, hasta),
    )
    row = cur.fetchone()
    val = (row[0] or "").strip() if row else ""
    return val or None


def mes_actual_rango(hoy: datetime.date | None = None) -> tuple[str, str]:
    hoy = hoy or datetime.date.today()
    desde = hoy.replace(day=1)
    if hoy.month == 12:
        hasta = hoy.replace(year=hoy.year + 1, month=1, day=1) - datetime.timedelta(days=1)
    else:
        hasta = hoy.replace(month=hoy.month + 1, day=1) - datetime.timedelta(days=1)
    return desde.strftime("%Y%m%d"), hasta.strftime("%Y%m%d")


def pos_conn(env: dict, db: dict):
    conn = psycopg2.connect(
        host=require(env, "DB_HOST_POS"), port=env.get("DB_PORT_POS", "5432"),
        dbname=db["db"], user=db["user"], password=require(env, db["pwd_env"]),
        connect_timeout=12,
        options="-c statement_timeout=0",
    )
    with conn.cursor() as c:
        c.execute("SET statement_timeout = 0")
    conn.commit()
    return conn


def empresas_seleccionadas(solo: str | None):
    if not solo:
        return EMPRESAS
    sel = [e for e in EMPRESAS if e["empresa"] == solo]
    if not sel:
        log("ERROR: --empresa invalida. Opciones: "
            + ", ".join(e["empresa"] for e in EMPRESAS))
        sys.exit(2)
    return sel


def pos_tiene_oc(conn) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public'
               AND table_name = 'cmmovimiento_ocompra'
             LIMIT 1
            """
        )
        return cur.fetchone() is not None


def pos_tiene_inv(conn) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public'
               AND table_name = 'cmmovimiento_inventario'
             LIMIT 1
            """
        )
        return cur.fetchone() is not None


def fechas_de_filtro_between(filtro: str) -> tuple[str, str] | None:
    m = re.search(
        r"fecha_dcto\s+BETWEEN\s+'(\d{8})'\s+AND\s+'(\d{8})'",
        filtro,
        flags=re.IGNORECASE,
    )
    if not m:
        return None
    return m.group(1), m.group(2)


UPSERT_SQL = f"""
INSERT INTO {TABLE} (
    empresa, id_co, sede, tipdoc, tipdoc_nom, documento_oc,
    fecha_dcto, fecha_entrega, id_terc, id_suc_terc,
    terc_nombre, terc_nit, ind_estado, estado_nom,
    usuario_ing, usuario_conf, fecha_conf, hora_conf,
    comprador_nom, n_lineas, n_items, cantidad, cantidad_ent,
    tot_bruto, tot_venta, loaded_at
)
SELECT
    %s, s.id_co, m.sede, s.tipdoc,
    CASE s.tipdoc
      WHEN 'OC' THEN %s
      WHEN 'FR' THEN %s
      WHEN 'OM' THEN %s
      WHEN 'OS' THEN %s
      WHEN 'ET' THEN %s
      WHEN 'EF' THEN %s
      ELSE s.tipdoc
    END,
    s.documento_oc, s.fecha_dcto, s.fecha_entrega,
    s.id_terc, s.id_suc_terc, s.terc_nombre, s.terc_nit,
    s.ind_estado, s.estado_nom, s.usuario_ing, s.usuario_conf,
    s.fecha_conf, s.hora_conf, s.comprador_nom,
    s.n_lineas, s.n_items, s.cantidad, s.cantidad_ent,
    s.tot_bruto, s.tot_venta, now()
FROM stg_orden_compra s
LEFT JOIN {TABLE_SEDE_MAP} m
       ON m.empresa_norm = %s AND m.id_co_norm = s.id_co
ON CONFLICT (empresa, id_co, tipdoc, documento_oc) DO UPDATE SET
    sede = EXCLUDED.sede,
    tipdoc_nom = EXCLUDED.tipdoc_nom,
    fecha_dcto = EXCLUDED.fecha_dcto,
    fecha_entrega = EXCLUDED.fecha_entrega,
    id_terc = EXCLUDED.id_terc,
    id_suc_terc = EXCLUDED.id_suc_terc,
    terc_nombre = EXCLUDED.terc_nombre,
    terc_nit = EXCLUDED.terc_nit,
    ind_estado = EXCLUDED.ind_estado,
    estado_nom = EXCLUDED.estado_nom,
    usuario_ing = EXCLUDED.usuario_ing,
    usuario_conf = EXCLUDED.usuario_conf,
    fecha_conf = EXCLUDED.fecha_conf,
    hora_conf = EXCLUDED.hora_conf,
    comprador_nom = EXCLUDED.comprador_nom,
    n_lineas = EXCLUDED.n_lineas,
    n_items = EXCLUDED.n_items,
    cantidad = EXCLUDED.cantidad,
    cantidad_ent = EXCLUDED.cantidad_ent,
    tot_bruto = EXCLUDED.tot_bruto,
    tot_venta = EXCLUDED.tot_venta,
    loaded_at = now();
"""

UPSERT_LINEA_SQL = f"""
INSERT INTO {TABLE_LINEA} (
    empresa, id_co, tipdoc, documento_oc, fecha_dcto,
    id_item, id_terc, id_suc_terc, terc_nombre, terc_nit,
    cantidad, cantidad_ent, tot_bruto, loaded_at
)
SELECT
    %s, s.id_co, s.tipdoc, s.documento_oc, s.fecha_dcto,
    s.id_item, COALESCE(s.id_terc, ''), s.id_suc_terc,
    s.terc_nombre, s.terc_nit,
    s.cantidad, s.cantidad_ent, s.tot_bruto, now()
FROM stg_orden_compra_linea s
ON CONFLICT (empresa, id_co, tipdoc, documento_oc, id_item, id_terc) DO UPDATE SET
    fecha_dcto = EXCLUDED.fecha_dcto,
    id_suc_terc = EXCLUDED.id_suc_terc,
    terc_nombre = EXCLUDED.terc_nombre,
    terc_nit = EXCLUDED.terc_nit,
    cantidad = EXCLUDED.cantidad,
    cantidad_ent = EXCLUDED.cantidad_ent,
    tot_bruto = EXCLUDED.tot_bruto,
    loaded_at = now();
"""


def upsert_filtro(
    *,
    src,
    tgt,
    empresa: str,
    filtro: str,
    etiqueta: str,
    rango_borrar: tuple[str, str] | None,
    dry_run: bool,
) -> int:
    q = SQL_CABECERA.format(filtro=filtro)
    if dry_run:
        with src.cursor() as c:
            c.execute(f"SELECT count(*) FROM ({q}) s")
            n = c.fetchone()[0]
        log(f"[{empresa}] DRY-RUN: {n} OC en origen ({etiqueta})")
        return n

    buf = io.StringIO()
    with src.cursor() as sc:
        sc.copy_expert(f"COPY ({q}) TO STDOUT", buf)
    payload = buf.getvalue()
    if not payload.strip():
        log(f"[{empresa}] SIN FILAS en POS ({etiqueta})")
        return 0

    q_lin = SQL_LINEAS.format(filtro=filtro)
    buf_lin = io.StringIO()
    with src.cursor() as sc:
        sc.copy_expert(f"COPY ({q_lin}) TO STDOUT", buf_lin)
    payload_lin = buf_lin.getvalue()

    with tgt.cursor() as tc:
        tc.execute("TRUNCATE stg_orden_compra;")
        tc.copy_expert(
            f"COPY stg_orden_compra ({STG_COLS}) FROM STDIN",
            io.StringIO(payload),
        )
        if rango_borrar:
            tc.execute(
                f"DELETE FROM {TABLE} WHERE empresa = %s "
                f"AND fecha_dcto BETWEEN %s AND %s",
                (empresa, rango_borrar[0], rango_borrar[1]),
            )
            log(f"[{empresa}] reemplazo rango {rango_borrar[0]}..{rango_borrar[1]} "
                f"({tc.rowcount} filas borradas)")
        tc.execute(
            UPSERT_SQL,
            (empresa,
             TIPDOC_NOM["OC"], TIPDOC_NOM["FR"], TIPDOC_NOM["OM"], TIPDOC_NOM["OS"],
             TIPDOC_NOM["ET"], TIPDOC_NOM["EF"],
             empresa),
        )
        n_ins = tc.rowcount
        n_lin = 0
        if rango_borrar:
            tc.execute(
                f"DELETE FROM {TABLE_LINEA} WHERE empresa = %s "
                f"AND fecha_dcto BETWEEN %s AND %s",
                (empresa, rango_borrar[0], rango_borrar[1]),
            )
        if payload_lin.strip():
            tc.execute("TRUNCATE stg_orden_compra_linea;")
            tc.copy_expert(
                f"COPY stg_orden_compra_linea ({STG_LINEA_COLS}) FROM STDIN",
                io.StringIO(payload_lin),
            )
            if not rango_borrar:
                tc.execute(
                    f"""
                    DELETE FROM {TABLE_LINEA} l
                     USING stg_orden_compra_linea s
                     WHERE l.empresa = %s
                       AND l.id_co = s.id_co
                       AND l.tipdoc = s.tipdoc
                       AND l.documento_oc = s.documento_oc
                    """,
                    (empresa,),
                )
            tc.execute(UPSERT_LINEA_SQL, (empresa,))
            n_lin = tc.rowcount
        tc.execute(
            f"SELECT count(*) FROM {TABLE} WHERE empresa = %s",
            (empresa,),
        )
        total = tc.fetchone()[0]
    tgt.commit()
    log(f"[{empresa}] {n_ins} OC upsert ({etiqueta}); "
        f"{n_lin} lineas; total cabeceras empresa={total}")
    return n_ins


def upsert_inv_et_ef(
    *,
    src,
    tgt,
    empresa: str,
    fecha_ini: str,
    fecha_fin: str,
    dry_run: bool,
) -> int:
    datetime.datetime.strptime(fecha_ini, "%Y%m%d")
    datetime.datetime.strptime(fecha_fin, "%Y%m%d")
    q = SQL_INV_LINEAS.format(fecha_ini=fecha_ini, fecha_fin=fecha_fin)
    if dry_run:
        with src.cursor() as c:
            c.execute(f"SELECT count(*) FROM ({q}) s")
            n = c.fetchone()[0]
        log(f"[{empresa}] DRY-RUN: {n} lineas ET/EF inventario "
            f"({fecha_ini}..{fecha_fin})")
        return n

    buf = io.StringIO()
    with src.cursor() as sc:
        sc.copy_expert(f"COPY ({q}) TO STDOUT", buf)
    payload = buf.getvalue()

    with tgt.cursor() as tc:
        tc.execute(
            f"""
            DELETE FROM {TABLE_LINEA}
             WHERE empresa = %s
               AND fecha_dcto BETWEEN %s AND %s
               AND tipdoc IN ('ET', 'EF')
            """,
            (empresa, fecha_ini, fecha_fin),
        )
        n_del = tc.rowcount
        n_ins = 0
        if payload.strip():
            tc.execute("TRUNCATE stg_orden_compra_linea;")
            tc.copy_expert(
                f"COPY stg_orden_compra_linea ({STG_LINEA_COLS}) FROM STDIN",
                io.StringIO(payload),
            )
            tc.execute(UPSERT_LINEA_SQL, (empresa,))
            n_ins = tc.rowcount
    tgt.commit()
    log(f"[{empresa}] inventario ET/EF {fecha_ini}..{fecha_fin}: "
        f"{n_del} borradas, {n_ins} upsert")
    return n_ins


def cargar(
    env: dict,
    empresas,
    *,
    incremental: bool,
    filtro_fijo: str | None,
    etiqueta_fija: str | None,
    rango_borrar: tuple[str, str] | None,
    refrescar_abiertas: bool,
    dry_run: bool,
    solo_et_ef: bool = False,
) -> list[str]:
    vacios: list[str] = []
    ayer = ayer_yyyymmdd()
    tgt = psycopg2.connect(**target_dsn(env))
    try:
        tgt.autocommit = False
        with tgt.cursor() as c:
            c.execute("SET statement_timeout = 0")
            c.execute(DDL_STG)
            c.execute(DDL_STG_LINEA)
        tgt.commit()

        for db in empresas:
            empresa = db["empresa"]
            etiqueta = etiqueta_fija or ""
            filtro = filtro_fijo
            fecha_abiertas_lt = None

            if incremental:
                dia_antes_ayer = add_days(ayer, -1)
                with tgt.cursor() as tc:
                    if solo_et_ef:
                        tc.execute(
                            f"SELECT max(fecha_dcto) FROM {TABLE_LINEA} "
                            f"WHERE empresa = %s AND tipdoc IN ('ET','EF') "
                            f"AND fecha_dcto <= %s",
                            (empresa, dia_antes_ayer),
                        )
                        row = tc.fetchone()
                        max_cerrada = (row[0] or "").strip() if row else ""
                        max_cerrada = max_cerrada or None
                    else:
                        max_cerrada = max_fecha_pasada(tc, empresa, dia_antes_ayer)
                if not max_cerrada:
                    if solo_et_ef:
                        vacios.append(empresa)
                        log(f"[{empresa}] incremental ET/EF vacio -> "
                            f"corre --solo-et-ef --mes-actual una vez")
                        continue
                    with tgt.cursor() as tc:
                        tc.execute(
                            f"SELECT 1 FROM {TABLE} WHERE empresa = %s LIMIT 1",
                            (empresa,),
                        )
                        tiene_algo = tc.fetchone() is not None
                    if not tiene_algo:
                        vacios.append(empresa)
                        log(f"[{empresa}] incremental: tabla vacia -> corre --mes-actual una vez")
                        continue
                    siguiente = ayer
                else:
                    siguiente = add_days(max_cerrada, 1)
                    if siguiente > ayer:
                        siguiente = ayer
                filtro = f"oc.fecha_dcto BETWEEN '{siguiente}' AND '{ayer}'"
                etiqueta = f"incremental fecha_dcto {siguiente}..{ayer}"
                fecha_abiertas_lt = siguiente
                log(f"[{empresa}] {etiqueta} "
                    f"(historico cerrado hasta {max_cerrada or 'n/a'}; ayer={ayer})")

            if not filtro and not refrescar_abiertas:
                vacios.append(empresa)
                log(f"[{empresa}] sin filtro POS -> se salta")
                continue

            with pos_conn(env, db) as src:
                if solo_et_ef:
                    if not pos_tiene_inv(src):
                        vacios.append(empresa)
                        log(f"[{empresa}] POS no tiene cmmovimiento_inventario -> se salta")
                        continue
                    fechas = fechas_de_filtro_between(filtro or "")
                    if not fechas:
                        vacios.append(empresa)
                        log(f"[{empresa}] --solo-et-ef sin rango de fechas -> se salta")
                        continue
                    upsert_inv_et_ef(
                        src=src, tgt=tgt, empresa=empresa,
                        fecha_ini=fechas[0], fecha_fin=fechas[1],
                        dry_run=dry_run,
                    )
                    continue

                if not pos_tiene_oc(src):
                    vacios.append(empresa)
                    log(f"[{empresa}] POS no tiene cmmovimiento_ocompra -> se salta")
                    continue

                if filtro:
                    dias = dias_de_filtro_between(filtro)
                    if dias:
                        log(f"[{empresa}] {etiqueta}: {len(dias)} dias (uno por COPY)")
                        for dia in dias:
                            upsert_filtro(
                                src=src, tgt=tgt, empresa=empresa,
                                filtro=(
                                    f"oc.fecha_dcto BETWEEN '{dia}' AND '{dia}'"
                                ),
                                etiqueta=f"fecha_dcto {dia}",
                                rango_borrar=(
                                    (dia, dia) if rango_borrar else None
                                ),
                                dry_run=dry_run,
                            )
                    else:
                        upsert_filtro(
                            src=src, tgt=tgt, empresa=empresa,
                            filtro=filtro, etiqueta=etiqueta,
                            rango_borrar=rango_borrar, dry_run=dry_run,
                        )
                    fechas = fechas_de_filtro_between(filtro)
                    if fechas and pos_tiene_inv(src):
                        upsert_inv_et_ef(
                            src=src, tgt=tgt, empresa=empresa,
                            fecha_ini=fechas[0], fecha_fin=fechas[1],
                            dry_run=dry_run,
                        )

                if not refrescar_abiertas:
                    continue

                with tgt.cursor() as tc:
                    keys = claves_abiertas(tc, empresa, fecha_abiertas_lt)
                if not keys:
                    log(f"[{empresa}] abiertas: ninguna que refrescar")
                    continue
                log(f"[{empresa}] abiertas a refrescar: {len(keys)} "
                    f"(ind_estado<>2"
                    f"{f', fecha_dcto < {fecha_abiertas_lt}' if fecha_abiertas_lt else ''})")
                total_ab = 0
                for i in range(0, len(keys), ABIERTAS_CHUNK):
                    chunk = keys[i:i + ABIERTAS_CHUNK]
                    n = upsert_filtro(
                        src=src, tgt=tgt, empresa=empresa,
                        filtro=filtro_claves(chunk),
                        etiqueta=f"abiertas {i + 1}-{i + len(chunk)}/{len(keys)}",
                        rango_borrar=None, dry_run=dry_run,
                    )
                    total_ab += n
                log(f"[{empresa}] abiertas upsert total={total_ab}")

        return vacios
    except Exception:
        tgt.rollback()
        raise
    finally:
        tgt.close()


def main() -> int:
    ap = argparse.ArgumentParser(
        description="ETL de ordenes de compra: POS(217) -> produXdia.orden_compra (232)"
    )
    ap.add_argument(
        "--dias", type=int, default=None,
        help="upsert fecha_dcto de los ultimos N dias (no borra dias fuera del rango)",
    )
    ap.add_argument("--desde", type=valid_date, help="inicio YYYYMMDD (con --hasta)")
    ap.add_argument("--hasta", type=valid_date, help="fin YYYYMMDD (con --desde)")
    ap.add_argument("--mes-actual", action="store_true",
                    help="upsert del mes calendario en curso (no borra otros meses)")
    ap.add_argument("--incremental", action="store_true",
                    help="solo dias que faltan hasta ayer (default si no hay otro modo)")
    ap.add_argument("--solo-abiertas", action="store_true",
                    help="solo refresca OC incompletas ya en dest (no carga dias nuevos)")
    ap.add_argument("--no-abiertas", action="store_true",
                    help="no refresca incompletas ya cargadas")
    ap.add_argument("--reemplazar", action="store_true",
                    help="borra el rango pedido y vuelve a insertarlo (backfill sucio)")
    ap.add_argument("--empresa", help="una sola empresa (mercamio|mtodo|bogota)")
    ap.add_argument(
        "--solo-et-ef", action="store_true",
        help="solo carga ET/EF desde cmmovimiento_inventario a orden_compra_linea",
    )
    ap.add_argument("--dry-run", action="store_true", help="solo cuenta filas en origen")
    args = ap.parse_args()

    modos = (
        int(bool(args.mes_actual))
        + int(args.desde is not None or args.hasta is not None)
        + int(args.dias is not None)
        + int(bool(args.incremental))
        + int(bool(args.solo_abiertas))
    )
    if modos > 1:
        log("ERROR: use solo uno de --incremental, --solo-abiertas, "
            "--mes-actual, --desde/--hasta o --dias")
        return 2
    if args.no_abiertas and args.solo_abiertas:
        log("ERROR: --no-abiertas y --solo-abiertas no van juntos")
        return 2
    if args.solo_et_ef and args.solo_abiertas:
        log("ERROR: --solo-et-ef y --solo-abiertas no van juntos")
        return 2
    if (args.desde is None) != (args.hasta is None):
        log("ERROR: --desde y --hasta van juntos")
        return 2
    if args.dias is not None and (args.dias < 1 or args.dias > 3660):
        log("ERROR: --dias debe estar entre 1 y 3660")
        return 2
    incremental = (args.incremental or modos == 0) and not args.solo_abiertas
    if args.reemplazar and (incremental or args.solo_abiertas):
        log("ERROR: --reemplazar no aplica al modo incremental/abiertas")
        return 2
    refrescar_abiertas = (
        (incremental or args.solo_abiertas)
        and not args.no_abiertas
        and not args.solo_et_ef
    )

    filtro_fijo = None
    etiqueta_fija = None
    rango_borrar = None
    if args.mes_actual:
        desde, hasta = mes_actual_rango()
        filtro_fijo = f"oc.fecha_dcto BETWEEN '{desde}' AND '{hasta}'"
        etiqueta_fija = f"fecha_dcto {desde}..{hasta} (mes actual)"
        if args.reemplazar:
            rango_borrar = (desde, hasta)
    elif args.desde:
        if args.hasta < args.desde:
            log("ERROR: --hasta es anterior a --desde")
            return 2
        filtro_fijo = f"oc.fecha_dcto BETWEEN '{args.desde}' AND '{args.hasta}'"
        etiqueta_fija = f"fecha_dcto {args.desde}..{args.hasta}"
        if args.reemplazar:
            rango_borrar = (args.desde, args.hasta)
    elif args.dias is not None:
        hasta = ayer_yyyymmdd()
        desde = add_days(hasta, -(args.dias - 1))
        filtro_fijo = f"oc.fecha_dcto BETWEEN '{desde}' AND '{hasta}'"
        etiqueta_fija = f"fecha_dcto {desde}..{hasta} ({args.dias}d)"
        if args.reemplazar:
            rango_borrar = (desde, hasta)

    env = load_env(ENV_FILE)
    empresas = empresas_seleccionadas(args.empresa)

    log(f"Origen POS: {env.get('DB_HOST_POS')}  ->  "
        f"{env.get('DB_HOST_LOCAL')}/{env.get('DB_NAME_LOCAL')}")
    if args.solo_abiertas:
        log(f"Modo solo-abiertas | tipos={','.join(TIPDOCS)}")
    elif incremental:
        log(f"Modo incremental hasta ayer={ayer_yyyymmdd()} "
            f"| abiertas={'si' if refrescar_abiertas else 'no'} | tipos={','.join(TIPDOCS)}")
    else:
        log(f"Modo {'reemplazo rango' if rango_borrar else 'upsert rango'}: "
            f"{etiqueta_fija} | abiertas={'si' if refrescar_abiertas else 'no'} "
            f"| tipos={','.join(TIPDOCS)}")
    if args.dry_run:
        log("DRY-RUN: no escribe en produXdia")

    try:
        vacios = cargar(
            env, empresas,
            incremental=incremental,
            filtro_fijo=filtro_fijo,
            etiqueta_fija=etiqueta_fija,
            rango_borrar=rango_borrar,
            refrescar_abiertas=refrescar_abiertas,
            dry_run=args.dry_run,
            solo_et_ef=args.solo_et_ef,
        )
    except Exception as exc:
        log(f"ERROR: {exc}")
        return 1

    if vacios:
        log(f"WARNING: sin filas o sin tabla OC en: {', '.join(vacios)}")
        return 3
    log("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
