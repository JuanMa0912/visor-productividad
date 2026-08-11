from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import sys
import re
import psycopg2
import pandas as pd
import argparse
from psycopg2.extras import execute_values


import os
from pathlib import Path

# =========================
# CREDENCIALES
# =========================
# Se leen del .env.etl unico del deploy (modo 600, fuera de git), el mismo que usan
# cargar_margen.py / etl_ventas_item.py / etl_proveedores.py. Antes estaban escritas
# aqui, lo que hacia imposible versionar este fichero sin publicar secretos.
# Override de la ruta con ETL_ENV_FILE=...
ENV_FILE = Path(os.environ.get("ETL_ENV_FILE", "/home/prodapp/visor-productividad/.env.etl"))


def _load_env(path: Path) -> dict:
    """Parser minimo de .env (KEY=VALUE, ignora # y comillas)."""
    if not path.exists():
        print(f"ERROR: no encuentro la config del ETL: {path}", file=sys.stderr)
        sys.exit(2)
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip("'\"")
    return env


def _req(env: dict, key: str) -> str:
    val = (env.get(key) or "").strip()
    if not val:
        print(f"ERROR: falta {key} en {ENV_FILE}", file=sys.stderr)
        sys.exit(2)
    return val


_ENV = _load_env(ENV_FILE)
_POS_HOST = _req(_ENV, "DB_HOST_POS")
_POS_PORT = int((_ENV.get("DB_PORT_POS") or "5432"))

# Origenes: una BD por empresa en el POS. dbname y user coinciden con el nombre de
# la empresa (convencion del POS), asi que no son secreto; la contrasena si.
DBS = [
    {"empresa": "mercamio", "host": _POS_HOST, "port": _POS_PORT, "dbname": "mercamio", "user": "mercamio", "password": _req(_ENV, "DB_PWD_POS_MERCAMIO")},
    {"empresa": "mtodo",    "host": _POS_HOST, "port": _POS_PORT, "dbname": "mtodo",    "user": "mtodo",    "password": _req(_ENV, "DB_PWD_POS_MTODO")},
    {"empresa": "bogota",   "host": _POS_HOST, "port": _POS_PORT, "dbname": "bogota",   "user": "bogota",   "password": _req(_ENV, "DB_PWD_POS_BOGOTA")},
]

DEST_DB = {
    "host": _req(_ENV, "DB_HOST_LOCAL"),
    "port": int((_ENV.get("DB_PORT_LOCAL") or "5432")),
    "dbname": _req(_ENV, "DB_NAME_LOCAL"),
    "user": _req(_ENV, "DB_USER_LOCAL"),
    "password": _req(_ENV, "DB_PASSWORD_LOCAL"),
    "schema": "public",
    "table": "ventas_cajas",
}

# =========================
# SQL ORIGEN (por factura)
# - Coalesce id_vend_cc a '' para poder usarlo en PK/UPSERT sin NULL
# - Casts a text para que no reviente si el tipo cambia entre BD
# =========================
SQL_ORIGEN = """
SELECT
    %s::text AS empresa_bd,                          -- mercamio / mtodo / bogota
    id_co::text AS centro_operacion,
    fecha_dcto::text AS fecha_dcto,                  -- YYYYMMDD
    id_tipdoc_fc::text AS id_tipdoc_fc,
    consecutivo_doc::text AS consecutivo_doc,

    MAX(to_timestamp(lpad(hora_fin::text, 4, '0'), 'HH24MI')::time) AS hora_final_hora,

    SUM(ven_netas)  AS total_neto,
    SUM(vlrtot_bru) AS total_bruto,

    COALESCE(id_vend_cc::text,'') AS id_vend_cc,
    MAX(vend_cc_desc::text) AS vendedor

FROM cmmovimiento_pdv
WHERE fecha_dcto::text BETWEEN %s AND %s
  AND id_tipdoc_fc::text NOT LIKE 'Z%%'
GROUP BY
    id_co::text, fecha_dcto::text, id_tipdoc_fc::text, consecutivo_doc::text, COALESCE(id_vend_cc::text,'')
ORDER BY
    fecha_dcto::text, id_tipdoc_fc::text, consecutivo_doc::text;
"""

