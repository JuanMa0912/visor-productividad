import { margenMetricSelect } from "@/lib/margenes/margen-final-query";
import type { MargenDataTable } from "@/lib/margenes/margen-data-source";

export const METRICS_SQL = `
  COALESCE(SUM(COALESCE(vlrtot_bru, 0)), 0) AS ventas_netas,
  COALESCE(SUM(COALESCE(tot_costo, 0)), 0) AS costo_total,
  COALESCE(SUM(COALESCE(vlrtot_bru, 0) - COALESCE(tot_costo, 0)), 0) AS margen_pesos,
  COALESCE(SUM(COALESCE(cantidad, 0)), 0) AS cantidad,
  COALESCE(SUM(COALESCE(ven_totales, 0)), 0) AS ventas_con_iva,
  COUNT(DISTINCT NULLIF(TRIM(documento_fc::text), '')) FILTER (
    WHERE NULLIF(TRIM(documento_fc::text), '') IS NOT NULL
  ) AS facturas,
  COUNT(DISTINCT NULLIF(TRIM(id_tipo::text), '')) AS categorias,
  COUNT(DISTINCT NULLIF(TRIM(id_linea1::text), '')) AS lineas,
  COUNT(DISTINCT NULLIF(TRIM(id_linea2::text), '')) AS sublineas,
  COUNT(DISTINCT NULLIF(TRIM(id_item::text), '')) AS items
  , CASE WHEN SUM(COALESCE(vlrtot_bru,0)) > 0 THEN SUM(COALESCE(vlrtot_bru,0)-COALESCE(tot_costo,0)) / SUM(COALESCE(vlrtot_bru,0)) ELSE 0 END AS margen_pct
  , CASE WHEN SUM(COALESCE(cantidad,0)) > 0 THEN SUM(COALESCE(ven_totales,0)) / SUM(COALESCE(cantidad,0)) ELSE 0 END AS pvu_iva
  , CASE WHEN SUM(COALESCE(cantidad,0)) > 0 THEN SUM(COALESCE(tot_costo,0)) / SUM(COALESCE(cantidad,0)) ELSE 0 END AS pcu
`;

/** Columnas ordenables server-side: key del board -> alias/columna SQL ordenable. */
export const MARGEN_SORT_COLUMNS: Record<string, string> = {
  ventasNetas: "ventas_netas",
  costoTotal: "costo_total",
  margenPesos: "margen_pesos",
  margenPct: "margen_pct",
  cantidad: "cantidad",
  facturas: "facturas",
  categorias: "categorias",
  lineas: "lineas",
  sublineas: "sublineas",
  items: "items",
  pvuIva: "pvu_iva",
  pcu: "pcu",
};

/**
 * ORDER BY seguro. orderBy debe estar en el whitelist (y, si se pasa `allowed`,
 * además en esa lista de columnas que la consulta REALMENTE expone en su SELECT);
 * si no, usa `fallback` (string sin la palabra ORDER BY). Esto evita ordenar por una
 * columna inexistente en consultas con SELECT reducido (p.ej. queryTable/margenMetricSelect).
 */
export const buildMargenOrderBy = (
  orderBy: string | undefined,
  orderDir: "asc" | "desc" | undefined,
  fallback: string,
  allowed?: string[],
): string => {
  const ok = orderBy && (!allowed || allowed.includes(orderBy));
  const col = ok ? MARGEN_SORT_COLUMNS[orderBy] : undefined;
  if (!col) {
    if (/\s+(ASC|DESC)\b/i.test(fallback)) {
      return `ORDER BY ${fallback}`;
    }
    const dir = orderDir === "desc" ? " DESC" : " ASC";
    return `ORDER BY ${fallback}${dir}`;
  }
  const dir = orderDir === "asc" ? "ASC" : "DESC";
  return `ORDER BY ${col} ${dir} NULLS LAST`;
};

export type MetricRow = {
  ventas_netas: string | number;
  costo_total: string | number;
  margen_pesos: string | number;
  cantidad: string | number;
  ventas_con_iva: string | number;
  facturas: string | number;
  categorias?: string | number;
  lineas?: string | number;
  sublineas?: string | number;
  items?: string | number;
};

export const toNum = (value: string | number | null | undefined) =>
  Number(value ?? 0) || 0;

export const marginPct = (ventas: number, margen: number) =>
  ventas > 0 ? (margen / ventas) * 100 : 0;

export const unitSaleWithTax = (ventasConIva: number, cantidad: number) =>
  cantidad > 0 ? ventasConIva / cantidad : 0;

