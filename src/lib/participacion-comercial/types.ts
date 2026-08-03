export type ParticipacionOrientation = "sede" | "linea";

export type ParticipacionLevel =
  | "sede"
  | "linea"
  | "almacen"
  | "categoria"
  | "sublinea"
  | "item";

export type ParticipacionDrillStep =
  | { type: "sede"; id: string; label: string; empresa: string; sedeId: string }
  | { type: "linea"; id: string; label: string }
  | { type: "almacen"; id: string; label: string }
  | { type: "categoria"; id: string; label: string }
  | { type: "sublinea"; id: string; label: string }
  | { type: "item"; id: string; label: string };

export type ParticipacionRow = {
  id: string;
  label: string;
  level: ParticipacionLevel;
  drillStep: ParticipacionDrillStep;
  sales: number;
  units: number;
  /** % sobre el total del padre / alcance actual. */
  sharePct: number;
  childCount: number;
  description?: string | null;
  empresa?: string;
  sedeId?: string;
};

export type ParticipacionSedeColumn = {
  key: string;
  label: string;
  empresa: string;
  sedeId: string;
};

export type ParticipacionMatrixCell = {
  rowId: string;
  sedeKey: string;
  sales: number;
  units: number;
  /**
   * % dentro del alcance actual de la matriz (hermanos ≈ 100%).
   * En raíz = % de la línea en la sede; en sublínea = % dentro de la línea;
   * en ítem = % dentro de la sublínea.
   */
  shareOfSedePct: number;
  /** % de la celda sobre el gran total del alcance (todas las sedes del scope). */
  shareOfTotalPct: number;
  /**
   * % sobre el total real de la sede (todas las líneas), aunque la matriz
   * esté filtrada a una línea/sublínea.
   */
  shareOfFullSedePct: number;
};

export type ParticipacionMatrixRow = {
  id: string;
  label: string;
  drillStep: ParticipacionDrillStep;
  /** Fila residual (líneas fuera del top). */
  residual?: boolean;
};

export type ParticipacionMatrixMetric = "share" | "units" | "sales";

export type ParticipacionMeta = {
  availableDateStart: string;
  availableDateEnd: string;
  defaultDateStart: string;
  defaultDateEnd: string;
  selectedDateStart?: string;
  selectedDateEnd?: string;
  sourceTable: string;
  sedes: ParticipacionSedeColumn[];
  fastPath?: boolean;
};

export type ParticipacionDrillPayload = {
  orientation: ParticipacionOrientation;
  level: ParticipacionLevel;
  rows: ParticipacionRow[];
  path: ParticipacionDrillStep[];
  parentTotalSales: number;
};

export type ParticipacionMatrixPayload = {
  rows: ParticipacionMatrixRow[];
  columns: ParticipacionSedeColumn[];
  cells: ParticipacionMatrixCell[];
  grandTotalSales: number;
  /**
   * Totales del alcance actual (padre): en raíz = sede completa;
   * en sublínea = total de la línea; en ítem = total de la sublínea.
   * Pie “Total sede” 100% usa estos valores.
   */
  sedeTotals: Array<{ sedeKey: string; sales: number; units: number }>;
  /** Totales reales de cada sede (todas las líneas), para % absoluto. */
  fullSedeTotals: Array<{ sedeKey: string; sales: number; units: number }>;
  /** Nivel de filas de la matriz (linea → sublinea → item). */
  rowLevel: "linea" | "sublinea" | "item";
  path: ParticipacionDrillStep[];
  /** Búsqueda activa de ítems (código / descripción). */
  itemSearch?: string;
};
