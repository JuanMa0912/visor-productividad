/** Query params compartidos para abrir ventas/inventario por ítem desde otras vistas. */
export const ITEM_DRILLDOWN_QUERY = {
  item: "item",
  ventasStart: "start",
  ventasEnd: "end",
  inventarioDateStart: "dateStart",
  inventarioDateEnd: "dateEnd",
} as const;

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export function buildVentasXItemDrilldownUrl(itemId: string, date: string): string {
  const params = new URLSearchParams();
  if (isIsoDate(date)) {
    params.set(ITEM_DRILLDOWN_QUERY.ventasStart, date);
    params.set(ITEM_DRILLDOWN_QUERY.ventasEnd, date);
  }
  params.set(ITEM_DRILLDOWN_QUERY.item, itemId.trim());
  return `/ventas-x-item?${params.toString()}`;
}

export function buildInventarioXItemDrilldownUrl(
  itemId: string,
  date: string,
): string {
  const params = new URLSearchParams();
  if (isIsoDate(date)) {
    params.set(ITEM_DRILLDOWN_QUERY.inventarioDateStart, date);
    params.set(ITEM_DRILLDOWN_QUERY.inventarioDateEnd, date);
  }
  params.set(ITEM_DRILLDOWN_QUERY.item, itemId.trim());
  return `/inventario-x-item?${params.toString()}`;
}
