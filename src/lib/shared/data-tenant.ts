/**
 * Alcance multi-empresa / tenant de datos.
 *
 * Dinastia vive en tablas dedicadas (`margen_dinastia`, `rotacion_dinastia`,
 * `ventas_dinastia`). El resto usa las tablas historicas.
 *
 * Reglas:
 * - admin / allowedEmpresas null → puede ver todas (incluye Dinastia).
 * - usuario solo `dinastia` → siempre tablas *_dinastia.
 * - usuario sin `dinastia` → nunca tablas *_dinastia.
 * - no mezclar Dinastia + otras empresas en la misma consulta.
 */

export const DEFAULT_EMPRESA_CODES = ["mercamio", "mtodo", "bogota"] as const;
export const DINASTIA_EMPRESA_CODE = "dinastia" as const;

export const ALL_EMPRESA_CODES = [
  ...DEFAULT_EMPRESA_CODES,
  DINASTIA_EMPRESA_CODE,
] as const;

export type EmpresaCode = (typeof ALL_EMPRESA_CODES)[number];
export type DataSourceKind = "default" | "dinastia";

export const EMPRESA_OPTION_LABELS: Record<EmpresaCode, string> = {
  mercamio: "Mercamio",
  mtodo: "Comercializadora",
  bogota: "Merkmios",
  dinastia: "Dinastía",
};

const EMPRESA_ALIASES: Record<string, EmpresaCode> = {
  mercamio: "mercamio",
  mtodo: "mtodo",
  mercatodo: "mtodo",
  bogota: "bogota",
  merkmios: "bogota",
  dinastia: "dinastia",
  dinastía: "dinastia",
};

export const isEmpresaCode = (value: string): value is EmpresaCode =>
  (ALL_EMPRESA_CODES as readonly string[]).includes(value);

export const canonicalizeEmpresaCode = (
  value: string | null | undefined,
): EmpresaCode | null => {
  if (!value?.trim()) return null;
  const key = value.trim().toLowerCase();
  return EMPRESA_ALIASES[key] ?? (isEmpresaCode(key) ? key : null);
};

