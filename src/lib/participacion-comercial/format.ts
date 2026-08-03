import type {
  ParticipacionDrillStep,
  ParticipacionLevel,
  ParticipacionOrientation,
} from "@/lib/participacion-comercial/types";

export const PARTICIPACION_LEVEL_NAMES: Record<ParticipacionLevel, string> = {
  sede: "Sede",
  linea: "Línea",
  almacen: "Almacén",
  categoria: "Categoría",
  sublinea: "Sublínea",
  item: "Ítem",
};

/** Orden de drill según orientación. */
export const DRILL_SEQUENCE: Record<
  ParticipacionOrientation,
  ParticipacionLevel[]
> = {
  /** Dentro de una sede: almacén → categoría → línea → sublínea → ítem */
  sede: ["sede", "almacen", "categoria", "linea", "sublinea", "item"],
  /** Dentro de una línea: sede → almacén → sublínea → ítem */
  linea: ["linea", "sede", "almacen", "sublinea", "item"],
};

export const parseParticipacionDrillPath = (
  raw: string | null,
): ParticipacionDrillStep[] => {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as ParticipacionDrillStep[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidStep);
  } catch {
    return [];
  }
};

const isValidStep = (step: ParticipacionDrillStep): step is ParticipacionDrillStep => {
  if (!step || typeof step !== "object") return false;
  if (typeof step.id !== "string" || typeof step.label !== "string") return false;
  if (step.type === "sede") {
    return (
      typeof step.empresa === "string" &&
      typeof step.sedeId === "string" &&
      step.empresa.trim().length > 0 &&
      step.sedeId.trim().length > 0
    );
  }
  return (
    step.type === "linea" ||
    step.type === "almacen" ||
    step.type === "categoria" ||
    step.type === "sublinea" ||
    step.type === "item"
  );
};

export const nextParticipacionLevel = (
  orientation: ParticipacionOrientation,
  path: ParticipacionDrillStep[],
): ParticipacionLevel => {
  const sequence = DRILL_SEQUENCE[orientation];
  const present = new Set(path.map((step) => step.type));
  for (const level of sequence) {
    if (!present.has(level)) return level;
  }
  return "item";
};

/** Nivel de filas de la matriz línea×sede (profundiza línea → sublínea → ítem). */
export const nextParticipacionMatrixRowLevel = (
  path: ParticipacionDrillStep[],
): "linea" | "sublinea" | "item" => {
  const types = new Set(path.map((step) => step.type));
  if (!types.has("linea")) return "linea";
  if (!types.has("sublinea")) return "sublinea";
  return "item";
};

export const sharePct = (part: number, total: number): number => {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return (part / total) * 100;
};

export const formatSharePct = (value: number): string => {
  if (!Number.isFinite(value)) return "—";
  return `${value.toLocaleString("es-CO", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
};

export const formatMoney = (value: number): string =>
  value.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });

/**
 * Solo visual: divide por 1.000.000 (quita 6 ceros) para matrices densas.
 * El valor real no cambia; usar formatMoney en tooltips / Excel.
 */
export const formatMoneyVisualMillions = (value: number): string => {
  if (!Number.isFinite(value)) return "—";
  const millions = value / 1_000_000;
  return `${millions.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: millions >= 100 ? 0 : 1,
  })} M`;
};

export const formatUnits = (value: number): string =>
  value.toLocaleString("es-CO", {
    maximumFractionDigits: 1,
  });
