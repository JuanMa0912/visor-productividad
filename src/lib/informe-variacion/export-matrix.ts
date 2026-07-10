import {
  filterRowIndices,
  aggregateIndicesBySede,
  filterIndexedRowIndices,
  type PeriodTriple,
} from "@/lib/informe-variacion/aggregate";
import {
  computeVariationPct,
  formatInformePct,
  formatInformeValue,
  heatmapCellStyle,
} from "@/lib/informe-variacion/format";
import { readInformeRowPeriodTriple } from "@/lib/informe-variacion/informe-metric-values";
import type { InformeMetric } from "@/lib/informe-variacion/types";
import type { prepareInformeData } from "@/lib/informe-variacion/aggregate";

type Prepared = ReturnType<typeof prepareInformeData>;

export type MatrixRawCell = {
  cur: number;
  base: number;
  nd: boolean;
} | null;

export type MatrixExportCell = {
  text: string;
  pct: number | null;
  nd: boolean;
  isValueMode: boolean;
};

export type MatrixExportRow = {
  label: string;
  depth: number;
  bold: boolean;
  cells: MatrixExportCell[];
};

export type BuildMatrixExportOptions = {
  payload: Prepared;
  metric: InformeMetric;
  pass: (row: Prepared["rows"][number]) => boolean;
  matrixMode: "yoy" | "mom";
  matrixDisplay: "pct" | "value";
  matrixOpen: ReadonlySet<string>;
  matrixSort: { col: number; dir: number };
};

const indentLabel = (label: string, depth: number) =>
  `${"  ".repeat(depth)}${label}`;

const sortMatrixKeys = (
  keys: number[],
  agg: Map<number, PeriodTriple[]>,
  labels: string[],
  matrixSort: { col: number; dir: number },
  matrixDisplay: "pct" | "value",
  matrixMode: "yoy" | "mom",
  sedeYoy: boolean[],
): number[] => {
  if (matrixSort.col < 0) {
    const sorted = [...keys].sort((a, b) => labels[a]!.localeCompare(labels[b]!, "es"));
    if (matrixSort.dir < 0) sorted.reverse();
    return sorted;
  }
  const val = (key: number) => {
    const per = agg.get(key);
    const values = per?.[matrixSort.col];
    if (!values) return matrixSort.dir > 0 ? -Infinity : Infinity;
    if (matrixDisplay === "value") return values[0];
    if (matrixMode === "yoy" && !sedeYoy[matrixSort.col]) return 0;
    const base = matrixMode === "mom" ? values[1] : values[2];
    return base > 0 ? values[0] / base - 1 : values[0] > 0 ? Infinity : -Infinity;
  };
  return [...keys].sort((a, b) => (val(b) - val(a)) * matrixSort.dir);
};

const buildMatrixCells = (
  payload: Prepared,
  perSede: PeriodTriple[] | undefined,
  matrixMode: "yoy" | "mom",
): MatrixRawCell[] =>
  payload.sedes.map((_, index) => {
    const values = perSede?.[index];
    if (!values) return null;
    const yoyUnavailable = matrixMode === "yoy" && !payload.sedeYoy[index];
    const base = matrixMode === "mom" ? values[1] : values[2];
    return {
      cur: values[0],
      base: yoyUnavailable ? 0 : base,
      nd: yoyUnavailable,
    };
  });

const formatMatrixCell = (
  cell: MatrixRawCell,
  matrixDisplay: "pct" | "value",
  metric: InformeMetric,
): MatrixExportCell => {
  if (matrixDisplay === "value") {
    if (!cell || cell.cur === 0) {
      return { text: "—", pct: null, nd: false, isValueMode: true };
    }
    return {
      text: formatInformeValue(cell.cur, metric),
      pct: null,
      nd: false,
      isValueMode: true,
    };
  }

  if (!cell) {
    return { text: "—", pct: null, nd: true, isValueMode: false };
  }
  if (cell.nd) {
    return { text: "N/D", pct: null, nd: true, isValueMode: false };
  }
  if (cell.base === 0) {
    return {
      text: cell.cur === 0 ? "—" : "Nuevo",
      pct: null,
      nd: false,
      isValueMode: false,
    };
  }
  const pct = computeVariationPct(cell.cur, cell.base);
  return {
    text: formatInformePct(pct),
    pct,
    nd: false,
    isValueMode: false,
  };
};

