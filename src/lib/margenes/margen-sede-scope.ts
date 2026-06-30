import {
  isSamePlanillaSede,
  mapRawSedeToCanonical,
} from "@/lib/horarios/planilla-sede";
import {
  listMargenSedeCatalogOptions,
  type MargenSedeCatalogOption,
} from "@/lib/margenes/margen-sede-catalog";

export type MargenSessionSedeScope = {
  role: "admin" | "user";
  sede: string | null;
  allowedSedes?: string[] | null;
};

const hasAllSedesToken = (allowedSedes: string[]) =>
  allowedSedes.some((sede) => sede.trim().toLowerCase() === "todas");

const matchCatalogByAllowedNames = (
  catalog: MargenSedeCatalogOption[],
  allowedNames: string[],
) => {
  const keys: string[] = [];
  for (const option of catalog) {
    if (allowedNames.some((name) => isSamePlanillaSede(option.label, name))) {
      keys.push(option.value);
    }
  }
  return keys;
};

export const resolveMargenSedeScope = (
  sessionUser: MargenSessionSedeScope,
): {
  authorized: boolean;
  hasAllSedes: boolean;
  allowedKeys: string[] | null;
} => {
  const catalog = listMargenSedeCatalogOptions();

  if (sessionUser.role === "admin") {
    return { authorized: true, hasAllSedes: true, allowedKeys: null };
  }

  const rawAllowed = Array.isArray(sessionUser.allowedSedes)
    ? sessionUser.allowedSedes
    : [];

  if (hasAllSedesToken(rawAllowed)) {
    return { authorized: true, hasAllSedes: true, allowedKeys: null };
  }

  const canonicalAllowed = rawAllowed
    .map((sede) => mapRawSedeToCanonical(sede))
    .filter(Boolean);

  if (canonicalAllowed.length > 0) {
    const keys = matchCatalogByAllowedNames(catalog, canonicalAllowed);
    if (keys.length > 0) {
      return { authorized: true, hasAllSedes: false, allowedKeys: keys };
    }
  }

  if (sessionUser.sede) {
    const legacy = mapRawSedeToCanonical(sessionUser.sede);
    const keys = matchCatalogByAllowedNames(catalog, [legacy]);
    if (keys.length > 0) {
      return { authorized: true, hasAllSedes: false, allowedKeys: keys };
    }
  }

  return { authorized: false, hasAllSedes: false, allowedKeys: [] };
};

export const filterMargenSedeCatalogForUser = (
  sessionUser: MargenSessionSedeScope,
): MargenSedeCatalogOption[] => {
  const catalog = listMargenSedeCatalogOptions();
  const scope = resolveMargenSedeScope(sessionUser);
  if (!scope.authorized) return [];
  if (scope.allowedKeys === null) return catalog;
  const allowed = new Set(scope.allowedKeys);
  return catalog.filter((option) => allowed.has(option.value));
};

export const assertMargenSedesAllowed = (
  requestedSedes: string[],
  sessionUser: MargenSessionSedeScope,
): { ok: true } | { ok: false; error: string; status: 403 | 400 } => {
  const scope = resolveMargenSedeScope(sessionUser);
  if (!scope.authorized) {
    return {
      ok: false,
      error: "No tienes sedes asignadas para márgenes.",
      status: 403,
    };
  }
  if (scope.allowedKeys === null) return { ok: true };

  const allowed = new Set(scope.allowedKeys);
  const invalid = requestedSedes.filter((sede) => !allowed.has(sede));
  if (invalid.length > 0) {
    return {
      ok: false,
      error: "Una o más sedes no están permitidas para tu usuario.",
      status: 403,
    };
  }
  return { ok: true };
};
