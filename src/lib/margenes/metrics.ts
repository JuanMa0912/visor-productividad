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
`;

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