export const unitCost = (costo: number, cantidad: number) =>
  cantidad > 0 ? costo / cantidad : 0;

/** Regla del prototipo: KPI en niveles día/categoría solo cuenta id_tipo = 4 (MERCADO). */
export const KPI_MERCADO_TIPO = "4";

export const MERCADO_TIPO_SQL = `TRIM(COALESCE(id_tipo::text, '')) = '${KPI_MERCADO_TIPO}'`;

/**
 * Mercado (4) es el default cuando no hay categoría seleccionada.
 * Si el cliente (o el scope asadero) ya fija `categorias`, no forzar Mercado
 * o se contradice `id_tipo = ANY(['3']) AND id_tipo = '4'`.
 */
export const shouldApplyMercadoTipoDefault = (
  categorias: readonly string[] | null | undefined,
): boolean => !categorias || categorias.length === 0;

/** Métricas sobre margen_final_roll (columnas ya agregadas por factura+ítem). */
export const ROLL_METRICS_SQL = `
  COALESCE(SUM(ventas_netas), 0) AS ventas_netas,
  COALESCE(SUM(costo_total), 0) AS costo_total,
  COALESCE(SUM(margen_pesos), 0) AS margen_pesos,
  COALESCE(SUM(cantidad), 0) AS cantidad,
  COALESCE(SUM(ventas_con_iva), 0) AS ventas_con_iva,
  COUNT(DISTINCT NULLIF(documento_fc, '')) FILTER (
    WHERE NULLIF(documento_fc, '') IS NOT NULL
  ) AS facturas,
  COUNT(DISTINCT NULLIF(id_tipo, '')) AS categorias,
  COUNT(DISTINCT NULLIF(id_linea1, '')) AS lineas,
  COUNT(DISTINCT NULLIF(id_linea2, '')) AS sublineas,
  COUNT(DISTINCT NULLIF(id_item, '')) AS items
  , CASE WHEN SUM(COALESCE(ventas_netas,0)) > 0 THEN SUM(COALESCE(margen_pesos,0)) / SUM(COALESCE(ventas_netas,0)) ELSE 0 END AS margen_pct
  , CASE WHEN SUM(COALESCE(cantidad,0)) > 0 THEN SUM(COALESCE(ventas_con_iva,0)) / SUM(COALESCE(cantidad,0)) ELSE 0 END AS pvu_iva
  , CASE WHEN SUM(COALESCE(cantidad,0)) > 0 THEN SUM(COALESCE(costo_total,0)) / SUM(COALESCE(cantidad,0)) ELSE 0 END AS pcu
`;

/**
 * SQL de la fila TOTAL (KPI + fila ACUMULADO) SIN agregados DISTINCT.
 *
 * Por qué existe: `COUNT(DISTINCT x)` obliga a PostgreSQL a ordenar la relación
 * completa una vez por cada agregado. Con los 5 conteos de METRICS_SQL sobre los
 * ~8,2M de filas de un mes x 11 sedes, la fila total tardaba 60 s; calculada
 * junto a las filas por día en un `GROUP BY GROUPING SETS ((), (fecha_dcto))`
 * llegaba a 135 s. El proxy corta a los 90 s, así que el tablero mostraba
 * "Error cargando datos" al seleccionar todas las sedes (504).
 *
 * Reformulado como `COUNT(*)` sobre subconsultas `SELECT DISTINCT`, el
 * planificador usa HashAggregate en vez de Sort. Medido contra producción el
 * 2026-07-31: la fila total pasó de 60 s a 27 s.
 *
 * Nota: subir `work_mem` NO resuelve esto (medido: 256MB -> 1GB solo bajó de
 * 135 s a 111 s), porque el costo no es el derrame a disco sino la cantidad de
 * ordenamientos.
 *
 * Detalles que SÍ importan para el tiempo (todos medidos, no supuestos):
 *  - `dias` y `sedes` no se consultan: salen en JS de las filas por día y de los
 *    filtros. Cada uno costaba una pasada completa sobre la relación.
 *  - Meter la sede como tipo compuesto `(empresa_norm, id_co_norm)` en el CTE
 *    dispara el tiempo a 117 s: materializar 8,2M registros compuestos y hacerles
 *    DISTINCT es carísimo. Ni siquiera como dos columnas planas vale la pena (76 s).
 *  - Los tres conteos de baja cardinalidad (categoría, línea, sublínea: 1, 48 y
 *    213 valores) se resuelven en UNA sola pasada vía el CTE `dims`, en vez de
 *    tres. Cada subconsulta extra sobre `base` cuesta ~10 s.
 * Resultado con esta forma: 27 s.
 */
