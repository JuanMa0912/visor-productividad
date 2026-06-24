import { withPoolClient } from "@/lib/db";
import { resolveRotacionBaseSqlFields } from "@/lib/rotacion/base-fields";
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
  type RotationRow,
} from "@/app/api/rotacion/route";
import type { AbcdConfig } from "@/app/rotacion/rotacion-preamble";
import { loadCeroEstadosForSede } from "@/lib/rotacion/server/load-cero-estados-for-sede";
import type { CeroRotacionEstado } from "@/lib/rotacion/cero-estado";

export type RotacionCriticalDigestSource = {
  rows: RotationRow[];
  abcdConfig: AbcdConfig;
  dateRange: { start: string; end: string };
  ceroEstadoByKey: Record<string, CeroRotacionEstado>;
  restockEstadoByKey: Record<string, CeroRotacionEstado>;
  sedeName: string;
  empresa: string;
  sedeId: string;
};

export type LoadRotacionCriticalDigestInput = {
  empresa: string;
  sedeId: string;
  sedeName: string;
  startDate?: string | null;
  endDate?: string | null;
};

/**
 * Carga filas de rotación y estados S.inventario con la misma lógica de rango
 * que GET /api/rotacion para una sede concreta.
 */
export async function loadRotacionCriticalDigestSource(
  input: LoadRotacionCriticalDigestInput,
): Promise<RotacionCriticalDigestSource | null> {
  const bounds = await getAvailableBounds();
  const minAvailableDate = compactToIsoDate(bounds?.min_date ?? null);
  const maxAvailableDate = compactToIsoDate(bounds?.max_date ?? null);
  if (!minAvailableDate || !maxAvailableDate) return null;

  const rollingDefault = getRollingMonthBackRange(
    minAvailableDate,
    maxAvailableDate,
  );
  const rawEndDate = isIsoDate(input.endDate ?? null)
    ? input.endDate!
    : maxAvailableDate;
  const rawStartDate = isIsoDate(input.startDate ?? null)
    ? input.startDate!
    : rollingDefault.start;
  const effectiveRange = clampDateRange({
    start: rawStartDate,
    end: rawEndDate,
    minDate: minAvailableDate,
    maxDate: maxAvailableDate,
  });
  const boundedRange = limitDateRangeWindow(effectiveRange);

  const [abcdConfig, precomputedFields, periodoStdMeta, estados] =
    await Promise.all([
      getRotacionAbcdConfigForScope(input.empresa, input.sedeId),
      withPoolClient((client) => resolveRotacionBaseSqlFields(client)),
      withPoolClient((client) => getRotacionPeriodoStdMeta(client)),
      loadCeroEstadosForSede(input.empresa, input.sedeId),
    ]);

  const rows = await queryRotationRows({
    startDate: boundedRange.start,
    endDate: boundedRange.end,
    maxSalesValue: null,
    empresa: input.empresa,
    sedeId: input.sedeId,
    lineasN1: null,
    categoriaKeys: null,
    precomputedFields,
    periodoStdMeta,
  });

  return {
    rows,
    abcdConfig,
    dateRange: boundedRange,
    ceroEstadoByKey: estados.ceroEstadoByKey,
    restockEstadoByKey: estados.restockEstadoByKey,
    sedeName: input.sedeName,
    empresa: input.empresa,
    sedeId: input.sedeId,
  };
}
