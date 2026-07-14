/**
 * Sede canónica para planillas de horario y cruce con asistencia.
 * Debe alinearse con los nombres usados en ingresar-horarios/options y horarios-comparar.
 *
 * Jerarquía planta: la sede canónica es "Planta"; panificadora / desposte mixto /
 * desprese pollo son *secciones* de esa sede (no sedes aparte).
 */
import type { Sede } from "@/lib/shared/constants";
import { normalizeKeySpaced } from "@/lib/shared/normalize";

const normalizeText = (value?: string | null) =>
  (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalizeSedeKey = normalizeKeySpaced;

/** Secciones válidas cuando la sede es Planta. */
export const PLANTA_SECCION_OPTIONS = [
  "Panificadora",
  "Planta Desposte Mixto",
  "Planta Desprese Pollo",
] as const;

export type PlantaSeccion = (typeof PLANTA_SECCION_OPTIONS)[number];

const PLANTA_SECCION_SET = new Set(
  PLANTA_SECCION_OPTIONS.map((value) => normalizeSedeKey(value)),
);

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
  { id: "Planta", name: "Planta" },
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
  {
    name: "Bogota",
    /**
     * En la base de productividad/rotacion la sede de Bogota viene
     * etiquetada como "Merkmios La 80" (la planta esta sobre la calle 80),
     * sin la palabra "Bogota". Sin estos aliases el matcher no la asociaba
     * con `allowedSedes: ["Bogota"]` y los usuarios scopeados a Bogota
     * obtenian un catalogo vacio (la sede no se autoseleccionaba en
     * rotacion).
     */
    aliases: [
      "bogota",
      "bogot",
      "merkmios bogota",
      "merkmios bogot",
      "merkmios la 80",
      "mercamios la 80",
      "la 80",
    ],
  },
  {
    name: "Chia",
    aliases: [
      "chia",
      "chi",
      "ch a",
      "merkmios chia",
      "plaza mayor chia",
      "plaza mayor de chia",
    ],
  },
  { name: "ADM", aliases: ["adm"] },
  { name: "CEDI-CAVASA", aliases: ["cedi cavasa", "cedi-cavasa", "cedicavasa"] },
  {
    name: "Planta",
    aliases: [
      "planta",
      "panificadora",
      "planta desposte mixto",
      "planta de desposte mixto",
      "planta desposte",
      "desposte mixto",
      "planta desposte pollo",
      "planta desprese pollo",
      "planta de desposte pollo",
      "planta de desprese pollo",
      "desposte pollo",
      "desprese pollo",
    ],
  },
] as const;

/** Attendance names usados para filtrar asistencia_horas bajo sede Planta. */
export const PLANTA_ATTENDANCE_SEDE_NAMES = [
  "panificadora",
  "planta desposte mixto",
  "planta de desposte mixto",
  "planta desposte pollo",
  "planta desprese pollo",
  "planta de desposte pollo",
  "planta de desprese pollo",
  "planta",
] as const;

const canonicalizeSedeKey = (value: string) => {
  const normalized = normalizeSedeKey(value);
  const compact = normalized.replace(/\s+/g, "");
  if (normalized === "cedicavasa" || compact === "cedicavasa") {
    return normalizeSedeKey("CEDI-CAVASA");
  }
  if (
    normalized === "planta" ||
    normalized.includes("panificadora") ||
    normalized.includes("planta desposte") ||
    normalized.includes("planta desprese") ||
    normalized.includes("desposte mixto") ||
    normalized.includes("desprese pollo") ||
    normalized.includes("desposte pollo")
  ) {
    return normalizeSedeKey("Planta");
  }
  return normalized;
};

export const isPlanillaPlantaSede = (sede: string | null | undefined): boolean =>
  Boolean(sede) && canonicalizeSedeKey(normalizeText(sede)) === normalizeSedeKey("Planta");

export const isPlantaSeccion = (value: string | null | undefined): value is PlantaSeccion => {
  if (!value) return false;
  return PLANTA_SECCION_SET.has(normalizeSedeKey(value));
};

/**
 * Infere seccion de planta a partir del texto crudo de sede (asistencia o planilla legacy).
 */
export function mapRawSedeToPlantaSeccion(
  rawSede?: string | null,
): PlantaSeccion | null {
  if (!rawSede) return null;
  const normalized = normalizeText(rawSede);
  if (!normalized) return null;
  if (normalized.includes("panificadora")) return "Panificadora";
  if (
    normalized.includes("desprese pollo") ||
    normalized.includes("desposte pollo")
  ) {
    return "Planta Desprese Pollo";
  }
  if (
    normalized.includes("desposte mixto") ||
    (normalized.includes("desposte") && !normalized.includes("pollo"))
  ) {
    return "Planta Desposte Mixto";
  }
  if (isPlantaSeccion(rawSede.trim())) {
    return rawSede.trim() as PlantaSeccion;
  }
  return null;
}

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

/**
 * Migra sede/seccion legacy (cuando panificadora/desposte eran sedes y seccion="Planta").
 */
export function migratePlanillaSedeSeccion(
  sede: string,
  seccion: string,
): { sede: string; seccion: string } {
  const canonicalSede = toCanonicalPlanillaSede(sede) ?? mapRawSedeToCanonical(sede);
  if (canonicalSede !== "Planta") {
    return {
      sede: canonicalSede || sede.trim(),
      seccion: seccion.trim() || "Cajas",
    };
  }

  const fromSeccion = isPlantaSeccion(seccion) ? seccion : null;
  const fromLegacySede = mapRawSedeToPlantaSeccion(sede);
  const nextSeccion =
    fromSeccion ?? fromLegacySede ?? PLANTA_SECCION_OPTIONS[0];

  return { sede: "Planta", seccion: nextSeccion };
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
