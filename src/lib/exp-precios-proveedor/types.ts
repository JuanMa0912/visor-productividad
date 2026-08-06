export type PreciosProveedorMetric = "pvu" | "pcu" | "margenPct" | "units";

export type PreciosProveedorMeta = {
  minDate: string | null;
  maxDate: string | null;
  defaultStart: string;
  defaultEnd: string;
  lineas: Array<{ id: string; label: string }>;
  note: string;
};

export type PreciosProveedorSedeColumn = {
  key: string;
  label: string;
  empresa: string;
  idCo: string;
};

export type PreciosProveedorRow = {
  id: string;
  label: string;
  lineaId: string;
  lineaLabel: string;
  proveedorId: string;
  proveedorLabel: string;
  /** Totales del rango (todas las sedes del resultado). */
  units: number;
  sales: number;
  cost: number;
  pvu: number;
  pcu: number;
  margenPct: number;
};

export type PreciosProveedorCell = {
  rowId: string;
  sedeKey: string;
  units: number;
  sales: number;
  cost: number;
  pvu: number;
  pcu: number;
  margenPct: number;
};

export type PreciosProveedorMatrix = {
  columns: PreciosProveedorSedeColumn[];
  rows: PreciosProveedorRow[];
  cells: PreciosProveedorCell[];
  from: string;
  to: string;
  itemLimit: number;
  elapsedMs: number;
};
