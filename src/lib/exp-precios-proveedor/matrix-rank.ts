/**
 * El ranking de la matriz es por venta neta. El costo de entrada es caro y
 * solo hace falta para las filas que se pintan.
 */
export const pickCostosMatrixItemIds = (
  rows: Iterable<{ id: string; sales: number }>,
  itemLimit: number,
): string[] => {
  const limit = Math.max(0, Math.floor(itemLimit));
  if (limit === 0) return [];
  return [...rows]
    .sort((a, b) => b.sales - a.sales)
    .slice(0, limit)
    .map((row) => row.id);
};
