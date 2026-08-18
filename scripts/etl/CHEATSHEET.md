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
`ventas_item_diario` `ventas_proveedor_dia` `inventario_proveedor_dia`
`proveedor_pos_catalogo` `proveedor_item` `proveedor_tercero` `orden_compra` `orden_compra_linea` `margen_final`.

Receta tipica de backfill de UNA tabla (dry-run -> real):
```bash
$SYNC --only ventas_item_diario --desde 2026-06-01 --hasta 2026-06-24 --dry-run
$SYNC --only ventas_item_diario --desde 2026-06-01 --hasta 2026-06-24 --no-refresh --verify
```

---

## 1.b Ordenes de compra POS -> local -> GCP

Carga `orden_compra` (cabecera) y `orden_compra_linea` (item + tercero real) en
la **local (232)** desde el POS (217). El diario 07:50 **no** las toca; las sube
el timer 08:00 con `--only orden_compra --only orden_compra_linea`
(upsert por `fecha_dcto`, no recopia todas las tablas). Prefijo:
```bash
OC="python3 /home/prodapp/visor-productividad/scripts/etl/orden-compra/etl_orden_compra.py"
```

| Quiero... | Comando |
| --- | --- |
| Incremental (dias nuevos + abiertas) | `$OC` o `$OC --incremental` |
| Solo refrescar incompletas | `$OC --solo-abiertas` |
| Incremental sin abiertas | `$OC --no-abiertas` |
| Solo el mes en curso | `$OC --mes-actual` |
| Rango fijo | `$OC --desde 20260801 --hasta 20260831` |
| Ventana N dias (upsert, no borra el resto) | `$OC --dias 30` |
| Rehacer un rango sucio | `$OC --reemplazar --desde 20260801 --hasta 20260812` |
| Una empresa | `$OC --empresa mercamio` |
| Probar sin escribir | `$OC --dry-run` |
| Subir a GCP (solo OC, tablas locales) | `$SYNC --only orden_compra --only orden_compra_linea --no-refresh --verify` |

Detalle: [`orden-compra/README.md`](orden-compra/README.md). Timer
`visor-etl-orden-compra` **todos los dias 08:00** (`run-daily.sh`: incremental + sync GCP).
El SLA de 7 dias **no** se persiste: el tablero calcula `fecha_dcto + 7`.

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

> El tablero de margenes en GCP lee de `margen_final_roll` y `/informe-variacion` de
> `margen_item_dia_roll`. El sync refresca **ambos** rolls para la ventana sincronizada cuando
> toca `margen_final` (aunque venga `--no-refresh`, que solo aplica a la matview de rotacion).
> Para saltarlos: `--no-roll`. Sin el refresh la UI mostraria datos viejos.
> Ademas, en app-server: `visor-refresh-variacion.timer` (08:15) hace rebuild completo
> (ver `deploy/CHEATSHEET.md`).

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

## 3.a Salidas de inventario + kits + codigo de barras (`rotacion-dim`)

**Que arregla:** el DIC de `/rotacion` dividia inventario entre la venta del POS, y eso deja
fuera el documento **`EK` = ENSAMBLE DE KIT** — el consumo del hijo cuando se vende un
multipack, arroba o reempaque. El POS cobra en el codigo PADRE y descuenta el inventario del
HIJO, y esa salida no viaja por `cmmovimiento_pdv`. Resultado: el hijo salia con DIC absurdo
(hasta 38.180 dias) y el padre salia "Agotado" mientras vendia.

```bash
ROTDIM="python3 /home/prodapp/visor-productividad/scripts/etl/rotacion-dim/etl_rotacion_dim.py"
```

| Quiero... | Comando |
| --- | --- |
| Diario (catalogos + salidas de AYER) | `$ROTDIM` |
| Solo salidas de un dia | `$ROTDIM --mode salidas --date 20260813` |
| Backfill de salidas | `$ROTDIM --mode salidas --desde 20260701 --hasta 20260813` |
| Solo catalogos (kits + codbar) | `$ROTDIM --mode dim` |
| Probar sin escribir | agrega `--dry-run` |
| Una empresa | `--empresas mercamio` |

