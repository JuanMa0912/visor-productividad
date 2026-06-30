import {
  CERO_ROTACION_ESTADO_LABELS,
  DEFAULT_CERO_ROTACION_ESTADO,
  makeCeroRotacionEstadoKey,
  type CeroRotacionEstado,
} from "@/lib/rotacion/cero-estado";
import type { RotacionCriticalDigestSource } from "@/lib/rotacion/server/load-critical-digest-source";
import type { RotationRow, AbcdConfig, DateRange } from "@/app/rotacion/rotacion-preamble";
import {
  NO_SALES_DI_VALUE,
  buildAbcdCategoryByItem,
  countInclusiveDays,
  isCeroRotacionExcludingNuevo,
  isNuevoItemRow,
  matchesLineaN1Family,
  normalizeRotationRows,
  parseDateKey,
} from "@/app/rotacion/rotacion-preamble";

export type SurtidoEstadoBreakdown = {
  itemCount: number;
  sinVerificar: number;
  seguimiento: number;
  surtido: number;
  /** Porcentaje de ítems marcados como surtido (0–100). */
  surtidoPct: number | null;
};

export type DemandaDDigest = {
  itemCount: number;
  totalInventario: number;
  diasInventario: number;
};

export type RotacionCriticalDigestSection = {
  total: {
    itemCount: number;
    totalInventario: number;
  };
  demandaD: DemandaDDigest;
  ceroRotacion: SurtidoEstadoBreakdown;
  restockS: SurtidoEstadoBreakdown;
};

export type RotacionCriticalDigestFamily = "perecederos" | "manufactura";

export type RotacionCriticalDigest = {
  sedeName: string;
  empresa: string;
  sedeId: string;
  dateRange: DateRange;
  daysConsulted: number;
  total: {
    itemCount: number;
    totalInventario: number;
  };
  perecederos: RotacionCriticalDigestSection;
  manufactura: RotacionCriticalDigestSection;
};

const isNuevoItemInSelectedRange = (
  row: RotationRow,
  dateRange: DateRange,
): boolean => {
  const rangeForS =
    dateRange.start && dateRange.end ? dateRange : null;
  if (!isNuevoItemRow(row, rangeForS)) return false;
  if (!row.lastPurchaseDate || !dateRange.start || !dateRange.end) return true;
  const lastSale = parseDateKey(row.lastPurchaseDate);
  const rangeStart = parseDateKey(dateRange.start);
  const rangeEnd = parseDateKey(dateRange.end);
  const hasSaleDateInsideSelectedRange =
    lastSale >= rangeStart && lastSale <= rangeEnd;
  return !hasSaleDateInsideSelectedRange;
};

const isAbcdFilterableRow = (row: RotationRow, dateRange: DateRange) =>
  !isNuevoItemInSelectedRange(row, dateRange) &&
  !isCeroRotacionExcludingNuevo(row, dateRange);

const sumInventoryValue = (rows: RotationRow[]) =>
  rows.reduce((acc, row) => acc + row.inventoryValue, 0);

const computeSalesCoverageDays = (
  rows: RotationRow[],
  daysConsulted: number,
): number => {
  const totalInvUnits = rows.reduce((acc, row) => acc + row.inventoryUnits, 0);
  const totalUnits = rows.reduce((acc, row) => acc + row.totalUnits, 0);
  if (totalUnits > 0 && daysConsulted > 0) {
    return (totalInvUnits * daysConsulted) / totalUnits;
  }
  if (totalInvUnits > 0) return NO_SALES_DI_VALUE;
  return 0;
};

const countEstadoBreakdown = (
  rows: RotationRow[],
  estadoByKey: Record<string, CeroRotacionEstado>,
): SurtidoEstadoBreakdown => {
  let sinVerificar = 0;
  let seguimiento = 0;
  let surtido = 0;
  for (const row of rows) {
    const key = makeCeroRotacionEstadoKey(row.empresa, row.sedeId, row.item);
    const estado = estadoByKey[key] ?? DEFAULT_CERO_ROTACION_ESTADO;
    if (estado === "sin_verificar") sinVerificar += 1;
    else if (estado === "seguimiento") seguimiento += 1;
    else surtido += 1;
  }
  const itemCount = rows.length;
  return {
    itemCount,
    sinVerificar,
    seguimiento,
    surtido,
    surtidoPct: itemCount > 0 ? (surtido / itemCount) * 100 : null,
  };
};

const filterDemandaDRows = (
  rows: RotationRow[],
  dateRange: DateRange,
  categoryByItem: Map<string, "A" | "B" | "C" | "D">,
) =>
  rows.filter((row) => {
    const cat = categoryByItem.get(row.item);
    return isAbcdFilterableRow(row, dateRange) && cat === "D";
  });

