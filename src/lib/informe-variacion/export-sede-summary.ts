import type { PeriodTriple } from "@/lib/informe-variacion/aggregate";
import {
  aggregateBySede,
  aggregateMarginBySede,
  aggregateVentasBySede,
} from "@/lib/informe-variacion/aggregate";
import {
  formatInformeValueRaw,
  margenPctValue,
  variationPctLabel,
  variationPctNumber,
} from "@/lib/informe-variacion/format";
import type { InformeMetric, InformeVariacionPayload } from "@/lib/informe-variacion/types";
import { INFORME_EMPRESA_ORDER } from "@/lib/informe-variacion/types";
import type { prepareInformeData } from "@/lib/informe-variacion/aggregate";

type Prepared = ReturnType<typeof prepareInformeData>;

export type SedeSummaryExportRowKind = "empresa" | "sede" | "total";

export type SedeSummaryExportRow = {
  kind: SedeSummaryExportRowKind;
  empresa: string;
  sede: string;
  current: number;
  yoyBase: number | null;
  yoyPct: string;
  yoyPctValue: number | null;
  momBase: number;
  momPct: string;
  momPctValue: number | null;
  currentMargPct: number | null;
  yoyMargPct: number | null;
  momMargPct: number | null;
  participationPct: number | null;
};

