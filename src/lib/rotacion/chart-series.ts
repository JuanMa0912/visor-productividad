import {
  getSedeOrderIndexForRawName,
} from "@/lib/shared/constants";
import {
  bestLineaDisplayFromRow,
  normalizeLineaN1CodeForFilter,
  normalizeLineaN2CodeForFilter,
  type RotationRow,
} from "@/app/rotacion/rotacion-preamble";
import type {
  RotacionCriticalBucket,
  RotacionCriticalDigestFamily,
  RotacionCriticalTaggedRow,
} from "@/lib/rotacion/critical-digest";

export type RotacionChartGroupBy = "sede" | "linea" | "sublinea" | "item";
export type RotacionChartMetric = "items" | "inventario" | "unidades";

export const ROTACION_CHART_BUCKETS: ReadonlyArray<{
  id: RotacionCriticalBucket;
  label: string;
  color: string;
}> = [
  { id: "demandaD", label: "Demanda D", color: "#9f1239" },
  { id: "cero", label: "Cero rotacion", color: "#475569" },
  { id: "restock", label: "Restock S", color: "#d97706" },
];

export type RotacionChartStackRow = {
  key: string;
  label: string;
  demandaD: number;
  cero: number;
  restock: number;
  total: number;
};

export type RotacionChartFocus = {
  groupBy: RotacionChartGroupBy;
  key: string;
  label: string;
};

const metricValue = (
  tagged: RotacionCriticalTaggedRow,
  metric: RotacionChartMetric,
): number => {
  if (metric === "items") return 1;
  if (metric === "unidades") return tagged.row.inventoryUnits;
  return tagged.row.inventoryValue;
};

const groupIdentity = (
  row: RotationRow,
  groupBy: RotacionChartGroupBy,
): { key: string; label: string } => {
  if (groupBy === "sede") {
    return {
      key: `${row.empresa}::${row.sedeId}`,
      label: row.sedeName || row.sedeId,
    };
  }
  if (groupBy === "linea") {
    const code = normalizeLineaN1CodeForFilter(row.lineaN1Codigo);
    const name = bestLineaDisplayFromRow(row);
    return {
      key: code || row.linea || "(sin linea)",
      label: name || code || row.linea || "(sin linea)",
    };
  }
  if (groupBy === "sublinea") {
    const n1 = normalizeLineaN1CodeForFilter(row.lineaN1Codigo);
    const n2 = normalizeLineaN2CodeForFilter(row.lineaN2Codigo);
    const label = row.sublinea?.trim() || n2 || "(sin sublinea)";
    return { key: `${n1}|${n2 || label}`, label };
  }
  const desc = row.descripcion?.trim();
  return {
    key: row.item,
    label: desc ? `${row.item} · ${desc}` : row.item,
  };
};

export const filterTaggedRowsForChart = (
  tagged: readonly RotacionCriticalTaggedRow[],
  families: readonly RotacionCriticalDigestFamily[],
  focusTrail: readonly RotacionChartFocus[],
): RotacionCriticalTaggedRow[] => {
  const familySet = new Set(families);
  return tagged.filter((entry) => {
    if (!familySet.has(entry.family)) return false;
    for (const focus of focusTrail) {
      if (groupIdentity(entry.row, focus.groupBy).key !== focus.key) {
        return false;
      }
    }
    return true;
  });
};

const compareStackRows = (
  a: RotacionChartStackRow,
  b: RotacionChartStackRow,
  groupBy: RotacionChartGroupBy,
): number => {
  if (groupBy === "sede") {
    const order = getSedeOrderIndexForRawName(a.label) - getSedeOrderIndexForRawName(b.label);
    if (order !== 0) return order;
    return a.label.localeCompare(b.label, "es");
  }
  if (b.total !== a.total) return b.total - a.total;
  return a.label.localeCompare(b.label, "es");
};

export const buildRotacionChartStacks = (
  tagged: readonly RotacionCriticalTaggedRow[],
  groupBy: RotacionChartGroupBy,
  metric: RotacionChartMetric,
  limit = 0,
): RotacionChartStackRow[] => {
  const buckets = new Map<string, RotacionChartStackRow>();
  for (const entry of tagged) {
    const { key, label } = groupIdentity(entry.row, groupBy);
    const current = buckets.get(key) ?? {
      key,
      label,
      demandaD: 0,
      cero: 0,
      restock: 0,
      total: 0,
    };
    const value = metricValue(entry, metric);
    current[entry.bucket] += value;
    current.total += value;
    buckets.set(key, current);
  }

  const rows = [...buckets.values()]
    .filter((row) => row.total !== 0)
    .sort((a, b) => compareStackRows(a, b, groupBy));

  if (limit <= 0 || rows.length <= limit || groupBy === "sede") return rows;

  const head = rows.slice(0, limit);
  const rest = rows.slice(limit);
  const otros = rest.reduce<RotacionChartStackRow>(
    (acc, row) => ({
      key: acc.key,
      label: acc.label,
      demandaD: acc.demandaD + row.demandaD,
      cero: acc.cero + row.cero,
      restock: acc.restock + row.restock,
      total: acc.total + row.total,
    }),
    {
      key: "__otros__",
      label: `Otros (${rest.length})`,
      demandaD: 0,
      cero: 0,
      restock: 0,
      total: 0,
    },
  );
  return otros.total === 0 ? head : [...head, otros];
};

export const sumRotacionChartStacks = (
  rows: readonly RotacionChartStackRow[],
): Omit<RotacionChartStackRow, "key" | "label"> =>
  rows.reduce(
    (acc, row) => ({
      demandaD: acc.demandaD + row.demandaD,
      cero: acc.cero + row.cero,
      restock: acc.restock + row.restock,
      total: acc.total + row.total,
    }),
    { demandaD: 0, cero: 0, restock: 0, total: 0 },
  );

export const nextChartGroupBy = (
  groupBy: RotacionChartGroupBy,
): RotacionChartGroupBy | null => {
  if (groupBy === "sede") return "linea";
  if (groupBy === "linea") return "sublinea";
  if (groupBy === "sublinea") return "item";
  return null;
};
