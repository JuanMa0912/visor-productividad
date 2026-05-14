export type CeroRotacionEstado = "sin_verificar" | "seguimiento" | "surtido";

/** Donde aplica el estado operativo (cero rotacion vs items restock S/R/N). */
export type RotacionSurtidoEstadoContext = "cero" | "restock";

export const ROTACION_SURTIDO_ESTADO_CONTEXT_VALUES: readonly RotacionSurtidoEstadoContext[] =
  ["cero", "restock"] as const;

export const parseRotacionSurtidoEstadoContext = (
  raw: string | null | undefined,
): RotacionSurtidoEstadoContext | null => {
  if (!raw || typeof raw !== "string") return null;
  const t = raw.trim();
  if (t === "cero" || t === "restock") return t;
  return null;
};

export const CERO_ROTACION_ESTADO_VALUES: readonly CeroRotacionEstado[] = [
  "sin_verificar",
  "seguimiento",
  "surtido",
] as const;

export const CERO_ROTACION_ESTADO_LABELS: Record<CeroRotacionEstado, string> = {
  sin_verificar: "Sin verificar",
  seguimiento: "Seguimiento",
  surtido: "Surtido",
};

export const DEFAULT_CERO_ROTACION_ESTADO: CeroRotacionEstado = "sin_verificar";

/** Orden para ordenar asc (menor = primero). */
export const CERO_ROTACION_ESTADO_SORT_ORDER: Record<CeroRotacionEstado, number> =
  {
    sin_verificar: 0,
    seguimiento: 1,
    surtido: 2,
  };

export const makeCeroRotacionEstadoKey = (sedeId: string, item: string) =>
  `${sedeId}\u001f${item}`;

export const parseCeroRotacionEstado = (
  raw: string | null | undefined,
): CeroRotacionEstado | null => {
  if (!raw || typeof raw !== "string") return null;
  const t = raw.trim();
  // Compatibilidad hacia atras con valores iniciales.
  if (t === "sin_revisar") return "sin_verificar";
  if (t === "r_inventario") return "surtido";
  if (t === "sin_verificar" || t === "seguimiento" || t === "surtido") {
    return t;
  }
  return null;
};
