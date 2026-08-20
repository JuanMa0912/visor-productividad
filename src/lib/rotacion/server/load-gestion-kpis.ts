import { withPoolClient } from "@/lib/db";
import {
  clampDateRange,
  compactToIsoDate,
  getAvailableBounds,
  getRotacionAbcdConfigForScope,
  getRotationFilterCatalog,
  isIsoDate,
  limitDateRangeWindow,
  queryRotationRows,
  resolveVisibleSedes,
} from "@/app/api/rotacion/route";
import type { RotationRow } from "@/app/rotacion/rotacion-preamble";
import { DEFAULT_ABCD_CONFIG, normalizeRotationRows } from "@/app/rotacion/rotacion-preamble";
import { resolveRotacionBaseSqlFields } from "@/lib/rotacion/base-fields";
import {
  tagRotacionCriticalRows,
  type RotacionCriticalBucket,
  type RotacionCriticalDigestFamily,
} from "@/lib/rotacion/critical-digest";
import { filterTaggedRowsForChart } from "@/lib/rotacion/chart-series";
import {
  buildRotacionGestionKpis,
  type RotacionGestionKpis,
} from "@/lib/rotacion/gestion-kpis";
import { getRotacionPeriodoStdMeta } from "@/lib/rotacion/periodo-std-server";
import { resolveSessionLineCategoryScope } from "@/lib/shared/line-category-scope";
import type { AuthUser } from "@/lib/auth/types";
import { mergeDinastiaIntoRotationCatalog } from "@/lib/rotacion/dinastia-catalog";
import { userHasDinastiaAccess } from "@/lib/shared/data-tenant";

const KPI_CACHE_TTL_MS = 5 * 60 * 1000;
const kpiCache = new Map<
  string,
  { value: RotacionGestionKpis; expiresAt: number }
>();

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) return [];
  const safeLimit = Math.max(1, Math.min(limit, items.length));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await worker(items[currentIndex]!);
    }
  };
  await Promise.all(Array.from({ length: safeLimit }, () => runWorker()));
  return results;
};

export type LoadRotacionGestionKpisInput = {
  user: AuthUser;
  start: string;
  end: string;
  sedeScopes: string[];
  families: RotacionCriticalDigestFamily[];
  buckets: RotacionCriticalBucket[];
  lineaKeys?: string[];
  sublineaKeys?: string[];
};

const parseSedeScope = (scope: string) => {
  const idx = scope.indexOf("::");
  if (idx <= 0) return null;
  const empresa = scope.slice(0, idx).trim();
  const sedeId = scope.slice(idx + 2).trim();
  if (!empresa || !sedeId) return null;
  return { empresa, sedeId };
};

export async function loadRotacionGestionKpis(
  input: LoadRotacionGestionKpisInput,
): Promise<{ kpis: RotacionGestionKpis; range: { start: string; end: string } }> {
  const cacheKey = JSON.stringify({
    start: input.start,
    end: input.end,
    sedes: [...input.sedeScopes].sort(),
    families: [...input.families].sort(),
    buckets: [...input.buckets].sort(),
    lineaKeys: [...(input.lineaKeys ?? [])].sort(),
    sublineaKeys: [...(input.sublineaKeys ?? [])].sort(),
    user: input.user.id,
  });
  const cached = kpiCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { kpis: cached.value, range: { start: input.start, end: input.end } };
  }

  const bounds = await getAvailableBounds();
  const minAvailableDate = compactToIsoDate(bounds?.min_date ?? null);
  const maxAvailableDate = compactToIsoDate(bounds?.max_date ?? null);
  if (!minAvailableDate || !maxAvailableDate) {
    throw new Error("No hay rango disponible de rotacion.");
  }
  if (!isIsoDate(input.start) || !isIsoDate(input.end)) {
    throw new Error("Rango de fechas invalido.");
  }

  const boundedRange = limitDateRangeWindow(
    clampDateRange({
      start: input.start,
      end: input.end,
      minDate: minAvailableDate,
      maxDate: maxAvailableDate,
    }),
  );

  const catalogRaw = await getRotationFilterCatalog(
    boundedRange.start.replaceAll("-", ""),
    boundedRange.end.replaceAll("-", ""),
  );
  const catalog = userHasDinastiaAccess(input.user)
    ? mergeDinastiaIntoRotationCatalog(catalogRaw)
    : catalogRaw;
  const sedeAccess = resolveVisibleSedes(input.user, catalog);
  if (!sedeAccess.authorized) {
    throw new Error("No tienes sedes autorizadas para esta seccion.");
  }

  const requested = input.sedeScopes
    .map(parseSedeScope)
    .filter(Boolean) as Array<{ empresa: string; sedeId: string }>;
  const visible = sedeAccess.visibleSedes.filter((sede) =>
    requested.some(
      (req) =>
        req.empresa.trim().toLowerCase() === sede.empresa.trim().toLowerCase() &&
        req.sedeId.trim() === sede.sedeId.trim(),
    ),
  );
  if (visible.length === 0) {
    throw new Error("Selecciona al menos una sede autorizada.");
  }

  const lineScope = resolveSessionLineCategoryScope(input.user);
  const [precomputedFields, periodoStdMeta, abcdConfig] = await Promise.all([
    withPoolClient((client) => resolveRotacionBaseSqlFields(client)),
    withPoolClient((client) => getRotacionPeriodoStdMeta(client)),
    visible.length === 1
      ? getRotacionAbcdConfigForScope(visible[0]!.empresa, visible[0]!.sedeId)
      : Promise.resolve(DEFAULT_ABCD_CONFIG),
  ]);

  const rowsBySede = await mapWithConcurrency(visible, 3, async (sede) =>
    queryRotationRows({
      startDate: boundedRange.start,
      endDate: boundedRange.end,
      maxSalesValue: null,
      empresa: sede.empresa,
      sedeId: sede.sedeId,
      lineasN1:
        input.lineaKeys && input.lineaKeys.length > 0 ? input.lineaKeys : null,
      categoriaKeys: null,
      precomputedFields,
      periodoStdMeta,
      forcedRotacionCategoriaKeys: lineScope.forcedRotacionCategoriaKeys,
    }),
  );

  const tagged = tagRotacionCriticalRows(
    normalizeRotationRows(rowsBySede.flat() as RotationRow[]),
    boundedRange,
    abcdConfig,
    input.families,
  );
  const scoped = filterTaggedRowsForChart(tagged, input.families, [], {
    lineaKeys: input.lineaKeys,
    sublineaKeys: input.sublineaKeys,
    buckets: input.buckets,
  });
  const kpis = buildRotacionGestionKpis(scoped, boundedRange);
  kpiCache.set(cacheKey, {
    value: kpis,
    expiresAt: Date.now() + KPI_CACHE_TTL_MS,
  });
  return { kpis, range: boundedRange };
}
