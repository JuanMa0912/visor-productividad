/**
 * Sede canónica para planillas de horario y cruce con asistencia.
 * Debe alinearse con los nombres usados en ingresar-horarios/options y horarios-comparar.
 */
import type { Sede } from "@/lib/constants";
import { normalizeKeySpaced } from "@/lib/normalize";

const normalizeText = (value?: string | null) =>
  (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalizeSedeKey = normalizeKeySpaced;

/** Sedes permitidas en el desplegable de planillas (misma lista que ingresar-horarios/options). */
export const PLANILLA_SEDE_OPTIONS: Sede[] = [
  { id: "Calle 5ta", name: "Calle 5ta" },
  { id: "La 39", name: "La 39" },
  { id: "Plaza Norte", name: "Plaza Norte" },
  { id: "Ciudad Jardin", name: "Ciudad Jardin" },
  { id: "Centro Sur", name: "Centro Sur" },
  { id: "Palmira", name: "Palmira" },
  { id: "Floresta", name: "Floresta" },
  { id: "Floralia", name: "Floralia" },
  { id: "Guaduales", name: "Guaduales" },
  { id: "Bogota", name: "Bogota" },
  { id: "Chia", name: "Chia" },
  { id: "ADM", name: "ADM" },
  { id: "CEDI-CAVASA", name: "CEDI-CAVASA" },
  { id: "Panificadora", name: "Panificadora" },
  { id: "Planta Desposte Mixto", name: "Planta Desposte Mixto" },
  { id: "Planta Desprese Pollo", name: "Planta Desprese Pollo" },
];

const SEDE_ALIAS_CONFIGS = [
  { name: "Calle 5ta", aliases: ["calle 5ta", "calle 5a", "la 5a", "la 5"] },
  { name: "La 39", aliases: ["la 39", "39"] },
  { name: "Plaza Norte", aliases: ["plaza norte", "mio plaza norte"] },
  { name: "Ciudad Jardin", aliases: ["ciudad jardin", "ciudad jard", "jardin"] },
  { name: "Centro Sur", aliases: ["centro sur"] },
  { name: "Palmira", aliases: ["palmira", "palmira mercamio"] },
  { name: "Floresta", aliases: ["floresta"] },
  { name: "Floralia", aliases: ["floralia", "floralia mercatodo", "mercatodo floralia"] },
  { name: "Guaduales", aliases: ["guaduales"] },
  { name: "Bogota", aliases: ["bogota", "bogot", "merkmios bogota", "merkmios bogot"] },
  { name: "Chia", aliases: ["chia", "chi", "ch a", "merkmios chia"] },
  { name: "ADM", aliases: ["adm"] },
  { name: "CEDI-CAVASA", aliases: ["cedi cavasa", "cedi-cavasa", "cedicavasa"] },
  { name: "Panificadora", aliases: ["panificadora"] },
  {
    name: "Planta Desposte Mixto",
    aliases: [
      "planta desposte mixto",
      "planta de desposte mixto",
      "planta desposte",
      "desposte mixto",
    ],
  },
  {
    name: "Planta Desprese Pollo",
    aliases: [
      "planta desposte pollo",
      "planta desprese pollo",
      "planta de desposte pollo",
      "planta de desprese pollo",
      "desposte pollo",
      "desprese pollo",
    ],
  },
] as const;

const canonicalizeSedeKey = (value: string) => {
  const normalized = normalizeSedeKey(value);
  const compact = normalized.replace(/\s+/g, "");
  if (normalized === "cedicavasa" || compact === "cedicavasa") {
    return normalizeSedeKey("CEDI-CAVASA");
  }
  if (
    normalized.includes("planta desposte pollo") ||
    normalized.includes("planta desprese pollo")
  ) {
    return normalizeSedeKey("Planta Desprese Pollo");
  }
  if (normalized.includes("planta desposte mixto")) {
    return normalizeSedeKey("Planta Desposte Mixto");
  }
  return normalized;
};

/**
 * Convierte cualquier texto de sede (planilla, asistencia cruda) al nombre canónico del sistema.
 */
export function mapRawSedeToCanonical(rawSede?: string | null): string {
  if (!rawSede) return "";
  const normalized = canonicalizeSedeKey(normalizeText(rawSede));
  const matched = SEDE_ALIAS_CONFIGS.find((cfg) =>
    [cfg.name, ...cfg.aliases].some((alias) => {
      const key = canonicalizeSedeKey(normalizeText(alias));
      return (
        normalized === key ||
        normalized.includes(key) ||
        key.includes(normalized)
      );
    }),
  );
  return matched?.name ?? rawSede.trim();
}

/**
 * Resuelve el texto enviado por el cliente al nombre exacto de {@link PLANILLA_SEDE_OPTIONS}, o null si no coincide.
 */
export function toCanonicalPlanillaSede(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const mapped = mapRawSedeToCanonical(trimmed);
  const exact = PLANILLA_SEDE_OPTIONS.find(
    (s) => normalizeKeySpaced(s.name) === normalizeKeySpaced(mapped),
  );
  return exact ? exact.name : null;
}

/** Comparación estricta de sede ya canónica o cruda (ambas pasan por mapRawSedeToCanonical). */
export function isSamePlanillaSede(a: string, b: string): boolean {
  const ca = mapRawSedeToCanonical(a);
  const cb = mapRawSedeToCanonical(b);
  if (!ca || !cb) return false;
  return normalizeKeySpaced(ca) === normalizeKeySpaced(cb);
}

type SessionLike = {
  role: "admin" | "user";
  sede: string | null;
  allowedSedes?: string[] | null;
};

export function resolveVisiblePlanillaSedes(sessionUser: SessionLike): {
  authorized: boolean;
  visibleSedes: Sede[];
  defaultSede: string | null;
} {
  if (sessionUser.role === "admin") {
    return {
      authorized: true,
      visibleSedes: PLANILLA_SEDE_OPTIONS,
      defaultSede: null,
    };
  }
  const rawAllowed = Array.isArray(sessionUser.allowedSedes)
    ? sessionUser.allowedSedes
    : [];
  const normalizedAllowed = new Set(
    rawAllowed.map((sede) => canonicalizeSedeKey(sede)).filter(Boolean),
  );
  if (normalizedAllowed.has(normalizeSedeKey("Todas"))) {
    return {
      authorized: true,
      visibleSedes: PLANILLA_SEDE_OPTIONS,
      defaultSede: null,
    };
  }
  const allowedMatches = PLANILLA_SEDE_OPTIONS.filter((sede) =>
    normalizedAllowed.has(canonicalizeSedeKey(sede.name)),
  );
  if (allowedMatches.length > 0) {
    return {
      authorized: true,
      visibleSedes: allowedMatches,
      defaultSede: allowedMatches.length === 1 ? allowedMatches[0].name : null,
    };
  }
  const legacyKey = sessionUser.sede ? canonicalizeSedeKey(sessionUser.sede) : null;
  const legacyMatch = legacyKey
    ? PLANILLA_SEDE_OPTIONS.find((sede) => canonicalizeSedeKey(sede.name) === legacyKey)
    : null;
  if (legacyMatch) {
    return {
      authorized: true,
      visibleSedes: [legacyMatch],
      defaultSede: legacyMatch.name,
    };
  }
  return {
    authorized: false,
    visibleSedes: [],
    defaultSede: null,
  };
}

export function isPlanillaSedeAllowedForUser(
  canonicalSede: string,
  sessionUser: SessionLike,
): boolean {
  if (sessionUser.role === "admin") return true;
  const { authorized, visibleSedes } = resolveVisiblePlanillaSedes(sessionUser);
  if (!authorized) return false;
  return visibleSedes.some((s) => isSamePlanillaSede(s.name, canonicalSede));
}