export const buildTotalMetricsSql = (
  table: MargenDataTable,
  whereSql: string,
): string => {
  const isRoll =
    table === "margen_final_roll" || table === "margen_dinastia_roll";
  const ventas = isRoll ? "ventas_netas" : "COALESCE(vlrtot_bru, 0)";
  const costo = isRoll ? "costo_total" : "COALESCE(tot_costo, 0)";
  const margen = isRoll
    ? "margen_pesos"
    : "(COALESCE(vlrtot_bru, 0) - COALESCE(tot_costo, 0))";
  const conIva = isRoll ? "ventas_con_iva" : "COALESCE(ven_totales, 0)";
  // Misma normalización que METRICS_SQL/ROLL_METRICS_SQL: '' cuenta como NULL y
  // COUNT ignora NULLs, así que el resultado es idéntico al COUNT(DISTINCT).
  const dim = (col: string) =>
    isRoll ? `NULLIF(${col}, '')` : `NULLIF(TRIM(${col}::text), '')`;

  return `
    WITH base AS (
      SELECT
        ${dim("documento_fc")} AS documento_fc,
        ${dim("id_tipo")}      AS id_tipo,
        ${dim("id_linea1")}    AS id_linea1,
        ${dim("id_linea2")}    AS id_linea2,
        ${dim("id_item")}      AS id_item,
        ${ventas}              AS ventas_netas,
        ${costo}               AS costo_total,
        ${margen}              AS margen_pesos,
        COALESCE(cantidad, 0)  AS cantidad,
        ${conIva}              AS ventas_con_iva
      FROM ${table}
      WHERE ${whereSql}
    ),
    sums AS (
      SELECT
        COALESCE(SUM(ventas_netas), 0)   AS ventas_netas,
        COALESCE(SUM(costo_total), 0)    AS costo_total,
        COALESCE(SUM(margen_pesos), 0)   AS margen_pesos,
        COALESCE(SUM(cantidad), 0)       AS cantidad,
        COALESCE(SUM(ventas_con_iva), 0) AS ventas_con_iva
      FROM base
    ),
    -- Una sola pasada para los tres conteos de baja cardinalidad.
    dims AS (
      SELECT DISTINCT id_tipo, id_linea1, id_linea2 FROM base
    )
    SELECT
      sums.ventas_netas,
      sums.costo_total,
      sums.margen_pesos,
      sums.cantidad,
      sums.ventas_con_iva,
      (SELECT COUNT(*) FROM (SELECT DISTINCT documento_fc FROM base WHERE documento_fc IS NOT NULL) d) AS facturas,
      (SELECT COUNT(*) FROM (SELECT DISTINCT id_item      FROM base WHERE id_item      IS NOT NULL) d) AS items,
      (SELECT COUNT(DISTINCT id_tipo)   FROM dims) AS categorias,
      (SELECT COUNT(DISTINCT id_linea1) FROM dims) AS lineas,
      (SELECT COUNT(DISTINCT id_linea2) FROM dims) AS sublineas
    FROM sums
  `;
};

/**
 * Métricas agrupadas SIN `COUNT(DISTINCT)` en el Aggregate exterior.
 * Misma estrategia que el antiguo `buildDayMetricsSql` / `buildTotalMetricsSql`:
 * CTE `base` + HashAggregate. Evita el Sort de `metricsSqlFor()` al perforar
 * día → categoría → línea (antes ~1 min con 11 sedes).
 */