> Fechas **sin guiones** (`YYYYMMDD`), igual que el ETL de margen.
> Cuesta **~19 s por dia por empresa** (~1 min/dia las tres): un backfill de 30 dias son
> ~30 min. Lanzalo fuera de horario. Idempotente: reemplaza por (empresa, dia).

Subirlo a GCP (fechas **con** guiones):
```bash
$SYNC --only rotacion_salidas_dia --desde 2026-07-01 --hasta 2026-08-13 --verify
$SYNC --only rotacion_kit_composicion,rotacion_item_codbar    # catalogos, sin fecha
```

**Orden obligatorio al instalar** (si se invierte, el snapshot aborta y el tablero se queda
sirviendo el periodo anterior):
1. `db/migrations/20260814_rotacion_salidas_kits_codbar.sql` en **232 y GCP**.
2. Correr `$ROTDIM --mode dim` y el backfill de salidas de la ventana del snapshot.
3. Subir a GCP con el `$SYNC` de arriba.
4. `db/migrations/20260814_rotacion_periodo_std_demanda.sql` en **GCP**.

**Comprobar que quedo bien** (si `uds_equivalentes` sale todo en 0, el snapshot se refresco
sin las salidas: revisa el paso 3):
```sql
SELECT count(*) FILTER (WHERE uds_equivalentes > 0) AS filas_con_kit,
       ROUND(MAX(uds_equivalentes),0) AS max_uds
FROM rotacion_item_periodo_std;
```

> **El sync ahora sale con WARN si el snapshot no se refresca.** Antes solo logueaba: un
> snapshot que no se actualiza no falla nada, sirve el periodo anterior y pasa desapercibido.

**Lo que NO entra al denominador del DIC** (siguen guardados en la tabla, cambiar el criterio
es editar la funcion sin re-ETL): `ST`/`TB` traslados (la demanda es de otra sede),
`FS`/`Na`/`FN` averias, y `AA`/`AJ`/`IF` que son **ajustes contables, no mercancia**. La
entrada real es `EA` (y `EF` en fruver).

---

## 3.b Ventas por linea de negocio (`/opt/ventas_pipeline`) — **el otro ETL**

**Hay DOS sistemas de ETL en la 232, no uno.** Este NO esta en el repo y carga
**6 de las 13 tablas** que el sync sube a GCP:

`ventas_cajas` · `ventas_fruver` · `ventas_carnes` · `ventas_asadero` ·
`ventas_pollo_pesc` · `ventas_industria`

Vive en `/opt/ventas_pipeline` (codigo de `root`, hace falta `sudo` para editarlo),
con sus propios timers: `ventas-pipeline-daily` (07:00) y `ventas-pipeline-monthly`
(14:00, solo dias concretos).

**Backfill de un rango.** El orquestador **no tiene** modo backfill (solo
`--mode daily|monthly`); hay que llamar a los ETL individuales, que si aceptan rango:

```bash
cd /opt/ventas_pipeline/etl
for E in cajas fruver carnes asadero pollo_pesc industria; do
  python3 ${E}_ventas_rango.py --start-date 20260801 --end-date 20260809
done
```

Luego subirlo (fechas CON guiones):
```bash
$SYNC --desde 2026-08-01 --hasta 2026-08-09 --replace --no-refresh --verify \
  --only ventas_cajas,ventas_fruver,ventas_carnes,ventas_asadero,ventas_pollo_pesc,ventas_industria
```
> `--no-refresh` es correcto aqui: los matviews dependen de rotacion, no de estas tablas.

**Ojo:** `ventas_asadero` solo opera en **mercamio y mtodo**. Ver bogota en 0 ahi es
normal, no un hueco.

---

## 3.c Detectar dias incompletos (empresa faltante O empresa flaca)

Cuando el POS 217 no ha cerrado el dia, un ETL carga **0 filas para esa empresa**. La
tabla queda con datos de las otras y **el total no se ve raro a simple vista**. Paso el
2026-08-10: faltaban mercamio y mtodo del 07 y mercamio del 09 en 12 tablas, durante dias.

