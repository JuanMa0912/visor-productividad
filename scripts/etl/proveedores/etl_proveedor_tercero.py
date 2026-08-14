#!/usr/bin/env python3
"""
ETL de TERCEROS/PROVEEDORES comerciales: POS 217 -> produXdia.proveedor_tercero (232).

Origen: public.terceros en mercamio / mtodo / bogota.
Grano: (empresa, codigo, sucursal). Una sola tabla destino, no una por empresa.

NO es proveedor_pos_catalogo (criterios_itm_1 / etiqueta del item). Esta lista es
la comercial real (NIT + sucursal) que usa la OC (id_terc / id_suc_terc).

Default: solo ind_pro='1'. --todos carga cualquier tercero con codigo.
Upsert; los que salen del POS se marcan activo=false (no se borran).
Si el POS devuelve 0 filas para una empresa, no se toca esa empresa.

Config: el mismo .env.etl de la raiz del deploy.

Uso:
  python3 etl_proveedor_tercero.py
  python3 etl_proveedor_tercero.py --empresa mtodo
  python3 etl_proveedor_tercero.py --todos
  python3 etl_proveedor_tercero.py --dry-run

Codigos de salida: 0 OK | 1 error | 2 uso invalido | 3 warning (empresa vacia).
"""
from __future__ import annotations

import argparse
import datetime
import io
import os
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

TABLE = "public.proveedor_tercero"
NIT_CENTINELA = "99999999"

STG_COLS = (
    "codigo, sucursal, nombre, nit, nit_dv, tipo_tercero, tipo_identifica, "
    "ind_pro, ind_cli, ind_empl, estado, email, telefono, ciudad, direccion, "
    "establecimiento, pro_clase, pro_estado, pro_cond_pago, pro_contacto, "
    "fecha_creacion, fecha_ult_compra, compras_brutas, nro_compras"
)

SQL_TERCEROS = r"""
SELECT DISTINCT ON (
  BTRIM(codigo),
  COALESCE(NULLIF(BTRIM(sucursal), ''), '00')
)
  BTRIM(codigo)                                            AS codigo,
  COALESCE(NULLIF(BTRIM(sucursal), ''), '00')              AS sucursal,
  NULLIF(BTRIM(descripcion), '')                           AS nombre,
  NULLIF(NULLIF(BTRIM(nit), ''), '{nit_centinela}')        AS nit,
  NULLIF(BTRIM(nit_dv), '')                                AS nit_dv,
  NULLIF(BTRIM(tipo_tercero), '')                          AS tipo_tercero,
  NULLIF(BTRIM(tipo_identifica), '')                       AS tipo_identifica,
  NULLIF(BTRIM(ind_pro), '')                               AS ind_pro,
  NULLIF(BTRIM(ind_cli), '')                               AS ind_cli,
  NULLIF(BTRIM(ind_empl), '')                              AS ind_empl,
  NULLIF(BTRIM(estado), '')                                AS estado,
  NULLIF(BTRIM(email), '')                                 AS email,
  NULLIF(BTRIM(telefono_1), '')                            AS telefono,
  NULLIF(BTRIM(COALESCE(ciudad_tercero, ciudad_corresp)), '') AS ciudad,
  NULLIF(BTRIM(direccion_1), '')                           AS direccion,
  NULLIF(BTRIM(establecimiento), '')                       AS establecimiento,
  NULLIF(BTRIM(pro_clase), '')                             AS pro_clase,
  NULLIF(BTRIM(pro_estado), '')                            AS pro_estado,
  NULLIF(BTRIM(pro_cond_pago), '')                         AS pro_cond_pago,
  NULLIF(BTRIM(pro_contacto), '')                          AS pro_contacto,
  NULLIF(BTRIM(fecha_creacion), '')                        AS fecha_creacion,
  NULLIF(BTRIM(p_fec_ult_compra), '')                      AS fecha_ult_compra,
  p_compras_brutas                                         AS compras_brutas,
  CASE
    WHEN NULLIF(BTRIM(p_nro_compras), '') ~ '^[0-9]+$'
    THEN NULLIF(BTRIM(p_nro_compras), '')::integer
    ELSE NULL
  END                                                      AS nro_compras
FROM public.terceros
WHERE BTRIM(COALESCE(codigo, '')) <> ''
  {filtro_pro}
ORDER BY
  BTRIM(codigo),
  COALESCE(NULLIF(BTRIM(sucursal), ''), '00')
"""

