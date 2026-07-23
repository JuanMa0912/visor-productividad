import type { InformeCompactRow, InformeMetric } from "@/lib/informe-variacion/types";
import type { PeriodTriple } from "@/lib/informe-variacion/aggregate";
import { metricOffset } from "@/lib/informe-variacion/format";
import {
  convertAsaderoQtyToPollosUnd,
  floorCompletePollosUnd,
  isAsaderoPollosUndContribution,
  resolveAsaderoPollosConversion,
  shouldConvertAsaderoToPollosUnd,
} from "@/lib/informe-variacion/asadero-pollos-und";
import {
  convertHuevosQtyToUndIndividuales,
  shouldConvertHuevosLineTotals,
  shouldConvertHuevosToUndIndividuales,
} from "@/lib/informe-variacion/huevos-individual-und";
import { convertQtyToGroupUom, resolveLineDisplayUom, resolveSublineDisplayUom } from "@/lib/informe-variacion/line-item-uom";

export type InformeMetricContext = {
  cats: string[];
  lins: string[];
  subs: string[];
  items: string[];
  ums: string[];
  lineDisplayUom: ReadonlyMap<number, string>;
  sublineDisplayUom: ReadonlyMap<string, string>;
  sublineItems: ReadonlyMap<string, readonly number[]>;
  lineItems: ReadonlyMap<number, readonly number[]>;
};

const rowUnitTriple = (row: InformeCompactRow): PeriodTriple => [row[5], row[6], row[7]];

/** Valores tal como vienen de la BD. */
export const readInformeRowPeriodTriple = (
  row: InformeCompactRow,
  metric: InformeMetric,
  ctx: InformeMetricContext,
): PeriodTriple => {
  void ctx;
  const offset = metricOffset(metric);
  return [row[offset], row[offset + 1], row[offset + 2]];
};

const convertHuevosRowTriple = (
  row: InformeCompactRow,
  ctx: InformeMetricContext,
): PeriodTriple => {
  const [cur, mom, yoy] = rowUnitTriple(row);
  const itemLabel = ctx.items[row[4]] ?? "";
  const unitId = ctx.ums[row[4]] ?? "";
  return [
    convertHuevosQtyToUndIndividuales(cur, itemLabel, unitId),
    convertHuevosQtyToUndIndividuales(mom, itemLabel, unitId),
    convertHuevosQtyToUndIndividuales(yoy, itemLabel, unitId),
  ];
};

/**
 * Unidades en pollos und para totales de sublinea 01 POLLO.
 * Fuera de esa sublinea devuelve las unidades crudas.
 */
