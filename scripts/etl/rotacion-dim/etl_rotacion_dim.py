#!/usr/bin/env python3
"""
ETL de dimensiones y salidas de rotacion: carga desde las BD POS
(192.168.35.217: mercamio / mtodo / bogota) a produXdia (232).

  - public.rotacion_salidas_dia      HECHO diario  -> reemplazo por (empresa, dia)
  - public.rotacion_kit_composicion  DIMENSION     -> reemplazo por empresa
  - public.rotacion_item_codbar      DIMENSION     -> reemplazo por empresa

Ver db/migrations/20260814_rotacion_salidas_kits_codbar.sql para el porque.

QUE PROBLEMA RESUELVE
---------------------
El DIC de /rotacion divide inventario entre la venta del POS. Pero cuando se vende un
multipack (sixpack, arroba, bandeja de huevos) o un reempaque de granel, el ERP cobra en
el codigo PADRE y descuenta el inventario del HIJO, y esa salida NO viaja por
cmmovimiento_pdv: viaja como documento **EK = "ENSAMBLE DE KIT"** en
cmmovimiento_inventario. Resultado medido: el hijo aparece con DIC absurdo (hasta 38.180
dias) y el padre aparece "Agotado" mientras vende.

NO hay que reconstruir la explosion desde la tabla `kits`: el ERP ya la contabilizo.
Reconciliacion verificada al item (mercamio, lapso 202608, sede 001):
    ARROZ 030653  EA +19.500 = can_exis_ent ;  RV 847 + EK 19.981 = 20.828 = can_exis_sal
    HUEVO 063124  EA+RG = 82.980 = ent      ;  RV+RG+EK = 93.493 = sal
Y `fin = ini + ent - sal` cuadra en 120.709 de 120.709 filas de cmresumen_inventario.

POR QUE SE EXCLUYE `RV`
-----------------------
`RV` (REMISION VENTAS PDV) es la venta, y ya esta en rotacion_base_item_dia_sede.
Incluirla duplicaria el denominador. Ademas es el grueso del volumen: 1.063.068 lineas
por lapso contra ~57.000 de todo lo demas junto. Excluirla es lo que hace que la tabla
quepa en ~5.200 filas/dia/empresa (medido el 20260813 en mercamio) en vez de ~150.000.

Costo: ~19 s por dia por empresa (~1 min/dia las tres). Un backfill de 30 dias son
~30 min; lanzalo con nohup o en una ventana sin usuarios.

La sede `IMP` (importados) entra a la tabla porque el filtro es por bodega, no por
nombre de sede. No estorba: el matview de rotacion ya la excluye, asi que el LEFT JOIN
del snapshot simplemente no la encuentra.

QUE **NO** ES DEMANDA (ojo al elegir el denominador)
----------------------------------------------------
La tabla trae TODOS los tipos para que la decision sea configurable sin re-ETL, pero:
  · `AA` = AJUSTE DE ACUMULACION, `AJ` = AJUSTE DE INVENTARIO, `IF` = AJUSTE INVENTARIO
    FISICO  -> son correcciones contables. NO son entrada real de mercancia ni demanda.
  · `ST` / `TB` = traslados. Consumen stock de esa sede pero la demanda es de otra.
  · `FS` / `Na` / `FN` = averias. Consumen stock, no son demanda.
La entrada real de mercancia es `EA` (ENTRADA DE INVENTARIO - Interfase), y en fruver `EF`.

SEDE Y BODEGA
-------------
cmmovimiento_inventario NO tiene id_co; tiene id_local char(5) = sede(3) + bodega(2).
Verificado contra cmresumen_inventario: id_local '00101' <-> id_co '001' + bodega '01'.
Se replica el filtro del ETL de rotacion: solo bodega principal (RIGHT(id_local,2)='01')
y se excluye la sede 'PPT' (planta de producto terminado).

RENDIMIENTO
-----------
`fecha_fc` es char(8) y tiene indice propio (idx_fecha). Las comparaciones van SIN BTRIM
a proposito: BTRIM lo convierte a text y mata el indice. char(8) con 8 caracteres no
tiene padding, asi que la comparacion directa es correcta.

Config: el mismo .env.etl compartido (ver scripts/etl/env.etl.example).
El destino (produXdia 232) sale de DB_*_LOCAL; el origen POS (217) de DB_*_POS.

Uso:
  python etl_rotacion_dim.py                          # dimensiones + salidas de AYER
  python etl_rotacion_dim.py --mode salidas --date 20260813
  python etl_rotacion_dim.py --mode salidas --desde 20260701 --hasta 20260813
  python etl_rotacion_dim.py --mode dim                # solo catalogos (semanal basta)
  python etl_rotacion_dim.py --dry-run                 # cuenta en origen, no escribe
  python etl_rotacion_dim.py --empresas mercamio

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

REPO_ROOT = Path(__file__).resolve().parents[3]  # scripts/etl/rotacion-dim/ -> raiz
ENV_FILE = Path(os.environ.get("ETL_ENV_FILE", REPO_ROOT / ".env.etl"))

# Metadata por empresa (no secreta). La clave sale del .env unico (pwd_env).
EMPRESAS = [
    {"empresa": "mercamio", "db": "mercamio", "user": "mercamio", "pwd_env": "DB_PWD_POS_MERCAMIO"},
    {"empresa": "mtodo",    "db": "mtodo",    "user": "mtodo",    "pwd_env": "DB_PWD_POS_MTODO"},
    {"empresa": "bogota",   "db": "bogota",   "user": "bogota",   "pwd_env": "DB_PWD_POS_BOGOTA"},
]

# Profundidad maxima de la explosion de kits. Medido: hay 2 niveles reales y CERO ciclos,
# pero el CTE lleva ademas guarda de camino por si el maestro se corrompe.
MAX_NIVEL_KIT = 5

COLS_SALIDAS = ("empresa, fecha_dia, sede, bodega_local, id_item, "
                "doc_inv_tipo, ind_es, unidades, valor, lineas")
COLS_KITS = "empresa, id_item_padre, id_item_hijo, multiplicador, nivel"
COLS_CODBAR = "empresa, id_item, codigo_barras, es_gtin"

# ── Origen: salidas/entradas de inventario que NO son venta POS ──────────────
SQL_SALIDAS = r"""
SELECT
    '{empresa}'                              AS empresa,
    TO_DATE(BTRIM(m.fecha_fc), 'YYYYMMDD')   AS fecha_dia,
    LEFT(BTRIM(m.id_local), 3)               AS sede,
    BTRIM(m.id_local)                        AS bodega_local,
    BTRIM(m.id_item)                         AS id_item,
    BTRIM(m.doc_inv_tipo)                    AS doc_inv_tipo,
    CASE WHEN BTRIM(m.ind_es) = '1' THEN 1 ELSE 2 END AS ind_es,
    ROUND(SUM(COALESCE(m.cantidad_1, 0)), 4) AS unidades,
    ROUND(SUM(COALESCE(m.costot, 0)), 2)     AS valor,
    COUNT(*)                                 AS lineas
