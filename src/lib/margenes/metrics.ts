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
 * SQL de las filas POR DÍA sin agregados DISTINCT. Mismo truco que
 * `buildTotalMetricsSql`, aplicado al `GROUP BY fecha_dcto`.
 *
 * Por qué existe: `metricsSqlFor()` trae 5 `COUNT(DISTINCT ...)`. Con esos
 * agregados PostgreSQL descarta HashAggregate y resuelve el GROUP BY con un
 * `Sort` de la relación completa. Medido contra producción el 2026-07-31
 * (margen_final_roll en Cloud SQL, julio × 11 sedes = 8,17M filas):
 *
 *   GroupAggregate + Sort (external merge, 601 MB a disco) ..... 61,7 s
 *   esta forma (HashAggregate sobre CTE materializado) ......... 26,5 s
 *
 * Junto a la fila total (antes ~22 s) la petición `mode=drill` bajaba de ~84 s a
 * ~49 s. Desde 2026-08 el nivel 0 ya no llama `buildTotalMetricsSql`: KPI y
 * ACUMULADO se derivan en JS desde las filas por día (~26 s wall). Esta función
 * sigue disponible para rutas/KPI que necesiten DISTINCT globales exactos.
 *
 * El proxy corta a los 90 s, y `mode=filters` (29,6 s) corre en paralelo
 * compitiendo por CPU: por eso el tablero daba 504 con todas las sedes.
 *
 * Cosas que se midieron y NO sirven, para que nadie las reintente:
 *  - `work_mem` 64MB -> 256MB: 61,6 s -> 61,7 s. Nada. El costo es el número de
 *    ordenamientos, no el derrame a disco.
 *  - `max_parallel_workers_per_gather` 1 -> 4 (el rol `visor` lo tiene en 1):
 *    26,5 s -> 25,6 s. El plan nuevo se apoya en un CTE Scan, que no es
 *    paralelizable, así que la palanca de /api/rotacion aquí no aplica.
 *  - Cambiar el `(empresa_norm, id_co_norm) IN (SELECT * FROM UNNEST(...))` por
 *    un OR de ANDs: EMPEORA (26,5 s -> 61,3 s en el día; 22,2 s -> 29,2 s en el
 *    total). El Hash Semi Join cuesta menos que 22 comparaciones de texto por
 *    fila. El UNNEST se queda.
 *  - Índices: ninguno ayuda. Un mes × 11 sedes es el 99% de las filas de ese
 *    rango (`Rows Removed by Filter: 94297` de 8,26M), así que el plan barre la
 *    partición de fechas entera hágase lo que se haga.
 */
export const buildDayMetricsSql = (
  table: MargenDataTable,
  whereSql: string,
  orderBySql = "",
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
        fecha_dcto,
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
        fecha_dcto,
        COALESCE(SUM(ventas_netas), 0)   AS ventas_netas,
        COALESCE(SUM(costo_total), 0)    AS costo_total,
        COALESCE(SUM(margen_pesos), 0)   AS margen_pesos,
        COALESCE(SUM(cantidad), 0)       AS cantidad,
        COALESCE(SUM(ventas_con_iva), 0) AS ventas_con_iva
      FROM base
      GROUP BY fecha_dcto
    ),
    fac AS (
      SELECT fecha_dcto, COUNT(*) AS facturas
      FROM (SELECT DISTINCT fecha_dcto, documento_fc FROM base WHERE documento_fc IS NOT NULL) d
      GROUP BY fecha_dcto
    ),
    itm AS (
      SELECT fecha_dcto, COUNT(*) AS items
      FROM (SELECT DISTINCT fecha_dcto, id_item FROM base WHERE id_item IS NOT NULL) d
      GROUP BY fecha_dcto
    ),
    -- Una sola pasada para los tres conteos de baja cardinalidad.
    dims AS (
      SELECT DISTINCT fecha_dcto, id_tipo, id_linea1, id_linea2 FROM base
    ),
    dimc AS (
      SELECT
        fecha_dcto,
        COUNT(DISTINCT id_tipo)   AS categorias,
        COUNT(DISTINCT id_linea1) AS lineas,
        COUNT(DISTINCT id_linea2) AS sublineas
      FROM dims
      GROUP BY fecha_dcto
    )
    SELECT
      s.fecha_dcto,
      s.ventas_netas,
      s.costo_total,
      s.margen_pesos,
      s.cantidad,
      s.ventas_con_iva,
      COALESCE(fac.facturas, 0)   AS facturas,
      COALESCE(itm.items, 0)      AS items,
      COALESCE(dimc.categorias, 0) AS categorias,
      COALESCE(dimc.lineas, 0)     AS lineas,
      COALESCE(dimc.sublineas, 0)  AS sublineas,
      CASE WHEN s.ventas_netas > 0 THEN s.margen_pesos / s.ventas_netas ELSE 0 END AS margen_pct,
      CASE WHEN s.cantidad > 0 THEN s.ventas_con_iva / s.cantidad ELSE 0 END AS pvu_iva,
      CASE WHEN s.cantidad > 0 THEN s.costo_total / s.cantidad ELSE 0 END AS pcu
    FROM sums s
    LEFT JOIN fac  ON fac.fecha_dcto  = s.fecha_dcto
    LEFT JOIN itm  ON itm.fecha_dcto  = s.fecha_dcto
    LEFT JOIN dimc ON dimc.fecha_dcto = s.fecha_dcto
    ${orderBySql}
  `;
};

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
