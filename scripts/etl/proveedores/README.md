# ETL de proveedores (POS 217 -> produXdia 232 -> GCP)

Alimenta el tablero `/proveedores`. Carga en `produXdia` (232):

| Tabla | Que es | Como se carga |
|---|---|---|
| `ventas_proveedor_dia` | HECHOS: venta por criterio x dia x sede | reemplazo por `(empresa, fecha_dcto)` |
| `proveedor_pos_catalogo` | CATALOGO de **criterio del item** (`criterios_itm_1`), aqui vive el NIT del criterio | upsert; nunca borra ni pisa el NIT |
| `proveedor_tercero` | Maestro **comercial** POS (`terceros.ind_pro=1`) | `etl_proveedor_tercero.py`; upsert; `activo=false` si sale del POS |

Migracion: [`db/migrations/20260805_ventas_proveedor.sql`](../../../db/migrations/20260805_ventas_proveedor.sql).

## Programacion

| Unidad | Cuando | Que hace |
|---|---|---|
| `visor-etl-proveedores.timer` | **Lun-Vie 07:12** | carga **ayer** + refresca catalogo de criterios + `proveedor_tercero` |
| `visor-etl-proveedores-reconcile.timer` | **Sab y Dom 07:12** | `--days 7` + refresco de `proveedor_tercero` |

Las 07:12 caen despues de `visor-etl-ventas-item` (07:09, ~1,5 min) y antes del sync a GCP
(07:35). El orden importa: `--reconciliar` compara contra `ventas_item_diario`, asi que ese
ETL tiene que haber cargado el dia primero.

Cadena de la manana:

| hora | proceso |
|---|---|
| 07:00 | `etl-rotacion@{mercamio,mtodo,bogota}` |
| 07:07 | `visor-etl-margen` |
| 07:09 | `visor-etl-ventas-item` |
| **07:12** | **este ETL** (~10 s) |
| 07:35 | `visor-etl-sync` -> GCP |

## Uso manual

```bash
cd /home/prodapp/visor-productividad

# diario
python3 scripts/etl/proveedores/etl_proveedores.py                      # ayer
python3 scripts/etl/proveedores/etl_proveedores.py --days 7             # ultimos 7 dias
python3 scripts/etl/proveedores/etl_proveedor_tercero.py                # lista comercial POS
python3 scripts/etl/proveedores/etl_proveedor_tercero.py --dry-run

# cargue por RANGO (backfill / recarga manual)
python3 scripts/etl/proveedores/etl_proveedores.py --date 20260729
python3 scripts/etl/proveedores/etl_proveedores.py --desde 20260701 --hasta 20260731
python3 scripts/etl/proveedores/etl_proveedores.py --empresa mtodo --days 3

# solo el catalogo (no toca los hechos)
python3 scripts/etl/proveedores/etl_proveedores.py --solo-catalogo

# verificar sin escribir
python3 scripts/etl/proveedores/etl_proveedores.py --dry-run --days 30

# comparar contra ventas_item_diario
python3 scripts/etl/proveedores/etl_proveedores.py --reconciliar --days 30

# rollback manual: dejar un rango VACIO a proposito (exige fechas explicitas)
python3 scripts/etl/proveedores/etl_proveedores.py --purge --desde 20260101 --hasta 20260131
```

Despues de una carga manual, subir a GCP:

```bash
bash scripts/etl/sync-local-to-gcp.sh --only proveedor_pos_catalogo --only ventas_proveedor_dia \
  --only proveedor_tercero --desde 2026-07-01 --hasta 2026-07-31 --verify
```

### Sobre el "rollback"

Normalmente **no hace falta**: el ETL reemplaza por `(empresa, fecha_dcto)` dentro de una
transaccion, asi que **re-correr un rango ES el rollback contra el origen**. Si un dia quedo
mal cargado, se vuelve a correr ese dia y queda como esta en el POS.

`--purge` existe solo para el caso de querer dejar un rango vacio a proposito. Exige
`--date` o `--desde/--hasta` explicitos: nunca borra "ayer" por defecto.

Ojo: `--purge` borra en el **local**. GCP conserva sus filas porque el sync hace upsert y no
borra. Para propagar un borrado a GCP hay que hacerlo a mano alla.

## Codigos de salida

