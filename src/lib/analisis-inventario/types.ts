export type AnalisisInventarioMetric = "units" | "value";

export type AnalisisInventarioLevel =
  | "sede"
  | "categoria"
  | "linea"
  | "sublinea"
  | "item";

export type AnalisisInventarioDrillStep =
  | { type: "sede"; id: string; label: string; empresa: string; sedeId: string }
  | { type: "categoria"; id: string; label: string }
  | { type: "linea"; id: string; label: string }
  | { type: "sublinea"; id: string; label: string }
  | { type: "item"; id: string; label: string };

export type AnalisisInventarioAgg = {
  inventoryUnits: number;
  inventoryValue: number;
  soldUnits: number;
  costOfSales: number;
  trackedDays: number;
  diUnits: number;
  diValue: number;
  childCount: number;
};

export type AnalisisInventarioDrillRow = AnalisisInventarioAgg & {
  id: string;
  label: string;
  level: AnalisisInventarioLevel;
  /** Paso a anexar al drillPath al abrir este nodo. */
  drillStep: AnalisisInventarioDrillStep;
  description?: string | null;
  empresa?: string;
  sedeId?: string;
};

export type AnalisisInventarioHeatmapCell = AnalisisInventarioAgg & {
  rowId: string;
  sedeKey: string;
};

export type AnalisisInventarioHeatmapRow = {
  id: string;
  label: string;
  level: Exclude<AnalisisInventarioLevel, "sede">;
  drillStep: AnalisisInventarioDrillStep;
};

export type AnalisisInventarioSedeColumn = {
  key: string;
  label: string;
  empresa: string;
  sedeId: string;
};

export type AnalisisInventarioMeta = {
  availableDateStart: string;
  availableDateEnd: string;
  defaultDateStart: string;
  defaultDateEnd: string;
  sourceTable: string;
  sedes: AnalisisInventarioSedeColumn[];
};

export type AnalisisInventarioDrillPayload = {
  level: AnalisisInventarioLevel;
  rows: AnalisisInventarioDrillRow[];
  path: AnalisisInventarioDrillStep[];
};

export type AnalisisInventarioHeatmapPayload = {
  rowLevel: Exclude<AnalisisInventarioLevel, "sede">;
  rows: AnalisisInventarioHeatmapRow[];
  columns: AnalisisInventarioSedeColumn[];
  cells: AnalisisInventarioHeatmapCell[];
  path: AnalisisInventarioDrillStep[];
};