DDL_STG = f"""
CREATE TEMP TABLE IF NOT EXISTS stg_proveedor_tercero (
  codigo text,
  sucursal text,
  nombre text,
  nit text,
  nit_dv text,
  tipo_tercero text,
  tipo_identifica text,
  ind_pro text,
  ind_cli text,
  ind_empl text,
  estado text,
  email text,
  telefono text,
  ciudad text,
  direccion text,
  establecimiento text,
  pro_clase text,
  pro_estado text,
  pro_cond_pago text,
  pro_contacto text,
  fecha_creacion text,
  fecha_ult_compra text,
  compras_brutas numeric(20, 2),
  nro_compras integer
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


def sql_terceros(todos: bool) -> str:
    filtro = "" if todos else "AND BTRIM(COALESCE(ind_pro, '')) = '1'"
    return SQL_TERCEROS.format(nit_centinela=NIT_CENTINELA, filtro_pro=filtro)


def cargar(env: dict, empresas, dry_run: bool, todos: bool) -> list[str]:
    vacios: list[str] = []
    q = sql_terceros(todos)
    modo = "TODOS los terceros" if todos else "solo ind_pro=1"
    tgt = None if dry_run else psycopg2.connect(**target_dsn(env))
    try:
        if tgt:
            tgt.autocommit = False
            with tgt.cursor() as c:
                c.execute(
                    "SELECT to_regclass(%s)",
                    ("public.proveedor_tercero",),
                )
                if c.fetchone()[0] is None:
                    log("ERROR: no existe public.proveedor_tercero. "
                        "Aplica db/migrations/20260813_proveedor_tercero.sql")
                    sys.exit(1)
                c.execute(DDL_STG)
            tgt.commit()

        for db in empresas:
            empresa = db["empresa"]
            with pos_conn(env, db) as src:
                if dry_run:
                    with src.cursor() as c:
                        c.execute(
                            f"""
                            SELECT count(*) AS n,
                                   count(nit) AS n_nit,
                                   count(*) FILTER (
                                     WHERE COALESCE(NULLIF(BTRIM(sucursal), ''), '00') <> '00'
                                   ) AS n_suc
                            FROM ({q}) s
                            """
                        )
                        n, n_nit, n_suc = c.fetchone()
                    log(f"[{empresa}] DRY-RUN ({modo}): {n} filas, {n_nit} con NIT, "
                        f"{n_suc} sucursal <> 00")
                    if n == 0:
                        vacios.append(empresa)
                    continue

                buf = io.StringIO()
                with src.cursor() as sc:
                    sc.copy_expert(f"COPY ({q}) TO STDOUT", buf)

            payload = buf.getvalue()
            if not payload.strip():
                vacios.append(empresa)
                log(f"[{empresa}] SIN FILAS en el POS -> no se toca proveedor_tercero")
                continue

            with tgt.cursor() as tc:
                tc.execute("TRUNCATE stg_proveedor_tercero;")
                tc.copy_expert(
                    f"COPY stg_proveedor_tercero ({STG_COLS}) FROM STDIN",
                    io.StringIO(payload),
                )
                tc.execute(
                    f"""
                    INSERT INTO {TABLE} (
                      empresa, codigo, sucursal, nombre, nit, nit_dv, tipo_tercero,
                      tipo_identifica, ind_pro, ind_cli, ind_empl, estado, email,
                      telefono, ciudad, direccion, establecimiento, pro_clase,
                      pro_estado, pro_cond_pago, pro_contacto, fecha_creacion,
                      fecha_ult_compra, compras_brutas, nro_compras, activo, updated_at
                    )
                    SELECT
                      %s, s.codigo, s.sucursal, s.nombre, s.nit, s.nit_dv, s.tipo_tercero,
                      s.tipo_identifica, s.ind_pro, s.ind_cli, s.ind_empl, s.estado,
                      s.email, s.telefono, s.ciudad, s.direccion, s.establecimiento,
                      s.pro_clase, s.pro_estado, s.pro_cond_pago, s.pro_contacto,
                      s.fecha_creacion, s.fecha_ult_compra, s.compras_brutas,
                      s.nro_compras, true, now()
                    FROM stg_proveedor_tercero s
                    ON CONFLICT (empresa, codigo, sucursal) DO UPDATE SET
                      nombre = EXCLUDED.nombre,
                      nit = EXCLUDED.nit,
                      nit_dv = EXCLUDED.nit_dv,
                      tipo_tercero = EXCLUDED.tipo_tercero,
                      tipo_identifica = EXCLUDED.tipo_identifica,
                      ind_pro = EXCLUDED.ind_pro,
                      ind_cli = EXCLUDED.ind_cli,
                      ind_empl = EXCLUDED.ind_empl,
                      estado = EXCLUDED.estado,
                      email = EXCLUDED.email,
                      telefono = EXCLUDED.telefono,
                      ciudad = EXCLUDED.ciudad,
                      direccion = EXCLUDED.direccion,
                      establecimiento = EXCLUDED.establecimiento,
                      pro_clase = EXCLUDED.pro_clase,
                      pro_estado = EXCLUDED.pro_estado,
                      pro_cond_pago = EXCLUDED.pro_cond_pago,
                      pro_contacto = EXCLUDED.pro_contacto,
                      fecha_creacion = EXCLUDED.fecha_creacion,
                      fecha_ult_compra = EXCLUDED.fecha_ult_compra,
                      compras_brutas = EXCLUDED.compras_brutas,
                      nro_compras = EXCLUDED.nro_compras,
                      activo = true,
                      updated_at = now();
                    """,
                    (empresa,),
                )
                n_up = tc.rowcount
                tc.execute(
                    f"""
                    UPDATE {TABLE} c
                       SET activo = false, updated_at = now()
                     WHERE c.empresa = %s
                       AND c.activo
                       AND NOT EXISTS (
                         SELECT 1
                         FROM stg_proveedor_tercero s
                         WHERE s.codigo = c.codigo
                           AND s.sucursal = c.sucursal
                       );
                    """,
                    (empresa,),
                )
                n_off = tc.rowcount
                tc.execute(
                    f"""
                    SELECT count(*), count(nit)
                    FROM {TABLE}
                    WHERE empresa = %s AND activo
                    """,
                    (empresa,),
                )
                n_act, n_nit = tc.fetchone()
            tgt.commit()
            log(f"[{empresa}] {n_up} upsert, {n_off} inactivos, "
                f"{n_act} activos ({n_nit} con NIT)")
        return vacios
    except Exception:
        if tgt:
            tgt.rollback()
        raise
    finally:
        if tgt:
            tgt.close()


def main() -> int:
    ap = argparse.ArgumentParser(
        description="ETL terceros/proveedores: POS(217) -> produXdia.proveedor_tercero"
    )
    ap.add_argument("--empresa", help="una sola empresa (mercamio|mtodo|bogota)")
    ap.add_argument("--todos", action="store_true",
                    help="cargar todos los terceros, no solo ind_pro=1")
    ap.add_argument("--dry-run", action="store_true", help="solo cuenta en origen")
    args = ap.parse_args()

    env = load_env(ENV_FILE)
    empresas = empresas_seleccionadas(args.empresa)
    modo = "todos" if args.todos else "ind_pro=1"
    log(f"=== ETL proveedor_tercero | {modo} | "
        f"empresas={','.join(e['empresa'] for e in empresas)} "
        f"| dry_run={args.dry_run} ===")
    log(f"Origen POS: {env.get('DB_HOST_POS')} -> "
        f"{env.get('DB_HOST_LOCAL')}/{env.get('DB_NAME_LOCAL')}.proveedor_tercero")

    try:
        vacios = cargar(env, empresas, args.dry_run, args.todos)
    except Exception as exc:
        log(f"ERROR: {exc}")
        return 1

    if vacios:
        log(f"AVISO: sin filas en {', '.join(vacios)}")
        return 3
    log("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
