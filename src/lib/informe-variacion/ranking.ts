import {
  INFORME_UNIT_SUMMARY_KEY_INDEX,
  type PeriodTriple,
  type prepareInformeData,
} from "@/lib/informe-variacion/aggregate";
import { computeVariationPct } from "@/lib/informe-variacion/format";
import { readInformeRowPeriodTripleForLevel } from "@/lib/informe-variacion/informe-metric-values";
import { INFORME_EMPRESA_ORDER, type InformeMetric } from "@/lib/informe-variacion/types";

export type InformeRankingDimension = "lin" | "sub" | "marca" | "item";

export const INFORME_RANKING_DIMENSIONS: Array<{
  id: InformeRankingDimension;
  label: string;
  keyIndex: number;
}> = [
  { id: "lin", label: "Línea", keyIndex: 2 },
  { id: "sub", label: "Sublínea", keyIndex: 3 },
  { id: "marca", label: "Marca", keyIndex: 1 },
  { id: "item", label: "Producto", keyIndex: 4 },
];

export type InformeRankingSort = "cur" | "yoy" | "mom";

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
  if (dimension === "lin") return payload.lins;
  if (dimension === "sub") return payload.subs;
  if (dimension === "marca") return payload.cats;
  return payload.items;
};

const keyIndexForDimension = (dimension: InformeRankingDimension): number =>
  INFORME_RANKING_DIMENSIONS.find((item) => item.id === dimension)?.keyIndex ?? 4;

const sortValue = (
  total: PeriodTriple,
  sort: InformeRankingSort,
): number => {
  if (sort === "yoy") {
    return computeVariationPct(total[0], total[2]) ?? (total[0] > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
  }
  if (sort === "mom") {
    return computeVariationPct(total[0], total[1]) ?? (total[0] > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
  }
  return total[0];
};

export const buildInformeRankingRows = ({
  payload,
  metric,
  pass,
  dimension,
  sort = "cur",
  limit = 20,
}: {
  payload: Prepared;
  metric: InformeMetric;
  pass: (row: Prepared["rows"][number]) => boolean;
  dimension: InformeRankingDimension;
  sort?: InformeRankingSort;
  limit?: number;
}): InformeRankingRow[] => {
  const keyIndex = keyIndexForDimension(dimension);
  const labels = labelsForDimension(payload, dimension);
  const sedeCount = payload.sedes.length;
  const buckets = new Map<number, { total: PeriodTriple; perSede: PeriodTriple[] }>();

  for (const row of payload.rows) {
    if (!pass(row)) continue;
    const key = row[keyIndex];
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
      keyIndex === 4 ? 4 : keyIndex === 2 || keyIndex === 3 ? keyIndex : INFORME_UNIT_SUMMARY_KEY_INDEX,
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
    const diff = sortValue(b.total, sort) - sortValue(a.total, sort);
    if (diff !== 0) return diff;
    return a.label.localeCompare(b.label, "es");
  });

  return rows.slice(0, Math.max(1, limit));
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
