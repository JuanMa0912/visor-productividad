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
    "table": "ventas_industria",
}

# =========================
# FILTROS (INDUSTRIA)
# =========================
CATEGORIA = "4"
EXCLUIR_LINEAS = ["01", "02", "03", "04"]  # fruver/carne/pollo/pescado

# =========================
# SQL ORIGEN (PARAMETRIZADO)
# NOTA: 'Z%%' para LIKE dentro de SQL con placeholders %s
# Agrupa por factura (NO por linea)
# =========================
SQL_ORIGEN = """
SELECT
    %s::text AS empresa_bd,
    m.id_co   AS centro_operacion,
    m.id_suc  AS sede,
    m.id_caja AS caja,
    m.fecha_dcto,
    m.id_tipdoc_fc,
    m.documento_fc,

    MAX(to_timestamp(lpad(m.hora_final::text, 4, '0'), 'HH24MI')::time) AS hora_final_hora,

    SUM(m.ven_netas) AS venta_sin_impuesto,
    SUM(m.imp_netos) AS impuesto,
    SUM(m.ven_netas + m.imp_netos) AS venta_con_impuesto,
    SUM(m.vlrtot_bru) AS total_bruto,

    m.id_vend_cc,
    MAX(m.vend_cc_desc) AS vendedor,

    i.id_tipo AS categoria

FROM cmmovimiento_pdv m
JOIN items i
  ON i.id_item = m.id_item

WHERE m.fecha_dcto BETWEEN %s AND %s
  AND m.id_tipdoc_fc NOT LIKE 'Z%%'
  AND i.id_tipo = %s
  AND (
        trim(i.id_linea1) <> ALL(%s)   -- equivalente a NOT IN ('01','02','03','04')
        OR i.id_linea1 IS NULL
      )

GROUP BY
    m.id_co, m.id_suc, m.id_caja, m.fecha_dcto, m.id_tipdoc_fc, m.documento_fc,
    m.id_vend_cc, i.id_tipo

ORDER BY
    m.fecha_dcto, m.id_tipdoc_fc, m.documento_fc;
"""

# =========================
# DDL DESTINO (tabla nueva)
# =========================
DDL_DESTINO = f"""
CREATE SCHEMA IF NOT EXISTS {DEST_DB["schema"]};

CREATE TABLE IF NOT EXISTS {DEST_DB["schema"]}.{DEST_DB["table"]} (
    empresa_bd          text      NOT NULL,  -- mercamio / mtodo / bogota
    centro_operacion    text      NOT NULL,
    sede                text      NOT NULL,
    caja                text      NOT NULL,
    fecha_dcto          text      NOT NULL,  -- YYYYMMDD
    id_tipdoc_fc        text      NOT NULL,
    documento_fc        text      NOT NULL,

    hora_final_hora     time      NULL,

    venta_sin_impuesto  numeric   NULL,
    impuesto            numeric   NULL,
    venta_con_impuesto  numeric   NULL,
    total_bruto         numeric   NULL,

    id_vend_cc          text      NOT NULL DEFAULT '',
    vendedor            text      NULL,

    categoria           text      NOT NULL,

    fecha_carga         timestamp NOT NULL DEFAULT now(),

    CONSTRAINT pk_ventas_industria PRIMARY KEY (
        empresa_bd, centro_operacion, sede, caja, fecha_dcto, id_tipdoc_fc, documento_fc, id_vend_cc, categoria
    )
);
"""

