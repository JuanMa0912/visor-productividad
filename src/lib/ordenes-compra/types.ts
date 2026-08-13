export type OrdenCompraRow = {
  empresa: string;
  idCo: string;
  sede: string | null;
  tipdoc: string;
  tipdocNom: string;
  documentoOc: string;
  fechaDcto: string;
  fechaEntrega: string | null;
  fechaLimiteSla: string;
  diasSla: number;
  idTerc: string | null;
  tercNombre: string | null;
  tercNit: string | null;
  indEstado: string;
  estadoNom: string | null;
  usuarioConf: string | null;
  fechaConf: string | null;
  horaConf: string | null;
  compradorNom: string | null;
  nLineas: number;
  nItems: number;
  cantidad: number;
  cantidadEnt: number;
  pctRecibida: number;
  totBruto: number;
  loadedAt: string | null;
  cumplida: boolean;
  incompleta: boolean;
  pendiente: boolean;
  vencidaSla: boolean;
  aTiempo: boolean;
  badge: "cumplida" | "vencida" | "incompleta" | "pendiente" | "a_tiempo";
};

export type OrdenCompraKpis = {
  total: number;
  abiertas: number;
  incompletas: number;
  vencidas: number;
  cumplidas: number;
  deAyer: number;
  totBrutoAbiertas: number;
  pctRecibidaAbiertas: number;
};

export type OrdenCompraBreakdown = {
  key: string;
  label: string;
  count: number;
  abiertas: number;
  vencidas: number;
  incompletas: number;
  totBruto: number;
};

export type OrdenCompraMeta = {
  empresas: string[];
  sedes: string[];
  tipdocs: { codigo: string; nombre: string }[];
  compradores: string[];
  loadedAt: string | null;
  slaDays: number;
  truncated: boolean;
};

export type OrdenCompraBoard = {
  meta: OrdenCompraMeta;
  kpis: OrdenCompraKpis;
  breakdowns: {
    empresa: OrdenCompraBreakdown[];
    sede: OrdenCompraBreakdown[];
    tipdoc: OrdenCompraBreakdown[];
  };
  rows: OrdenCompraRow[];
};
