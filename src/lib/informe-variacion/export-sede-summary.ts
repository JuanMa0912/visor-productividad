import type { PeriodTriple } from "@/lib/informe-variacion/aggregate";
import { aggregateBySede } from "@/lib/informe-variacion/aggregate";
import {
  formatInformeValueRaw,
  variationPctLabel,
  variationPctNumber,
} from "@/lib/informe-variacion/format";
import type { InformeMetric, InformeVariacionPayload } from "@/lib/informe-variacion/types";
import { INFORME_EMPRESA_ORDER } from "@/lib/informe-variacion/types";
import type { prepareInformeData } from "@/lib/informe-variacion/aggregate";

type Prepared = ReturnType<typeof prepareInformeData>;

export type SedeSummaryExportRow = {
  empresa: string;
  sede: string;
  current: number;
  yoyBase: number | null;
  yoyPct: string;
  momBase: number;
  momPct: string;
  participationPct: number | null;
};

export const buildSedeSummaryExportRows = (
  payload: Prepared,
  metric: InformeMetric,
  pass: (row: InformeVariacionPayload["rows"][number]) => boolean,
): SedeSummaryExportRow[] => {
  const perSede = aggregateBySede(payload.rows, metric, payload.sedes.length, pass);
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

    rows.push({
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
      momBase: formatInformeValueRaw(empresaSum[1], metric),
      momPct: variationPctLabel(empresaSum[0], empresaSum[1]),
      participationPct: total[0] > 0 ? (empresaSum[0] / total[0]) * 100 : null,
    });

    for (const index of indices) {
      const values = perSede[index];
      rows.push({
        empresa: empresa.label,
        sede: payload.sedes[index]!.s,
        current: formatInformeValueRaw(values[0], metric),
        yoyBase: payload.sedeYoy[index]
          ? formatInformeValueRaw(values[2], metric)
          : null,
        yoyPct: variationPctLabel(values[0], values[2], payload.sedeYoy[index]),
        momBase: formatInformeValueRaw(values[1], metric),
        momPct: variationPctLabel(values[0], values[1]),
        participationPct: total[0] > 0 ? (values[0] / total[0]) * 100 : null,
      });
    }
  }

  rows.push({
    empresa: "TOTAL COMPANIAS",
    sede: "",
    current: formatInformeValueRaw(total[0], metric),
    yoyBase: formatInformeValueRaw(
      perSede.reduce(
        (sum, values, index) => sum + (payload.sedeYoy[index] ? values[2] : 0),
        0,
      ),
      metric,
    ),
    yoyPct: variationPctLabel(
      total[0],
      perSede.reduce(
        (sum, values, index) => sum + (payload.sedeYoy[index] ? values[2] : 0),
        0,
      ),
    ),
    momBase: formatInformeValueRaw(total[1], metric),
    momPct: variationPctLabel(total[0], total[1]),
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
