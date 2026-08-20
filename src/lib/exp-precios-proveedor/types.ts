export type PreciosProveedorMetric = "pvu" | "pcu" | "margenPct" | "units";

export type PreciosProveedorMeta = {
  minDate: string | null;
  maxDate: string | null;
  defaultStart: string;
  defaultEnd: string;
  lineas: Array<{ id: string; label: string }>;
  sublineas: Array<{ id: string; label: string; lineaId: string }>;
  /** Empresas (Mercamio / Mercatodo / Merkmios). No es marca comercial. */
  empresas: Array<{ id: string; label: string }>;
  sedes: Array<{ key: string; label: string }>;
  proveedores: Array<{ id: string; label: string }>;
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
  /** Kilos EN TRANSITO (ET): despachados y sin recibir. Se informan, no se suman. */
  transito: number;
};

export type PreciosProveedorExpandRow = {
  rowId: string;
  itemId: string;
  label: string;
  /** Id estable: `oc:CODIGO` (linea OC), `t:CODIGO` (comercial) o criterio POS. */
  proveedorId: string;
  /** Nombre del tercero de OC si hay lineas; si no, comercial por NIT o criterio POS. */
  proveedorLabel: string;
  /** Criterio del ítem (`proveedor_pos_catalogo`), distinto del comercial. */
  criterioId: string | null;
  criterioLabel: string | null;
  empresa: string;
  /** Marca legible: Mercamio / Mercatodo / Merkmios. */
  empresaLabel: string;
  nit: string | null;
  /** true si el nombre sale de `orden_compra_linea` o `proveedor_tercero`. */
  fromTercero: boolean;
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
