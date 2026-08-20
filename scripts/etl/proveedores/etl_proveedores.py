#!/usr/bin/env python3
"""
ETL de ventas por PROVEEDOR: carga desde las BD POS de origen
(192.168.35.217: mercamio / mtodo / bogota) a produXdia (232):

  - public.ventas_proveedor_dia   HECHOS  (proveedor x dia x sede)  -> reemplazo por dia
  - public.proveedor_pos_catalogo     CATALOGO de proveedores           -> upsert, nunca borra

Alimenta el tablero /proveedores. Ver db/migrations/20260805_ventas_proveedor.sql.

POR QUE ESTE ETL EXISTE, SI YA HAY ventas_item_diario
-----------------------------------------------------
ventas_item_diario tiene el grano item x dia x sede y ya sube a GCP. Se podria haber
colgado una dimension item->proveedor y agregar al vuelo, pero:
  1. El grano proveedor comprime 14x (medido en mtodo: 281.846 -> 20.137 filas en 30 dias).
     Con las 3 empresas son ~60k filas/mes: una tabla que GCP sirve sin rollup.
  2. Permite calcular la plata BIEN desde el origen. ventas_item_diario.venta_sin_impuesto_dia
     se llena con SUM(ven_netas) y ven_netas INCLUYE impuestos (ver abajo), asi que agregando
     desde ahi se arrastraria el error.
  3. No obliga a tocar el ETL de ventas-item ni a backfillear 7,5M filas.

LAS TRES COLUMNAS DE PLATA
--------------------------
Medido en vivo contra 217/mtodo, con diferencia EXACTA de 0.00 sobre 5 dias completos:

    cmmovimiento_pdv.ven_netas = cmmovimiento_pdv.vlrtot_bru + cmmovimiento_pdv.imp_netos

O sea ven_netas INCLUYE IVA e impoconsumo. Por eso aqui se cargan las tres por separado y
con nombres honestos:
    venta_base          = SUM(vlrtot_bru)   base gravable, SIN impuestos
    impuestos           = SUM(imp_netos)
    venta_con_impuesto  = SUM(ven_netas)    = venta_base + impuestos
Importa: el ranking de proveedores CAMBIA segun cual se use (en 30 dias de mtodo, ALPINA
supera a UNILEVER en base gravable pero UNILEVER la supera con impuestos).

`descuentos` (SUM(dscto_netos)) es un pasa-a-traves informativo. NO se cumple
vlrtot_bru = precio_uni*cantidad - dscto_netos (medido: ~70M sin explicar en un dia de
mtodo), asi que no lo uses para derivar la venta.

PROVEEDOR
---------
La MARCA del producto sale de criterios_itm_2 por el mismo mecanismo
(items.id_cricla2 = criterios_itm_2.id_cricla2 AND items.id_tipo = .id_catego),
verificado 1:1 contra el POS de mercamio: 48.390 items entran y 48.390 salen,
cobertura 84,4%. El centinela 'XXXX...' del maestro se descarta como sin marca.
Ojo: la marca es del PRODUCTO, no del proveedor.

Sale de criterios_itm_1, no de terceros. Join verificado 1:1 sin fan-out:
    items.id_cricla1 = criterios_itm_1.id_cricla1 AND items.id_tipo = criterios_itm_1.id_catego
Lo confirma la vista informes.v_eos_items del POS, que lo aliasa como `proveedor`.
Cobertura: 98,7% del valor en 30 dias. El 1,3% restante NO se descarta: entra con el codigo
sintetico '@SP' / '(SIN PROVEEDOR)'. Perder plata en silencio es el peor resultado posible.

EL NIT: SE CARGA LO QUE HAY, Y SOLO ESO
---------------------------------------
La tabla que liga criterio con NIT SI existe, pero su nombre lleva SUFIJO POR EMPRESA:
    mercamio -> public.nit_mmio      mtodo -> public.nit_mtodo      bogota -> NO EXISTE
(buscar "nit_mmio" en mtodo da "no existe la relacion" y lleva a concluir, mal, que no hay
fuente; de ahi el mapa NIT_TABLE de abajo).

Y hay que leerla con cuidado, porque un COUNT(nit IS NOT NULL) miente:
    filas 1093 | nit='99999999' + proveedor='NO ASIGNADO': 750 (68,6%) | NIT util: 343
El centinela '99999999' se descarta explicitamente. Cobertura real medida: 341 de los 1137
criterios del maestro (~30%).

bogota no tiene tabla propia, pero los 1137 codigos son IDENTICOS en las 3 empresas
(verificado: 0 discrepancias de nombre), asi que hereda el NIT de mercamio con la guarda de
que el nombre coincida, y queda marcado nit_origen='pos:heredado' para poder auditarlo.

Lo que este ETL NO hace: cruzar por nombre contra `terceros`. Es posible (0 ambiguos en las
mediciones) pero es una inferencia, no una llave; si se quiere, va como paso aparte revisable.

REGLA DE SOBREESCRITURA: el ETL solo escribe el NIT cuando la fila esta vacia o cuando el
valor vigente vino del propio POS (nit_origen LIKE 'pos%'). Un NIT puesto a mano
(nit_origen='manual') NUNCA se pisa. Los codigos que desaparecen del POS se marcan
activo=false en vez de borrarse, para no perder el trabajo manual.

DEVOLUCIONES
------------
Se EXCLUYEN (id_tipdoc_fc LIKE 'Z%'), igual que etl_ventas_item.py, para que el tablero
cuadre con /ventas-x-item. En mtodo son -28,3M en 30 dias (~0,1%).

IDEMPOTENCIA
------------
Los HECHOS se reemplazan por (empresa, fecha_dcto): DELETE + INSERT en una transaccion.
Re-correr NO duplica; re-correr ES el rollback contra el origen. El CATALOGO es upsert puro.

Config: el mismo .env.etl unico de la raiz del deploy que usan sync-local-to-gcp.sh,
cargar_margen.py y etl_ventas_item.py. Override con ETL_ENV_FILE.

Uso:
  python3 etl_proveedores.py                          # ayer (lo que corre el timer diario)
  python3 etl_proveedores.py --days 7                 # ultimos 7 dias hasta ayer
  python3 etl_proveedores.py --date 20260729          # un dia
  python3 etl_proveedores.py --desde 20260101 --hasta 20260804   # backfill / recarga manual
  python3 etl_proveedores.py --empresa mtodo --days 3 # una sola empresa
  python3 etl_proveedores.py --solo-catalogo          # refresca solo el catalogo
  python3 etl_proveedores.py --sin-catalogo --date 20260804
  python3 etl_proveedores.py --dry-run --days 30      # solo cuenta filas en origen
  python3 etl_proveedores.py --reconciliar --days 30  # compara contra ventas_item_diario
  python3 etl_proveedores.py --purge --desde 20260101 --hasta 20260131   # borra sin recargar

Codigos de salida: 0 OK | 1 error | 2 uso invalido | 3 warning (algun dia/empresa sin datos).
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

REPO_ROOT = Path(__file__).resolve().parents[3]  # scripts/etl/proveedores/ -> raiz del repo
ENV_FILE = Path(os.environ.get("ETL_ENV_FILE", REPO_ROOT / ".env.etl"))

# Metadata por empresa (no secreta). La clave sale del .env unico (pwd_env).
# nit_table: tabla criterio->NIT dentro de ESA base. El nombre lleva sufijo por empresa y
# bogota simplemente no la tiene (hereda de mercamio; ver herencia_nit_bogota()).
EMPRESAS = [
    {"empresa": "mercamio", "db": "mercamio", "user": "mercamio", "pwd_env": "DB_PWD_POS_MERCAMIO", "nit_table": "nit_mmio"},
    {"empresa": "mtodo",    "db": "mtodo",    "user": "mtodo",    "pwd_env": "DB_PWD_POS_MTODO",    "nit_table": "nit_mtodo"},
    {"empresa": "bogota",   "db": "bogota",   "user": "bogota",   "pwd_env": "DB_PWD_POS_BOGOTA",   "nit_table": None},
]

# Valor centinela de las tablas nit_*: 750 de 1093 filas lo traen junto con
# proveedor='NO ASIGNADO'. Tratarlo como NIT valido inflaria la cobertura de 30% a 96%.
NIT_CENTINELA = "99999999"
EMPRESA_NIT_ORIGEN = "mercamio"   # de quien hereda el NIT una empresa sin tabla propia

TABLE_HECHOS = "public.ventas_proveedor_dia"
TABLE_CATALOGO = "public.proveedor_pos_catalogo"
TABLE_PUENTE = "public.proveedor_item"          # item -> proveedor, para valorizar inventario
TABLE_INVENTARIO = "public.inventario_proveedor_dia"
TABLE_ROTACION = "public.rotacion_base_item_dia_sede"  # origen del inventario, ya en la 232
TABLE_CARGAS = "public.ventas_item_cargas"      # se reusa la tabla de auditoria existente
TABLE_SEDE_MAP = "public.ventas_item_sede_map"  # el mapa de sedes vive en el DESTINO, no en el POS
TABLE_VENTAS_ITEM = "public.ventas_item_diario" # solo para --reconciliar

LOADED_BY = "etl_proveedores"

SIN_PROVEEDOR_COD = "@SP"
SIN_PROVEEDOR_NOM = "(SIN PROVEEDOR)"

STG_HECHOS_COLS = (
    "fecha_dcto, id_co, id_cricla1, proveedor, items, "
    "unidades, venta_base, impuestos, venta_con_impuesto, descuentos"
)
STG_CATALOGO_COLS = "id_cricla1, nombre, nit"

# Query de HECHOS. Las fechas van inline (validadas YYYYMMDD) porque COPY no acepta
# parametros; mismo criterio que etl_ventas_item.py y cargar_margen.py.
#
# Notas de diseno:
#  - LEFT JOIN a items y a criterios_itm_1 (no INNER): si un id_item no existe en `items`
#    o no tiene criterio, la venta NO se pierde, cae en '@SP'. OJO: etl_ventas_item.py usa
#    INNER JOIN contra items, asi que puede haber una diferencia legitima entre las dos
#    tablas; --reconciliar la mide y la explica.
#  - Se agrupa SOLO por la clave natural y el nombre se toma con max(): si un mismo codigo
#    trajera dos descripciones, seguiriamos produciendo UNA fila por clave y el INSERT no
#    violaria ventas_proveedor_dia_uq_natural.
#  - BTRIM en las llaves: esta tabla es NUEVA y no tiene historia en GCP que respetar, a
#    diferencia de ventas_item_diario.linea (ver el comentario largo en etl_ventas_item.py).
#    Normalizar aqui es seguro y evita que el padding de los CHAR de SIESA parta las llaves.
SQL_HECHOS = r"""
WITH base AS (
  SELECT
    BTRIM(v.fecha_dcto) AS fecha_dcto,
    BTRIM(v.id_co)      AS id_co,
    COALESCE(NULLIF(BTRIM(i.id_cricla1), ''), '{sp_cod}')            AS id_cricla1,
    COALESCE(NULLIF(BTRIM(cr.cmcricla_descripcion), ''), '{sp_nom}') AS proveedor,
    BTRIM(v.id_item)    AS id_item,
    v.cantidad,
    v.vlrtot_bru,
    v.imp_netos,
    v.ven_netas,
    v.dscto_netos
  FROM public.cmmovimiento_pdv v
  LEFT JOIN public.items i
    ON i.id_item = v.id_item
  LEFT JOIN public.criterios_itm_1 cr
    ON cr.id_cricla1 = i.id_cricla1
   AND cr.id_catego  = i.id_tipo
  WHERE v.fecha_dcto BETWEEN '{fecha_ini}' AND '{fecha_fin}'
    AND (v.id_tipdoc_fc IS NULL OR v.id_tipdoc_fc NOT LIKE 'Z%')
)
SELECT
  fecha_dcto,
  id_co,
  id_cricla1,
  max(proveedor)                        AS proveedor,
  count(DISTINCT id_item)               AS items,
  COALESCE(sum(cantidad), 0)            AS unidades,
  COALESCE(sum(vlrtot_bru), 0)          AS venta_base,
  COALESCE(sum(imp_netos), 0)           AS impuestos,
  COALESCE(sum(ven_netas), 0)           AS venta_con_impuesto,
  COALESCE(sum(dscto_netos), 0)         AS descuentos