FROM public.cmmovimiento_inventario m
JOIN public.items i
       ON BTRIM(i.id_item) = BTRIM(m.id_item)
      AND BTRIM(i.id_tipo) = '4'
WHERE m.fecha_fc BETWEEN '{fecha_ini}' AND '{fecha_fin}'   -- char(8), usa idx_fecha
  AND RIGHT(BTRIM(m.id_local), 2) = '01'                   -- solo bodega principal
  AND LEFT(BTRIM(m.id_local), 3) <> 'PPT'                  -- excluye planta (igual que rotacion)
  AND BTRIM(COALESCE(m.doc_inv_tipo, '')) <> ''
  AND BTRIM(m.doc_inv_tipo) <> 'RV'                        -- la venta ya esta en rotacion
GROUP BY 1, 2, 3, 4, 5, 6, 7
HAVING SUM(COALESCE(m.cantidad_1, 0)) <> 0
    OR SUM(COALESCE(m.costot, 0)) <> 0
"""

# ── Origen: cierre recursivo de kits ────────────────────────────────────────
# `camino` evita bucle infinito si algun dia aparece un ciclo en el maestro.
SQL_KITS = r"""
WITH RECURSIVE base AS (
    SELECT
        BTRIM(k.id_cod_item_p) AS padre,
        BTRIM(k.id_cod_item_c) AS hijo,
        COALESCE(k.cantidad, 0) * COALESCE(NULLIF(k.factor, 0), 1) AS mult
    FROM public.kits k
    WHERE COALESCE(k.cantidad, 0) > 0
      AND BTRIM(COALESCE(k.id_cod_item_p, '')) <> ''
      AND BTRIM(COALESCE(k.id_cod_item_c, '')) <> ''
),
ex (raiz, hijo, mult, nivel, camino) AS (
    SELECT b.padre, b.hijo, b.mult, 1, ARRAY[b.padre, b.hijo]
    FROM base b
  UNION ALL
    SELECT e.raiz, b.hijo, e.mult * b.mult, e.nivel + 1, e.camino || b.hijo
    FROM ex e
    JOIN base b ON b.padre = e.hijo
    WHERE e.nivel < {max_nivel}
      AND NOT (b.hijo = ANY(e.camino))
)
SELECT
    '{empresa}'              AS empresa,
    ex.raiz                  AS id_item_padre,
    ex.hijo                  AS id_item_hijo,
    ROUND(SUM(ex.mult), 6)   AS multiplicador,
    MAX(ex.nivel)            AS nivel