UPSERT_SQL = f"""
INSERT INTO {DEST_DB["schema"]}.{DEST_DB["table"]} (
    empresa_bd, centro_operacion, sede, caja, fecha_dcto, id_tipdoc_fc, documento_fc,
    hora_final_hora,
    venta_sin_impuesto, impuesto, venta_con_impuesto, total_bruto,
    id_vend_cc, vendedor,
    categoria
) VALUES %s
ON CONFLICT (empresa_bd, centro_operacion, sede, caja, fecha_dcto, id_tipdoc_fc, documento_fc, id_vend_cc, categoria)
DO UPDATE SET
    hora_final_hora      = EXCLUDED.hora_final_hora,
    venta_sin_impuesto   = EXCLUDED.venta_sin_impuesto,
    impuesto             = EXCLUDED.impuesto,
    venta_con_impuesto   = EXCLUDED.venta_con_impuesto,
    total_bruto          = EXCLUDED.total_bruto,
    vendedor             = EXCLUDED.vendedor,
    fecha_carga          = now();
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
        params = (cfg["empresa"], fecha_ini, fecha_fin, CATEGORIA, EXCLUIR_LINEAS)
        return pd.read_sql(SQL_ORIGEN, conn, params=params)
    finally:
        conn.close()

def load_destino(df: pd.DataFrame) -> int:
    if df.empty:
        return 0

    # Normalizar texto (por si vienen char/numeric)
    text_cols = [
        "empresa_bd", "centro_operacion", "sede", "caja", "fecha_dcto", "id_tipdoc_fc", "documento_fc",
        "id_vend_cc", "categoria"
    ]
    for col in text_cols:
        df[col] = df[col].astype(str).fillna("")

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
                    r["empresa_bd"], r["centro_operacion"], r["sede"], r["caja"], r["fecha_dcto"], r["id_tipdoc_fc"], r["documento_fc"],
                    r["hora_final_hora"],
                    r["venta_sin_impuesto"], r["impuesto"], r["venta_con_impuesto"], r["total_bruto"],
                    (r["id_vend_cc"] or ""), r["vendedor"],
                    r["categoria"]
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
    print(f"ETL ventas_industria | rango={fecha_ini}..{fecha_fin} | categoria={CATEGORIA} | excluye lineas={EXCLUIR_LINEAS}")

    dfs = []
    for cfg in DBS:
        df_i = fetch_origen(cfg, fecha_ini, fecha_fin)
        print(f"{cfg['empresa']}: {len(df_i)} registros")
        dfs.append(df_i)

    df_all = pd.concat(dfs, ignore_index=True) if dfs else pd.DataFrame()
    print(f"Total registros (3 BD): {len(df_all)}")

    upserted = load_destino(df_all)
    print(f"Carga OK -> {DEST_DB['host']} / {DEST_DB['dbname']}.{DEST_DB['schema']}.{DEST_DB['table']} | Upsert: {upserted}")



# ---------------------------------------------------------------------------
# Deteccion de dias incompletos
#   empresa ausente -> 2026-08-10
#   empresa presente pero flaca -> 2026-08-12
# ---------------------------------------------------------------------------
DIAS_BASE = 14        # ventana para calibrar que es "un dia normal"
UMBRAL_VOLUMEN = 0.5  # se avisa por debajo del 50% de la mediana
MIN_MEDIANA = 100     # por debajo de esto la serie es muy chica para juzgar


def _empresas_presentes(cur, tabla, d1, d2):
    cur.execute(
        f"SELECT DISTINCT empresa_bd FROM {tabla} WHERE fecha_dcto BETWEEN %s AND %s",
        (d1, d2),
    )
    return {r[0] for r in cur.fetchall() if r[0]}


def _filas_por_empresa_dia(cur, tabla, d1, d2):
    cur.execute(
        f"SELECT empresa_bd, fecha_dcto, count(*) FROM {tabla} "
        f"WHERE fecha_dcto BETWEEN %s AND %s GROUP BY 1, 2",
        (d1, d2),
    )
    return [(r[0], r[1], int(r[2])) for r in cur.fetchall() if r[0]]


def _mediana_por_empresa(cur, tabla, d1, d2):
    """Filas/dia tipicas de cada empresa en la ventana de referencia.

    Mediana y no promedio: si en la ventana ya cayo un dia flaco, el promedio se
    va detras de el y el umbral deja de disparar justo cuando mas falta.

    Los dias con cero filas no aparecen en el GROUP BY, asi que quedan fuera
    solos, que es lo correcto: un dia que nunca se cargo no es un dia flojo de
    ventas y meterlo hundiria la referencia.
    """
    cur.execute(
        f"WITH d AS ("
        f"  SELECT empresa_bd, fecha_dcto, count(*) AS n FROM {tabla}"
        f"  WHERE fecha_dcto BETWEEN %s AND %s GROUP BY 1, 2"
        f") "
        f"SELECT empresa_bd, percentile_cont(0.5) WITHIN GROUP (ORDER BY n) "
        f"FROM d GROUP BY 1",
        (d1, d2),
    )
    return {r[0]: float(r[1]) for r in cur.fetchall() if r[0] and r[1] is not None}


def verificar_cobertura(fecha_ini, fecha_fin):
    """Sale con codigo 3 si lo cargado no se parece a un dia normal.

    Son DOS comprobaciones y hacen falta las dos:

    1. Empresa AUSENTE. Las esperadas no salen de una lista fija sino de los 14
       dias previos de la propia tabla: `ventas_asadero` solo opera en mercamio y
       mtodo, y una lista fija haria saltar el aviso todos los dias por bogota.
       Un aviso que salta siempre se ignora, con lo que deja de avisar de nada.

    2. Empresa PRESENTE pero FLACA. El 2026-08-07 y el 2026-08-10 mercamio y
       mtodo cargaron ~30% de sus filas habituales. Las tres empresas estaban
       presentes, asi que (1) daba "Cobertura OK" y el dia paso por bueno cinco
       dias hasta que alguien miro el tablero. Contar empresas no basta: hay que
       contar filas y compararlas con lo que esa empresa suele traer.

    Exit 3 sigue la convencion de los ETL del repo (ventas-item, proveedores,
    rotacion): systemd marca la unidad `failed` y sale en `systemctl --failed`.
    """
    tabla = DEST_DB["schema"] + "." + DEST_DB["table"] if DEST_DB.get("schema") else DEST_DB["table"]
    conn = psycopg2.connect(
        host=DEST_DB["host"], port=DEST_DB["port"], dbname=DEST_DB["dbname"],
        user=DEST_DB["user"], password=DEST_DB["password"],
    )
    try:
        with conn.cursor() as cur:
            ini = datetime.strptime(fecha_ini, "%Y%m%d")
            ref1 = (ini - timedelta(days=DIAS_BASE)).strftime("%Y%m%d")
            ref2 = (ini - timedelta(days=1)).strftime("%Y%m%d")
            esperadas = _empresas_presentes(cur, tabla, ref1, ref2)
            presentes = _empresas_presentes(cur, tabla, fecha_ini, fecha_fin)
            medianas = _mediana_por_empresa(cur, tabla, ref1, ref2)
            cargado = _filas_por_empresa_dia(cur, tabla, fecha_ini, fecha_fin)
    finally:
        conn.close()

    if not esperadas:
        print("AVISO: sin historial previo para calibrar; no se verifica cobertura.")
        return

    avisos = []

    faltan = sorted(esperadas - presentes)
    if faltan:
        avisos.append(
            "sin NINGUNA fila para " + ", ".join(faltan) +
            " en " + fecha_ini + ".." + fecha_fin +
            "; esas empresas si tuvieron ventas en los " + str(DIAS_BASE) + " dias previos"
        )

    for empresa, dia, filas in sorted(cargado):
        base = medianas.get(empresa)
        if base is None or base < MIN_MEDIANA:
            continue
        if filas < base * UMBRAL_VOLUMEN:
            avisos.append(
                empresa + " el " + str(dia) + ": " + format(filas, ",d") + " filas frente a "
                + format(int(base), ",d") + " tipicas (" + str(round(100.0 * filas / base))
                + "%)"
            )

    if avisos:
        print("AVISO de cobertura en " + tabla + ":")
        for a in avisos:
            print("  - " + a)
        print(
            "El POS (192.168.35.217) probablemente no habia cerrado el dia. Exit 3.\n"
            "COMPROBAR PRIMERO que el origen ya tiene el dato: re-correr el ETL no\n"
            "inventa filas que el POS no tiene. Y hacerlo ANTES del sync a GCP."
        )
        sys.exit(3)

    print("Cobertura OK: " + ", ".join(sorted(presentes)))


if __name__ == "__main__":
    main()
    verificar_cobertura(*parse_args_date_range())