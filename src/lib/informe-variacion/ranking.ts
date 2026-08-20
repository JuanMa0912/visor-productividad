import {
  INFORME_UNIT_SUMMARY_KEY_INDEX,
  type PeriodTriple,
  type prepareInformeData,
} from "@/lib/informe-variacion/aggregate";
import { computeVariationPct } from "@/lib/informe-variacion/format";
import { readInformeRowPeriodTripleForLevel } from "@/lib/informe-variacion/informe-metric-values";
import { stripInformeSedeDisplayName } from "@/lib/informe-variacion/labels";
import { INFORME_EMPRESA_ORDER, type InformeMetric } from "@/lib/informe-variacion/types";

export type InformeRankingDimension =
  | "emp"
  | "sede"
  | "marca"
  | "lin"
  | "sub"
  | "prov"
  | "item";

export const INFORME_RANKING_DIMENSIONS: Array<{
  id: InformeRankingDimension;
  label: string;
  keyIndex: number;
}> = [
  { id: "emp", label: "Compañía", keyIndex: -2 },
  { id: "sede", label: "Sede", keyIndex: 0 },
  { id: "marca", label: "Categoría", keyIndex: 1 },
  { id: "lin", label: "Línea", keyIndex: 2 },
  { id: "sub", label: "Sublínea", keyIndex: 3 },
  { id: "prov", label: "Empresa (proveedor)", keyIndex: -1 },
  { id: "item", label: "Ítem", keyIndex: 4 },
];

export const INFORME_RANKING_LIMITS = [10, 20, 50, 100] as const;

export const clampInformeRankingLimit = (value: number): number => {
  if (!Number.isFinite(value)) return 20;
  return Math.min(200, Math.max(5, Math.round(value)));
};

export type InformeRankingSortCol = "name" | "cur" | "prev" | "var" | number;

export type InformeRankingTableSort = {
  col: InformeRankingSortCol;
  dir: number;
};

export const DEFAULT_INFORME_RANKING_SORT: InformeRankingTableSort = {
  col: "cur",
  dir: 1,
};

export type InformeRankingRow = {
  key: number;
  label: string;
  total: PeriodTriple;
  perSede: PeriodTriple[];
};

export type InformeEmpresaSummaryRow = {
  label: string;
  total: PeriodTriple;
  yoyOk: boolean;
  share: number;
};

type Prepared = ReturnType<typeof prepareInformeData>;

const emptyTriple = (): PeriodTriple => [0, 0, 0];

const addTriple = (target: PeriodTriple, source: PeriodTriple) => {
  target[0] += source[0];
  target[1] += source[1];
  target[2] += source[2];
};

const labelsForDimension = (
  payload: Prepared,
  dimension: InformeRankingDimension,
): string[] => {
  if (dimension === "emp") {
    return INFORME_EMPRESA_ORDER.map((empresa) => empresa.label);
  }
  if (dimension === "sede") {
    return payload.sedes.map((sede) => stripInformeSedeDisplayName(sede.s));
  }
  if (dimension === "lin") return payload.lins;
  if (dimension === "sub") return payload.subs;
  if (dimension === "marca") return payload.cats;
  if (dimension === "prov") return payload.provs ?? ["(Sin proveedor)"];
  return payload.items;
};

const keyIndexForDimension = (dimension: InformeRankingDimension): number =>
  INFORME_RANKING_DIMENSIONS.find((item) => item.id === dimension)?.keyIndex ?? 4;

const rankingKeyForRow = (
  payload: Prepared,
  dimension: InformeRankingDimension,
  row: Prepared["rows"][number],
  keyIndex: number,
): number => {
  if (dimension === "prov") return payload.itemProv?.[row[4]] ?? 0;
  if (dimension === "sede") return row[0];
  if (dimension === "emp") {
    const label = payload.sedes[row[0]]?.e ?? "";
    const index = INFORME_EMPRESA_ORDER.findIndex((empresa) => empresa.label === label);
    return index >= 0 ? index : INFORME_EMPRESA_ORDER.length;
  }
  return row[keyIndex];
};