**Hay un segundo caso, peor: la empresa esta PRESENTE pero trae un tercio de las filas.**
Paso el 2026-08-07 y el 2026-08-10 (mercamio y mtodo ~30% de lo normal, bogota bien).
Contar empresas da 3 y el dia pasa por bueno; el hueco solo se ve en el tablero, dias
despues. Desde 2026-08-12 los 6 ETL de la seccion 3.b tambien avisan de esto comparando
contra la **mediana de los 14 dias previos** (por debajo del 50% -> exit 3).

**La consulta que lo destapa** — mirar filas POR EMPRESA, no el total del dia (el total
puede parecer razonable con una empresa entera a la mitad). Ojo: en las 6 tablas de la
seccion 3.b la columna es `empresa_bd`; en el resto es `empresa`:

```sql
SELECT fecha_dcto, empresa_bd, count(*) AS filas
FROM ventas_cajas
WHERE fecha_dcto BETWEEN '20260801' AND '20260809'
GROUP BY 1, 2 ORDER BY 1, 2;
```

**Antes de re-correr, comprobar que el POS SI tiene el dato** (si no lo tiene, re-correr
no sirve de nada):

```sql
-- en 192.168.35.217, base = nombre de la empresa
SELECT trim(fecha_dcto), count(*) FROM cmmovimiento_pdv
WHERE trim(fecha_dcto) BETWEEN '20260801' AND '20260809' GROUP BY 1 ORDER BY 1;
```

**Orden obligatorio al reparar:** arreglar la LOCAL → verificar cobertura por empresa →
y solo entonces sincronizar. `margen_final` y `asistencia_horas` suben **siempre en modo
replace**: subir con la local incompleta **borra en GCP** esas fechas.

---

## 4. Codigos de salida

`0` OK · `3` WARNING (sin datos de ayer en tablas canary, exit normal del timer) ·
`1` ERROR · `2` uso invalido (flag/fecha mal escrita) **o un extremo no responde**.

> **`sync-local-to-gcp.sh`, exit 2 = problema de CONEXION, no de esquema.** El script
> ahora hace un preflight (`SELECT 1` a local y a GCP) antes de recorrer tablas y dice
> cual extremo esta caido, con la IP publica actual de la maquina. Si el detalle menciona
> timeout, casi siempre es que esa IP se cayo de las **redes autorizadas del Cloud SQL**
> (la IP del ISP es dinamica). Se autoriza en la consola de GCP: SQL > Conexiones > Redes
> autorizadas. Antes de este preflight el sintoma era `ERROR: sin columnas comunes
> resueltas` en cada tabla, que manda a buscar una columna que no falta; asi pasaron
> 2 dias sin que nadie lo notara en agosto de 2026.
>
> Una tabla de la allowlist que todavia no existe **en el local** se omite con AVISO y
> deja el sync en exit 3, en vez de tumbar la corrida entera; y el `--verify` omite las
> que aun no existen **en GCP** en vez de dejar de reportar todas las demas. Eso permite
> desplegar el script antes que su migracion sin romper el diario de las 07:35.
>
> En el `--verify`, **`SIN DATOS` no es `ATRASADA`**: la tabla existe en GCP pero esta
> vacia, o sea espera su primera carga. Es lo normal recien aplicada una migracion.
> `ATRASADA` de verdad es tener datos, pero mas viejos que el objetivo.

> Los 6 ETL de la seccion 3.b tambien salen con **exit 3** en dos casos. Antes reportaban
> `PIPELINE COMPLETADO EXITOSAMENTE` en ambos:
> 1. **Empresa ausente** (2026-08-10): falta una empresa que si tenia ventas en los 14
>    dias previos. Las esperadas se calculan mirando la propia tabla, no una lista fija:
>    por eso `ventas_asadero` no alarma por bogota, donde no opera.
> 2. **Empresa flaca** (2026-08-12): esta presente pero por debajo del **50% de su
>    mediana** de los 14 dias previos. Mediana y no promedio, para que un dia malo ya
>    dentro de la ventana no arrastre el umbral hacia abajo.
>
> **Un exit 3 no dice que el ETL este mal.** Casi siempre el dato no esta en el POS.
> Comprobar el origen (seccion 3.c) antes de re-correr: re-correr no inventa filas.

## 5. Ver estado de los timers / logs

