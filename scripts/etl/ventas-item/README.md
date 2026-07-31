# ETL ventas x item (POS 217 -> produXdia.ventas_item_diario en la 232)

Reemplaza al script `ETL_ventasXitem_Masive_load.py` que corria en un PC Windows
con tarea programada a las 07:00. Ahora es un pipeline de la 232, igual que
`visor-etl-margen`.

## Programacion

| Unidad | Cuando | Que hace |
|---|---|---|
| `visor-etl-ventas-item.timer` | **Lun-Vie 07:09** | carga **ayer** |
| `visor-etl-ventas-item-reconcile.timer` | **Sab y Dom 07:09** | `--days 7`: recarga los ultimos 7 dias |

Las 07:09 caen despues del ETL de margenes (07:07) y **antes** del sync a GCP
(07:35), asi lo que se carga sube el mismo dia.

Cadena completa de la mañana (2026-07-31):

| hora | proceso | dura |
|---|---|---|
| 07:00 | `etl-rotacion@{mercamio,mtodo,bogota}` en paralelo | ~30 min |
| 07:00 | `ventas-pipeline-daily` | ~6 min |
| 07:07 | `visor-etl-margen` | ~1 min |
| 07:09 | **este ETL** | ~1,5 min |
| 07:35 | `visor-etl-sync` (`--days 3`) | ~31 min |
| **~08:05** | **informacion lista en GCP** | |

El refresco de fin de semana existe para dos cosas: recuperar dias que quedaron
`empty` porque el POS llego tarde, y recalcular `und_acum` si algun dia
intermedio cambio. Como el ETL **borra y reescribe** por `(empresa, fecha)`,
re-correr nunca duplica.

Cobertura: el sabado recarga `[sab-7..vie]` y el domingo `[dom-7..sab]`, asi que
sabado y domingo quedan cubiertos sin que el diario corra esos dias.

## Uso manual

```bash
cd /home/prodapp/visor-productividad
python3 scripts/etl/ventas-item/etl_ventas_item.py                       # ayer
python3 scripts/etl/ventas-item/etl_ventas_item.py --days 7              # refresco 7 dias
python3 scripts/etl/ventas-item/etl_ventas_item.py --date 20260729       # un dia
python3 scripts/etl/ventas-item/etl_ventas_item.py --desde 20260701 --hasta 20260729
python3 scripts/etl/ventas-item/etl_ventas_item.py --dry-run             # solo cuenta
```

Despues de una carga manual, subir a GCP:

```bash
bash scripts/etl/sync-local-to-gcp.sh --only ventas_item_diario --date 2026-07-29 --verify
```

## Codigos de salida

| Codigo | Significado |
|---|---|
| 0 | OK |
| 1 | error |
| 2 | uso invalido |
| **3** | **warning: alguna empresa/dia cargo 0 filas** |

El exit 3 **no** esta declarado como `SuccessExitStatus` en el `.service`, a
proposito: asi systemd marca la unidad `failed` y el problema se ve en
`systemctl --failed`. Un dia sin ventas pasando callado fue justo lo que dejo
`ventas_item_diario` atrasada sin que nadie se enterara.

## Config

Usa el `.env.etl` unico de la raiz del deploy, el mismo de `sync-local-to-gcp.sh`
y `cargar_margen.py`. No hay contraseñas en el codigo.

- Destino (232): `DB_HOST_LOCAL`, `DB_PORT_LOCAL`, `DB_NAME_LOCAL`, `DB_USER_LOCAL`, `DB_PASSWORD_LOCAL`
- Origen POS (217): `DB_HOST_POS`, `DB_PORT_POS`, `DB_PWD_POS_MERCAMIO`, `DB_PWD_POS_MTODO`, `DB_PWD_POS_BOGOTA`

Override de la ruta con `ETL_ENV_FILE`.

## Que cambio respecto al script viejo, y por que

### 1. La fecha la manda el calendario, no un cursor en la BD

El viejo calculaba el dia con
`get_last_loaded_day() = MAX(fecha_dcto) WHERE status='done'`. El cargue
historico del 2026-07-29 marco como `done` con 0 filas los dias **20260730 y
20260731**, que ni siquiera existian todavia. A partir de ahi el incremental
calculaba `start_day = 20260801` y concluia *"nada nuevo"*: quedo bloqueado
hasta agosto. **Esa fue la causa real del atraso**, no que el PC estuviera
apagado.

Aqui el rango sale de la fecha de corrida. Ademas hay un tope duro: si
`--hasta` es hoy o futuro, el script sale con codigo 2 sin escribir nada.

