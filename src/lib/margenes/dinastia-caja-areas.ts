/**
 * Áreas comerciales Dinastía por rango de caja (roles de vendedores/cajeros).
 * Solo aplica a tablas margen_dinastia(_roll).
 *
 * - Cajas 1 a 10 → Mayorista
 * - Cajas 11 a 30 → Detal
 * - Cajas 31 a 40 → Call Center
 */

export type DinastiaCajaArea = "mayorista" | "detal" | "call_center";

export type DinastiaCajaAreaDef = {
  id: DinastiaCajaArea;
  /** Etiqueta corta para filtros. */
  label: string;
  /** Nombre completo pedido por negocio. */
  fullLabel: string;
  minCaja: number;
  maxCaja: number;
};

export const DINASTIA_CAJA_AREAS: readonly DinastiaCajaAreaDef[] = [
  {
    id: "mayorista",
    label: "Mayorista",
    fullLabel: "Cajas 1 a 10 · Mayorista",
    minCaja: 1,
    maxCaja: 10,
  },
  {
    id: "detal",
    label: "Detal",
    fullLabel: "Cajas 11 a 30 · Detal",
    minCaja: 11,
    maxCaja: 30,
  },
  {
    id: "call_center",
    label: "Call Center",
    fullLabel: "Cajas 31 a 40 · Call Center",
    minCaja: 31,
    maxCaja: 40,
  },
] as const;

export const DINASTIA_CAJA_AREA_BY_ID: Record<
  DinastiaCajaArea,
  DinastiaCajaAreaDef
> = Object.fromEntries(
  DINASTIA_CAJA_AREAS.map((area) => [area.id, area]),
) as Record<DinastiaCajaArea, DinastiaCajaAreaDef>;

export const isDinastiaCajaArea = (value: string): value is DinastiaCajaArea =>
  value === "mayorista" || value === "detal" || value === "call_center";

export const parseDinastiaCajaAreas = (
  raw: string | null | undefined,
): DinastiaCajaArea[] => {
  if (!raw?.trim()) return [];
  const seen = new Set<DinastiaCajaArea>();
  for (const part of raw.split(",")) {
    const key = part.trim().toLowerCase();
    if (isDinastiaCajaArea(key)) seen.add(key);
  }
  return DINASTIA_CAJA_AREAS.map((area) => area.id).filter((id) =>
    seen.has(id),
  );
};

/** Opciones para MultiSelect del tablero. */
export const dinastiaCajaAreaSelectOptions = () =>
  DINASTIA_CAJA_AREAS.map((area) => ({
    value: area.id,
    label: area.fullLabel,
    code: `${area.minCaja}-${area.maxCaja}`,
  }));

/**
 * Expresión SQL: dígitos de id_caja (sin cast).
 * Ej. '05' → '05', 'Caja 12' → '12'.
 */
export const dinastiaIdCajaDigitsSql = (idCajaExpr = "id_caja"): string =>
  `NULLIF(regexp_replace(TRIM(COALESCE(${idCajaExpr}::text, '')), '[^0-9]', '', 'g'), '')`;

/**
 * Añade predicado OR de rangos a `parts` (mutando `params`).
 * No-op si `areas` está vacío.
 */
export const appendDinastiaCajaAreaSql = (
  parts: string[],
  params: unknown[],
  areas: DinastiaCajaArea[],
  idCajaExpr = "id_caja",
): void => {
  if (areas.length === 0) return;
  const digits = dinastiaIdCajaDigitsSql(idCajaExpr);
  const ranges = areas.map((areaId) => {
    const area = DINASTIA_CAJA_AREA_BY_ID[areaId];
    params.push(area.minCaja, area.maxCaja);
    return `(${digits} ~ '^[0-9]+$' AND (${digits})::integer BETWEEN $${params.length - 1} AND $${params.length})`;
  });
  parts.push(`(${ranges.join(" OR ")})`);
};

/** Clasifica un código de caja en el área Dinastía (o null si fuera de rango). */
export const resolveDinastiaCajaArea = (
  idCaja: string | null | undefined,
): DinastiaCajaArea | null => {
  const digits = String(idCaja ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const num = Number.parseInt(digits, 10);
  if (!Number.isFinite(num)) return null;
  for (const area of DINASTIA_CAJA_AREAS) {
    if (num >= area.minCaja && num <= area.maxCaja) return area.id;
  }
  return null;
};
