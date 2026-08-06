import {
  aggregateBySede,
  aggregateMarginBySede,
  aggregateVentasBySede,
  filterRowIndices,
  sumFilteredRows,
  sumRowIndices,
  type PeriodTriple,
} from "@/lib/informe-variacion/aggregate";
import type { prepareInformeData } from "@/lib/informe-variacion/aggregate";
import type { InformeCompactRow, InformeMetric } from "@/lib/informe-variacion/types";

type Prepared = ReturnType<typeof prepareInformeData>;

/** Totales / sedes sin filtros: evita re-escanear filas al cambiar de corte. */
export type UnfilteredBoardWarm = {
  kpi: Record<InformeMetric, PeriodTriple>;
  kpiYoy: Record<InformeMetric, PeriodTriple>;
  growthSedes: Record<InformeMetric, number>;
  /** Sin floor pollos — KPI crecimiento + totales matriz. */
  perSede: Record<InformeMetric, PeriodTriple[]>;
  /** Con floor pollos — igual que SedeSummaryTable. */
  perSedeSummary: Record<InformeMetric, PeriodTriple[]>;
  perSedeVentas: PeriodTriple[];
  perSedeMargin: PeriodTriple[];
};

const unfilteredBoardWarmByRows = new WeakMap<
  InformeCompactRow[],
  UnfilteredBoardWarm
>();

export const getUnfilteredBoardWarm = (
  rows: InformeCompactRow[],
): UnfilteredBoardWarm | undefined => unfilteredBoardWarmByRows.get(rows);

const countGrowthSedes = (
  perSede: PeriodTriple[],
  sedeYoy: boolean[],
): number => {
  let count = 0;
  perSede.forEach((values, index) => {
    if (sedeYoy[index] && values[2] > 0 && values[0] > values[2]) {
      count += 1;
    }
  });
  return count;
};

export const warmUnfilteredBoard = (prepared: Prepared): UnfilteredBoardWarm => {
  const existing = unfilteredBoardWarmByRows.get(prepared.rows);
  if (existing) return existing;

  const passAll = () => true;
  const allIndices = filterRowIndices(prepared.rows, passAll);
  const yoyIndices = allIndices.filter(
    (index) => prepared.sedeYoy[prepared.rows[index]![0]],
  );

  const perSedeU = aggregateBySede(
    prepared.rows,
    "u",
    prepared.sedes.length,
    passAll,
    prepared.metricCtx,
  );
  const perSedeV = aggregateBySede(
    prepared.rows,
    "v",
    prepared.sedes.length,
    passAll,
    prepared.metricCtx,
  );
  const perSedeUSummary = aggregateBySede(
    prepared.rows,
    "u",
    prepared.sedes.length,
    passAll,
    prepared.metricCtx,
    { floorCompletePollosUnd: true },
  );
  // Ventas: floor no aplica; reutilizar.
  const perSedeVSummary = perSedeV;

  const warm: UnfilteredBoardWarm = {
    kpi: {
      u: sumFilteredRows(prepared.rows, "u", passAll, prepared.metricCtx),
      v: sumFilteredRows(prepared.rows, "v", passAll, prepared.metricCtx),
    },
    kpiYoy: {
      u: sumRowIndices(prepared.rows, yoyIndices, "u", prepared.metricCtx),
      v: sumRowIndices(prepared.rows, yoyIndices, "v", prepared.metricCtx),
    },
    growthSedes: {
      u: countGrowthSedes(perSedeU, prepared.sedeYoy),
      v: countGrowthSedes(perSedeV, prepared.sedeYoy),
    },
    perSede: { u: perSedeU, v: perSedeV },
    perSedeSummary: { u: perSedeUSummary, v: perSedeVSummary },
    perSedeVentas: aggregateVentasBySede(
      prepared.rows,
      prepared.sedes.length,
      passAll,
    ),
    perSedeMargin: aggregateMarginBySede(
      prepared.rows,
      prepared.sedes.length,
      passAll,
    ),
  };

  unfilteredBoardWarmByRows.set(prepared.rows, warm);
  return warm;
};
