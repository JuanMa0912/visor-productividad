export type KardexFilters = {
  empresa?: string;
  sede?: string;
  bodegaLocal?: string;
  idItem?: string;
  idCategoria?: string;
  idLineaNivel1?: string;
  fechaDesde?: string;
  fechaHasta?: string;
};

export type KardexRow = {
  fechaDia: string;
  empresa: string;
  sede: string;
  nombreSede: string | null;
  bodegaLocal: string;
  idItem: string;
  nombreItem: string | null;
  nombreCategoria: string | null;
  nombreLineaNivel1: string | null;
  cantidadVendida: number | null;
  ventas: number | null;
  costo: number | null;
  margen: number | null;
  margenPct: number | null;
  precioUnit: number | null;
  costoUnit: number | null;
  invUnidades: number | null;
  invCostoUnit: number | null;
  invValor: number | null;
  unidadesAcum: number;
  ventasAcum: number;
  costoAcum: number;
  margenAcum: number;
  margenPctAcum: number | null;
};

export type KardexResumenItem = {
  empresa: string;
  sede: string;
  nombreSede: string | null;
  idItem: string;
  nombreItem: string | null;
  nombreCategoria: string | null;
  unidades: number;
  ventas: number;
  costo: number;
  margen: number;
  margenPct: number;
  ultimaFecha: string | null;
  ultimaVentaPdv: string | null;
};

export type KardexResumenCategoria = {
  empresa: string;
  sede: string;
  idCategoria: string | null;
  nombreCategoria: string | null;
  idLineaNivel1: string | null;
  nombreLineaNivel1: string | null;
  items: number;
  unidades: number;
  ventas: number;
  costo: number;
  margen: number;
  margenPct: number;
};

export type KardexTotales = {
  ventas: number;
  costo: number;
  margen: number;
  margenPct: number;
};

export type KardexLookups = {
  empresas: string[];
  sedes: Array<{ value: string; empresa: string }>;
  bodegas: string[];
  categorias: Array<{ idCategoria: string | null; nombreCategoria: string | null }>;
  lineas: Array<{
    idLineaNivel1: string | null;
    nombreLineaNivel1: string | null;
  }>;
};