export const buildSedeSummaryExportRows = (
  payload: Prepared,
  metric: InformeMetric,
  pass: (row: InformeVariacionPayload["rows"][number]) => boolean,
): SedeSummaryExportRow[] => {
  const perSede = aggregateBySede(
    payload.rows,
    metric,
    payload.sedes.length,
    pass,
    payload.metricCtx,
  );
  const perSedeVentas = aggregateVentasBySede(payload.rows, payload.sedes.length, pass);
  const perSedeMargin = aggregateMarginBySede(payload.rows, payload.sedes.length, pass);
  const total = perSede.reduce<PeriodTriple>(
    (acc, values) => [acc[0] + values[0], acc[1] + values[1], acc[2] + values[2]],
    [0, 0, 0],
  );

  const rows: SedeSummaryExportRow[] = [];

  for (const empresa of INFORME_EMPRESA_ORDER) {
    const indices = payload.sedes
      .map((sede, index) => (sede.e === empresa.label ? index : -1))
      .filter((index) => index >= 0);
    if (indices.length === 0) continue;

    const empresaSum = indices.reduce<PeriodTriple>(
      (acc, index) => [
        acc[0] + perSede[index][0],
        acc[1] + perSede[index][1],
        acc[2] + perSede[index][2],
      ],
      [0, 0, 0],
    );
    const empresaVentas = indices.reduce<PeriodTriple>(
      (acc, index) => [
        acc[0] + perSedeVentas[index][0],
        acc[1] + perSedeVentas[index][1],
        acc[2] + perSedeVentas[index][2],
      ],
      [0, 0, 0],
    );
    const empresaMargin = indices.reduce<PeriodTriple>(
      (acc, index) => [
        acc[0] + perSedeMargin[index][0],
        acc[1] + perSedeMargin[index][1],
        acc[2] + perSedeMargin[index][2],
      ],
      [0, 0, 0],
    );

    rows.push({
      kind: "empresa",
      empresa: empresa.label,
      sede: "",
      current: formatInformeValueRaw(empresaSum[0], metric),
      yoyBase: payload.empYoy[empresa.label]
        ? formatInformeValueRaw(empresaSum[2], metric)
        : null,
      yoyPct: variationPctLabel(
        empresaSum[0],
        empresaSum[2],
        payload.empYoy[empresa.label],
      ),
      yoyPctValue: variationPctForExcel(
        formatInformeValueRaw(empresaSum[0], metric),
        formatInformeValueRaw(empresaSum[2], metric),
        payload.empYoy[empresa.label],
      ),
      momBase: formatInformeValueRaw(empresaSum[1], metric),
      momPct: variationPctLabel(empresaSum[0], empresaSum[1]),
      momPctValue: variationPctForExcel(
        formatInformeValueRaw(empresaSum[0], metric),
        formatInformeValueRaw(empresaSum[1], metric),
      ),
      currentMargPct: margenPctValue(empresaVentas[0], empresaMargin[0]),
      yoyMargPct: payload.empYoy[empresa.label]
        ? margenPctValue(empresaVentas[2], empresaMargin[2])
        : null,
      momMargPct: margenPctValue(empresaVentas[1], empresaMargin[1]),
      participationPct: total[0] > 0 ? (empresaSum[0] / total[0]) * 100 : null,
    });

    for (const index of indices) {
      const values = perSede[index];
      const current = formatInformeValueRaw(values[0], metric);
      const yoyBase = payload.sedeYoy[index]
        ? formatInformeValueRaw(values[2], metric)
        : null;
      const momBase = formatInformeValueRaw(values[1], metric);
      rows.push({
        kind: "sede",
        empresa: empresa.label,
        sede: payload.sedes[index]!.s,
        current,
        yoyBase,
        yoyPct: variationPctLabel(values[0], values[2], payload.sedeYoy[index]),
        yoyPctValue: variationPctForExcel(current, yoyBase ?? 0, payload.sedeYoy[index]),
        momBase,
        momPct: variationPctLabel(values[0], values[1]),
        momPctValue: variationPctForExcel(current, momBase),
        currentMargPct: margenPctValue(perSedeVentas[index][0], perSedeMargin[index][0]),
        yoyMargPct: payload.sedeYoy[index]
          ? margenPctValue(perSedeVentas[index][2], perSedeMargin[index][2])
          : null,
        momMargPct: margenPctValue(perSedeVentas[index][1], perSedeMargin[index][1]),
        participationPct: total[0] > 0 ? (values[0] / total[0]) * 100 : null,
      });
    }
  }

  const totalYoyBase = perSede.reduce(
    (sum, values, index) => sum + (payload.sedeYoy[index] ? values[2] : 0),
    0,
  );
  const totalCurrent = formatInformeValueRaw(total[0], metric);
  const totalMomBase = formatInformeValueRaw(total[1], metric);
  const totalYoyBaseFmt = formatInformeValueRaw(totalYoyBase, metric);
  const totalVentas = perSedeVentas.reduce<PeriodTriple>(
    (acc, values) => [acc[0] + values[0], acc[1] + values[1], acc[2] + values[2]],
    [0, 0, 0],
  );
  const totalMargin = perSedeMargin.reduce<PeriodTriple>(
    (acc, values) => [acc[0] + values[0], acc[1] + values[1], acc[2] + values[2]],
    [0, 0, 0],
  );
  const totalYoyVentas = perSedeVentas.reduce(
    (sum, values, index) => sum + (payload.sedeYoy[index] ? values[2] : 0),
    0,
  );
  const totalYoyMargin = perSedeMargin.reduce(
    (sum, values, index) => sum + (payload.sedeYoy[index] ? values[2] : 0),
    0,
  );

  rows.push({
    kind: "total",
    empresa: "TOTAL COMPANIAS",
    sede: "",
    current: totalCurrent,
    yoyBase: totalYoyBaseFmt,
    yoyPct: variationPctLabel(total[0], totalYoyBase),
    yoyPctValue: variationPctForExcel(totalCurrent, totalYoyBaseFmt),
    momBase: totalMomBase,
    momPct: variationPctLabel(total[0], total[1]),
    momPctValue: variationPctForExcel(totalCurrent, totalMomBase),
    currentMargPct: margenPctValue(totalVentas[0], totalMargin[0]),
    yoyMargPct: margenPctValue(totalYoyVentas, totalYoyMargin),
    momMargPct: margenPctValue(totalVentas[1], totalMargin[1]),
    participationPct: null,
  });

  return rows;
};

export const sedeSummaryExportFilename = (
  periodLabel: string,
  metric: InformeMetric,
): string => {
  const safe = periodLabel.replace(/[^\w-]+/g, "_");
  const suffix = metric === "u" ? "unidades" : "valor";
  return `informe-variacion-sedes_${safe}_${suffix}.xlsx`;
};

/** Valor numerico YoY/MoM para Excel (null si N/D o Nuevo). */
export const variationPctForExcel = (
  current: number,
  previous: number,
  yoyOk = true,
): number | null => {
  if (!yoyOk) return null;
  if (previous === 0) return null;
  return variationPctNumber(current, previous);
};