# =========================
# DDL DESTINO
# =========================
DDL_DESTINO = f"""
CREATE SCHEMA IF NOT EXISTS {DEST_DB["schema"]};

CREATE TABLE IF NOT EXISTS {DEST_DB["schema"]}.{DEST_DB["table"]} (
    empresa_bd         text      NOT NULL,  -- mercamio / mtodo / bogota
    centro_operacion   text      NOT NULL,  -- id_co
    fecha_dcto         text      NOT NULL,  -- YYYYMMDD
    id_tipdoc_fc       text      NOT NULL,
    consecutivo_doc    text      NOT NULL,
    hora_final_hora    time      NULL,
    total_neto         numeric   NULL,
    total_bruto        numeric   NULL,
    id_vend_cc         text      NOT NULL DEFAULT '',
    vendedor           text      NULL,
    fecha_carga        timestamp NOT NULL DEFAULT now(),

    CONSTRAINT pk_ventas_cajas PRIMARY KEY (
        empresa_bd, centro_operacion, fecha_dcto, id_tipdoc_fc, consecutivo_doc, id_vend_cc
    )
);
"""

UPSERT_SQL = f"""
INSERT INTO {DEST_DB["schema"]}.{DEST_DB["table"]} (
    empresa_bd, centro_operacion, fecha_dcto, id_tipdoc_fc, consecutivo_doc,
    hora_final_hora, total_neto, total_bruto, id_vend_cc, vendedor
) VALUES %s
ON CONFLICT (empresa_bd, centro_operacion, fecha_dcto, id_tipdoc_fc, consecutivo_doc, id_vend_cc)
DO UPDATE SET
    hora_final_hora = EXCLUDED.hora_final_hora,
    total_neto      = EXCLUDED.total_neto,
    total_bruto     = EXCLUDED.total_bruto,
    vendedor        = EXCLUDED.vendedor,
    fecha_carga     = now();
"""

def _validate_yyyymmdd(value: str) -> str:
    # Acepta 'YYYYMMDD' o 'YYYY-MM-DD' y devuelve 'YYYYMMDD'
    v = str(value).strip()
    if re.fullmatch(r"\d{8}", v):
        return v
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        return datetime.strptime(v, "%Y-%m-%d").strftime("%Y%m%d")
    raise ValueError(f"Fecha inválida: {value}. Usa YYYYMMDD o YYYY-MM-DD.")

def get_default_date_range_yyyymmdd() -> tuple[str, str]:
    """Por defecto: AYER en America/Bogota (rango de 1 día)."""
    now_bogota = datetime.now(ZoneInfo("America/Bogota"))
    yesterday = now_bogota.date() - timedelta(days=1)
    y = yesterday.strftime("%Y%m%d")
    return y, y

def parse_args_date_range() -> tuple[str, str]:
    """Lee --start-date y --end-date (o --date) desde CLI. Si no se pasan, usa AYER."""
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--start-date", dest="start_date", help="Fecha inicial (YYYYMMDD o YYYY-MM-DD)")
    parser.add_argument("--end-date", dest="end_date", help="Fecha final (YYYYMMDD o YYYY-MM-DD)")
    parser.add_argument("--date", dest="single_date", help="Atajo para un solo día (YYYYMMDD o YYYY-MM-DD)")
    args = parser.parse_args()

    if args.single_date and (args.start_date or args.end_date):
        raise ValueError("Usa --date o (--start-date/--end-date), no ambos.")

    if args.single_date:
        d = _validate_yyyymmdd(args.single_date)
        return d, d

    if args.start_date or args.end_date:
        if not (args.start_date and args.end_date):
            raise ValueError("Si usas rango, debes pasar --start-date y --end-date.")
        ini = _validate_yyyymmdd(args.start_date)
        fin = _validate_yyyymmdd(args.end_date)
        if ini > fin:
            raise ValueError(f"Rango inválido: start_date ({ini}) > end_date ({fin}).")
        return ini, fin

    return get_default_date_range_yyyymmdd()

def fetch_origen(cfg: dict, fecha_ini: str, fecha_fin: str) -> pd.DataFrame:
    conn = psycopg2.connect(
        host=cfg["host"], port=cfg["port"],
        dbname=cfg["dbname"], user=cfg["user"], password=cfg["password"]
    )
    try:
        return pd.read_sql(SQL_ORIGEN, conn, params=(cfg["empresa"], fecha_ini, fecha_fin))
    finally:
        conn.close()