export const heatmapExcelArgb = (cell: MatrixExportCell): string => {
  if (cell.isValueMode) return "FFF8FAFC";
  const style = heatmapCellStyle(cell.pct, cell.nd);
  const match = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(style.background);
  if (!match) {
    return style.background === "#eef0f4" ? "FFEEF0F4" : "FFFFFFFF";
  }
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  const a = Number(match[4]);
  const blend = (channel: number) => Math.round(channel * a + 255 * (1 - a));
  const toHex = (value: number) => value.toString(16).padStart(2, "0").toUpperCase();
  return `FF${toHex(blend(r))}${toHex(blend(g))}${toHex(blend(b))}`;
};

export const heatmapPdfRgb = (
  cell: MatrixExportCell,
): { fill: [number, number, number]; text: [number, number, number] } => {
  if (cell.isValueMode) {
    return { fill: [248, 250, 252], text: [30, 41, 59] };
  }
  const style = heatmapCellStyle(cell.pct, cell.nd);
  const match = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(style.background);
  const textMatch = style.color.match(/#([0-9a-f]{6})/i);
  const textHex = textMatch?.[1] ?? "334155";
  const text: [number, number, number] = [
    Number.parseInt(textHex.slice(0, 2), 16),
    Number.parseInt(textHex.slice(2, 4), 16),
    Number.parseInt(textHex.slice(4, 6), 16),
  ];
  if (!match) {
    return { fill: [238, 240, 244], text: [154, 163, 178] };
  }
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  const a = Number(match[4]);
  const blend = (channel: number) => Math.round(channel * a + 255 * (1 - a));
  return { fill: [blend(r), blend(g), blend(b)], text };
};

export const buildMatrixExportRows = ({
  payload,
  metric,
  pass,
  matrixMode,
  matrixDisplay,
  matrixOpen,
  matrixSort,
}: BuildMatrixExportOptions): MatrixExportRow[] => {
  const filteredIndices = filterRowIndices(payload.rows, pass);
  const filteredSet = new Set(filteredIndices);

  const catAgg = aggregateIndicesBySede(
    payload.rows,
    filteredIndices,
    metric,
    payload.sedes.length,
    1,
    payload.metricCtx,
  );

  const totPer: PeriodTriple[] = Array.from({ length: payload.sedes.length }, () => [0, 0, 0]);
  for (const rowIndex of filteredIndices) {
    const row = payload.rows[rowIndex]!;
    const triple = readInformeRowPeriodTriple(row, metric, payload.metricCtx);
    const bucket = totPer[row[0]]!;
    bucket[0] += triple[0];
    bucket[1] += triple[1];
    bucket[2] += triple[2];
  }

  const rows: MatrixExportRow[] = [];

  const pushRow = (
    label: string,
    depth: number,
    bold: boolean,
    rawCells: MatrixRawCell[],
  ) => {
    rows.push({
      label: indentLabel(label, depth),
      depth,
      bold,
      cells: rawCells.map((cell) => formatMatrixCell(cell, matrixDisplay, metric)),
    });
  };

  pushRow("TOTAL (segun filtros)", 0, true, buildMatrixCells(payload, totPer, matrixMode));

  const catKeys = sortMatrixKeys(
    [...catAgg.keys()],
    catAgg,
    payload.cats,
    matrixSort,
    matrixDisplay,
    matrixMode,
    payload.sedeYoy,
  );

  for (const cat of catKeys) {
    const ck = `c${cat}`;
    const catPer = catAgg.get(cat) ?? [];
    pushRow(payload.cats[cat]!, 0, false, buildMatrixCells(payload, catPer, matrixMode));

    if (!matrixOpen.has(ck)) continue;

    const catIndices = filterIndexedRowIndices(
      payload.rowIndex.indicesByCat.get(cat),
      filteredSet,
    );
    const linAgg = aggregateIndicesBySede(
      payload.rows,
      catIndices,
      metric,
      payload.sedes.length,
      2,
      payload.metricCtx,
    );
    const linKeys = sortMatrixKeys(
      [...linAgg.keys()],
      linAgg,
      payload.lins,
      matrixSort,
      matrixDisplay,
      matrixMode,
      payload.sedeYoy,
    );

    for (const lin of linKeys) {
      const lk = `${ck}|l${lin}`;
      const linPer = linAgg.get(lin) ?? [];
      pushRow(payload.lins[lin]!, 1, false, buildMatrixCells(payload, linPer, matrixMode));

      if (!matrixOpen.has(lk)) continue;

      const linIndices = filterIndexedRowIndices(
        payload.rowIndex.indicesByCatLin.get(`${cat}|${lin}`),
        filteredSet,
      );
      const subAgg = aggregateIndicesBySede(
        payload.rows,
        linIndices,
        metric,
        payload.sedes.length,
        3,
        payload.metricCtx,
      );
      const subKeys = sortMatrixKeys(
        [...subAgg.keys()],
        subAgg,
        payload.subs,
        matrixSort,
        matrixDisplay,
        matrixMode,
        payload.sedeYoy,
      );

      for (const sub of subKeys) {
        const bk = `${lk}|b${sub}`;
        const subPer = subAgg.get(sub) ?? [];
        pushRow(payload.subs[sub]!, 2, false, buildMatrixCells(payload, subPer, matrixMode));

        if (!matrixOpen.has(bk)) continue;

        const subIndices = filterIndexedRowIndices(
          payload.rowIndex.indicesByCatLinSub.get(`${cat}|${lin}|${sub}`),
          filteredSet,
        );
        const itAgg = aggregateIndicesBySede(
          payload.rows,
          subIndices,
          metric,
          payload.sedes.length,
          4,
          payload.metricCtx,
        );
        const itKeys = [...itAgg.keys()]
          .sort((a, b) => {
            const sa = (itAgg.get(a) ?? []).reduce((sum, values) => sum + (values?.[0] ?? 0), 0);
            const sb = (itAgg.get(b) ?? []).reduce((sum, values) => sum + (values?.[0] ?? 0), 0);
            return sb - sa;
          })
          .slice(0, 30);

        for (const item of itKeys) {
          const itemPer = itAgg.get(item) ?? [];
          pushRow(payload.items[item]!, 3, false, buildMatrixCells(payload, itemPer, matrixMode));
        }
      }
    }
  }

  return rows;
};

export const matrixExportFilename = (
  periodLabel: string,
  metric: InformeMetric,
  matrixMode: "yoy" | "mom",
  matrixDisplay: "pct" | "value",
  ext: "xlsx" | "pdf",
): string => {
  const safe = periodLabel.replace(/[^\w-]+/g, "_");
  const metricSuffix = metric === "u" ? "unidades" : "valor";
  const modeSuffix = matrixDisplay === "value" ? "actual" : matrixMode;
  const displaySuffix = matrixDisplay === "value" ? "valores" : "pct";
  return `informe-variacion-matriz_${safe}_${metricSuffix}_${modeSuffix}_${displaySuffix}.${ext}`;
};

export const matrixExportMetaLine = (
  periodLabel: string,
  metric: InformeMetric,
  matrixMode: "yoy" | "mom",
  matrixDisplay: "pct" | "value",
): string => {
  const metricLabel = metric === "u" ? "Unidades" : "Valor ($ miles)";
  const viewLabel =
    matrixDisplay === "value"
      ? "Valores actuales"
      : matrixMode === "yoy"
        ? "Variacion YoY %"
        : "Variacion MoM %";
  return `Periodo: ${periodLabel} · Metrica: ${metricLabel} · Vista: ${viewLabel}`;
};