export const buildGroupedMetricsSql = (
  table: MargenDataTable,
  whereSql: string,
  group: {
    keySql: string;
    keyAlias: string;
    /** Columna/expresión en `base` para MAX → etiqueta (nombre línea, etc.). */
    labelSourceSql?: string;
    labelAlias?: string;
  },
  orderBySql = "",
  limitSql = "",
): string => {
  const isRoll =
    table === "margen_final_roll" || table === "margen_dinastia_roll";
  const ventas = isRoll ? "ventas_netas" : "COALESCE(vlrtot_bru, 0)";
  const costo = isRoll ? "costo_total" : "COALESCE(tot_costo, 0)";
  const margen = isRoll
    ? "margen_pesos"
    : "(COALESCE(vlrtot_bru, 0) - COALESCE(tot_costo, 0))";
  const conIva = isRoll ? "ventas_con_iva" : "COALESCE(ven_totales, 0)";
  const dim = (col: string) =>
    isRoll ? `NULLIF(${col}, '')` : `NULLIF(TRIM(${col}::text), '')`;

  const labelAlias = group.labelAlias ?? "nombre";
  const labelInBase = group.labelSourceSql
    ? `, ${group.labelSourceSql} AS _label_src`
    : "";
  const labelInSums = group.labelSourceSql
    ? `, MAX(_label_src) AS _label_raw`
    : "";
  const labelSelect = group.labelSourceSql
    ? `, COALESCE(NULLIF(s._label_raw, ''), s.${group.keyAlias}::text) AS ${labelAlias}`
    : "";

  return `
    WITH base AS (
      SELECT
        ${group.keySql} AS ${group.keyAlias}
        ${labelInBase},
        ${dim("documento_fc")} AS documento_fc,
        ${dim("id_tipo")}      AS dim_tipo,
        ${dim("id_linea1")}    AS dim_linea1,
        ${dim("id_linea2")}    AS dim_linea2,
        ${dim("id_item")}      AS dim_item,
        ${ventas}              AS ventas_netas,
        ${costo}               AS costo_total,
        ${margen}              AS margen_pesos,
        COALESCE(cantidad, 0)  AS cantidad,
        ${conIva}              AS ventas_con_iva
      FROM ${table}
      WHERE ${whereSql}
    ),
    sums AS (
      SELECT
        ${group.keyAlias}
        ${labelInSums},
        COALESCE(SUM(ventas_netas), 0)   AS ventas_netas,
        COALESCE(SUM(costo_total), 0)    AS costo_total,
        COALESCE(SUM(margen_pesos), 0)   AS margen_pesos,
        COALESCE(SUM(cantidad), 0)       AS cantidad,
        COALESCE(SUM(ventas_con_iva), 0) AS ventas_con_iva
      FROM base
      GROUP BY ${group.keyAlias}
    ),
    fac AS (
      SELECT ${group.keyAlias}, COUNT(*) AS facturas
      FROM (
        SELECT DISTINCT ${group.keyAlias}, documento_fc
        FROM base
        WHERE documento_fc IS NOT NULL
      ) d
      GROUP BY ${group.keyAlias}
    ),
    itm AS (
      SELECT ${group.keyAlias}, COUNT(*) AS items
      FROM (
        SELECT DISTINCT ${group.keyAlias}, dim_item
        FROM base
        WHERE dim_item IS NOT NULL
      ) d
      GROUP BY ${group.keyAlias}
    ),
    dims AS (
      SELECT DISTINCT ${group.keyAlias}, dim_tipo, dim_linea1, dim_linea2 FROM base
    ),
    dimc AS (
      SELECT
        ${group.keyAlias},
        COUNT(DISTINCT dim_tipo)   AS categorias,
        COUNT(DISTINCT dim_linea1) AS lineas,
        COUNT(DISTINCT dim_linea2) AS sublineas
      FROM dims
      GROUP BY ${group.keyAlias}
    )
    SELECT
      s.${group.keyAlias}
      ${labelSelect},
      s.ventas_netas,
      s.costo_total,
      s.margen_pesos,
      s.cantidad,
      s.ventas_con_iva,
      COALESCE(fac.facturas, 0)    AS facturas,
      COALESCE(itm.items, 0)       AS items,
      COALESCE(dimc.categorias, 0) AS categorias,
      COALESCE(dimc.lineas, 0)     AS lineas,
      COALESCE(dimc.sublineas, 0)  AS sublineas,
      CASE WHEN s.ventas_netas > 0 THEN s.margen_pesos / s.ventas_netas ELSE 0 END AS margen_pct,
      CASE WHEN s.cantidad > 0 THEN s.ventas_con_iva / s.cantidad ELSE 0 END AS pvu_iva,
      CASE WHEN s.cantidad > 0 THEN s.costo_total / s.cantidad ELSE 0 END AS pcu
    FROM sums s
    LEFT JOIN fac  ON fac.${group.keyAlias}  = s.${group.keyAlias}
    LEFT JOIN itm  ON itm.${group.keyAlias}  = s.${group.keyAlias}
    LEFT JOIN dimc ON dimc.${group.keyAlias} = s.${group.keyAlias}
    ${orderBySql}
    ${limitSql}
  `;
};

/**
 * Filas POR DÍA (wrapper de `buildGroupedMetricsSql`).
 * Medido 2026-07-31: Sort+DISTINCT ~62 s → HashAggregate ~26 s (mes × 11 sedes).
 */
