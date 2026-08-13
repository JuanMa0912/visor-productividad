export type PreciosProveedorMetric = "pvu" | "pcu" | "margenPct" | "units";

export type PreciosProveedorMeta = {
  minDate: string | null;
  maxDate: string | null;
  defaultStart: string;
  defaultEnd: string;
  lineas: Array<{ id: string; label: string }>;
  sublineas: Array<{ id: string; label: string; lineaId: string }>;
  sedes: Array<{ key: string; label: string }>;
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
  sublineaId: string;
  sublineaLabel: string;
  proveedorId: string;
  proveedorLabel: string;
  /** Totales del rango (todas las sedes del resultado). */
  units: number;
  sales: number;
  cost: number;
  pvu: number;
  /** Costo unitario de entrada (inventario), no COGS de venta. */
  pcu: number;
  margenPct: number;
  proveedorCount: number;
};

export type PreciosProveedorCell = {
  rowId: string;
  sedeKey: string;
  units: number;
  sales: number;
  cost: number;
  pvu: number;
  /** Costo unitario de entrada (inventario). */
  pcu: number;
  margenPct: number;
};

export type PreciosProveedorExpandRow = {
  rowId: string;
  itemId: string;
  label: string;
  proveedorId: string;
  proveedorLabel: string;
  empresa: string;
  cells: PreciosProveedorCell[];
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
