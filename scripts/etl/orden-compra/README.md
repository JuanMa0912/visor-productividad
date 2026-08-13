# ETL de ordenes de compra (POS 217 -> produXdia 232 -> GCP)

Alimenta el tablero de OC. Carga **una** tabla en `produXdia` (232):

| Tabla | Grano | Como se carga |
|---|---|---|
| `orden_compra` | cabecera: empresa + co + tipdoc + documento_oc | incremental UPSERT por dia de `fecha_dcto` |

Migracion: [`db/migrations/20260813_orden_compra.sql`](../../../db/migrations/20260813_orden_compra.sql).

Origen POS: `cmmovimiento_ocompra` (tipos `OC` `FR` `OM` `OS`). Confirmacion del
sistema = `usuario_conf` / `fecha_conf` / `hora_conf`. Recepcion = `cantidad` vs
`cantidad_ent` y `ind_estado` (`1` CONFIRMADO, `2` CUMPLIDO).

## Carga incremental (default)

Dos pasos, sin reescribir el historico cumplido:

1. **Dias nuevos.** Si ya estan el 1..12, el timer lee `fecha_dcto` del 13 y UPSERT.
2. **Abiertas.** Relee del POS las OC ya en dest con `ind_estado <> 2` (PENDIENTE /
   CONFIRMADO) para actualizar `cantidad_ent` y estado. Las CUMPLIDO no se tocan.
   No descubre OC historicas que nunca se cargaron.

Por empresa: el historico cerrado es `max(fecha_dcto) < ayer`. Dias nuevos =
`BETWEEN siguiente AND ayer`. Abiertas = claves locales incompletas con
`fecha_dcto < siguiente` (las del dia recien cargado ya van en el paso 1).

Si la tabla esta vacia, hay que hacer una carga inicial (`--mes-actual` /
`--desde`). La primera carga fue `--mes-actual` (agosto 2026).

No se traen CONFIRMADO historicas sin limite: el scan completo del POS no termina
en tiempo razonable. Si el POS de una empresa no tiene la tabla, se salta.

## SLA de 7 dias

No se persiste. El tablero calcula `fecha_dcto + 7`. `fecha_entrega` viaja porque es
la promesa real del POS (en fruver suele ser +1/+2, no +7).

## Programacion

| Unidad | Cuando | Que hace |
|---|---|---|
| `visor-etl-orden-compra.timer` | **todos los dias 08:00** | `--incremental` (dias + abiertas) + `$SYNC --only orden_compra --no-refresh` |

A las 08:00, **despues** del sync general 07:50, para no competir por el POS ni
por GCP. `visor-etl-sync` (07:50) **no** incluye `orden_compra`. Este timer sube
solo OC (`--only`), upsert de **toda** la tabla local (incluye incompletas viejas
ya refrescadas), sin refrescar matviews.

Si el timer falla un dia, la corrida siguiente cubre el hueco (`siguiente..ayer`).

Cadena:

| hora | proceso |
|---|---|
| 07:50 | `visor-etl-sync` (resto de tablas) |
| **08:00** | **este ETL + sync solo `orden_compra`** |

## Uso manual

```bash
cd /home/prodapp/visor-productividad

python3 scripts/etl/orden-compra/etl_orden_compra.py              # incremental (dias + abiertas)
python3 scripts/etl/orden-compra/etl_orden_compra.py --solo-abiertas
python3 scripts/etl/orden-compra/etl_orden_compra.py --no-abiertas
python3 scripts/etl/orden-compra/etl_orden_compra.py --mes-actual
python3 scripts/etl/orden-compra/etl_orden_compra.py --desde 20260801 --hasta 20260831
python3 scripts/etl/orden-compra/etl_orden_compra.py --dias 30
python3 scripts/etl/orden-compra/etl_orden_compra.py --reemplazar --desde 20260801 --hasta 20260812
python3 scripts/etl/orden-compra/etl_orden_compra.py --empresa mercamio
python3 scripts/etl/orden-compra/etl_orden_compra.py --dry-run
```

Subir a GCP despues de una carga manual (y de aplicar la migracion en GCP):

```bash
bash scripts/etl/sync-local-to-gcp.sh --only orden_compra --no-refresh --verify
```

`--only orden_compra` es obligatorio: sin eso `sync-local-to-gcp.sh` es el diario
de **todas** las tablas y ademas omite OC. Con `--only` hace upsert de toda la
tabla local (sin borrar GCP). Si el local esta vacio, no toca GCP.

## Codigos de salida

| Codigo | Significado |
|---|---|
| 0 | OK |
| 1 | error |
| 2 | uso invalido |
| **3** | **warning: alguna empresa sin filas o sin tabla OC** |

El exit 3 **no** esta como `SuccessExitStatus`: systemd marca `failed` y se ve en
`systemctl --failed`.

## Config

Mismo `.env.etl` de la raiz del deploy.

- Destino (232): `DB_HOST_LOCAL`, `DB_PORT_LOCAL`, `DB_NAME_LOCAL`, `DB_USER_LOCAL`, `DB_PASSWORD_LOCAL`
- Origen POS (217): `DB_HOST_POS`, `DB_PORT_POS`, `DB_PWD_POS_MERCAMIO`, `DB_PWD_POS_MTODO`, `DB_PWD_POS_BOGOTA`

Override de la ruta con `ETL_ENV_FILE`.

## Instalacion del timer (232)

```bash
cd /home/prodapp/visor-productividad
sudo cp deploy/systemd/visor-etl-orden-compra.service \
       deploy/systemd/visor-etl-orden-compra.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now visor-etl-orden-compra.timer
```

## Primera carga (232 + GCP)

```bash
# 232
cd /home/prodapp/visor-productividad
psql -h 127.0.0.1 -U postgres -d produXdia -v ON_ERROR_STOP=1 \
  -f db/migrations/20260813_orden_compra.sql
python3 scripts/etl/orden-compra/etl_orden_compra.py --dry-run
python3 scripts/etl/orden-compra/etl_orden_compra.py

# GCP (en el app-server de la nube, o psql contra Cloud SQL)
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260813_orden_compra.sql

# subir snapshot
sudo -u prodapp bash scripts/etl/sync-local-to-gcp.sh --only orden_compra --verify
```
