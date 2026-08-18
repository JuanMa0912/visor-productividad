# ETL `rotacion-dim` — salidas de inventario, kits y codigo de barras

Carga del POS (`192.168.35.217`) a `produXdia` (232) tres tablas que arreglan el DIC
(dias de inventario) de `/rotacion` y agregan el codigo de barras al tablero.

Comandos de operacion: [`../CHEATSHEET.md` seccion 3.a](../CHEATSHEET.md).
Detalle tecnico y decisiones: docstring de [`etl_rotacion_dim.py`](etl_rotacion_dim.py).
Esquema: [`db/migrations/20260814_rotacion_salidas_kits_codbar.sql`](../../../db/migrations/20260814_rotacion_salidas_kits_codbar.sql).

## El problema, en una tabla

Medido el 2026-08-14 en el 217 (mercamio, sede 001, agosto):

| | ARROZ BLANQUITA*500g |
| --- | --- |
| Inventario 05-ago → 12-ago | 21.314 → 13.005 (**8.309 consumidas**) |
| Venta directa registrada | **537** |
| Diferencia | la ARROBA (25 × 500g), que el POS cobra en OTRO codigo |

El ERP **ya contabiliza** ese consumo: es el documento `EK` (ENSAMBLE DE KIT) en
`cmmovimiento_inventario`. No hay que reconstruirlo desde la tabla `kits`. Reconciliacion
exacta verificada al item:

```
ARROZ 030653  EA +19.500 = can_exis_ent  |  RV 847 + EK 19.981 = 20.828 = can_exis_sal
HUEVO 063124  EA+RG = 82.980 = ent       |  RV+RG+EK = 93.493 = sal
```

Y `fin = ini + ent - sal` cuadra en **120.709 de 120.709** filas de `cmresumen_inventario`.

## Que carga

| Tabla | Grano | Tamano medido |
| --- | --- | --- |
| `rotacion_salidas_dia` | empresa × dia × sede × bodega × item × tipo_doc × E/S | 5.217 filas/dia/empresa |
| `rotacion_kit_composicion` | empresa × padre × hijo (cierre recursivo aplanado) | 1.163 filas/empresa |
| `rotacion_item_codbar` | empresa × item | 36.628 filas/empresa |

`RV` (la venta POS) se excluye a proposito: ya esta en `rotacion_base_item_dia_sede` y
sumarla duplicaria el denominador. Es ademas el 95% del volumen.

## Tres cosas que conviene saber antes de tocarlo

1. **`AA` no es una entrada.** Es "AJUSTE DE ACUMULACION" (672 lineas / 4.590 uds por lapso).
   Junto con `AJ` e `IF` son correcciones contables. La entrada real de mercancia es `EA`
   ("ENTRADA DE INVENTARIO - Interfase") y en fruver `EF`.
2. **"El codigo de barras mas usado" no existe.** El POS resuelve alias→item al escanear y
   graba el canonico, no el escaneado: 168.069 de 168.069 lineas de
   `cmmovimiento_pdv.id_codbar` son identicas a `items.id_codbar`, y ningun item muestra mas
   de un codigo distinto en un dia. Por eso se carga `items.id_codbar` directo.
   Solo el 3,5% de los items tipo 4 tiene mas de un codigo en `cod_barras`.
3. **El `es_gtin=false` no es un dato roto.** ~5,8% de los codigos son PLU de granel de 1–8
   caracteres (`PAPA SIN LAVAR*KILO GRANEL` = `"1"`, `TOMATE CHONTO*KILO` = `"2"`). En la UI:
   titular la columna **"Codigo"**, no "Codigo de barras", y no pasar los no-GTIN a un
   encoder EAN-13 (revienta).

## Lo que este ETL NO arregla

El denominador correcto del DIC es el consumo total, y esto solo recupera el consumo por
kit. Traslados entre sedes (`ST`/`TB`), averias (`FS`/`Na`/`FN`) y reclasificaciones
(`DC`/`RP`/`RF`/`RG`/`RI`/`DU`) quedan guardados en la tabla pero **fuera** del denominador,
por decision de negocio: consumen stock pero no son demanda de esa sede. Cambiar el criterio
es editar `refresh_rotacion_item_periodo_std()`, sin re-ETL.

Aparte, sigue abierto que **`cmresumen_inventario.can_disponible` es un valor VIVO**, no
historico: un backfill de rotacion de un dia nunca cargado estampa el stock de HOY sobre esa
fecha pasada. Eso no lo toca este ETL.