export const buildDayMetricsSql = (
  table: MargenDataTable,
  whereSql: string,
  orderBySql = "",
): string =>
  buildGroupedMetricsSql(
    table,
    whereSql,
    { keySql: "fecha_dcto", keyAlias: "fecha_dcto" },
    orderBySql,
  );

/**
 * Nivel N híbrido: dinero + facturas desde el roll factura+ítem (única fuente de
 * `ventas_con_iva` y `documento_fc`) y los conteos de dimensiones desde
 * `margen_item_dia_roll`, que para la misma ventana tiene ~8,7x menos filas
 * (441.537 vs 3.842.527 en 13 días × 11 sedes, medido en GCP 2026-08-14).
 *
 * Por qué importa: `buildGroupedMetricsSql` materializa el CTE `base` y lo
 * recorre CUATRO veces (sums, fac, itm, dims). Sobre el roll eso son 3,8M filas
 * volcadas a un tuplestore que se derrama a disco. Moviendo itm/dims a item_dia
 * el CTE del roll se queda en dos recorridos y mucho más angosto.
 *
 * Medido contra GCP el 2026-08-14 con el SQL que emiten ESTAS funciones,
 * alternando A/B EN CALIENTE (la primera lectura de cada ventana viene de disco
 * y confunde caché fría con costo real; agosto 1-13 × 11 sedes):
 *
 *   nivel 1 = ACUMULADO → Categorías     nivel 2 = Líneas dentro de Mercado
 *          agrupado   híbrido                   agrupado   híbrido
 *   r1     10.949 ms  7.466 ms            r1    10.469 ms  8.980 ms
 *   r2      8.429 ms  6.129 ms            r2    11.681 ms  7.875 ms
 *   r3      9.813 ms  6.174 ms            r3    10.005 ms  7.822 ms
 *
 * Verificado que las filas salen IDÉNTICAS: EXCEPT ALL en ambos sentidos = 0
 * (2 filas en nivel 1, 48 en nivel 2).
 *
 * Lo que NO arregla: el grueso del tiempo es leer el roll factura+ítem
 * (3,84M filas / 1,06 GB de páginas para esa ventana). Reformular el agregado
 * del dinero casi no mueve la aguja — se probaron tres formas y quedaron todas
 * entre 5,4 y 7,0 s. Para bajar de ahí habría que dejar de tocar el roll en
 * nivel 0..4, y eso exige `ventas_con_iva` en item_dia + un rollup de facturas
 * por día/sede (documento_fc se repite entre sedes, así que no se puede contar
 * por sede y sumar).
 *
 * `keySql` tiene que existir en LAS DOS tablas: solo sirve para claves que
 * `margen_item_dia_roll` también agrupa (fecha, tipo, línea, sublínea, ítem).
 * La etiqueta sigue saliendo del roll (`labelSourceSql`) para no depender de
 * cómo quedó el MAX() al refrescar item_dia.
 *
 * `rollWhereSql` / `itemDiaWhereSql` deben usar placeholders continuos del
 * mismo array de params (primero roll, luego item_dia).
 */
export const buildGroupedMetricsHybridSql = (
  rollTable: MargenDataTable,
  rollWhereSql: string,
  itemDiaWhereSql: string,
  group: {
    keySql: string;
    keyAlias: string;
    /** Columna/expresión en el ROLL para MAX → etiqueta (nombre línea, etc.). */
    labelSourceSql?: string;
    labelAlias?: string;
  },
  orderBySql = "",
  limitSql = "",
): string => {
  const key = group.keyAlias;
  const labelAlias = group.labelAlias ?? "nombre";
  const labelSelect = group.labelSourceSql ? `, m.${labelAlias}` : "";

  return `
  WITH money AS (
    ${buildEntityBoardMetricsSql(rollTable, rollWhereSql, {
      keySql: group.keySql,
      keyAlias: key,
      ...(group.labelSourceSql
        ? { labelSourceSql: group.labelSourceSql, labelAlias }
        : {}),
    })}
  ),
  base AS (
    SELECT
      ${group.keySql} AS ${key},
      NULLIF(id_tipo, '') AS dim_tipo,
      NULLIF(id_linea1, '') AS dim_linea1,
      NULLIF(id_linea2, '') AS dim_linea2,
      NULLIF(id_item, '') AS dim_item
    FROM margen_item_dia_roll
    WHERE ${itemDiaWhereSql}
  ),
  itm AS (
    SELECT ${key}, COUNT(*) AS items
    FROM (
      SELECT DISTINCT ${key}, dim_item
      FROM base
      WHERE dim_item IS NOT NULL
    ) d
    GROUP BY ${key}
  ),
  dims AS (
    SELECT DISTINCT ${key}, dim_tipo, dim_linea1, dim_linea2 FROM base
  ),
  dimc AS (
    SELECT
      ${key},
      COUNT(DISTINCT dim_tipo) AS categorias,
      COUNT(DISTINCT dim_linea1) AS lineas,
      COUNT(DISTINCT dim_linea2) AS sublineas
    FROM dims
    GROUP BY ${key}
  )
  SELECT
    m.${key}
    ${labelSelect},
    m.ventas_netas,
    m.costo_total,
    m.margen_pesos,
    m.cantidad,
    m.ventas_con_iva,
    m.facturas,
    COALESCE(itm.items, 0) AS items,
    COALESCE(dimc.categorias, 0) AS categorias,
    COALESCE(dimc.lineas, 0) AS lineas,
    COALESCE(dimc.sublineas, 0) AS sublineas,
    m.margen_pct,
    m.pvu_iva,
    m.pcu
  FROM money m
  LEFT JOIN itm ON itm.${key} = m.${key}
  LEFT JOIN dimc ON dimc.${key} = m.${key}
  ${orderBySql}
  ${limitSql}
`;
};

