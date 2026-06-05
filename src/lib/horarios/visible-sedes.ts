// Resolucion de sedes visibles por usuario (autorizacion fina por sede).
// Fuente unica de verdad: usada por /api/jornada-extendida/meta (lista para el
// front) y por /api/jornada-extendida/tipos-horario (enforcing server-side).
//
// Reglas: admin ve todas; allowedSedes con "Todas" = todas; allowedSedes con
// nombres = esas sedes; si no hay match, fallback al campo legacy `sede`.

import type { Sede } from "@/lib/shared/constants";
import { normalizeKeySpaced } from "@/lib/shared/normalize";

export const VISIBLE_SEDES: Sede[] = [
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

const normalizeSedeKey = normalizeKeySpaced;

export const canonicalizeSedeKey = (value: string) => {
  const normalized = normalizeSedeKey(value);
  const compact = normalized.replace(/\s+/g, "");
  if (
    normalized === "calle 5a" ||
    normalized === "la 5a" ||
    normalized === "calle 5" ||
    compact === "calle5a" ||
    compact === "la5a" ||
    compact === "calle5"
  ) {
    return normalizeSedeKey("Calle 5ta");
  }
  if (normalized === "cedicavasa" || compact === "cedicavasa") {
    return normalizeSedeKey("CEDI-CAVASA");
  }
  return normalized;
};

export type SessionUserSedeInfo = {
  role: "admin" | "user";
  sede: string | null;
  allowedSedes?: string[] | null;
};

export type VisibleSedesResult = {
  authorized: boolean;
  visibleSedes: Sede[];
  defaultSede: string | null;
};

export const resolveVisibleSedes = (
  sessionUser: SessionUserSedeInfo,
): VisibleSedesResult => {
  if (sessionUser.role === "admin") {
    return { authorized: true, visibleSedes: VISIBLE_SEDES, defaultSede: null };
  }

  const rawAllowed = Array.isArray(sessionUser.allowedSedes)
    ? sessionUser.allowedSedes
    : [];
  const normalizedAllowed = new Set(
    rawAllowed.map((sede) => canonicalizeSedeKey(sede)).filter(Boolean),
  );
  if (normalizedAllowed.has(canonicalizeSedeKey("Todas"))) {
    return { authorized: true, visibleSedes: VISIBLE_SEDES, defaultSede: null };
  }

  const allowedMatches = VISIBLE_SEDES.filter((sede) =>
    normalizedAllowed.has(canonicalizeSedeKey(sede.name)),
  );
  if (allowedMatches.length > 0) {
    return {
      authorized: true,
      visibleSedes: allowedMatches,
      defaultSede: allowedMatches.length === 1 ? allowedMatches[0].name : null,
    };
  }

  const legacySedeKey = sessionUser.sede
    ? canonicalizeSedeKey(sessionUser.sede)
    : null;
  const legacySede = legacySedeKey
    ? VISIBLE_SEDES.find((sede) => canonicalizeSedeKey(sede.name) === legacySedeKey)
    : null;
  if (legacySede) {
    return {
      authorized: true,
      visibleSedes: [legacySede],
      defaultSede: legacySede.name,
    };
  }

  return { authorized: false, visibleSedes: [], defaultSede: null };
};

/**
 * Conjunto de nombres canonicos de sede que el usuario puede ver, para filtrar
 * resultados en el servidor:
 *   - `null`       => sin restriccion (admin o "Todas")
 *   - `Set` vacio  => el usuario no tiene ninguna sede asignada (no autorizado)
 *   - `Set` lleno  => restringido a esas sedes
 */
export const resolveAllowedSedeNames = (
  sessionUser: SessionUserSedeInfo,
): Set<string> | null => {
  const { authorized, visibleSedes } = resolveVisibleSedes(sessionUser);
  if (!authorized) return new Set();
  if (sessionUser.role === "admin") return null;
  const rawAllowed = Array.isArray(sessionUser.allowedSedes)
    ? sessionUser.allowedSedes
    : [];
  const normalizedAllowed = new Set(
    rawAllowed.map((sede) => canonicalizeSedeKey(sede)).filter(Boolean),
  );
  if (normalizedAllowed.has(canonicalizeSedeKey("Todas"))) return null;
  return new Set(visibleSedes.map((sede) => sede.name));
};

/**
 * Igual que resolveAllowedSedeNames pero devuelve las CLAVES canonicas
 * (via canonicalizeSedeKey), para comparar contra sedes normalizadas en SQL.
 *   - `null`      => sin restriccion
 *   - `Set` vacio => no autorizado a ninguna sede
 */
export const resolveAllowedSedeKeys = (
  sessionUser: SessionUserSedeInfo,
): Set<string> | null => {
  const names = resolveAllowedSedeNames(sessionUser);
  if (names === null) return null;
  return new Set(Array.from(names, (name) => canonicalizeSedeKey(name)));
};
