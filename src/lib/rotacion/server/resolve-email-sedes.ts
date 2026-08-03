import {
  clampDateRange,
  compactToIsoDate,
  getAvailableBounds,
  getRotationFilterCatalog,
  limitDateRangeWindow,
} from "@/app/api/rotacion/route";
import { getRollingMonthBackRange } from "@/lib/rotacion/rolling-month-range";
import { getSedeOrderIndexForRawName } from "@/lib/shared/constants";
import { displayRotationSedeName } from "@/app/rotacion/rotacion-preamble";

export type RotacionEmailSede = {
  empresa: string;
  sedeId: string;
  sedeName: string;
};

const isoToCompact = (iso: string) => iso.replace(/-/g, "");

const sedeKey = (sede: Pick<RotacionEmailSede, "empresa" | "sedeId">) =>
  `${sede.empresa}::${sede.sedeId}`;

/**
 * Sedes operativas del catálogo de rotación para el rango por defecto del correo
 * (mismo rolling month que los digests individuales), ordenadas como en el portal.
 */
export async function resolveRotacionEmailSedes(): Promise<RotacionEmailSede[]> {
  const bounds = await getAvailableBounds();
  const minAvailableDate = compactToIsoDate(bounds?.min_date ?? null);
  const maxAvailableDate = compactToIsoDate(bounds?.max_date ?? null);
  if (!minAvailableDate || !maxAvailableDate) return [];

  const rolling = getRollingMonthBackRange(minAvailableDate, maxAvailableDate);
  const bounded = limitDateRangeWindow(
    clampDateRange({
      start: rolling.start,
      end: rolling.end,
      minDate: minAvailableDate,
      maxDate: maxAvailableDate,
    }),
  );

  const catalog = await getRotationFilterCatalog(
    isoToCompact(bounded.start),
    isoToCompact(bounded.end),
  );

  const byKey = new Map<string, RotacionEmailSede>();
  for (const row of catalog.sedes) {
    const sedeName = displayRotationSedeName(row.sedeName);
    if (!sedeName) continue;
    const sede: RotacionEmailSede = {
      empresa: row.empresa,
      sedeId: row.sedeId,
      sedeName,
    };
    byKey.set(sedeKey(sede), sede);
  }

  return [...byKey.values()].sort((a, b) => {
    const orderA = getSedeOrderIndexForRawName(a.sedeName);
    const orderB = getSedeOrderIndexForRawName(b.sedeName);
    if (orderA !== orderB) return orderA - orderB;
    return a.sedeName.localeCompare(b.sedeName, "es");
  });
}

/** Une listas de sedes sin duplicar empresa+sedeId (conserva el orden de `primary`). */
export function mergeRotacionEmailSedes(
  primary: readonly RotacionEmailSede[],
  extra: readonly RotacionEmailSede[],
): RotacionEmailSede[] {
  const byKey = new Map<string, RotacionEmailSede>();
  for (const sede of [...primary, ...extra]) {
    const key = sedeKey(sede);
    if (!byKey.has(key)) byKey.set(key, sede);
  }
  return [...byKey.values()];
}