/**
 * Nivel 0 híbrido (wrapper de `buildGroupedMetricsHybridSql` por fecha).
 * Medido 2026-08-06 (5 días × 13 sedes, Mercado): full `buildDayMetricsSql`
 * ~5,8 s → híbrido ~4,5 s. Las dims solas en item_dia ~0,4 s.
 */
export const buildDayMetricsHybridSql = (
  rollTable: MargenDataTable,
  rollWhereSql: string,
  itemDiaWhereSql: string,
  orderBySql = "",
): string =>
  buildGroupedMetricsHybridSql(
    rollTable,
    rollWhereSql,
    itemDiaWhereSql,
    { keySql: "fecha_dcto", keyAlias: "fecha_dcto" },
    orderBySql,
  );

/**
 * Métricas del tablero Por Cliente / facturas de cliente:
 * sin COUNT DISTINCT de categorías/líneas/ítems (no se muestran y son caros).
 */
export const ROLL_BOARD_METRICS_SQL = `
  COALESCE(SUM(ventas_netas), 0) AS ventas_netas,
  COALESCE(SUM(costo_total), 0) AS costo_total,
  COALESCE(SUM(margen_pesos), 0) AS margen_pesos,
  COALESCE(SUM(cantidad), 0) AS cantidad,
  COALESCE(SUM(ventas_con_iva), 0) AS ventas_con_iva,
  COUNT(DISTINCT NULLIF(documento_fc, '')) FILTER (
    WHERE NULLIF(documento_fc, '') IS NOT NULL
  ) AS facturas
  , CASE WHEN SUM(COALESCE(ventas_netas,0)) > 0 THEN SUM(COALESCE(margen_pesos,0)) / SUM(COALESCE(ventas_netas,0)) ELSE 0 END AS margen_pct
  , CASE WHEN SUM(COALESCE(cantidad,0)) > 0 THEN SUM(COALESCE(ventas_con_iva,0)) / SUM(COALESCE(cantidad,0)) ELSE 0 END AS pvu_iva
  , CASE WHEN SUM(COALESCE(cantidad,0)) > 0 THEN SUM(COALESCE(costo_total,0)) / SUM(COALESCE(cantidad,0)) ELSE 0 END AS pcu
`;

export const BOARD_METRICS_SQL = `
  COALESCE(SUM(COALESCE(vlrtot_bru, 0)), 0) AS ventas_netas,
  COALESCE(SUM(COALESCE(tot_costo, 0)), 0) AS costo_total,
  COALESCE(SUM(COALESCE(vlrtot_bru, 0) - COALESCE(tot_costo, 0)), 0) AS margen_pesos,
  COALESCE(SUM(COALESCE(cantidad, 0)), 0) AS cantidad,
  COALESCE(SUM(COALESCE(ven_totales, 0)), 0) AS ventas_con_iva,
  COUNT(DISTINCT NULLIF(TRIM(documento_fc::text), '')) FILTER (
    WHERE NULLIF(TRIM(documento_fc::text), '') IS NOT NULL
  ) AS facturas
  , CASE WHEN SUM(COALESCE(vlrtot_bru,0)) > 0 THEN SUM(COALESCE(vlrtot_bru,0)-COALESCE(tot_costo,0)) / SUM(COALESCE(vlrtot_bru,0)) ELSE 0 END AS margen_pct
  , CASE WHEN SUM(COALESCE(cantidad,0)) > 0 THEN SUM(COALESCE(ven_totales,0)) / SUM(COALESCE(cantidad,0)) ELSE 0 END AS pvu_iva
  , CASE WHEN SUM(COALESCE(cantidad,0)) > 0 THEN SUM(COALESCE(tot_costo,0)) / SUM(COALESCE(cantidad,0)) ELSE 0 END AS pcu
`;

