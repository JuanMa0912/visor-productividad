import type {
  AnalisisInventarioDrillStep,
  AnalisisInventarioLevel,
} from "@/lib/analisis-inventario/types";

/** Nombre visible por PROFUNDIDAD del drill (0..4). Se indexa con un numero. */
export const ANALISIS_INVENTARIO_LEVEL_NAMES = [
  "Sede",
  "Categoría",
  "Línea",
  "Sublínea",
  "Ítem",
] as const;

/**
 * Nombre visible por IDENTIFICADOR de nivel ("sede", "categoria", ...).
 *
 * Existe porque confundirla con `ANALISIS_INVENTARIO_LEVEL_NAMES` es facil y falla
 * en silencio: aquella es una tupla indexada por numero, asi que indexarla con el
 * string del nivel devuelve `undefined` sin error en runtime. Ese bug estuvo activo
 * en el export a Excel (banner, metadatos, columna de nivel y cabecera del mapa).
 */
export const ANALISIS_INVENTARIO_LEVEL_LABELS: Record<
  AnalisisInventarioLevel,
  string
> = {
  sede: "Sede",
  categoria: "Categoría",
  linea: "Línea",
  sublinea: "Sublínea",
  item: "Ítem",
};

export const parseAnalisisInventarioDrillPath = (
  raw: string | null,
): AnalisisInventarioDrillStep[] => {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as AnalisisInventarioDrillStep[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidDrillStep);
  } catch {
    return [];
  }
};

const isValidDrillStep = (
  step: AnalisisInventarioDrillStep,
): step is AnalisisInventarioDrillStep => {
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
    step.type === "categoria" ||
    step.type === "linea" ||
    step.type === "sublinea" ||
    step.type === "item"
  );
};

export const nextDrillLevel = (
  path: AnalisisInventarioDrillStep[],
): "sede" | "categoria" | "linea" | "sublinea" | "item" => {
  const types = new Set(path.map((step) => step.type));
  if (!types.has("sede")) return "sede";
  if (!types.has("categoria")) return "categoria";
  if (!types.has("linea")) return "linea";
  if (!types.has("sublinea")) return "sublinea";
  return "item";
};

/** Nivel de filas del heatmap (nunca sede: las columnas ya son sedes). */
export const nextHeatmapRowLevel = (
  path: AnalisisInventarioDrillStep[],
): "categoria" | "linea" | "sublinea" | "item" => {
  const types = new Set(
    path.filter((step) => step.type !== "sede").map((step) => step.type),
  );
  if (!types.has("categoria")) return "categoria";
  if (!types.has("linea")) return "linea";
  if (!types.has("sublinea")) return "sublinea";
  return "item";
};
