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

/**
 * Clave unica para indexar el estado S.inventario de un item en una sede.
 *
 * Incluye `empresa` porque `sedeId` NO es unico entre empresas (ej. Mercamio
 * 001 = Calle 5ta, Mercatodo 001 = Floresta, Merkmios 001 = Bogota). Si solo
 * usaramos sedeId, los cambios de un admin se mostrarian/aplicarian a otras
 * sedes que comparten el mismo numero. El separador `\u001f` (Unit Separator)
 * evita colisiones con caracteres validos en empresa, sedeId o item.
 */
export const makeCeroRotacionEstadoKey = (
  empresa: string,
  sedeId: string,
  item: string,
) => `${empresa}\u001f${sedeId}\u001f${item}`;

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
