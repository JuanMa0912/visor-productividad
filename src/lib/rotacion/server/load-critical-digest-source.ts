import { withPoolClient } from "@/lib/db";
import {
  resolveRotacionBaseSqlFields,
  type RotacionBaseSqlFields,
} from "@/lib/rotacion/base-fields";
import type { RotacionPeriodoStdMeta } from "@/lib/rotacion/periodo-std";
import { getRotacionPeriodoStdMeta } from "@/lib/rotacion/periodo-std-server";
import { getRollingMonthBackRange } from "@/lib/rotacion/rolling-month-range";
import {
  clampDateRange,
  compactToIsoDate,
  getAvailableBounds,
  getRotacionAbcdConfigForScope,
  isIsoDate,
  limitDateRangeWindow,
  queryRotationRows,
} from "@/app/api/rotacion/route";
import { loadCeroEstadosForSede } from "@/lib/rotacion/server/load-cero-estados-for-sede";
import { emptyRestockEffectivenessScore } from "@/lib/rotacion/restock-effectiveness";
import type { RotacionCriticalDigestSource } from "@/lib/rotacion/critical-digest";
import { queryRestockEffectivenessScore } from "@/lib/rotacion/server/query-restock-effectiveness";

export type { RotacionCriticalDigestSource };

export type LoadRotacionCriticalDigestInput = {
  empresa: string;
  sedeId: string;
  sedeName: string;
  startDate?: string | null;
  endDate?: string | null;
};

/** Contexto compartido al cargar muchas sedes (evita N introspecciones). */
export type RotacionCriticalDigestSharedContext = {
  boundedRange: { start: string; end: string };
  precomputedFields: RotacionBaseSqlFields;
  periodoStdMeta: RotacionPeriodoStdMeta | null;
};

export async function resolveRotacionCriticalDigestSharedContext(
  startDate?: string | null,
  endDate?: string | null,
): Promise<RotacionCriticalDigestSharedContext | null> {
  const bounds = await getAvailableBounds();
  const minAvailableDate = compactToIsoDate(bounds?.min_date ?? null);
  const maxAvailableDate = compactToIsoDate(bounds?.max_date ?? null);
  if (!minAvailableDate || !maxAvailableDate) return null;

  const rollingDefault = getRollingMonthBackRange(
    minAvailableDate,
    maxAvailableDate,
  );
  const rawEndDate = isIsoDate(endDate ?? null) ? endDate! : maxAvailableDate;
  const rawStartDate = isIsoDate(startDate ?? null)
    ? startDate!
    : rollingDefault.start;
  const boundedRange = limitDateRangeWindow(
    clampDateRange({
      start: rawStartDate,
      end: rawEndDate,
      minDate: minAvailableDate,
      maxDate: maxAvailableDate,
    }),
  );

  const [precomputedFields, periodoStdMeta] = await Promise.all([
    withPoolClient((client) => resolveRotacionBaseSqlFields(client)),
    withPoolClient((client) => getRotacionPeriodoStdMeta(client)),
  ]);

  return { boundedRange, precomputedFields, periodoStdMeta };
}

/**
 * Carga filas de rotación y estados S.inventario con la misma lógica de rango
 * que GET /api/rotacion para una sede concreta.
 */
export async function loadRotacionCriticalDigestSource(
  input: LoadRotacionCriticalDigestInput,
  shared?: RotacionCriticalDigestSharedContext | null,
): Promise<RotacionCriticalDigestSource | null> {
  const context =
    shared ??
    (await resolveRotacionCriticalDigestSharedContext(
      input.startDate,
      input.endDate,
    ));
  if (!context) return null;

  const { boundedRange, precomputedFields, periodoStdMeta } = context;

  const [abcdConfig, estados, restockEffectiveness, rows] = await Promise.all([
    getRotacionAbcdConfigForScope(input.empresa, input.sedeId),
    loadCeroEstadosForSede(input.empresa, input.sedeId),
    withPoolClient((client) =>
      queryRestockEffectivenessScore(client, {
        empresa: input.empresa,
        sedeId: input.sedeId,
        dateStartIso: boundedRange.start,
        dateEndIso: boundedRange.end,
      }),
    ).catch((error) => {
      console.warn(
        `[rotacion-digest] score restock no disponible (${input.empresa}|${input.sedeId}):`,
        error instanceof Error ? error.message : error,
      );
      return emptyRestockEffectivenessScore(true);
    }),
    queryRotationRows({
      startDate: boundedRange.start,
      endDate: boundedRange.end,
      maxSalesValue: null,
      empresa: input.empresa,
      sedeId: input.sedeId,
      lineasN1: null,
      categoriaKeys: null,
      precomputedFields,
      periodoStdMeta,
    }),
  ]);

  return {
    rows,
    abcdConfig,
    dateRange: boundedRange,
    ceroEstadoByKey: estados.ceroEstadoByKey,
    restockEstadoByKey: estados.restockEstadoByKey,
    restockEffectiveness,
    sedeName: input.sedeName,
    empresa: input.empresa,
    sedeId: input.sedeId,
  };
}