/**
 * Solo SUM (+ ratios). Sin COUNT DISTINCT.
 * Usar cuando el GROUP BY YA es la factura (o no se muestran conteos de dims).
 * `facturas` queda en 1 por grupo.
 */
export const ROLL_SUM_METRICS_SQL = `
  COALESCE(SUM(ventas_netas), 0) AS ventas_netas,
  COALESCE(SUM(costo_total), 0) AS costo_total,
  COALESCE(SUM(margen_pesos), 0) AS margen_pesos,
  COALESCE(SUM(cantidad), 0) AS cantidad,
  COALESCE(SUM(ventas_con_iva), 0) AS ventas_con_iva,
  1 AS facturas,
  0 AS categorias,
  0 AS lineas,
  0 AS sublineas,
  0 AS items,
  CASE WHEN SUM(COALESCE(ventas_netas,0)) > 0 THEN SUM(COALESCE(margen_pesos,0)) / SUM(COALESCE(ventas_netas,0)) ELSE 0 END AS margen_pct,
  CASE WHEN SUM(COALESCE(cantidad,0)) > 0 THEN SUM(COALESCE(ventas_con_iva,0)) / SUM(COALESCE(cantidad,0)) ELSE 0 END AS pvu_iva,
  CASE WHEN SUM(COALESCE(cantidad,0)) > 0 THEN SUM(COALESCE(costo_total,0)) / SUM(COALESCE(cantidad,0)) ELSE 0 END AS pcu
`;

export const SUM_METRICS_SQL = `
  COALESCE(SUM(COALESCE(vlrtot_bru, 0)), 0) AS ventas_netas,
  COALESCE(SUM(COALESCE(tot_costo, 0)), 0) AS costo_total,
  COALESCE(SUM(COALESCE(vlrtot_bru, 0) - COALESCE(tot_costo, 0)), 0) AS margen_pesos,
  COALESCE(SUM(COALESCE(cantidad, 0)), 0) AS cantidad,
  COALESCE(SUM(COALESCE(ven_totales, 0)), 0) AS ventas_con_iva,
  1 AS facturas,
  0 AS categorias,
  0 AS lineas,
  0 AS sublineas,
  0 AS items,
  CASE WHEN SUM(COALESCE(vlrtot_bru,0)) > 0 THEN SUM(COALESCE(vlrtot_bru,0)-COALESCE(tot_costo,0)) / SUM(COALESCE(vlrtot_bru,0)) ELSE 0 END AS margen_pct,
  CASE WHEN SUM(COALESCE(cantidad,0)) > 0 THEN SUM(COALESCE(ven_totales,0)) / SUM(COALESCE(cantidad,0)) ELSE 0 END AS pvu_iva,
  CASE WHEN SUM(COALESCE(cantidad,0)) > 0 THEN SUM(COALESCE(tot_costo,0)) / SUM(COALESCE(cantidad,0)) ELSE 0 END AS pcu
`;

export const sumMetricsSqlFor = (table: MargenDataTable) =>
  table === "margen_final_roll" || table === "margen_dinastia_roll"
    ? ROLL_SUM_METRICS_SQL
    : SUM_METRICS_SQL;

/**
 * Ranking cliente/vendedor/sede: SUM + facturas vía HashAggregate (sin
 * COUNT(DISTINCT) en el Aggregate exterior). Opcionalmente `dias`.
 */
