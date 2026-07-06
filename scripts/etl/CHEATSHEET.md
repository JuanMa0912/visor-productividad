# Recetario ETL (una pagina)

Comandos listos para copiar. Detalle completo en
[`README-sync.md`](README-sync.md) (sync local->GCP) y
[`margen/README.md`](margen/README.md) (margenes POS->local).

> Todo corre en el server **192.168.35.232**, dentro de `/home/prodapp/visor-productividad`.
> Antes de cualquier cosa nueva: `cd /home/prodapp/visor-productividad && git pull`.
> Las corridas manuales **no tocan los timers**; son comandos sueltos.

---

## 1. Sync local -> GCP (`sync-local-to-gcp.sh`)

Prefijo comun:
```bash
SYNC="sudo -u prodapp bash /home/prodapp/visor-productividad/scripts/etl/sync-local-to-gcp.sh"
```

| Quiero... | Comando |
| --- | --- |
| Re-correr AYER (tras fallo/aviso) | `$SYNC --verify` |
| Un dia puntual (todas las tablas) | `$SYNC --date 2026-06-22` |
| Reconciliacion de N dias | `$SYNC --days 7` |
| **Una tabla, rango fijo** | `$SYNC --only ventas_item_diario --desde 2026-06-01 --hasta 2026-06-24 --no-refresh --verify` |
| Una tabla, un dia | `$SYNC --only ventas_cajas --date 2026-06-20` |
| Una tabla, ultimos N dias | `$SYNC --only asistencia_horas --days 7` |
| **Solo asistencia** (subir/corregir un rango; auto borra+inserta) | `$SYNC --only asistencia_horas --desde 2026-07-01 --hasta 2026-07-02 --no-refresh --verify` |
| Varias tablas a la vez | `$SYNC --only ventas_cajas,ventas_fruver --days 3` |
| Rango fijo, todas las tablas | `$SYNC --desde 2026-06-01 --hasta 2026-06-24` |
| Primera carga `margen_final` (historico) | `$SYNC --margen-full --no-refresh --verify` |
| **Limpiar HUERFANAS** en tabla upsert (local perdio filas) | `$SYNC --only ventas_cajas --desde 2026-06-01 --hasta 2026-06-30 --replace --no-refresh --verify` |
| **Probar sin escribir** (solo cuenta) | agrega `--dry-run` a cualquiera |

> **`asistencia_horas` y `margen_final` van SIEMPRE en modo replace** (borra-fechas-presentes-en-local + reinserta en cada sync): se auto-corrigen las huerfanas, **NO** necesitan `--replace`. El `--replace` manual es para las OTRAS tablas de upsert (`ventas_*`, `ventas_item_diario`, `rotacion_base_item_dia_sede`) cuando el local perdio filas.

Flags utiles: `--dry-run` (no escribe), `--verify` (fecha max por tabla),
`--no-refresh` (no refresca matview de rotacion), `--replace` (reemplaza las fechas
presentes en el local en vez de upsert; limpia huerfanas cuando el local perdio filas),
`--help`.

**Tablas validas** (allowlist; otra cosa aborta con error):
`ventas_cajas` `ventas_fruver` `ventas_carnes` `ventas_asadero` `ventas_pollo_pesc`
`ventas_industria` `rotacion_base_item_dia_sede` `asistencia_horas`
`ventas_item_diario` `margen_final`.

Receta tipica de backfill de UNA tabla (dry-run -> real):
```bash
$SYNC --only ventas_item_diario --desde 2026-06-01 --hasta 2026-06-24 --dry-run
$SYNC --only ventas_item_diario --desde 2026-06-01 --hasta 2026-06-24 --no-refresh --verify
```

---

## 2. Margenes POS -> local (`margen/cargar_margen.py`)

Carga `margen_final` en la **local (232)** desde las BD POS (217). NO sube a GCP
(eso lo hace el sync). Prefijo:
```bash
MARGEN="python3 /home/prodapp/visor-productividad/scripts/etl/margen/cargar_margen.py"
```

| Quiero... | Comando |
| --- | --- |
| Cargar AYER (default) | `$MARGEN` |
| Un dia puntual | `$MARGEN --date 20260623` |
| Un rango | `$MARGEN --desde 20260601 --hasta 20260623` |
| Probar sin escribir | agrega `--dry-run` |

> Ojo: aqui las fechas van **sin guiones** (`YYYYMMDD`), distinto al sync (`YYYY-MM-DD`).