| Codigo | Significado |
|---|---|
| 0 | OK |
| 1 | error |
| 2 | uso invalido |
| **3** | **warning: alguna empresa/dia cargo 0 filas** |

El exit 3 **no** esta declarado como `SuccessExitStatus` en el `.service`, igual que en
`visor-etl-ventas-item`: asi systemd marca la unidad `failed` y el problema se ve en
`systemctl --failed` en vez de pasar callado.

## Config

Usa el `.env.etl` unico de la raiz del deploy, el mismo de `sync-local-to-gcp.sh`,
`cargar_margen.py` y `etl_ventas_item.py`. No hay contrasenas en el codigo.

- Destino (232): `DB_HOST_LOCAL`, `DB_PORT_LOCAL`, `DB_NAME_LOCAL`, `DB_USER_LOCAL`, `DB_PASSWORD_LOCAL`
- Origen POS (217): `DB_HOST_POS`, `DB_PORT_POS`, `DB_PWD_POS_MERCAMIO`, `DB_PWD_POS_MTODO`, `DB_PWD_POS_BOGOTA`

Override de la ruta con `ETL_ENV_FILE`.

## Decisiones de diseno, y por que

### 1. Tabla de hechos propia, no un join contra `ventas_item_diario`

El grano proveedor x dia x sede comprime **14x** respecto del grano item (medido en mtodo:
281.846 -> 20.137 filas en 30 dias). Con las 3 empresas son ~60k filas/mes, ~730k/ano: una
tabla chica que GCP sirve sin rollup ni matview. Ademas permite calcular la plata bien desde
el origen, sin heredar el problema de la columna de `ventas_item_diario` (punto 2), y sin
tocar el ETL existente ni backfillear 7,5M filas.

### 2. Tres columnas de plata, con nombres honestos

Medido en vivo contra 217/mtodo, con diferencia **exacta de 0.00** sobre 5 dias:

```
cmmovimiento_pdv.ven_netas = cmmovimiento_pdv.vlrtot_bru + cmmovimiento_pdv.imp_netos
```

O sea `ven_netas` **incluye** IVA e impoconsumo. Por eso `ventas_item_diario.venta_sin_impuesto_dia`,
que se llena con `SUM(ven_netas)`, **si trae impuesto pese a su nombre**. Aqui no se repite
ese error:

| Columna | Que es |
|---|---|
| `venta_base` | `SUM(vlrtot_bru)` — base gravable, **sin** impuestos |
| `impuestos` | `SUM(imp_netos)` — IVA + impoconsumo |
| `venta_con_impuesto` | `SUM(ven_netas)` = `venta_base + impuestos` |

Se llevan las dos porque **el ranking de proveedores cambia segun cual se use**: en 30 dias
de mtodo, ALPINA supera a UNILEVER en base gravable pero UNILEVER la supera con impuestos.
El tablero debe declarar cual muestra.

`descuentos` (`SUM(dscto_netos)`) es informativo. **No** se cumple
`vlrtot_bru = precio_uni*cantidad - dscto_netos` (medido: ~70M sin explicar en un dia de
mtodo), asi que no sirve para derivar la venta.

### 3. De donde sale el proveedor

De `criterios_itm_1`, no de `terceros`. Join verificado 1:1 sin fan-out:

```sql
items.id_cricla1 = criterios_itm_1.id_cricla1 AND items.id_tipo = criterios_itm_1.id_catego
```

Lo confirma la vista `informes.v_eos_items` del POS, que lo aliasa como `proveedor`.
Los **1137 codigos son identicos en las 3 empresas** (verificado: 0 discrepancias de nombre).
Aun asi `empresa` va en la clave natural: es correcto y protege si algun dia divergen.

### 4. La venta sin proveedor NO se descarta

El 1,3% del valor corresponde a items sin criterio asignado. Entra con el codigo sintetico
`@SP` / `(SIN PROVEEDOR)`, que existe como fila del catalogo para las 3 empresas. Asi la suma
del tablero cuadra con el POS. Perder plata en silencio es el peor resultado posible.

### 5. El NIT: se carga lo que hay, y solo eso

La tabla que liga criterio con NIT **si existe**, pero su nombre lleva **sufijo por empresa**:

| empresa | tabla |
|---|---|
| mercamio | `public.nit_mmio` |
| mtodo | `public.nit_mtodo` |
| bogota | **no existe** |