FROM ex
GROUP BY 1, 2, 3
"""

# ── Origen: codigo de barras canonico ───────────────────────────────────────
SQL_CODBAR = r"""
SELECT
    '{empresa}'                                       AS empresa,
    BTRIM(i.id_item)                                  AS id_item,
    BTRIM(i.id_codbar)                                AS codigo_barras,
    (BTRIM(i.id_codbar) ~ '^[0-9]{{12,14}}$')         AS es_gtin
FROM public.items i
WHERE BTRIM(i.id_tipo) = '4'
  AND BTRIM(COALESCE(i.id_codbar, '')) <> ''
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
    val = env.get(key, "").strip()
    if not val:
        log(f"ERROR: falta {key} en {ENV_FILE}")
        sys.exit(1)
    return val


def valid_date(s: str) -> str:
    if not re.fullmatch(r"\d{8}", s or ""):
        log(f"ERROR: fecha invalida '{s}'. Formato esperado YYYYMMDD.")
        sys.exit(2)
    try:
        datetime.datetime.strptime(s, "%Y%m%d")
    except ValueError:
        log(f"ERROR: fecha inexistente '{s}'.")
        sys.exit(2)
    return s


def daterange(desde: str, hasta: str):
    d0 = datetime.datetime.strptime(desde, "%Y%m%d").date()
    d1 = datetime.datetime.strptime(hasta, "%Y%m%d").date()
    if d1 < d0:
        log(f"ERROR: --hasta ({hasta}) es anterior a --desde ({desde}).")
        sys.exit(2)
    cur = d0
    while cur <= d1:
        yield cur.strftime("%Y%m%d")
        cur += datetime.timedelta(days=1)


def target_conn(env: dict):
    return psycopg2.connect(
        host=env.get("DB_HOST_LOCAL", "localhost"),
        port=env.get("DB_PORT_LOCAL", "5432"),
        dbname=require(env, "DB_NAME_LOCAL"),
        user=require(env, "DB_USER_LOCAL"),
        password=require(env, "DB_PASSWORD_LOCAL"),
        sslmode=env.get("DB_SSL_LOCAL", "disable"),
        connect_timeout=15,
    )


def pos_conn(env: dict, emp: dict):
    return psycopg2.connect(
        host=require(env, "DB_HOST_POS"),
        port=env.get("DB_PORT_POS", "5432"),
        dbname=emp["db"],
        user=emp["user"],
        password=require(env, emp["pwd_env"]),
        connect_timeout=15,
    )


def empresas_sel(solo):
    if not solo:
        return EMPRESAS
    pedidas = {e.strip().lower() for e in solo.split(",") if e.strip()}
    sel = [e for e in EMPRESAS if e["empresa"] in pedidas]
    desconocidas = pedidas - {e["empresa"] for e in EMPRESAS}
    if desconocidas:
        log(f"ERROR: empresa(s) desconocida(s): {', '.join(sorted(desconocidas))}")
        sys.exit(2)
    return sel


def copy_rows(tgt, tabla: str, cols: str, rows) -> int:
    """COPY postgres->postgres en formato texto, NULL-safe."""
    if not rows:
        return 0
    buf = io.StringIO()
    for row in rows:
        campos = []
        for v in row:
            if v is None:
                campos.append(r"\N")
            elif isinstance(v, bool):
                campos.append("t" if v else "f")
            else:
                s = str(v)
                s = (s.replace("\\", "\\\\").replace("\t", "\\t")
                      .replace("\n", "\\n").replace("\r", "\\r"))
                campos.append(s)
        buf.write("\t".join(campos) + "\n")
    buf.seek(0)
    with tgt.cursor() as cur:
        cur.copy_expert(f"COPY {tabla} ({cols}) FROM STDIN", buf)
    return len(rows)


# ── Carga de dimensiones (catalogos, sin fecha) ──────────────────────────────