const filterRowsByFamily = (
  rows: RotationRow[],
  family: RotacionCriticalDigestFamily,
) =>
  rows.filter((row) =>
    matchesLineaN1Family(
      row.lineaN1Codigo ?? row.linea ?? "",
      new Set([family]),
    ),
  );

const buildAbcdCategoryByItemForRows = (
  rows: RotationRow[],
  dateRange: DateRange,
  abcdConfig: AbcdConfig,
) =>
  buildAbcdCategoryByItem(
    rows.filter((row) => isAbcdFilterableRow(row, dateRange)),
    abcdConfig,
  );

const buildDigestSection = (
  rows: RotationRow[],
  dateRange: DateRange,
  categoryByItem: Map<string, "A" | "B" | "C" | "D">,
  ceroEstadoByKey: Record<string, CeroRotacionEstado>,
  restockEstadoByKey: Record<string, CeroRotacionEstado>,
  daysConsulted: number,
): RotacionCriticalDigestSection => {
  const ceroRows = rows.filter((row) =>
    isCeroRotacionExcludingNuevo(row, dateRange),
  );
  const restockRows = rows.filter((row) =>
    isNuevoItemInSelectedRange(row, dateRange),
  );
  const demandaDRows = filterDemandaDRows(rows, dateRange, categoryByItem);
  const criticalRows = [...demandaDRows, ...ceroRows, ...restockRows];

  return {
    total: {
      itemCount: demandaDRows.length + ceroRows.length + restockRows.length,
      totalInventario: sumInventoryValue(criticalRows),
    },
    demandaD: {
      itemCount: demandaDRows.length,
      totalInventario: sumInventoryValue(demandaDRows),
      diasInventario: computeSalesCoverageDays(demandaDRows, daysConsulted),
    },
    ceroRotacion: countEstadoBreakdown(ceroRows, ceroEstadoByKey),
    restockS: countEstadoBreakdown(restockRows, restockEstadoByKey),
  };
};

const buildFamilyDigestSection = (
  allRows: RotationRow[],
  family: RotacionCriticalDigestFamily,
  dateRange: DateRange,
  abcdConfig: AbcdConfig,
  ceroEstadoByKey: Record<string, CeroRotacionEstado>,
  restockEstadoByKey: Record<string, CeroRotacionEstado>,
  daysConsulted: number,
): RotacionCriticalDigestSection => {
  const familyRows = filterRowsByFamily(allRows, family);
  const categoryByItem = buildAbcdCategoryByItemForRows(
    familyRows,
    dateRange,
    abcdConfig,
  );
  return buildDigestSection(
    familyRows,
    dateRange,
    categoryByItem,
    ceroEstadoByKey,
    restockEstadoByKey,
    daysConsulted,
  );
};

export const buildRotacionCriticalDigest = (
  source: RotacionCriticalDigestSource,
): RotacionCriticalDigest => {
  const dateRange = source.dateRange;
  const rows = normalizeRotationRows(source.rows);
  const daysConsulted = countInclusiveDays(dateRange);
  const abcdConfig = source.abcdConfig as AbcdConfig;

  const perecederos = buildFamilyDigestSection(
    rows,
    "perecederos",
    dateRange,
    abcdConfig,
    source.ceroEstadoByKey,
    source.restockEstadoByKey,
    daysConsulted,
  );
  const manufactura = buildFamilyDigestSection(
    rows,
    "manufactura",
    dateRange,
    abcdConfig,
    source.ceroEstadoByKey,
    source.restockEstadoByKey,
    daysConsulted,
  );

  /** Total sede: misma regla que la UI sin filtro de familia (ABCD sobre todo el catálogo). */
  const globalCategoryByItem = buildAbcdCategoryByItemForRows(
    rows,
    dateRange,
    abcdConfig,
  );
  const globalDemandaDRows = filterDemandaDRows(
    rows,
    dateRange,
    globalCategoryByItem,
  );
  const globalCeroRows = rows.filter((row) =>
    isCeroRotacionExcludingNuevo(row, dateRange),
  );
  const globalRestockRows = rows.filter((row) =>
    isNuevoItemInSelectedRange(row, dateRange),
  );
  const total = {
    itemCount:
      globalDemandaDRows.length +
      globalCeroRows.length +
      globalRestockRows.length,
    totalInventario: sumInventoryValue([
      ...globalDemandaDRows,
      ...globalCeroRows,
      ...globalRestockRows,
    ]),
  };

  return {
    sedeName: source.sedeName,
    empresa: source.empresa,
    sedeId: source.sedeId,
    dateRange,
    daysConsulted,
    total,
    perecederos,
    manufactura,
  };
};

export { CERO_ROTACION_ESTADO_LABELS };