FROM base
GROUP BY fecha_dcto, id_co, id_cricla1
ORDER BY fecha_dcto, id_cricla1
"""

# Query de CATALOGO. Un solo id_catego en la practica ('4'), pero se agrupa por codigo con
# max(nombre) para garantizar una fila por clave pase lo que pase.
# El NIT sale de la tabla nit_* de la empresa, descartando el centinela. Si la empresa no
# tiene tabla (bogota) se emite NULL y el NIT se hereda despues en el destino.
SQL_CATALOGO = r"""
SELECT
  BTRIM(cr.id_cricla1)                AS id_cricla1,
  max(BTRIM(cr.cmcricla_descripcion)) AS nombre,
  {nit_expr}                          AS nit
FROM public.criterios_itm_1 cr
{nit_join}
WHERE BTRIM(COALESCE(cr.cmcricla_descripcion, '')) <> ''
  AND BTRIM(COALESCE(cr.id_cricla1, '')) <> ''
GROUP BY BTRIM(cr.id_cricla1)
ORDER BY 1
"""


def build_sql_catalogo(nit_table) -> str:
    """Arma la query del catalogo segun la empresa tenga o no tabla de NIT."""
    if not nit_table:
        return SQL_CATALOGO.format(nit_expr="NULL::text", nit_join="")
    return SQL_CATALOGO.format(
        nit_expr=(f"max(NULLIF(NULLIF(BTRIM(n.nit), ''), '{NIT_CENTINELA}'))"),
        nit_join=(f"LEFT JOIN public.{nit_table} n "
                  f"ON BTRIM(n.criterio) = BTRIM(cr.id_cricla1)"),
    )

DDL_STG_HECHOS = """
CREATE TEMP TABLE IF NOT EXISTS stg_ventas_proveedor (
  fecha_dcto         text,
  id_co              text,
  id_cricla1         text,
  proveedor          text,
  items              integer,
  unidades           numeric(18,4),
  venta_base         numeric(18,4),
  impuestos          numeric(18,4),
  venta_con_impuesto numeric(18,4),
  descuentos         numeric(18,4)
);
"""

DDL_STG_CATALOGO = """
CREATE TEMP TABLE IF NOT EXISTS stg_proveedor_pos_catalogo (
  id_cricla1 text,
  nombre     text,
  nit        text
);
"""

# Puente item -> proveedor. Se resuelve por cr.id_cricla1 (no por i.id_cricla1) para que un
# criterio que no exista en el maestro caiga en '@SP' igual que en la query de hechos: asi el
# puente y el catalogo nunca se contradicen.
SQL_PUENTE = r"""
SELECT
  BTRIM(i.id_item)                                      AS id_item,
  COALESCE(NULLIF(BTRIM(max(cr.id_cricla1)), ''), '@SP') AS id_cricla1,
  BTRIM(max(i.descripcion))                             AS descripcion,
  NULLIF(BTRIM(max(i.id_cricla2)), '')                  AS id_cricla2,
  CASE
    WHEN BTRIM(max(mk.cmcricla_descripcion)) ~ '^[X ]+$' THEN NULL
    ELSE NULLIF(BTRIM(max(mk.cmcricla_descripcion)), '')
  END                                                   AS marca