const numericSortValue = (
  row: InformeRankingRow,
  col: Exclude<InformeRankingSortCol, "name">,
): number => {
  if (typeof col === "number") {
    const values = row.perSede[col] ?? emptyTriple();
    return values[0];
  }
  if (col === "prev") return row.total[1];
  if (col === "var") {
    return (
      computeVariationPct(row.total[0], row.total[1]) ??
      (row.total[0] > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY)
    );
  }
  return row.total[0];
};

export const buildInformeRankingRows = ({
  payload,
  metric,
  pass,
  dimension,
  sort = DEFAULT_INFORME_RANKING_SORT,
  limit = 20,
}: {
  payload: Prepared;
  metric: InformeMetric;
  pass: (row: Prepared["rows"][number]) => boolean;
  dimension: InformeRankingDimension;
  sort?: InformeRankingTableSort;
  limit?: number;
}): InformeRankingRow[] => {
  const keyIndex = keyIndexForDimension(dimension);
  const labels = labelsForDimension(payload, dimension);
  const sedeCount = payload.sedes.length;
  const buckets = new Map<number, { total: PeriodTriple; perSede: PeriodTriple[] }>();
  const cappedLimit = clampInformeRankingLimit(limit);
  const dir = sort.dir < 0 ? -1 : 1;

  for (const row of payload.rows) {
    if (!pass(row)) continue;
    const key = rankingKeyForRow(payload, dimension, row, keyIndex);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        total: emptyTriple(),
        perSede: Array.from({ length: sedeCount }, () => emptyTriple()),
      };
      buckets.set(key, bucket);
    }
    const triple = readInformeRowPeriodTripleForLevel(
      row,
      metric,
      payload.metricCtx,
      keyIndex === 4
        ? 4
        : keyIndex === 2 || keyIndex === 3
          ? keyIndex
          : INFORME_UNIT_SUMMARY_KEY_INDEX,
    );
    addTriple(bucket.total, triple);
    addTriple(bucket.perSede[row[0]]!, triple);
  }

  const rows = [...buckets.entries()].map(([key, bucket]) => ({
    key,
    label: labels[key] ?? `#${key}`,
    total: bucket.total,
    perSede: bucket.perSede,
  }));

  rows.sort((a, b) => {
    if (sort.col === "name") {
      const byOrder =
        dimension === "sede" || dimension === "emp"
          ? a.key - b.key
          : a.label.localeCompare(b.label, "es");
      if (byOrder !== 0) return byOrder * dir;
      return a.label.localeCompare(b.label, "es");
    }
    const diff =
      (numericSortValue(b, sort.col) - numericSortValue(a, sort.col)) * dir;
    if (diff !== 0) return diff;
    return a.label.localeCompare(b.label, "es");
  });

  return rows.slice(0, cappedLimit);
};

export const buildInformeEmpresaSummary = ({
  perSede,
  payload,
}: {
  perSede: PeriodTriple[];
  payload: Prepared;
}): InformeEmpresaSummaryRow[] => {
  const grand = perSede.reduce(
    (acc, values) => acc + values[0],
    0,
  );
  return INFORME_EMPRESA_ORDER.flatMap((empresa) => {
    const indices = payload.sedes
      .map((sede, index) => (sede.e === empresa.label ? index : -1))
      .filter((index) => index >= 0);
    if (indices.length === 0) return [];
    const total = indices.reduce<PeriodTriple>(
      (acc, index) => {
        const values = perSede[index] ?? emptyTriple();
        return [acc[0] + values[0], acc[1] + values[1], acc[2] + values[2]];
      },
      emptyTriple(),
    );
    return [
      {
        label: empresa.label,
        total,
        yoyOk: payload.empYoy[empresa.label] ?? false,
        share: grand > 0 ? total[0] / grand : 0,
      },
    ];
  });
};
