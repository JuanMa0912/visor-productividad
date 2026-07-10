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

export const readInformeRowPeriodTriple = (
  row: InformeCompactRow,
  metric: InformeMetric,
  ctx: InformeMetricContext,
): PeriodTriple => {
  const offset = metricOffset(metric);
  const cur = row[offset];
  const mom = row[offset + 1];
  const yoy = row[offset + 2];

  if (metric !== "u") return [cur, mom, yoy];

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