FROM public.items i
LEFT JOIN public.criterios_itm_1 cr
  ON cr.id_cricla1 = i.id_cricla1
 AND cr.id_catego  = i.id_tipo
LEFT JOIN public.criterios_itm_2 mk
  ON mk.id_cricla2 = i.id_cricla2
 AND mk.id_catego  = i.id_tipo
WHERE BTRIM(COALESCE(i.id_item, '')) <> ''
GROUP BY BTRIM(i.id_item)
ORDER BY 1
"""

DDL_STG_PUENTE = """
CREATE TEMP TABLE IF NOT EXISTS stg_proveedor_item (
  id_item     text,
  id_cricla1  text,
  descripcion text,
  id_cricla2  text,
  marca       text
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


def target_dsn(env: dict) -> dict:
    return dict(
        host=require(env, "DB_HOST_LOCAL"), port=env.get("DB_PORT_LOCAL", "5432"),
        dbname=require(env, "DB_NAME_LOCAL"), user=require(env, "DB_USER_LOCAL"),
        password=require(env, "DB_PASSWORD_LOCAL"),
    )


def pos_conn(env: dict, db: dict):
    return psycopg2.connect(
        host=require(env, "DB_HOST_POS"), port=env.get("DB_PORT_POS", "5432"),
        dbname=db["db"], user=db["user"], password=require(env, db["pwd_env"]),
    )


def empresas_seleccionadas(solo: str | None):
    if not solo:
        return EMPRESAS
    sel = [e for e in EMPRESAS if e["empresa"] == solo]
    if not sel:
        log(f"ERROR: --empresa '{solo}' no existe. Opciones: "
            f"{', '.join(e['empresa'] for e in EMPRESAS)}")
        sys.exit(2)
    return sel


def insert_carga_header(cur, empresa: str, dia: str, src_hash: str, src_rows: int) -> int:
    cur.execute(
        f"""
        INSERT INTO {TABLE_CARGAS} (source_name, source_hash, source_rows, loaded_by, notes)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id;
        """,
        (f"217->{empresa}", src_hash, src_rows, LOADED_BY,
         f"pipeline 232 etl_proveedores {empresa} {dia}"),
    )
    return cur.fetchone()[0]


# --------------------------------------------------------------------------- CATALOGO
def cargar_catalogo(env: dict, empresas, dry_run: bool) -> list:
    """Upsert del catalogo por empresa. Devuelve la lista de empresas que vinieron vacias.

    GUARDA IMPORTANTE: si el POS devuelve 0 filas para una empresa NO se toca nada. Un
    catalogo vacio borraria los nombres y dejaria el tablero sin proveedores; peor aun,
    marcaria todo inactivo. Ante duda, no escribir.
    """
    vacios = []
    tgt = None if dry_run else psycopg2.connect(**target_dsn(env))
    try:
        if tgt:
            tgt.autocommit = False
            with tgt.cursor() as c:
                c.execute(DDL_STG_CATALOGO)
            tgt.commit()

        for db in empresas:
            empresa = db["empresa"]
            q_cat = build_sql_catalogo(db.get("nit_table"))
            with pos_conn(env, db) as src:
                if dry_run:
                    with src.cursor() as c:
                        c.execute(f"SELECT count(*), count(nit) FROM ({q_cat}) s")
                        n, n_nit = c.fetchone()
                    log(f"[catalogo {empresa}] DRY-RUN: {n} proveedores en origen, "
                        f"{n_nit} con NIT util (tabla={db.get('nit_table') or 'ninguna'})")
                    if n == 0:
                        vacios.append(f"catalogo@{empresa}")
                    continue

                buf = io.StringIO()
                with src.cursor() as sc:
                    sc.copy_expert(f"COPY ({q_cat}) TO STDOUT", buf)

            payload = buf.getvalue()
            if not payload.strip():
                vacios.append(f"catalogo@{empresa}")
                log(f"[catalogo {empresa}] SIN FILAS en el POS -> no se toca el catalogo "
                    f"(evitar borrar nombres/NIT ya cargados)")
                continue

            with tgt.cursor() as tc:
                tc.execute("TRUNCATE stg_proveedor_pos_catalogo;")
                tc.copy_expert(
                    f"COPY stg_proveedor_pos_catalogo ({STG_CATALOGO_COLS}) FROM STDIN",
                    io.StringIO(payload),
                )
                # Upsert. El nombre siempre se refresca. El NIT solo se escribe si la fila
                # esta vacia o si el valor vigente vino del propio POS: un NIT puesto a mano
                # (nit_origen='manual') NUNCA se pisa, y sobrevive a todas las recargas.
                tc.execute(
                    f"""
                    INSERT INTO {TABLE_CATALOGO}
                        (empresa, id_cricla1, nombre, nit, nit_origen, activo, updated_at)
                    SELECT %s, s.id_cricla1, s.nombre, s.nit,
                           CASE WHEN s.nit IS NOT NULL THEN %s END,
                           true, now()
                    FROM stg_proveedor_pos_catalogo s
                    ON CONFLICT (empresa, id_cricla1) DO UPDATE SET
                      nombre     = EXCLUDED.nombre,
                      nit        = CASE
                                     WHEN {TABLE_CATALOGO}.nit IS NULL
                                       OR {TABLE_CATALOGO}.nit_origen LIKE 'pos%%'
                                     THEN COALESCE(EXCLUDED.nit, {TABLE_CATALOGO}.nit)
                                     ELSE {TABLE_CATALOGO}.nit
                                   END,
                      nit_origen = CASE
                                     WHEN {TABLE_CATALOGO}.nit IS NULL
                                       OR {TABLE_CATALOGO}.nit_origen LIKE 'pos%%'
                                     THEN COALESCE(EXCLUDED.nit_origen, {TABLE_CATALOGO}.nit_origen)
                                     ELSE {TABLE_CATALOGO}.nit_origen
                                   END,
                      activo     = true,
                      updated_at = now();
                    """,
                    (empresa, f"pos:{db.get('nit_table')}"),
                )
                n_up = tc.rowcount
                # Los que ya no estan en el POS se marcan inactivos, NO se borran: los hechos
                # historicos siguen apuntando a ese codigo y el NIT ya trabajado se conserva.
                tc.execute(
                    f"""
                    UPDATE {TABLE_CATALOGO} c
                       SET activo = false, updated_at = now()
                     WHERE c.empresa = %s
                       AND c.id_cricla1 <> %s
                       AND c.activo
                       AND NOT EXISTS (
                         SELECT 1 FROM stg_proveedor_pos_catalogo s WHERE s.id_cricla1 = c.id_cricla1
                       );
                    """,
                    (empresa, SIN_PROVEEDOR_COD),
                )
                n_off = tc.rowcount
                # La fila sintetica siempre debe existir para que un INNER JOIN del tablero
                # no pierda la venta sin proveedor.
                tc.execute(
                    f"""
                    INSERT INTO {TABLE_CATALOGO} (empresa, id_cricla1, nombre, nit_origen, activo)
                    VALUES (%s, %s, %s, 'sintetico', true)
                    ON CONFLICT (empresa, id_cricla1) DO NOTHING;
                    """,
                    (empresa, SIN_PROVEEDOR_COD, SIN_PROVEEDOR_NOM),
                )
                tc.execute(
                    f"SELECT count(nit) FROM {TABLE_CATALOGO} WHERE empresa = %s", (empresa,)
                )
                n_nit = tc.fetchone()[0]
            tgt.commit()
            log(f"[catalogo {empresa}] {n_up} proveedores upsert, {n_off} marcados inactivos, "
                f"{n_nit} con NIT")

        if tgt:
            heredar_nit(tgt, empresas)
        return vacios
    except Exception:
        if tgt:
            tgt.rollback()
        raise
    finally:
        if tgt:
            tgt.close()


def heredar_nit(tgt, empresas) -> None:
    """Propaga el NIT desde la empresa que si tiene tabla nit_* a las que no la tienen.

    bogota no tiene tabla propia. Los 1137 codigos son identicos en las 3 empresas
    (verificado: 0 discrepancias de nombre), asi que heredar es correcto; aun asi se exige
    que el NOMBRE coincida antes de copiar, y se marca nit_origen='pos:heredado' para que
    quede auditable de donde salio. Nunca pisa un NIT manual.
    """
    destinos = [e["empresa"] for e in empresas if not e.get("nit_table")]
    if not destinos:
        return
    for empresa in destinos:
        with tgt.cursor() as tc:
            tc.execute(
                f"""
                UPDATE {TABLE_CATALOGO} dst
                   SET nit = src.nit, nit_origen = 'pos:heredado', updated_at = now()
                  FROM {TABLE_CATALOGO} src
                 WHERE dst.empresa = %s
                   AND src.empresa = %s
                   AND src.id_cricla1 = dst.id_cricla1
                   AND src.nit IS NOT NULL
                   AND dst.nombre = src.nombre
                   AND (dst.nit IS NULL OR dst.nit_origen LIKE 'pos%%');
                """,
                (empresa, EMPRESA_NIT_ORIGEN),
            )
            n = tc.rowcount
        tgt.commit()
        log(f"[catalogo {empresa}] {n} NIT heredados de {EMPRESA_NIT_ORIGEN} "
            f"(no tiene tabla nit_* propia)")


# --------------------------------------------------------------------------- PUENTE
def cargar_puente(env: dict, empresas, dry_run: bool) -> list:
    """Reemplazo total del puente item -> proveedor, por empresa.

    Hace falta porque rotacion_base_item_dia_sede tiene id_item pero no proveedor, y
    ventas_proveedor_dia ya viene agregada. Misma guarda que el catalogo: si el origen
    devuelve 0 filas NO se borra nada.
    """
    vacios = []
    tgt = None if dry_run else psycopg2.connect(**target_dsn(env))
    try:
        if tgt:
            tgt.autocommit = False
            with tgt.cursor() as c:
                c.execute(DDL_STG_PUENTE)
            tgt.commit()

        for db in empresas:
            empresa = db["empresa"]
            with pos_conn(env, db) as src:
                if dry_run:
                    with src.cursor() as c:
                        c.execute(f"SELECT count(*) FROM ({SQL_PUENTE}) s")
                        n = c.fetchone()[0]
                    log(f"[puente {empresa}] DRY-RUN: {n} items en origen")
                    if n == 0:
                        vacios.append(f"puente@{empresa}")
                    continue

                buf = io.StringIO()
                with src.cursor() as sc:
                    sc.copy_expert(f"COPY ({SQL_PUENTE}) TO STDOUT", buf)

            payload = buf.getvalue()
            if not payload.strip():
                vacios.append(f"puente@{empresa}")
                log(f"[puente {empresa}] SIN FILAS en el POS -> no se toca el puente")
                continue

            with tgt.cursor() as tc:
                tc.execute("TRUNCATE stg_proveedor_item;")
                tc.copy_expert(
                    "COPY stg_proveedor_item "
                    "(id_item, id_cricla1, descripcion, id_cricla2, marca) FROM STDIN",
                    io.StringIO(payload),
                )
                tc.execute(f"DELETE FROM {TABLE_PUENTE} WHERE empresa = %s;", (empresa,))
                tc.execute(
                    f"""
                    INSERT INTO {TABLE_PUENTE}
                      (empresa, id_item, id_cricla1, descripcion,
                       id_cricla2, marca, updated_at)
                    SELECT %s, s.id_item, s.id_cricla1, s.descripcion,
                           s.id_cricla2, s.marca, now()
                    FROM stg_proveedor_item s;
                    """,
                    (empresa,),
                )
                n_ins = tc.rowcount
            tgt.commit()
            log(f"[puente {empresa}] {n_ins} items mapeados a proveedor")

        return vacios
    except Exception:
        if tgt:
            tgt.rollback()
        raise
    finally:
        if tgt:
            tgt.close()


# --------------------------------------------------------------------------- INVENTARIO
def cargar_inventario(env: dict, empresas, desde: str, hasta: str, dry_run: bool):
    """Inventario valorizado por proveedor. Se calcula ENTERO dentro de la 232.

    El inventario ya esta en rotacion_base_item_dia_sede (lo deja el ETL de rotacion), asi
    que aqui NO se toca el POS: solo se cruza contra el puente y se agrega.
        valorizado = SUM(can_disponible_foto * costo_uni_inventario)   -- al COSTO
    Idempotente por (empresa, fecha_dia): DELETE + INSERT en una transaccion.
    Solo se guardan filas con existencia distinta de cero.
    """
    total = 0
    vacios = []
    empresas_nom = [e["empresa"] for e in empresas]

    with psycopg2.connect(**target_dsn(env)) as tgt:
        tgt.autocommit = False
        with tgt.cursor() as tc:
            # Las fechas de rotacion son DATE; el rango del ETL viene en YYYYMMDD.
            tc.execute(
                f"""
                SELECT DISTINCT fecha_dia FROM {TABLE_ROTACION}
                 WHERE empresa = ANY(%s)
                   AND fecha_dia BETWEEN to_date(%s,'YYYYMMDD') AND to_date(%s,'YYYYMMDD')
                 ORDER BY 1
                """,
                (empresas_nom, desde, hasta),
            )
            dias = [r[0] for r in tc.fetchall()]

        if not dias:
            log(f"[inventario {desde}..{hasta}] rotacion no tiene fotos en ese rango "
                f"(su ventana es mas corta que la de ventas). Nada que hacer.")
            return 0, [f"inventario@{desde}..{hasta}"]

        if dry_run:
            log(f"[inventario] DRY-RUN: {len(dias)} foto(s) entre {dias[0]} y {dias[-1]}")
            return 0, []

        for dia in dias:
            with tgt.cursor() as tc:
                tc.execute(
                    f"DELETE FROM {TABLE_INVENTARIO} "
                    f"WHERE empresa = ANY(%s) AND fecha_dia = %s",
                    (empresas_nom, dia),
                )
                tc.execute(
                    f"""
                    INSERT INTO {TABLE_INVENTARIO} (
                        empresa, fecha_dia, id_co, sede, id_cricla1, proveedor,
                        items_con_stock, unidades, valorizado
                    )
                    SELECT
                        r.empresa,
                        r.fecha_dia,
                        r.sede                                        AS id_co,
                        m.sede                                        AS sede,
                        COALESCE(p.id_cricla1, %s)                    AS id_cricla1,
                        COALESCE(c.nombre, %s)                        AS proveedor,
                        count(*)                                      AS items_con_stock,
                        sum(r.can_disponible_foto)                    AS unidades,
                        sum(r.can_disponible_foto * r.costo_uni_inventario) AS valorizado
                    FROM {TABLE_ROTACION} r
                    LEFT JOIN {TABLE_PUENTE} p
                           ON p.empresa = r.empresa AND p.id_item = r.id_item
                    LEFT JOIN {TABLE_SEDE_MAP} m
                           ON m.empresa_norm = r.empresa AND m.id_co_norm = r.sede
                    LEFT JOIN {TABLE_CATALOGO} c
                           ON c.empresa = r.empresa
                          AND c.id_cricla1 = COALESCE(p.id_cricla1, %s)
                    WHERE r.empresa = ANY(%s)
                      AND r.fecha_dia = %s
                      AND r.can_disponible_foto IS NOT NULL
                      AND r.can_disponible_foto <> 0
                    GROUP BY r.empresa, r.fecha_dia, r.sede, m.sede,
                             COALESCE(p.id_cricla1, %s), COALESCE(c.nombre, %s);
                    """,
                    (SIN_PROVEEDOR_COD, SIN_PROVEEDOR_NOM, SIN_PROVEEDOR_COD,
                     empresas_nom, dia, SIN_PROVEEDOR_COD, SIN_PROVEEDOR_NOM),
                )
                n = tc.rowcount
            tgt.commit()
            total += n
            log(f"[inventario {dia}] {n} filas proveedor x sede")

    return total, vacios


# --------------------------------------------------------------------------- HECHOS
def cargar_hechos(env: dict, empresas, desde: str, hasta: str, dry_run: bool):
    """Devuelve (total_filas, lista de '<empresa>@<dia>' que quedaron vacios)."""
    total = 0
    vacios = []

    tgt = None if dry_run else psycopg2.connect(**target_dsn(env))
    try:
        if tgt:
            tgt.autocommit = False
            with tgt.cursor() as c:
                c.execute(DDL_STG_HECHOS)
            tgt.commit()

        for db in empresas:
            empresa = db["empresa"]
            q = SQL_HECHOS.format(fecha_ini=desde, fecha_fin=hasta,
                                  sp_cod=SIN_PROVEEDOR_COD, sp_nom=SIN_PROVEEDOR_NOM)

            with pos_conn(env, db) as src:
                if dry_run:
                    with src.cursor() as c:
                        c.execute(f"SELECT count(*) FROM ({q}) s")
                        n = c.fetchone()[0]
                    log(f"[{empresa} {desde}..{hasta}] DRY-RUN: {n} filas agregadas en origen")
                    total += n
                    continue

                buf = io.StringIO()
                with src.cursor() as sc:
                    sc.copy_expert(f"COPY ({q}) TO STDOUT", buf)

            payload = buf.getvalue()
            src_hash = hashlib.sha1(payload.encode("utf-8")).hexdigest()

            with tgt.cursor() as tc:
                tc.execute("TRUNCATE stg_ventas_proveedor;")
                tc.copy_expert(
                    f"COPY stg_ventas_proveedor ({STG_HECHOS_COLS}) FROM STDIN",
                    io.StringIO(payload),
                )
            tgt.commit()

            for dia in daterange(desde, hasta):
                try:
                    with tgt.cursor() as tc:
                        tc.execute(
                            "SELECT count(*) FROM stg_ventas_proveedor WHERE fecha_dcto = %s",
                            (dia,),
                        )
                        n_dia = tc.fetchone()[0]

                        if n_dia == 0:
                            # NO SE BORRA NADA. Un dia vacio es un dia PENDIENTE, no un dia
                            # que quedo sin ventas: el POS pudo no haber cerrado, o la lectura
                            # pudo fallar de forma transitoria. Borrar aqui destruiria datos
                            # buenos ya cargados ante un problema pasajero, y seria ademas
                            # asimetrico con la guarda del catalogo ("ante duda, no escribir").
                            # Si de verdad se quiere dejar el dia vacio, existe --purge.
                            tc.execute(
                                f"SELECT count(*) FROM {TABLE_HECHOS} "
                                f"WHERE empresa = %s AND fecha_dcto = %s",
                                (empresa, dia),
                            )
                            ya_cargadas = tc.fetchone()[0]
                            tgt.commit()
                            vacios.append(f"{empresa}@{dia}")
                            if ya_cargadas:
                                log(f"[{empresa} {dia}] SIN VENTAS en el POS, pero el destino "
                                    f"ya tiene {ya_cargadas} filas -> SE CONSERVAN. "
                                    f"Usa --purge si de verdad quieres vaciar el dia.")
                            else:
                                log(f"[{empresa} {dia}] SIN VENTAS: 0 filas en el POS")
                            continue

                        load_id = insert_carga_header(tc, empresa, dia, src_hash, n_dia)

                        tc.execute(
                            f"DELETE FROM {TABLE_HECHOS} "
                            f"WHERE empresa = %s AND fecha_dcto = %s",
                            (empresa, dia),
                        )

                        # sede sale del mapa que vive en el DESTINO (no en el POS)
                        tc.execute(
                            f"""
                            INSERT INTO {TABLE_HECHOS} (
                                empresa, fecha_dcto, id_co, sede, id_cricla1, proveedor,
                                items, unidades, venta_base, impuestos, venta_con_impuesto,
                                descuentos, source_load_id
                            )
                            SELECT
                                %s, s.fecha_dcto, s.id_co, m.sede, s.id_cricla1, s.proveedor,
                                s.items, s.unidades, s.venta_base, s.impuestos, s.venta_con_impuesto,
                                s.descuentos, %s
                            FROM stg_ventas_proveedor s
                            LEFT JOIN {TABLE_SEDE_MAP} m
                                   ON m.empresa_norm = %s AND m.id_co_norm = s.id_co
                            WHERE s.fecha_dcto = %s;
                            """,
                            (empresa, load_id, empresa, dia),
                        )
                        n_ins = tc.rowcount

                    tgt.commit()
                    log(f"[{empresa} {dia}] cargadas {n_ins} filas (load_id={load_id})")
                    total += n_ins
                except Exception as e:  # noqa: BLE001
                    tgt.rollback()
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


# --------------------------------------------------------------------------- PURGE
def purgar(env: dict, empresas, desde: str, hasta: str) -> int:
    """Borra los hechos de un rango SIN recargar. Rollback manual explicito.

    Normalmente NO hace falta: recargar el rango ya reemplaza (DELETE+INSERT por dia).
    Esto es para cuando se quiere dejar el rango vacio a proposito.
    """
    borradas = 0
    with psycopg2.connect(**target_dsn(env)) as tgt:
        tgt.autocommit = False
        for db in empresas:
            empresa = db["empresa"]
            with tgt.cursor() as tc:
                tc.execute(
                    f"DELETE FROM {TABLE_HECHOS} "
                    f"WHERE empresa = %s AND fecha_dcto BETWEEN %s AND %s",
                    (empresa, desde, hasta),
                )
                n = tc.rowcount
            tgt.commit()
            borradas += n
            log(f"[purge {empresa} {desde}..{hasta}] {n} filas borradas")
    return borradas


# --------------------------------------------------------------------------- RECONCILIAR
def reconciliar(env: dict, empresas, desde: str, hasta: str) -> int:
    """Compara ventas_proveedor_dia contra ventas_item_diario en la misma ventana.

    Ambas salen de SUM(ven_netas) del mismo POS con el mismo filtro de devoluciones, asi
    que venta_con_impuesto tiene que calzar con venta_sin_impuesto_dia.

    SE COMPARA DIA A DIA, no solo el total: un total puede cuadrar compensando un dia de mas
    con otro de menos, y eso pasaria inadvertido.

    Sobre la tolerancia: etl_ventas_item.py hace INNER JOIN contra `items` y descarta las
    ventas de items ausentes del maestro, mientras este ETL usa LEFT JOIN y las conserva en
    '@SP'; en teoria el delta podria ser > 0. En la practica se midio 0 EXACTO en las tres
    empresas (no hay ventas de items fuera del maestro), asi que la tolerancia es estricta:
    cualquier diferencia distinta de cero se reporta. Poner 1% aqui seria ~1000x el delta
    real y taparia justo lo que este control debe detectar.

    Devuelve 0 si todo cuadra, 3 si hay algo que mirar.
    """
    peor = 0
    with psycopg2.connect(**target_dsn(env)) as tgt:
        for db in empresas:
            empresa = db["empresa"]
            with tgt.cursor() as tc:
                # FULL OUTER JOIN para que un dia presente en un solo lado NO se pierda:
                # saltarlo con un continue haria que el porcentaje se calculara sobre un
                # subconjunto y ocultaria exactamente el fallo que se busca.
                tc.execute(
                    f"""
                    WITH p AS (
                      SELECT fecha_dcto,
                             sum(venta_con_impuesto) AS prov,
                             sum(venta_base)         AS base,
                             sum(impuestos)          AS imp,
                             sum(venta_con_impuesto - venta_base - impuestos) AS descuadre
                        FROM {TABLE_HECHOS}
                       WHERE empresa = %s AND fecha_dcto BETWEEN %s AND %s
                       GROUP BY 1
                    ), i AS (
                      SELECT fecha_dcto, sum(venta_sin_impuesto_dia) AS item
                        FROM {TABLE_VENTAS_ITEM}
                       WHERE empresa = %s AND fecha_dcto BETWEEN %s AND %s
                       GROUP BY 1
                    )
                    SELECT COALESCE(p.fecha_dcto, i.fecha_dcto) AS fecha,
                           COALESCE(p.prov, 0), COALESCE(i.item, 0),
                           COALESCE(p.base, 0), COALESCE(p.imp, 0),
                           COALESCE(p.descuadre, 0),
                           (p.fecha_dcto IS NULL) AS falta_en_proveedor,
                           (i.fecha_dcto IS NULL) AS falta_en_item
                      FROM p FULL OUTER JOIN i ON i.fecha_dcto = p.fecha_dcto
                     ORDER BY 1
                    """,
                    (empresa, desde, hasta, empresa, desde, hasta),
                )
                filas = tc.fetchall()

            tot_p = sum(f[1] for f in filas)
            tot_i = sum(f[2] for f in filas)
            malos = []
            for fecha, prov, item, base, imp, descuadre, falta_p, falta_i in filas:
                if falta_p:
                    malos.append(f"{fecha}: falta en ventas_proveedor_dia (item={item:,.0f})")
                elif falta_i:
                    malos.append(f"{fecha}: falta en ventas_item_diario (prov={prov:,.0f})")
                elif prov != item:
                    malos.append(f"{fecha}: delta={prov - item:,.2f} "
                                 f"(prov={prov:,.0f} item={item:,.0f})")
                if abs(descuadre) > 0.005:
                    malos.append(f"{fecha}: base+impuestos no da venta_con_impuesto "
                                 f"(descuadre={descuadre:,.4f})")

            log(f"[reconciliar {empresa} {desde}..{hasta}] {len(filas)} dias comparados")
            log(f"    ventas_proveedor_dia.venta_con_impuesto  = {tot_p:,.0f}")
            log(f"    ventas_item_diario.venta_sin_impuesto_dia = {tot_i:,.0f}")
            log(f"    delta total = {tot_p - tot_i:,.2f}")
            if malos:
                peor = 3
                log(f"    AVISO: {len(malos)} dia(s) con diferencia:")
                for m in malos[:15]:
                    log(f"      - {m}")
                if len(malos) > 15:
                    log(f"      ... y {len(malos) - 15} mas")
            else:
                log(f"    OK: los {len(filas)} dias cuadran EXACTO y base+impuestos "
                    f"= venta_con_impuesto en todos")
    return peor


def main() -> int:
    ap = argparse.ArgumentParser(
        description="ETL de proveedores: POS(217) -> produXdia.ventas_proveedor_dia (232)"
    )
    ap.add_argument("--date", type=valid_date, help="un solo dia YYYYMMDD")
    ap.add_argument("--desde", type=valid_date, help="inicio del rango YYYYMMDD")
    ap.add_argument("--hasta", type=valid_date, help="fin del rango YYYYMMDD")
    ap.add_argument("--days", type=int, help="ultimos N dias terminando AYER (refresco)")
    ap.add_argument("--empresa", help="procesar una sola empresa (mercamio|mtodo|bogota)")
    ap.add_argument("--dry-run", action="store_true", help="solo cuenta filas en origen")
    ap.add_argument("--solo-catalogo", action="store_true", help="solo refresca el catalogo")
    ap.add_argument("--sin-catalogo", action="store_true", help="no toca el catalogo")
    ap.add_argument("--solo-inventario", action="store_true",
                    help="solo recalcula el inventario valorizado por proveedor")
    ap.add_argument("--sin-inventario", action="store_true", help="no toca el inventario")
    ap.add_argument("--reconciliar", action="store_true",
                    help="compara contra ventas_item_diario y sale")
    ap.add_argument("--purge", action="store_true",
                    help="borra los hechos del rango SIN recargar (rollback manual)")
    args = ap.parse_args()

    if args.date and (args.desde or args.hasta):
        log("ERROR: usa --date O (--desde/--hasta), no ambos"); return 2
    if bool(args.desde) ^ bool(args.hasta):
        log("ERROR: --desde y --hasta van juntos"); return 2
    if args.days is not None and (args.date or args.desde):
        log("ERROR: --days no se combina con --date ni --desde/--hasta"); return 2
    if args.days is not None and args.days < 1:
        log("ERROR: --days debe ser >= 1"); return 2
    if args.solo_catalogo and args.sin_catalogo:
        log("ERROR: --solo-catalogo y --sin-catalogo se excluyen"); return 2
    if args.solo_inventario and args.sin_inventario:
        log("ERROR: --solo-inventario y --sin-inventario se excluyen"); return 2
    if args.solo_catalogo and args.solo_inventario:
        log("ERROR: --solo-catalogo y --solo-inventario se excluyen"); return 2
    if args.purge and not (args.date or args.desde):
        log("ERROR: --purge exige --date o --desde/--hasta explicitos (no borra 'ayer' por defecto)")
        return 2

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

    # Tope duro: nunca escribir dias futuros. Es lo que dejo bloqueado al ETL viejo de
    # ventas x item (marco dias inexistentes como 'done' y el cursor salto de mes).
    hoy = datetime.date.today().strftime("%Y%m%d")
    if hasta >= hoy and not args.solo_catalogo:
        log(f"ERROR: --hasta={hasta} es hoy o futuro. El maximo es ayer ({ayer:%Y%m%d}).")
        return 2

    env = load_env(ENV_FILE)
    empresas = empresas_seleccionadas(args.empresa)

    log(f"=== ETL proveedores | [{desde}..{hasta}] | empresas={','.join(e['empresa'] for e in empresas)} "
        f"| dry_run={args.dry_run} ===")
    log(f"Origen POS: {env.get('DB_HOST_POS')}  ->  "
        f"Destino: {env.get('DB_HOST_LOCAL')}/{env.get('DB_NAME_LOCAL')}.ventas_proveedor_dia")

    try:
        if args.reconciliar:
            return reconciliar(env, empresas, desde, hasta)

        if args.purge:
            n = purgar(env, empresas, desde, hasta)
            log(f"=== Purge terminado | {n} filas borradas ===")
            return 0

        vacios_cat = []
        if not args.sin_catalogo and not args.solo_inventario:
            vacios_cat = cargar_catalogo(env, empresas, args.dry_run)
            # El puente item->proveedor va junto al catalogo: son la misma dimension leida
            # del POS, y el inventario no se puede calcular sin el.
            vacios_cat += cargar_puente(env, empresas, args.dry_run)

        total, vacios = (0, [])
        if not args.solo_catalogo and not args.solo_inventario:
            total, vacios = cargar_hechos(env, empresas, desde, hasta, args.dry_run)

        vacios_inv = []
        if not args.sin_inventario and not args.solo_catalogo:
            # El inventario NO toca el POS: se calcula dentro de la 232 cruzando
            # rotacion_base_item_dia_sede contra el puente.
            n_inv, vacios_inv = cargar_inventario(env, empresas, desde, hasta, args.dry_run)
            total += n_inv
        vacios = vacios + vacios_inv
    except Exception as e:  # noqa: BLE001
        log(f"ERROR: {e}")
        return 1

    avisos = vacios_cat + vacios
    if avisos:
        log(f"=== AVISO: {len(avisos)} caso(s) sin datos: {', '.join(avisos[:20])}"
            f"{' ...' if len(avisos) > 20 else ''}. Exit 3: revisar el POS y re-correr "
            f"antes del sync a GCP. ===")
        log(f"=== Terminado CON AVISOS | total filas: {total} ===")
        return 3

    log(f"=== Terminado OK | total filas: {total} ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
