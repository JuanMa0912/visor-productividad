# ETL de margenes (`cargar_margen.py`)

Carga el "movimiento unificado" (margen por linea de factura) desde las BD POS de
origen (**192.168.35.217**: mercamio / mtodo / bogota) a **`produXdia.margen_final`**
(192.168.35.232). Basado en `consulta_Movimiento_bd.py`.

- **Estrategia:** por cada empresa y dia → `DELETE (fecha_dcto, empresa)` + **COPY
  postgres->postgres** (formato texto, NULL-safe). Idempotente: re-correr no duplica.
- Solo carga a la BD local (232). La subida a GCP la hace `sync-local-to-gcp.sh`
  (`--margen-full` la primera vez o cuando hay backfill; luego el sync diario con ventana).
- Corre en el server (232) con `python3` del sistema (tiene `psycopg2-binary`; no hay venv).

## Reglas de negocio (que carga y como)

Dos ajustes clave viven en el `SQL_TEMPLATE` de `cargar_margen.py`:

**1. Solo categorias 3 y 4 (mercado).** Filtra `WHERE i.id_tipo IN ('3','4')`. La categoria
`id_tipo = 'V'` NO se carga (desde 2026-07-06). Para limpiar V historica:
```sql
DELETE FROM margen_final WHERE id_tipo = 'V';        -- local (232) Y GCP
DELETE FROM margen_final_roll WHERE id_tipo = 'V';   -- solo GCP (el roll)
```

**2. Impoconsumo en BEBIDAS ALCOHOLICAS (linea 33 = licores, cerveza, vino).** Desde
2026-07-06, el bruto cargado (`vlrtot_bru`) de la linea `33` YA incluye el impoconsumo
(`vlrimpcon1`) → **entra a ventas Y margen** (el tablero calcula ambos sobre `vlrtot_bru`).
El resto de lineas queda igual. `ven_totales` sigue usando el bruto ORIGINAL, asi que **no se
duplica** el impoconsumo.
- El impoconsumo vive en `cmmovimiento_pdv.vlrimpcon1` del POS (217). La tabla `impuestos` lo
  marca con `id_ind_impocon = 1` (codigos `A` = IVA 5% + IMPOCONSUMO, `C` = IVA 19% + IMPOCONSUMO).
- **Backfill del historico** (una vez; idempotente porque en `margen_final` ya esta guardado
  `ven_totales` = bruto_original + impoconsumo):
  ```sql
  -- en local (232) Y en GCP:
  UPDATE margen_final SET vlrtot_bru = ven_totales WHERE TRIM(id_linea1) = '33';
  -- luego refrescar el roll en GCP (full):
  SELECT refresh_margen_final_roll();
  ```

## Config

Usa el **mismo `.env.etl`** que el sync (no tiene su propio archivo). Necesita:
- Destino: `DB_HOST_LOCAL / DB_PORT_LOCAL / DB_NAME_LOCAL / DB_USER_LOCAL / DB_PASSWORD_LOCAL`
  (= produXdia 232; ya estaban para el sync).
- Origen POS: `DB_HOST_POS / DB_PORT_POS / DB_PWD_POS_MERCAMIO / DB_PWD_POS_MTODO / DB_PWD_POS_BOGOTA`.

Ver `scripts/etl/env.etl.example`. La ruta del `.env.etl` se puede sobreescribir con
`ETL_ENV_FILE=/ruta/.env.etl`.

## Uso manual

```bash
cd /home/prodapp/visor-productividad
python3 scripts/etl/margen/cargar_margen.py                       # ayer
python3 scripts/etl/margen/cargar_margen.py --date 20260623       # un dia
python3 scripts/etl/margen/cargar_margen.py --desde 20260601 --hasta 20260623  # rango
python3 scripts/etl/margen/cargar_margen.py --date 20260623 --dry-run          # solo cuenta
```

Codigos de salida: `0` OK | `1` error | `2` uso invalido.

## Programacion (systemd)

Units en `deploy/systemd/`: `visor-etl-margen.{service,timer}` → **todos los dias 07:15**,
carga el dia anterior.

```bash
cd /home/prodapp/visor-productividad
sudo cp deploy/systemd/visor-etl-margen.service deploy/systemd/visor-etl-margen.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now visor-etl-margen.timer

systemctl list-timers 'visor-etl-*'
journalctl -u visor-etl-margen.service -n 80 --no-pager   # (con sudo si no ves nada)
sudo systemctl start visor-etl-margen.service             # correrlo a mano sin esperar
```

## Rollup del tablero (`margen_final_roll`)

El tablero (`/api/margenes/data`) lee de `margen_final_roll` (rollup factura+item), **no** del
crudo. Vive **solo en GCP** (Cloud SQL); en la local 232 no existe y el tablero de ahi lee
directo `margen_final`.

> **Legacy eliminado (2026-07-06):** antes existia un camino viejo `margenes_linea_co_dia`
> (tabla) + su matview `margenes_linea_co_dia_clean`, leido por el endpoint viejo `/api/margenes`
> (`route.ts`). Estaba **congelado** (datos hasta feb-2026) y ya nadie lo usaba: el tablero vivo
> usa `/api/margenes/data` + `/api/margenes/meta`. Se **dropearon** esas tablas (local+GCP) y se
> **borraron** el endpoint viejo + `scripts/refresh-margenes-matview.sh` + sus units
> `deploy/systemd/visor-refresh-margenes.*`. La migracion `20260612_margenes_clean_matview.sql`
> queda como historica (tiene guard: solo crea el matview si existe la tabla legacy).

**Refresh automatico:** el `sync-local-to-gcp.sh` (07:50) ya refresca el roll en GCP **por la
ventana sincronizada** cada vez que sube `margen_final` (ver [`../README-sync.md`](../README-sync.md)).
En operacion normal **no hay que refrescarlo a mano**.

**Refresh manual (fallback / backfill puntual)** en la VM app-server de GCP como `visor`:

```bash
cd /opt/visor-productividad
# una sola vez: aplicar las migraciones del rollup en GCP
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260702_margen_final_roll.sql
sudo -u visor node scripts/apply-migration-file.mjs db/migrations/20260703_margen_final_roll_refresh_chunks.sql
# refrescar un rango puntual:
sudo -u visor bash -c 'MARGEN_ROLL_FROM=20260615 MARGEN_ROLL_TO=20260615 npm run margen:refresh-roll'
```

Sin rollup poblado, el tablero cae a leer `margen_final` (mas lento). Tras refrescar, la app viva
puede seguir mostrando datos viejos hasta ~5 min (cache en memoria) o hasta reiniciar `visor.service`.

## CSV (desactivado)

El `consulta_Movimiento_bd.py` original genera CSVs a `\\192.168.35.236\...\
Analisis_Margen_Facturas_Diarias\YYYY\mes\` (diario unificado + rango mes-a-fecha por
sede). Este cargador **no** los genera; solo carga a la BD. Si en el futuro se quiere
volver a generar el CSV ademas de cargar, se agrega un paso que escriba el resultado del
COPY a un archivo (reusando `build_query`) antes del INSERT.