**Lo primero ante cualquier sospecha:**
```bash
systemctl --failed          # un ETL con exit 3 aparece aqui, y se queda hasta reset-failed
```
> Tras reparar, limpiar con `sudo systemctl reset-failed <unidad>`; si no, manana no se
> distingue un fallo nuevo del viejo.

> **`systemctl --failed` NO detecta un timer apagado.** Un timer que no dispara no falla:
> simplemente no existe. Paso el 2026-08-11 — el timer de ventas quedo `inactive (dead)`,
> `--failed` salio limpio dos dias y nadie se entero hasta ver el tablero vacio. El unico
> chequeo que lo ve es mirar que **NEXT tenga una fecha futura**, no un `-`:
> ```bash
> systemctl list-timers --all 'visor-etl-*' 'etl-rotacion*' 'ventas-pipeline-*'
> ```
> `enabled` NO significa "corriendo": significa "arranca en el proximo boot". Un timer
> puede estar `enabled` y `inactive` a la vez, que es exactamente el estado malo.
>
> **Como se apago:** los dos `.timer` de ventas tenian `Requires=<su>.service` en
> `[Unit]`. `Requires=` propaga el stop en las dos direcciones, asi que un
> `systemctl stop` del **servicio** (para cortar una corrida a mano) tumbaba tambien el
> **timer**. Se quito el 2026-08-12; un timer no necesita declarar nada para activar su
> servicio homonimo. Si algun dia vuelve a aparecer un `Requires=` dentro de un `.timer`,
> es un bug.

```bash
systemctl list-timers 'visor-etl-*' 'etl-rotacion*' 'ventas-pipeline-*'
journalctl -u ventas-pipeline-daily.service -n 80 --no-pager  # el ETL de la seccion 3.b
journalctl -u visor-etl-sync.service -n 80 --no-pager        # diario 7:50 (sube todo a GCP)
journalctl -u visor-etl-reconcile.service -n 80 --no-pager   # domingos 16:00 (--replace)
journalctl -u visor-etl-margen.service -n 80 --no-pager      # margenes 7:15
journalctl -u visor-etl-orden-compra.service -n 80 --no-pager # OC incremental 8:00
journalctl -u etl-rotacion.service -n 80 --no-pager          # rotacion base local 7:00
journalctl -u visor-etl-asistencia-gcp.service -n 80 --no-pager  # asistencia mes->GCP 18:30
```
(usa `sudo` si `prodapp` no ve el journal).

> **El log de PostgreSQL NO esta en el journal.** El cluster arranca con
> `pg_ctlcluster --skip-systemctl-redirect`, asi que `journalctl -u postgresql*` sale
> **vacio** y buscar ahi da un falso negativo. Esta en
> `/var/log/postgresql/postgresql-18-main.log` (logrotate ya lo rota semanal, 10 copias).
> Desde 2026-08-10 registra el DML (`log_statement='mod'`) con `app=` y `host=` en el
> prefijo — necesario porque pgAdmin y los ETL **se conectan ambos como `postgres`** y
> el usuario solo no los distingue:
> ```bash
> sudo grep -iE "DELETE|UPDATE|TRUNCATE" /var/log/postgresql/postgresql-18-main.log | tail -20
> ```

> **`visor-etl-asistencia-gcp` (18:30 diario):** sube `asistencia_horas` del **mes-a-la-fecha**
> a GCP (replace). Rango = primer dia del mes de AYER → AYER (ej. dia 8 → `2026-08-01..2026-08-07`;
> el dia 1 re-sube el mes anterior completo, para no dejar sin subir el ultimo dia al cambiar de
> mes). La carga a la LOCAL la hace una tarea de **Windows** (manana + 18:00); este timer solo
> replica local→GCP. Correr a mano: `sudo systemctl start visor-etl-asistencia-gcp.service`.
> Instalar/actualizar el timer: ver `deploy/systemd/` + `git pull` + `daemon-reload`.

## 6. Reglas de oro

- Re-correr es **siempre seguro**: upsert no duplica; replace borra-ventana+reinserta.
- Sube/replica lo que la **local** ya tiene; no inventa datos faltantes.
- Manual = comando suelto, **no afecta los timers**.
- Duda con un rango grande? corre primero con `--dry-run`.