def load_destino(df: pd.DataFrame) -> int:
    if df.empty:
        return 0

    conn = psycopg2.connect(
        host=DEST_DB["host"], port=DEST_DB["port"],
        dbname=DEST_DB["dbname"], user=DEST_DB["user"], password=DEST_DB["password"]
    )
    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            cur.execute(DDL_DESTINO)

            rows = [
                (
                    r["empresa_bd"], r["centro_operacion"], r["fecha_dcto"], r["id_tipdoc_fc"], r["consecutivo_doc"],
                    r["hora_final_hora"], r["total_neto"], r["total_bruto"], r["id_vend_cc"], r["vendedor"]
                )
                for _, r in df.iterrows()
            ]

            execute_values(cur, UPSERT_SQL, rows, page_size=2000)

        conn.commit()
        return len(df)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def main():
    fecha_ini, fecha_fin = parse_args_date_range()
    print(f"Consultando ventas | rango={fecha_ini}..{fecha_fin} (America/Bogota)")

    dfs = []
    for cfg in DBS:
        df_i = fetch_origen(cfg, fecha_ini, fecha_fin)
        print(f"{cfg['empresa']}: {len(df_i)} facturas agregadas")
        dfs.append(df_i)

    df_all = pd.concat(dfs, ignore_index=True) if dfs else pd.DataFrame()
    print(f"Total (3 BD): {len(df_all)} registros")

    upserted = load_destino(df_all)
    print(f"Carga a {DEST_DB['host']} / {DEST_DB['dbname']}.{DEST_DB['table']} OK. Upsert: {upserted}")



# ---------------------------------------------------------------------------
# Deteccion de empresas faltantes  (agregado 2026-08-10)
# ---------------------------------------------------------------------------
def _empresas_presentes(cur, tabla, d1, d2):
    cur.execute(
        f"SELECT DISTINCT empresa_bd FROM {tabla} WHERE fecha_dcto BETWEEN %s AND %s",
        (d1, d2),
    )
    return {r[0] for r in cur.fetchall() if r[0]}


def verificar_cobertura(fecha_ini, fecha_fin):
    """Sale con codigo 3 si falta una empresa que normalmente SI tiene datos.

    Las empresas esperadas NO se toman de DBS: se calculan mirando los 14 dias
    anteriores en la propia tabla. `ventas_asadero` solo opera en mercamio y
    mtodo, asi que una lista fija haria saltar el aviso todos los dias por bogota
    — y un aviso que salta siempre se ignora, con lo que deja de avisar de nada.

    Exit 3 sigue la convencion de los ETL del repo (ventas-item, proveedores,
    rotacion): systemd marca la unidad `failed` y aparece en `systemctl --failed`.
    """
    tabla = DEST_DB["schema"] + "." + DEST_DB["table"] if DEST_DB.get("schema") else DEST_DB["table"]
    conn = psycopg2.connect(
        host=DEST_DB["host"], port=DEST_DB["port"], dbname=DEST_DB["dbname"],
        user=DEST_DB["user"], password=DEST_DB["password"],
    )
    try:
        with conn.cursor() as cur:
            ini = datetime.strptime(fecha_ini, "%Y%m%d")
            ref1 = (ini - timedelta(days=14)).strftime("%Y%m%d")
            ref2 = (ini - timedelta(days=1)).strftime("%Y%m%d")
            esperadas = _empresas_presentes(cur, tabla, ref1, ref2)
            presentes = _empresas_presentes(cur, tabla, fecha_ini, fecha_fin)
    finally:
        conn.close()

    if not esperadas:
        print("AVISO: sin historial previo para calibrar; no se verifica cobertura.")
        return

    faltan = sorted(esperadas - presentes)
    if faltan:
        print(
            "AVISO: sin datos para " + ", ".join(faltan) +
            " en " + fecha_ini + ".." + fecha_fin +
            ". Esas empresas SI tuvieron ventas en los 14 dias previos, asi que el POS"
            " probablemente no habia cerrado el dia. Exit 3: re-correr este ETL antes"
            " del sync a GCP."
        )
        sys.exit(3)
    print("Cobertura OK: " + ", ".join(sorted(presentes)))


if __name__ == "__main__":
    main()
    verificar_cobertura(*parse_args_date_range())
