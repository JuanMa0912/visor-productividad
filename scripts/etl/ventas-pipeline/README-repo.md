# ventas-pipeline (copia versionada de `/opt/ventas_pipeline`)

Carga **6 de las 13 tablas** que `sync-local-to-gcp.sh` sube a GCP:

`ventas_cajas` · `ventas_fruver` · `ventas_carnes` · `ventas_asadero` ·
`ventas_pollo_pesc` · `ventas_industria`

Es el **segundo** sistema de ETL de la 232. El otro son los scripts de este repo
(`margen/`, `ventas-item/`, `proveedores/`) mas rotacion en `/opt/etl_rotacion`.
Recetario operativo: [`../CHEATSHEET.md`](../CHEATSHEET.md) seccion 3.b.

## Esto es una copia, no el original desplegado

El pipeline **corre desde `/opt/ventas_pipeline`** (codigo de `root`, sus propios
timers `ventas-pipeline-daily` 07:00 y `ventas-pipeline-monthly` 14:00). Esta carpeta
existe para que el codigo tenga historial: hasta 2026-08-10 vivia **solo** en esa
maquina, sin git y sin respaldo, asi que reconstruirla habria perdido todo.

**Al cambiar algo hay que copiarlo a `/opt`**, no basta con hacer merge:

```bash
sudo cp scripts/etl/ventas-pipeline/etl/*.py        /opt/ventas_pipeline/etl/
sudo cp scripts/etl/ventas-pipeline/scripts/*.py    /opt/ventas_pipeline/scripts/
# el config NO se copia tal cual: ver abajo
```

> Riesgo asumido: repo y `/opt` pueden divergir. Antes de tocar nada, comparar con
> `diff -r`. Mover los timers para que apunten al repo seria lo ideal, pero cambia el
> despliegue y no se hizo en este paso.

## Credenciales: fuera del codigo (2026-08-10)

Los 6 ETL tenian el host, el usuario y la **contrasena** del POS 217 y de la 232
escritos en el propio fichero. Por eso no se podian versionar. Ahora leen el
`.env.etl` unico del deploy (modo 600, git-ignorado), el mismo que usan
`cargar_margen.py`, `etl_ventas_item.py` y `etl_proveedores.py`:

`DB_HOST_POS`, `DB_PORT_POS`, `DB_PWD_POS_{MERCAMIO,MTODO,BOGOTA}`,
`DB_HOST_LOCAL`, `DB_PORT_LOCAL`, `DB_NAME_LOCAL`, `DB_USER_LOCAL`, `DB_PASSWORD_LOCAL`.

Override de la ruta con `ETL_ENV_FILE=...`.

### `config/pipeline_config.yaml` va SANEADO

El bloque `database:` del config aparece aqui con `__DESDE_ENV_ETL__` en vez de los
valores reales. **Es codigo muerto**: se comprobo que ni `pipeline_orchestrator.py`
ni `etl_runner.py` ni `pipeline_utils.py` leen esas claves — solo los 6 ETL usaban
credenciales, y ya no las sacan de ahi. El fichero real en `/opt` conserva los
valores; si se copia esta version, no se rompe nada.

**No restaurar esos valores en el repo.** El repositorio es **publico**.

## Deteccion de dias incompletos (2026-08-10)

Antes estos ETL imprimian `empresa: 0 facturas agregadas` y salian con codigo 0, asi
que el orquestador reportaba `PIPELINE COMPLETADO EXITOSAMENTE` **con una empresa
entera ausente**. Paso durante dias sin que nadie lo viera.

Ahora `verificar_cobertura()` corre despues de `main()` y sale con **exit 3** si falta
una empresa → systemd marca la unidad `failed` → sale en `systemctl --failed`. Misma
convencion que los ETL del repo.

Las empresas esperadas **no** se leen de `DBS`: se calculan mirando los **14 dias
previos en la propia tabla destino**. Es deliberado — `ventas_asadero` solo opera en
mercamio y mtodo, y una lista fija haria saltar el aviso todos los dias por bogota.
Un aviso que salta siempre se ignora, y entonces deja de avisar de nada.

## Backfill de un rango

El orquestador **no tiene** modo backfill (solo `--mode daily|monthly`); los ETL
individuales **si** aceptan rango:

```bash
cd /opt/ventas_pipeline/etl
for E in cajas fruver carnes asadero pollo_pesc industria; do
  python3 ${E}_ventas_rango.py --start-date 20260801 --end-date 20260809
done
```

Despues subirlo a GCP (fechas CON guiones):

```bash
bash scripts/etl/sync-local-to-gcp.sh --desde 2026-08-01 --hasta 2026-08-09 \
  --replace --no-refresh --verify \
  --only ventas_cajas,ventas_fruver,ventas_carnes,ventas_asadero,ventas_pollo_pesc,ventas_industria
```
