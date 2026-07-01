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
| Varias tablas a la vez | `$SYNC --only ventas_cajas,ventas_fruver --days 3` |
| Rango fijo, todas las tablas | `$SYNC --desde 2026-06-01 --hasta 2026-06-24` |
| Primera carga `margen_final` (historico) | `$SYNC --margen-full --no-refresh --verify` |
| **Limpiar HUERFANAS** (el local perdio filas y GCP quedo con de mas) | `$SYNC --only asistencia_horas --desde 2026-06-01 --hasta 2026-06-30 --replace --no-refresh --verify` |
| **Probar sin escribir** (solo cuenta) | agrega `--dry-run` a cualquiera |

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

---

## 3. Codigos de salida

`0` OK · `3` WARNING (sin datos de ayer en tablas canary, exit normal del timer) ·
`1` ERROR · `2` uso invalido (flag/fecha mal escrita).

## 4. Ver estado de los timers / logs

```bash
systemctl list-timers 'visor-etl-*'
journalctl -u visor-etl-sync.service -n 80 --no-pager        # diario 7:50
journalctl -u visor-etl-reconcile.service -n 80 --no-pager   # domingos 16:00
journalctl -u visor-etl-margen.service -n 80 --no-pager      # margenes 7:15
```
(usa `sudo` si `prodapp` no ve el journal).

## 5. Reglas de oro

- Re-correr es **siempre seguro**: upsert no duplica; replace borra-ventana+reinserta.
- Sube/replica lo que la **local** ya tiene; no inventa datos faltantes.
- Manual = comando suelto, **no afecta los timers**.
- Duda con un rango grande? corre primero con `--dry-run`.
