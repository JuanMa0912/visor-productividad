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

/**
 * Cuando solo recibimos la fecha tope, devolvemos un rango movil de 1 mes hacia
 * atras (misma logica de `/rotacion`) para que el DI calce exactamente con el
 * DIC sin necesidad de pasar `dateStart` por URL.
 */
const expandSingleDateToMonth = (date: string): { start: string; end: string } | null => {
  if (!isIsoDate(date)) return null;
  const endAtNoon = new Date(`${date}T12:00:00`);
  if (Number.isNaN(endAtNoon.getTime())) return null;
  const formatYMD = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const oneMonthBack = new Date(endAtNoon);
  oneMonthBack.setMonth(oneMonthBack.getMonth() - 1);
  oneMonthBack.setDate(oneMonthBack.getDate() + 1);
  let start = formatYMD(oneMonthBack);
  if (start > date) start = date;
  return { start, end: date };
};

/**
 * Construye el URL de inventario por item respetando exactamente el mismo
 * rango que se este consultando en rotacion, para que DI = inventario * dias /
 * unidades_vendidas devuelva los mismos numeros en ambas vistas.
 *
 * - Si se reciben `dateStart` y `dateEnd` validos, se pasan tal cual.
 * - Si solo se recibe la fecha tope (caso historico), se expande a 1 mes movil
 *   hacia atras (mismo rango por defecto de `/rotacion`), evitando quedar con
 *   un solo dia y manteniendo DI == DIC.
 */
export function buildInventarioXItemDrilldownUrl(
  itemId: string,
  dateStart: string,
  dateEnd?: string,
): string {
  const params = new URLSearchParams();
  const startIso = isIsoDate(dateStart) ? dateStart : "";
  const endIso = dateEnd && isIsoDate(dateEnd) ? dateEnd : "";

  if (startIso && endIso) {
    const [start, end] = startIso <= endIso ? [startIso, endIso] : [endIso, startIso];
    params.set(ITEM_DRILLDOWN_QUERY.inventarioDateStart, start);
    params.set(ITEM_DRILLDOWN_QUERY.inventarioDateEnd, end);
  } else if (startIso || endIso) {
    const single = startIso || endIso;
    const expanded = expandSingleDateToMonth(single);
    if (expanded) {
      params.set(ITEM_DRILLDOWN_QUERY.inventarioDateStart, expanded.start);
      params.set(ITEM_DRILLDOWN_QUERY.inventarioDateEnd, expanded.end);
    }
  }

  params.set(ITEM_DRILLDOWN_QUERY.item, itemId.trim());
  return `/inventario-x-item?${params.toString()}`;
}