export const buildEntityBoardMetricsSql = (
  table: MargenDataTable,
  whereSql: string,
  group: {
    keySql: string;
    keyAlias: string;
    labelSourceSql?: string;
    labelAlias?: string;
    includeDias?: boolean;
  },
  orderBySql = "",
  limitSql = "",
): string => {
  const isRoll =
    table === "margen_final_roll" || table === "margen_dinastia_roll";
  const ventas = isRoll ? "ventas_netas" : "COALESCE(vlrtot_bru, 0)";
  const costo = isRoll ? "costo_total" : "COALESCE(tot_costo, 0)";
  const margen = isRoll
    ? "margen_pesos"
    : "(COALESCE(vlrtot_bru, 0) - COALESCE(tot_costo, 0))";
  const conIva = isRoll ? "ventas_con_iva" : "COALESCE(ven_totales, 0)";
  const dimDoc = isRoll
    ? "NULLIF(documento_fc, '')"
    : "NULLIF(TRIM(documento_fc::text), '')";

  const labelAlias = group.labelAlias ?? "nombre";
  const labelInBase = group.labelSourceSql
    ? `, ${group.labelSourceSql} AS _label_src`
    : "";
  const labelInSums = group.labelSourceSql
    ? `, MAX(_label_src) AS _label_raw`
    : "";
  const labelSelect = group.labelSourceSql
    ? `, COALESCE(NULLIF(s._label_raw, ''), s.${group.keyAlias}::text) AS ${labelAlias}`
    : "";
  const diasInBase = group.includeDias ? ", fecha_dcto" : "";
  const diasCte = group.includeDias
    ? `,
    dias AS (
      SELECT ${group.keyAlias}, COUNT(*) AS dias
      FROM (SELECT DISTINCT ${group.keyAlias}, fecha_dcto FROM base) d
      GROUP BY ${group.keyAlias}
    )`
    : "";
  const diasJoin = group.includeDias
    ? `LEFT JOIN dias ON dias.${group.keyAlias} = s.${group.keyAlias}`
    : "";
  const diasSelect = group.includeDias
    ? ", COALESCE(dias.dias, 0) AS dias"
    : "";

  return `
    WITH base AS (
      SELECT
        ${group.keySql} AS ${group.keyAlias}
        ${labelInBase}
        ${diasInBase},
        ${dimDoc} AS documento_fc,
        ${ventas} AS ventas_netas,
        ${costo} AS costo_total,
        ${margen} AS margen_pesos,
        COALESCE(cantidad, 0) AS cantidad,
        ${conIva} AS ventas_con_iva
      FROM ${table}
      WHERE ${whereSql}
    ),
    sums AS (
      SELECT
        ${group.keyAlias}
        ${labelInSums},
        COALESCE(SUM(ventas_netas), 0) AS ventas_netas,
        COALESCE(SUM(costo_total), 0) AS costo_total,
        COALESCE(SUM(margen_pesos), 0) AS margen_pesos,
        COALESCE(SUM(cantidad), 0) AS cantidad,
        COALESCE(SUM(ventas_con_iva), 0) AS ventas_con_iva
      FROM base
      GROUP BY ${group.keyAlias}
    ),
    fac AS (
      SELECT ${group.keyAlias}, COUNT(*) AS facturas
      FROM (
        SELECT DISTINCT ${group.keyAlias}, documento_fc
        FROM base
        WHERE documento_fc IS NOT NULL
      ) d
      GROUP BY ${group.keyAlias}
    )
    ${diasCte}
    SELECT
      s.${group.keyAlias}
      ${labelSelect},
      s.ventas_netas,
      s.costo_total,
      s.margen_pesos,
      s.cantidad,
      s.ventas_con_iva,
      COALESCE(fac.facturas, 0) AS facturas,
      CASE WHEN s.ventas_netas > 0 THEN s.margen_pesos / s.ventas_netas ELSE 0 END AS margen_pct,
      CASE WHEN s.cantidad > 0 THEN s.ventas_con_iva / s.cantidad ELSE 0 END AS pvu_iva,
      CASE WHEN s.cantidad > 0 THEN s.costo_total / s.cantidad ELSE 0 END AS pcu
      ${diasSelect}
    FROM sums s
    LEFT JOIN fac ON fac.${group.keyAlias} = s.${group.keyAlias}
    ${diasJoin}
    ${orderBySql}
    ${limitSql}
  `;
};

export const metricsSqlFor = (table: MargenDataTable) =>
  table === "margen_final_roll" || table === "margen_dinastia_roll"
    ? ROLL_METRICS_SQL
    : METRICS_SQL;

export const boardMetricsSqlFor = (table: MargenDataTable) =>
  table === "margen_final_roll" || table === "margen_dinastia_roll"
    ? ROLL_BOARD_METRICS_SQL
    : BOARD_METRICS_SQL;

export const ROLL_SUMMARY_METRICS_SQL = `
  COALESCE(SUM(ventas_netas), 0) AS ventas_netas,
  COALESCE(SUM(costo_total), 0) AS costo_total,
  COALESCE(SUM(margen_pesos), 0) AS margen_pesos
`;

export const summaryMetricsSqlFor = (table: MargenDataTable) =>
  table === "margen_final_roll" || table === "margen_dinastia_roll"
    ? ROLL_SUMMARY_METRICS_SQL
    : margenMetricSelect;
