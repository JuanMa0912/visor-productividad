import type { InformeCompactRow, InformeMetric } from "@/lib/informe-variacion/types";
import type { PeriodTriple } from "@/lib/informe-variacion/aggregate";
import { metricOffset } from "@/lib/informe-variacion/format";
import {
  convertAsaderoQtyToPollosUnd,
  shouldConvertAsaderoToPollosUnd,
} from "@/lib/informe-variacion/asadero-pollos-und";

export type InformeMetricContext = {
  cats: string[];
  lins: string[];
  subs: string[];
  items: string[];
  ums: string[];
};

/** Valores tal como vienen de la BD (sin convertir pollos). */
export const readInformeRowPeriodTriple = (
  row: InformeCompactRow,
  metric: InformeMetric,
  ctx: InformeMetricContext,
): PeriodTriple => {
  void ctx;
  const offset = metricOffset(metric);
  return [row[offset], row[offset + 1], row[offset + 2]];
};

/**
 * Unidades en pollos und para totales de sublinea 01 POLLO.
 * Fuera de esa sublinea devuelve las unidades crudas.
 */
export const readInformeRowPollosUndTriple = (
  row: InformeCompactRow,
  ctx: InformeMetricContext,
): PeriodTriple => {
  const cur = row[5];
  const mom = row[6];
  const yoy = row[7];

  const catLabel = ctx.cats[row[1]] ?? "";
  const linLabel = ctx.lins[row[2]] ?? "";
  const subLabel = ctx.subs[row[3]] ?? "";
  if (!shouldConvertAsaderoToPollosUnd(catLabel, linLabel, subLabel)) {
    return [cur, mom, yoy];
  }

  const itemLabel = ctx.items[row[4]] ?? "";
  const unitId = ctx.ums[row[4]] ?? "";
  return [
    convertAsaderoQtyToPollosUnd(cur, itemLabel, unitId, linLabel, subLabel),
    convertAsaderoQtyToPollosUnd(mom, itemLabel, unitId, linLabel, subLabel),
    convertAsaderoQtyToPollosUnd(yoy, itemLabel, unitId, linLabel, subLabel),
  ];
};

export const readInformeRowPeriodTripleForLevel = (
  row: InformeCompactRow,
  metric: InformeMetric,
  ctx: InformeMetricContext,
  keyIndex: number,
): PeriodTriple => {
  if (metric === "u" && keyIndex === 3) {
    return readInformeRowPollosUndTriple(row, ctx);
  }
  return readInformeRowPeriodTriple(row, metric, ctx);
};

export const informeMetricContextFromPayload = (payload: {
  cats: string[];
  lins: string[];
  subs: string[];
  items: string[];
  ums: string[];
}): InformeMetricContext => ({
  cats: payload.cats,
  lins: payload.lins,
  subs: payload.subs,
  items: payload.items,
  ums: payload.ums,
});