export const parseAllowedEmpresas = (
  raw: unknown,
): EmpresaCode[] | null => {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  const out: EmpresaCode[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const code = canonicalizeEmpresaCode(String(entry ?? ""));
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out.length > 0 ? out : null;
};

export type EmpresaScopeInput = {
  role: "admin" | "user";
  allowedEmpresas?: string[] | null;
};

/** null = todas las empresas (admin o sin restriccion). */
export const resolveAllowedEmpresaCodes = (
  user: EmpresaScopeInput,
): EmpresaCode[] | null => {
  if (user.role === "admin") return null;
  return parseAllowedEmpresas(user.allowedEmpresas);
};

export const userHasDinastiaAccess = (user: EmpresaScopeInput): boolean => {
  const codes = resolveAllowedEmpresaCodes(user);
  if (codes === null) return true;
  return codes.includes(DINASTIA_EMPRESA_CODE);
};

export const userIsDinastiaOnly = (user: EmpresaScopeInput): boolean => {
  const codes = resolveAllowedEmpresaCodes(user);
  return (
    codes !== null &&
    codes.length > 0 &&
    codes.every((code) => code === DINASTIA_EMPRESA_CODE)
  );
};

/**
 * Decide tablas a usar segun empresas seleccionadas en filtros + alcance usuario.
 * `selectedEmpresas` vacio = "Todas" dentro del alcance permitido.
 */
export const resolveDataSourceKind = (
  user: EmpresaScopeInput,
  selectedEmpresas: string[] = [],
):
  | { ok: true; kind: DataSourceKind; empresas: EmpresaCode[] | null }
  | { ok: false; error: string } => {
  const allowed = resolveAllowedEmpresaCodes(user);
  const selected = selectedEmpresas
    .map((value) => canonicalizeEmpresaCode(value))
    .filter((value): value is EmpresaCode => value !== null);

  const effective: EmpresaCode[] =
    selected.length > 0
      ? selected
      : allowed === null
        ? [...DEFAULT_EMPRESA_CODES]
        : [...allowed];

  if (allowed !== null) {
    const allowedSet = new Set(allowed);
    if (effective.some((code) => !allowedSet.has(code))) {
      return {
        ok: false,
        error: "No tienes permiso para una o mas empresas seleccionadas.",
      };
    }
  }

  const hasDinastia = effective.includes(DINASTIA_EMPRESA_CODE);
  const hasDefault = effective.some((code) => code !== DINASTIA_EMPRESA_CODE);

  if (hasDinastia && hasDefault) {
    return {
      ok: false,
      error:
        "No se puede consultar Dinastía junto con otras empresas. Elige solo Dinastía o solo el resto.",
    };
  }

  if (hasDinastia) {
    return { ok: true, kind: "dinastia", empresas: [DINASTIA_EMPRESA_CODE] };
  }

  return {
    ok: true,
    kind: "default",
    empresas: selected.length > 0 ? effective : allowed,
  };
};

export const MARGEN_TABLE_BY_KIND = {
  default: {
    raw: "margen_final",
    roll: "margen_final_roll",
    itemDia: "margen_item_dia_roll",
  },
  dinastia: {
    raw: "margen_dinastia",
    roll: "margen_dinastia",
    itemDia: "margen_dinastia",
  },
} as const;

export const ROTACION_TABLE_BY_KIND = {
  default: "rotacion_base_item_dia_sede",
  dinastia: "rotacion_dinastia",
} as const;

export const VENTAS_TABLE_BY_KIND = {
  default: null,
  dinastia: "ventas_dinastia",
} as const;

/**
 * Extrae empresas de claves `empresa|idCo` (márgenes) o `empresa::sedeId` (rotación).
 */
export const empresasFromScopeKeys = (
  keys: string[],
  separator: "|" | "::" = "|",
): EmpresaCode[] => {
  const out: EmpresaCode[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const raw = key.trim();
    if (!raw) continue;
    const idx =
      separator === "::" ? raw.indexOf("::") : raw.indexOf(separator);
    if (idx <= 0) continue;
    const code = canonicalizeEmpresaCode(raw.slice(0, idx));
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
};

/**
 * Empuje de tenant cuando el UI manda sedes pero deja empresa vacía.
 * - Solo Dinastía → `["dinastia"]`
 * - Mezcla / solo default → `[]` (= "Todas" → tablas historicas)
 */
export const resolveEmpresasHintForTenant = (
  selectedEmpresas: string[],
  scopeKeys: string[],
  separator: "|" | "::" = "|",
): string[] => {
  if (selectedEmpresas.length > 0) return selectedEmpresas;
  const fromKeys = empresasFromScopeKeys(scopeKeys, separator);
  if (fromKeys.length === 0) return [];
  const onlyDinastia = fromKeys.every((code) => code === DINASTIA_EMPRESA_CODE);
  return onlyDinastia ? [DINASTIA_EMPRESA_CODE] : [];
};

/** Quita sedes Dinastía del filtro cuando la consulta va a tablas historicas. */
export const stripDinastiaSedeKeys = (
  sedeKeys: string[],
  separator: "|" | "::" = "|",
): string[] =>
  sedeKeys.filter((key) => {
    const idx =
      separator === "::" ? key.indexOf("::") : key.indexOf(separator);
    if (idx <= 0) return true;
    return canonicalizeEmpresaCode(key.slice(0, idx)) !== DINASTIA_EMPRESA_CODE;
  });

/** Valida payload admin de `allowedEmpresas`. `undefined` = no tocar. */
export const resolveValidAllowedEmpresas = (
  value: unknown,
):
  | { ok: true; value: EmpresaCode[] | null | undefined }
  | { ok: false; error: string } => {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  if (!Array.isArray(value)) {
    return {
      ok: false,
      error: "Las empresas permitidas no son validas.",
    };
  }
  if (value.length === 0) return { ok: true, value: null };

  const out: EmpresaCode[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const code = canonicalizeEmpresaCode(String(entry ?? ""));
    if (!code) {
      return {
        ok: false,
        error: "Hay empresas no validas en la seleccion.",
      };
    }
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return { ok: true, value: out.length > 0 ? out : null };
};
