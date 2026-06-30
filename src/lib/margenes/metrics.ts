import { margenMetricSelect } from "@/lib/margenes/margen-final-query";

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

export const metricsSqlFor = (table: "margen_final" | "margen_final_roll") =>
  table === "margen_final_roll" ? ROLL_METRICS_SQL : METRICS_SQL;

export const ROLL_SUMMARY_METRICS_SQL = `
  COALESCE(SUM(ventas_netas), 0) AS ventas_netas,
  COALESCE(SUM(costo_total), 0) AS costo_total,
  COALESCE(SUM(margen_pesos), 0) AS margen_pesos
`;

export const summaryMetricsSqlFor = (
  table: "margen_final" | "margen_final_roll",
) => (table === "margen_final_roll" ? ROLL_SUMMARY_METRICS_SQL : margenMetricSelect);