export const readInformeRowPollosUndTriple = (
  row: InformeCompactRow,
  ctx: InformeMetricContext,
): PeriodTriple => {
  const [cur, mom, yoy] = rowUnitTriple(row);

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

/**
 * Huevos individuales para totales de sublinea de huevos.
 */
export const readInformeRowHuevosUndTriple = (
  row: InformeCompactRow,
  ctx: InformeMetricContext,
): PeriodTriple => {
  const raw = rowUnitTriple(row);
  const linLabel = ctx.lins[row[2]] ?? "";
  const subLabel = ctx.subs[row[3]] ?? "";
  if (!shouldConvertHuevosToUndIndividuales(linLabel, subLabel)) {
    return raw;
  }
  return convertHuevosRowTriple(row, ctx);
};

/**
 * Total de linea 01 POLLO ASADO: pollos und + porciones en unidades crudas.
 */
export const readInformeRowLinePollosUndTriple = (
  row: InformeCompactRow,
  ctx: InformeMetricContext,
): PeriodTriple => {
  const raw = rowUnitTriple(row);

  const catLabel = ctx.cats[row[1]] ?? "";
  const linLabel = ctx.lins[row[2]] ?? "";
  const subLabel = ctx.subs[row[3]] ?? "";
  if (!shouldConvertAsaderoToPollosUnd(catLabel, linLabel, subLabel)) {
    return raw;
  }

  const itemLabel = ctx.items[row[4]] ?? "";
  const unitId = ctx.ums[row[4]] ?? "";
  const conversion = resolveAsaderoPollosConversion(
    itemLabel,
    unitId,
    linLabel,
    subLabel,
  );
  if (conversion.kind === "exclude") {
    return raw;
  }

  const [cur, mom, yoy] = raw;
  return [
    convertAsaderoQtyToPollosUnd(cur, itemLabel, unitId, linLabel, subLabel),
    convertAsaderoQtyToPollosUnd(mom, itemLabel, unitId, linLabel, subLabel),
    convertAsaderoQtyToPollosUnd(yoy, itemLabel, unitId, linLabel, subLabel),
  ];
};

export const isInformeRowAsaderoPollosUndContribution = (
  row: InformeCompactRow,
  ctx: InformeMetricContext,
): boolean => {
  const catLabel = ctx.cats[row[1]] ?? "";
  const linLabel = ctx.lins[row[2]] ?? "";
  const subLabel = ctx.subs[row[3]] ?? "";
  const itemLabel = ctx.items[row[4]] ?? "";
  const unitId = ctx.ums[row[4]] ?? "";
  return isAsaderoPollosUndContribution(
    catLabel,
    linLabel,
    subLabel,
    itemLabel,
    unitId,
  );
};

export const floorPeriodTripleCompletePollos = (
  triple: PeriodTriple,
): PeriodTriple => [
  floorCompletePollosUnd(triple[0]),
  floorCompletePollosUnd(triple[1]),
  floorCompletePollosUnd(triple[2]),
];

/** Total de linea 12 HUEVOS: huevos individuales por empaque. */
export const readInformeRowLineHuevosUndTriple = (
  row: InformeCompactRow,
  ctx: InformeMetricContext,
): PeriodTriple => {
  const raw = rowUnitTriple(row);
  const linLabel = ctx.lins[row[2]] ?? "";
  const subLabel = ctx.subs[row[3]] ?? "";
  if (!shouldConvertHuevosLineTotals(linLabel)) {
    return raw;
  }
  if (!shouldConvertHuevosToUndIndividuales(linLabel, subLabel)) {
    return raw;
  }
  return convertHuevosRowTriple(row, ctx);
};

const readInformeRowGroupUomTriple = (
  row: InformeCompactRow,
  ctx: InformeMetricContext,
  displayLabel: string,
): PeriodTriple => {
  const [cur, mom, yoy] = rowUnitTriple(row);
  const itemLabel = ctx.items[row[4]] ?? "";
  const unitId = ctx.ums[row[4]] ?? "";
  return [
    convertQtyToGroupUom(cur, itemLabel, unitId, displayLabel),
    convertQtyToGroupUom(mom, itemLabel, unitId, displayLabel),
    convertQtyToGroupUom(yoy, itemLabel, unitId, displayLabel),
  ];
};

export const readInformeRowPeriodTripleForLevel = (
  row: InformeCompactRow,
  metric: InformeMetric,
  ctx: InformeMetricContext,
  keyIndex: number,
): PeriodTriple => {
  if (metric !== "u") {
    return readInformeRowPeriodTriple(row, metric, ctx);
  }

  // Totales padre (empresa/sede/categoría): rollup físico sin romper
  // padre >= hijo (asadero exclude queda en crudo, no en 0).
  if (keyIndex === 0 || keyIndex === 1) {
    return readInformeRowPeriodTripleForRollup(row, metric, ctx);
  }

  if (keyIndex === 3) {
    const linLabel = ctx.lins[row[2]] ?? "";
    const subLabel = ctx.subs[row[3]] ?? "";
    const catLabel = ctx.cats[row[1]] ?? "";
    if (shouldConvertAsaderoToPollosUnd(catLabel, linLabel, subLabel)) {
      return readInformeRowPollosUndTriple(row, ctx);
    }
    if (shouldConvertHuevosToUndIndividuales(linLabel, subLabel)) {
      return readInformeRowHuevosUndTriple(row, ctx);
    }
    const subUom = resolveSublineDisplayUom(ctx, row[2], row[3]);
    if (subUom) {
      return readInformeRowGroupUomTriple(row, ctx, subUom);
    }
    return readInformeRowPeriodTriple(row, metric, ctx);
  }

  if (keyIndex === 2) {
    const linLabel = ctx.lins[row[2]] ?? "";
    const catLabel = ctx.cats[row[1]] ?? "";
    const subLabel = ctx.subs[row[3]] ?? "";
    if (shouldConvertAsaderoToPollosUnd(catLabel, linLabel, subLabel)) {
      return readInformeRowLinePollosUndTriple(row, ctx);
    }
    if (shouldConvertHuevosLineTotals(linLabel)) {
      return readInformeRowLineHuevosUndTriple(row, ctx);
    }
    const linUom = resolveLineDisplayUom(ctx, row[2]);
    if (linUom) {
      return readInformeRowGroupUomTriple(row, ctx, linUom);
    }
    return readInformeRowPeriodTriple(row, metric, ctx);
  }

  return readInformeRowPeriodTriple(row, metric, ctx);
};

/**
 * Conversión para totales mezclados (empresa / sede / categoría / KPIs).
 * - Asadero 01 POLLO: reglas de línea (porciones excluidas en crudo).
 * - Huevos / kilos / litros: igual que sublínea homogénea.
 * Evita el caso padre < hijo al subir sublínea (exclude → 0).
 */
export const readInformeRowPeriodTripleForRollup = (
  row: InformeCompactRow,
  metric: InformeMetric,
  ctx: InformeMetricContext,
): PeriodTriple => {
  if (metric !== "u") {
    return readInformeRowPeriodTriple(row, metric, ctx);
  }

  const catLabel = ctx.cats[row[1]] ?? "";
  const linLabel = ctx.lins[row[2]] ?? "";
  const subLabel = ctx.subs[row[3]] ?? "";

  if (shouldConvertAsaderoToPollosUnd(catLabel, linLabel, subLabel)) {
    return readInformeRowLinePollosUndTriple(row, ctx);
  }
  if (shouldConvertHuevosToUndIndividuales(linLabel, subLabel)) {
    return readInformeRowHuevosUndTriple(row, ctx);
  }
  const subUom = resolveSublineDisplayUom(ctx, row[2], row[3]);
  if (subUom) {
    return readInformeRowGroupUomTriple(row, ctx, subUom);
  }
  const linUom = resolveLineDisplayUom(ctx, row[2]);
  if (linUom) {
    return readInformeRowGroupUomTriple(row, ctx, linUom);
  }
  return readInformeRowPeriodTriple(row, metric, ctx);
};

export const informeMetricContextFromPayload = (
  payload: {
    cats: string[];
    lins: string[];
    subs: string[];
    items: string[];
    ums?: string[];
  },
  uomIndex?: {
    lineDisplayUom: ReadonlyMap<number, string>;
    sublineDisplayUom: ReadonlyMap<string, string>;
    sublineItems: ReadonlyMap<string, readonly number[]>;
    lineItems: ReadonlyMap<number, readonly number[]>;
  },
): InformeMetricContext => ({
  cats: payload.cats,
  lins: payload.lins,
  subs: payload.subs,
  items: payload.items,
  ums: payload.ums ?? [],
  lineDisplayUom: uomIndex?.lineDisplayUom ?? new Map(),
  sublineDisplayUom: uomIndex?.sublineDisplayUom ?? new Map(),
  sublineItems: uomIndex?.sublineItems ?? new Map(),
  lineItems: uomIndex?.lineItems ?? new Map(),
});
