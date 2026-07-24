import {
  isSamePlanillaSede,
  mapRawSedeToCanonical,
} from "@/lib/horarios/planilla-sede";
import {
  listMargenSedeCatalogOptions,
  type MargenSedeCatalogOption,
} from "@/lib/margenes/margen-sede-catalog";
import {
  canonicalizeEmpresaCode,
  DEFAULT_EMPRESA_CODES,
  type EmpresaCode,
} from "@/lib/shared/data-tenant";

export type MargenSessionSedeScope = {
  role: "admin" | "user";
  sede: string | null;
  allowedSedes?: string[] | null;
  allowedEmpresas?: string[] | null;
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

/**
 * null = sin filtro (catalogo completo, tipicamente admin).
 * [] = ninguna empresa (denegar).
 * lista = filtrar; codigos invalidos → ninguna (no promover a "todas").
 */
const filterCatalogByEmpresas = (
  catalog: MargenSedeCatalogOption[],
  allowedEmpresas?: string[] | null,
): MargenSedeCatalogOption[] => {
  if (allowedEmpresas == null) return catalog;
  if (!Array.isArray(allowedEmpresas) || allowedEmpresas.length === 0) {
    return [];
  }
  const allowed = new Set(
    allowedEmpresas
      .map((value) => canonicalizeEmpresaCode(value))
      .filter((value): value is NonNullable<typeof value> => value !== null),
  );
  if (allowed.size === 0) return [];
  return catalog.filter((option) => {
    const code = canonicalizeEmpresaCode(option.empresa);
    return code !== null && allowed.has(code);
  });
};

/** No-admin sin empresas → historico (sin Dinastia). Admin → null (todas). */
const resolveEmpresaFilterForUser = (
  sessionUser: MargenSessionSedeScope,
): EmpresaCode[] | null => {
  if (sessionUser.role === "admin") return null;
  if (
    sessionUser.allowedEmpresas == null ||
    (Array.isArray(sessionUser.allowedEmpresas) &&
      sessionUser.allowedEmpresas.length === 0)
  ) {
    return [...DEFAULT_EMPRESA_CODES];
  }
  const codes = sessionUser.allowedEmpresas
    .map((value) => canonicalizeEmpresaCode(value))
    .filter((value): value is EmpresaCode => value !== null);
  return codes.length > 0 ? codes : [...DEFAULT_EMPRESA_CODES];
};

export const resolveMargenSedeScope = (
  sessionUser: MargenSessionSedeScope,
): {
  authorized: boolean;
  hasAllSedes: boolean;
  allowedKeys: string[] | null;
} => {
  const empresaFilter = resolveEmpresaFilterForUser(sessionUser);
  const catalog = filterCatalogByEmpresas(
    listMargenSedeCatalogOptions(),
    empresaFilter,
  );

  if (sessionUser.role === "admin") {
    return { authorized: true, hasAllSedes: true, allowedKeys: null };
  }

  const rawAllowed = Array.isArray(sessionUser.allowedSedes)
    ? sessionUser.allowedSedes
    : [];

  if (hasAllSedesToken(rawAllowed)) {
    // Catalogo ya acotado por empresas (historico o lista explicita).
    return {
      authorized: catalog.length > 0,
      hasAllSedes: true,
      allowedKeys: catalog.map((option) => option.value),
    };
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

  // Usuario solo-Dinastia sin sedes explicitas: todas las sedes Dinastia del catalogo.
  if (catalog.length > 0 && catalog.every((o) => o.empresa === "dinastia")) {
    return {
      authorized: true,
      hasAllSedes: true,
      allowedKeys: catalog.map((option) => option.value),
    };
  }

  return { authorized: false, hasAllSedes: false, allowedKeys: [] };
};

export const filterMargenSedeCatalogForUser = (
  sessionUser: MargenSessionSedeScope,
): MargenSedeCatalogOption[] => {
  const empresaFilter = resolveEmpresaFilterForUser(sessionUser);
  const catalog = filterCatalogByEmpresas(
    listMargenSedeCatalogOptions(),
    empresaFilter,
  );
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