Para llevar ese margen a GCP despues, usa el sync (seccion 1):
`$SYNC --only margen_final --desde 2026-06-01 --hasta 2026-06-23 --no-refresh --verify`
(requiere que `margen_final` exista en GCP).

> El tablero de margenes en GCP lee de la tabla `margen_final_roll` (rollup), NO del crudo.
> El sync ahora **refresca ese roll automaticamente para la ventana sincronizada** cuando toca
> `margen_final` (aunque venga `--no-refresh`, que solo aplica a la matview de rotacion). Para
> saltar el roll explicitamente: `--no-roll`. Sin el refresh el tablero mostraria datos viejos.

> **Reglas de negocio del ETL de margen** (detalle en [`margen/README.md`](margen/README.md)):
> (1) solo carga `id_tipo IN ('3','4')` — la categoria `V` se excluye; (2) la **linea 33**
> (bebidas alcoholicas: licores, cerveza, vino) carga el impoconsumo dentro de `vlrtot_bru`,
> asi que **entra a ventas Y margen**. Backfill del historico (una vez, local + GCP):
> `UPDATE margen_final SET vlrtot_bru = ven_totales WHERE TRIM(id_linea1)='33';` y luego
> `SELECT refresh_margen_final_roll();` en GCP.

---

## 3. Rotacion (base local -> GCP + sublinea)

El ETL que llena la base `rotacion_base_item_dia_sede` **NO esta en este repo**:
vive en `/opt/etl_rotacion/etl_rotacion_v3.py` (232, corre como `etlrotacion` via
`etl-rotacion.timer` 07:00). El sync (seccion 1) es el que la **sube a GCP**.

**Cargar la base LOCAL de fecha a fecha** (fechas SIN guiones, `YYYYMMDD`):
```bash
sudo -u etlrotacion /opt/etl_rotacion/.venv/bin/python /opt/etl_rotacion/etl_rotacion_v3.py \
  --mode backfill --date-start 20260701 --date-end 20260705 --log-dir /var/log/etl_rotacion
```
> `backfill` ~2.5 min por dia por empresa (recarga inventario del mes). `--dry-run` para probar.

**Subir ese rango a GCP** (fechas CON guiones, `YYYY-MM-DD`):
```bash
$SYNC --only rotacion_base_item_dia_sede --desde 2026-07-01 --hasta 2026-07-05 --replace --verify
```
El sync refresca solo el matview `rotacion_item_dia_clean` (**la "view"**, CONCURRENTLY,
sin downtime) y el snapshot `rotacion_item_periodo_std` (**el "general"** que lee el tablero
por defecto). El daily 07:50 es upsert; el reconcile dominical usa `--replace` (limpia huerfanas).

> **Sublinea (linea nivel 2):** ya viaja sola. Son columnas de la base
> (`id_linea_nivel_2` / `nombre_linea_nivel_2`) que el ETL 07:00 llena y el sync sube. El
> matview y el general se refrescan en cada sync. **Requisito UNA-SOLA-VEZ en GCP:** aplicar
> las 3 migraciones `20260705_rotacion_sublinea.sql` (base),
> `20260706_rotacion_clean_matview_sublinea.sql` (matview) y
> `20260707_rotacion_periodo_std_sublinea.sql` (snapshot + recrea la funcion
> `refresh_rotacion_item_periodo_std()`). **Sin la 20260707 el "general" sale con sublinea en
> NULL** aunque la base la tenga. Detalle en `db/migrations/`.

---

## 4. Codigos de salida

`0` OK · `3` WARNING (sin datos de ayer en tablas canary, exit normal del timer) ·
`1` ERROR · `2` uso invalido (flag/fecha mal escrita).

## 5. Ver estado de los timers / logs

```bash
systemctl list-timers 'visor-etl-*' 'etl-rotacion*'
journalctl -u visor-etl-sync.service -n 80 --no-pager        # diario 7:50 (sube todo a GCP)
journalctl -u visor-etl-reconcile.service -n 80 --no-pager   # domingos 16:00 (--replace)
journalctl -u visor-etl-margen.service -n 80 --no-pager      # margenes 7:15
journalctl -u etl-rotacion.service -n 80 --no-pager          # rotacion base local 7:00
```
(usa `sudo` si `prodapp` no ve el journal).

## 6. Reglas de oro

- Re-correr es **siempre seguro**: upsert no duplica; replace borra-ventana+reinserta.
- Sube/replica lo que la **local** ya tiene; no inventa datos faltantes.
- Manual = comando suelto, **no afecta los timers**.
- Duda con un rango grande? corre primero con `--dry-run`.
