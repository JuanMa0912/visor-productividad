const DEPARTAMENTO_TO_LINE: Record<string, string> = {
  cajas: "cajas",
  "supervision y cajas": "cajas",
  fruver: "fruver",
  "surtidor fruver": "fruver",
  industria: "industria",
  surtidores: "industria",
  carnes: "carnes",
  "carnes rojas": "carnes",
  "pollo y pescado": "pollo y pescado",
  "surtidor (a) pollo y pescado": "pollo y pescado",
  "surtidor a pollo y pescado": "pollo y pescado",
  asadero: "asadero",
  "pollo asado": "asadero",
  "planta de produccion": "industria",
};

const normalizeDepartamento = (depto: string): string =>
  depto
    ?.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim() || "";

const normalizeLineId = (value: string) => value.trim().toLowerCase();

/** Mapea nombre de departamento (asistencia_horas) a id de linea de productividad. */
export const resolveDepartamentoLineId = (depto: string): string | undefined => {
  const normalized = normalizeDepartamento(depto);
  if (!normalized) return undefined;

  const direct = DEPARTAMENTO_TO_LINE[normalized];
  if (direct) return direct;

  if (normalized.includes("asadero") || normalized.includes("asado")) {
    return "asadero";
  }
  if (
    normalized.includes("pollo") ||
    normalized.includes("pescado") ||
    normalized.includes("mariscos")
  ) {
    return "pollo y pescado";
  }
  if (
    normalized.includes("fruver") ||
    normalized.includes("fruta") ||
    normalized.includes("verdura")
  ) {
    return "fruver";
  }
  if (normalized.includes("caja")) return "cajas";
  if (normalized.includes("industria") || normalized.includes("surtidor")) {
    return "industria";
  }
  if (normalized.includes("carn")) return "carnes";

  return undefined;
};

export const isDepartamentoAllowedForLines = (
  departamento: string,
  allowedLineIds: string[] | null | undefined,
): boolean => {
  if (!Array.isArray(allowedLineIds) || allowedLineIds.length === 0) {
    return true;
  }
  const lineId = resolveDepartamentoLineId(departamento);
  if (!lineId) return false;
  const allowed = new Set(allowedLineIds.map(normalizeLineId));
  return allowed.has(normalizeLineId(lineId));
};