### 2. Un dia vacio no es un dia cargado

El viejo hacia `mark_control_day(status='done')` aunque el POS devolviera cero
filas, asi que el pase de reparacion nunca lo reintentaba. Aqui un dia sin filas
queda `status='empty'` y dispara el exit 3.

### 3. Acumulados correctos

`und_acum` y `venta_sin_impuesto_acum` son acumulados **del mes**. El viejo los
calculaba con una ventana sobre el rango consultado, y en modo diario ese rango
era **un solo dia**, con lo cual `und_acum == und_dia` siempre. Verificado: el
20260729 quedo con las 32.460 filas con `acum == dia`, mientras los dias 25-28
si acumulaban porque el cargue historico mensual los habia reescrito.

La consulta nueva arranca **siempre el 1 del mes** y particiona la ventana por
mes:

```sql
SUM(und_dia) OVER (
  PARTITION BY id_co, id_item, LEFT(fecha_dcto, 6)
  ORDER BY fecha_dcto
)
```

Luego inserta solo los dias objetivo. Asi el acumulado es correcto tambien
cuando el rango cruza de mes.

La app lee esta columna en el detalle de `/api/ventas-x-item/v2`
(en el resumen la fuerza a 0).

### 4. El padding de `descripcion` y `linea` se conserva a proposito

`cmlineas_descripcion` es CHAR en SIESA, asi que `linea` llega con espacios al
final. De las 7.260.700 filas de la tabla, **6.660.797 tienen padding**.

La tentacion es trimarlo en el ETL. **No se debe**, y esta comprobado en vivo:
`linea` forma parte del indice unico natural que usa el `ON CONFLICT` del sync a
GCP. Si el ETL trima y GCP tiene la version con padding, la clave no calza y el
upsert **inserta en vez de actualizar**. El 2026-07-30 eso dejo el dia 20260729
con **62.475 filas en GCP** (30.015 viejas con padding + 32.460 nuevas sin el)
hasta que se corrigio con `--replace`.

Normalizar el padding **si es viable**: se verifico que hay **0 colisiones** en
el indice unico si se trima toda la tabla. Pero es una migracion de 6.6M filas
en local **y** en GCP, y hay que hacerla coordinada (primero las dos bases, y
solo despues activar el trim en el ETL). Queda como mantenimiento aparte.

Chequeo de colisiones, por si se retoma:

```sql
SELECT COUNT(*) FROM (
  SELECT fecha_dcto, COALESCE(empresa_norm,empresa), COALESCE(id_co_norm,id_co),
         id_item, BTRIM(linea)
  FROM ventas_item_diario GROUP BY 1,2,3,4,5 HAVING COUNT(*) > 1
) x;   -- debe dar 0
```

`id_co` e `id_item` si vienen limpios de origen (0 filas con padding), por eso
el ETL les aplica `BTRIM` sin riesgo: es un no-op defensivo.

### 5. Se elimino la salida a `\\192.168.35.236\proyectos\Ventas_x_Item`

Ya era codigo muerto: el bloque que generaba el CSV mensual estaba comentado
completo en el script viejo.

## GCP

No hay nada que cambiar. `sync-local-to-gcp.sh` ya trae `ventas_item_diario` en
la allowlist con el manejo correcto: excluye el serial `id` y la FK
`source_load_id`, y hace `ON CONFLICT` sobre el indice unico natural
`(fecha_dcto, COALESCE(empresa_norm, empresa), COALESCE(id_co_norm, id_co), id_item, linea)`.

Un detalle a tener presente: el sync diario sube una ventana corta. Si el
refresco de fin de semana corrige `und_acum` de dias anteriores, esos cambios
solo viajan a GCP si la ventana del sync los cubre. El
`visor-etl-reconcile` de los domingos (`--days 7 --replace`) los alcanza.

## Instalacion de las unidades

```bash
sudo cp /home/prodapp/visor-productividad/deploy/systemd/visor-etl-ventas-item.service \
        /home/prodapp/visor-productividad/deploy/systemd/visor-etl-ventas-item.timer \
        /home/prodapp/visor-productividad/deploy/systemd/visor-etl-ventas-item-reconcile.service \
        /home/prodapp/visor-productividad/deploy/systemd/visor-etl-ventas-item-reconcile.timer \
        /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now visor-etl-ventas-item.timer
sudo systemctl enable --now visor-etl-ventas-item-reconcile.timer
systemctl list-timers 'visor-etl-ventas-item*' --all
```

**Importante:** al activar esto hay que **desactivar la tarea programada del PC
Windows**, o las dos van a escribir sobre la misma tabla.
