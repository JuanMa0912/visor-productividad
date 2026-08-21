import { isOverstockFilter } from "@/lib/rotacion/overstock";
import {
  formatAbcdCategoryFilterLabel,
  isCeroRotacionExcludingNuevo,
  type DateRange,
  type GroupAbcdFilter,
  type GroupRowsQuickFilter,
  type RotationRow,
} from "@/app/rotacion/rotacion-preamble";

export type RotacionTendenciaScope = {
  rows: RotationRow[];
  itemIds: string[];
  label: string;
  scoped: boolean;
};

const uniqueItemIds = (rows: RotationRow[]): string[] => [
  ...new Set(rows.map((row) => String(row.item ?? "").trim()).filter(Boolean)),
];

const applyCategoryFilter = (
  rows: RotationRow[],
  categoryFilter: GroupAbcdFilter,
  dateRange: DateRange,
  categoryByItem: Map<string, string>,
  isAbcdFilterableRow: (row: RotationRow) => boolean,
  isNuevoItemInSelectedRange: (row: RotationRow) => boolean,
): RotationRow[] => {
  if (categoryFilter === "all" || isOverstockFilter(categoryFilter)) {
    return rows;
  }
  if (categoryFilter === "0") {
    return rows.filter((row) => isCeroRotacionExcludingNuevo(row, dateRange));
  }
  if (categoryFilter === "S" || categoryFilter === "R" || categoryFilter === "N") {
    return rows.filter((row) => isNuevoItemInSelectedRange(row));
  }
  if (categoryFilter === "D0S") {
    return rows.filter((row) => {
      const isS = isNuevoItemInSelectedRange(row);
      const isZero = isCeroRotacionExcludingNuevo(row, dateRange);
      const isD =
        isAbcdFilterableRow(row) && categoryByItem.get(row.item) === "D";
      return isS || isZero || isD;
    });
  }
  if (Array.isArray(categoryFilter)) {
    return rows.filter((row) => {
      const cat = categoryByItem.get(row.item);
      return (
        isAbcdFilterableRow(row) &&
        cat !== undefined &&
        categoryFilter.includes(cat as "A" | "B" | "C" | "D")
      );
    });
  }
  return rows;
};

const scopeLabels = (
  categoryFilter: GroupAbcdFilter,
  ceroRotacionActive: boolean,
): string[] => {
  const labels: string[] = [];
  if (ceroRotacionActive) labels.push("Cero rotación");
  if (categoryFilter === "all" || isOverstockFilter(categoryFilter)) {
    return labels;
  }
  if (categoryFilter === "0") labels.push("0");
  else if (
    categoryFilter === "S" ||
    categoryFilter === "R" ||
    categoryFilter === "N"
  ) {
    labels.push("Restock");
  } else if (categoryFilter === "D0S") {
    labels.push("D+0+S");
  } else {
    const letterLabel = formatAbcdCategoryFilterLabel(categoryFilter);
    if (letterLabel) labels.push(`Clase ${letterLabel}`);
  }
  return labels;
};

/**
 * Ítems de la gráfica de tendencia: sede actual, con A/B/C/D, 0, restock o
 * cero rotación. Sobrestock / días de inventario no cambian el recorte.
 */
export const selectRotacionTendenciaRows = ({
  rows,
  categoryFilter,
  rowFilter,
  dateRange,
  categoryByItem,
  isAbcdFilterableRow,
  isNuevoItemInSelectedRange,
}: {
  rows: RotationRow[];
  categoryFilter: GroupAbcdFilter;
  rowFilter: GroupRowsQuickFilter;
  dateRange: DateRange;
  categoryByItem: Map<string, string>;
  isAbcdFilterableRow: (row: RotationRow) => boolean;
  isNuevoItemInSelectedRange: (row: RotationRow) => boolean;
}): RotacionTendenciaScope => {
  const ceroRotacionActive =
    rowFilter === "cero_rotacion" || rowFilter === "both";
  const base = ceroRotacionActive
    ? rows.filter((row) => isCeroRotacionExcludingNuevo(row, dateRange))
    : rows;
  const filtered = applyCategoryFilter(
    base,
    categoryFilter,
    dateRange,
    categoryByItem,
    isAbcdFilterableRow,
    isNuevoItemInSelectedRange,
  );
  const labels = scopeLabels(categoryFilter, ceroRotacionActive);
  return {
    rows: filtered,
    itemIds: uniqueItemIds(filtered),
    label: labels.length > 0 ? labels.join(" · ") : "Toda la sede",
    scoped: labels.length > 0,
  };
};