Buscar `nit_mmio` dentro de `mtodo` da *"no existe la relacion"* y lleva a concluir, mal, que
no hay fuente. `bogota` hereda el NIT de mercamio (los 1137 codigos son identicos en las 3
empresas, verificado con 0 discrepancias de nombre) y queda marcado `nit_origen='pos:heredado'`.

**Cuidado con el centinela.** De 1093 filas, **750 (68,6%)** traen `nit='99999999'` junto con
`proveedor='NO ASIGNADO'`. Un `COUNT(nit IS NOT NULL)` reporta 95,9% de cobertura y es falso.
El ETL descarta ese valor explicitamente.

Cobertura real medida:

| Medida | Valor |
|---|---|
| Criterios con NIT util | **341 de 1137** (~30%) |
| Ponderado por venta de 30 dias | **28,3%** |
| Idem, solo proveedores externos | **~60%** |

El 73% de lo que falta son buckets **internos** (MERCAMIO CARNES ROJAS, FRUVER, POLLOS,
IMPORTADOS, GRANOS): no son proveedores externos y no tienen NIT propio.

Lo que el ETL **no** hace: cruzar por nombre contra `terceros`. Es viable (sin ambiguedad en
las mediciones) pero es una inferencia, no una llave; si se quiere, va como paso aparte
revisable.

**Regla de sobreescritura:** el ETL escribe `nit` solo si esta vacio o si el valor vigente vino
del propio POS (`nit_origen LIKE 'pos%'`). Un NIT puesto a mano (`nit_origen='manual'`) **nunca
se pisa**. Los codigos que desaparecen del POS se marcan `activo=false` en vez de borrarse.

Para completar un NIT a mano:

```sql
UPDATE proveedor_pos_catalogo
   SET nit = '900123456', nit_origen = 'manual', updated_at = now()
 WHERE empresa = 'mercamio' AND id_cricla1 = '0023';
```

La fuente de verdad del NIT es el **232**. El sync lo replica a GCP; lo que se edite
directamente en GCP se pisa en la siguiente corrida.

### 6. Devoluciones excluidas

Se filtra `id_tipdoc_fc LIKE 'Z%'`, igual que `etl_ventas_item.py`, para que el tablero
cuadre con `/ventas-x-item`. En mtodo son -28,3M en 30 dias (~0,1%).

### 7. Guarda contra el catalogo vacio

Si el POS devuelve 0 proveedores para una empresa, el ETL **no toca el catalogo** y sale con
exit 3. Un catalogo vacio dejaria el tablero sin nombres y marcaria todo inactivo. Ante duda,
no escribir.

### 8. Un dia vacio NO borra nada

Si el POS devuelve 0 filas para un dia que el destino ya tiene cargado, el ETL **conserva lo
que hay** y avisa con exit 3. Borrar ahi destruiria datos buenos ante una lectura transitoria
mala (POS sin cerrar, corte de red), y ademas seria asimetrico con la guarda del catalogo.
Para vaciar un dia a proposito esta `--purge`.

## Verificacion

```bash
# compara DIA A DIA contra ventas_item_diario (un total puede cuadrar compensando dias)
python3 scripts/etl/proveedores/etl_proveedores.py --reconciliar --desde 20260102 --hasta 20260804
```

La tolerancia es **estricta**: cualquier diferencia distinta de cero se reporta. En teoria el
delta podria ser > 0 (este ETL usa LEFT JOIN contra `items` y conserva ventas de items
ausentes del maestro, mientras `etl_ventas_item.py` usa INNER JOIN y las descarta), pero se
midio 0 exacto: no hay ventas de items fuera del maestro.

Resultado medido el 2026-08-05 sobre **215 dias x 3 empresas**:

```
[reconciliar mercamio 20260102..20260804] 215 dias comparados
    ventas_proveedor_dia.venta_con_impuesto  = 382,882,093,119
    ventas_item_diario.venta_sin_impuesto_dia = 382,882,093,119
    delta total = 0.00
    OK: los 215 dias cuadran EXACTO y base+impuestos = venta_con_impuesto en todos
[reconciliar mtodo  ...] 211,830,830,994 = 211,830,830,994   delta 0.00   OK
[reconciliar bogota ...]  79,432,697,445 =  79,432,697,445   delta 0.00   OK
```