def cargar_dimensiones(env: dict, empresas, dry_run: bool) -> int:
    total = 0
    for emp in empresas:
        nombre = emp["empresa"]
        with pos_conn(env, emp) as src:
            with src.cursor() as cur:
                cur.execute(SQL_KITS.format(empresa=nombre, max_nivel=MAX_NIVEL_KIT))
                kits = cur.fetchall()
                cur.execute(SQL_CODBAR.format(empresa=nombre))
                codbar = cur.fetchall()

        niveles = sorted({r[4] for r in kits})
        log(f"empresa={nombre:<9} kits={len(kits):>6} (niveles {niveles})  "
            f"codbar={len(codbar):>6}")

        if dry_run:
            continue

        # Reemplazo por empresa dentro de UNA transaccion: el catalogo nunca queda
        # a medias para el tablero.
        with target_conn(env) as tgt:
            with tgt.cursor() as cur:
                cur.execute("DELETE FROM rotacion_kit_composicion WHERE empresa = %s",
                            (nombre,))
                cur.execute("DELETE FROM rotacion_item_codbar WHERE empresa = %s",
                            (nombre,))
            copy_rows(tgt, "rotacion_kit_composicion", COLS_KITS, kits)
            copy_rows(tgt, "rotacion_item_codbar", COLS_CODBAR, codbar)
            tgt.commit()
        total += len(kits) + len(codbar)
    return total


# ── Carga del hecho diario ───────────────────────────────────────────────────

def cargar_salidas(env: dict, empresas, desde: str, hasta: str, dry_run: bool) -> int:
    total = 0
    for emp in empresas:
        nombre = emp["empresa"]
        with pos_conn(env, emp) as src:
            for dia in daterange(desde, hasta):
                with src.cursor() as cur:
                    cur.execute(SQL_SALIDAS.format(
                        empresa=nombre, fecha_ini=dia, fecha_fin=dia))
                    rows = cur.fetchall()

                ek = sum(abs(float(r[7])) for r in rows
                         if r[5] == "EK" and r[6] == 2)
                log(f"empresa={nombre:<9} fecha={dia}  filas={len(rows):>5}  "
                    f"EK_salida={ek:,.0f} uds")

                if dry_run:
                    continue

                # Idempotente por "reemplazar el dia": re-correr NO duplica.
                with target_conn(env) as tgt:
                    with tgt.cursor() as cur:
                        cur.execute(
                            "DELETE FROM rotacion_salidas_dia "
                            "WHERE empresa = %s AND fecha_dia = TO_DATE(%s,'YYYYMMDD')",
                            (nombre, dia))
                    copy_rows(tgt, "rotacion_salidas_dia", COLS_SALIDAS, rows)
                    tgt.commit()
                total += len(rows)
    return total


def parse_args(argv=None):
    p = argparse.ArgumentParser(
        description="Carga salidas de inventario, composicion de kits y codigo de "
                    "barras del POS (217) a produXdia (232).")
    p.add_argument("--mode", choices=("all", "dim", "salidas"), default="all",
                   help="all = dimensiones + salidas (default). dim = solo catalogos.")
    p.add_argument("--date", help="Un solo dia (YYYYMMDD).")
    p.add_argument("--desde", help="Inicio del rango (YYYYMMDD).")
    p.add_argument("--hasta", help="Fin del rango (YYYYMMDD).")
    p.add_argument("--empresas", help="Subconjunto separado por comas.")
    p.add_argument("--dry-run", action="store_true",
                   help="Consulta el origen y reporta, pero no escribe.")
    args = p.parse_args(argv)

    if args.date and (args.desde or args.hasta):
        p.error("--date no se combina con --desde/--hasta")
    if bool(args.desde) != bool(args.hasta):
        p.error("--desde y --hasta van juntos")
    return args


def main(argv=None) -> int:
    args = parse_args(argv)
    env = load_env(ENV_FILE)
    empresas = empresas_sel(args.empresas)

    if args.date:
        desde = hasta = valid_date(args.date)
    elif args.desde:
        desde, hasta = valid_date(args.desde), valid_date(args.hasta)
    else:
        ayer = (datetime.date.today() - datetime.timedelta(days=1)).strftime("%Y%m%d")
        desde = hasta = ayer

    modo = "DRY-RUN" if args.dry_run else "carga"
    log(f"inicio  modo={args.mode}  {modo}  rango={desde}..{hasta}  "
        f"empresas={','.join(e['empresa'] for e in empresas)}")

    try:
        if args.mode in ("all", "dim"):
            n = cargar_dimensiones(env, empresas, args.dry_run)
            log(f"dimensiones: {n} filas")
        if args.mode in ("all", "salidas"):
            n = cargar_salidas(env, empresas, desde, hasta, args.dry_run)
            log(f"salidas: {n} filas")
    except psycopg2.Error as e:
        log(f"ERROR de base de datos: {e}")
        return 1
    except Exception as e:  # noqa: BLE001 - el timer necesita exit code, no traceback
        log(f"ERROR: {e}")
        return 1

    log("fin OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
