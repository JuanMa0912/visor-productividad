export type InformePeriodRange = {
  from: string;
  to: string;
  label: string;
};

export type InformePeriods = {
  current: InformePeriodRange;
  mom: InformePeriodRange;
  yoy: InformePeriodRange;
};

export type InformeSedeMeta = {
  e: string;
  s: string;
  yoyOk: boolean;
  key: string;
};

/** Fila compacta: [sede, cat, lin, sub, item, u_cur, u_mom, u_yoy, v_cur, v_mom, v_yoy] */
export type InformeCompactRow = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export type InformeVariacionPayload = {
  periods: InformePeriods;
  sedes: InformeSedeMeta[];
  cats: string[];
  lins: string[];
  subs: string[];
  items: string[];
  ums: string[];
  rows: InformeCompactRow[];
  meta: {
    rowCount: number;
    generatedAt: string;
    /** Bases MoM/YoY sintetizadas para pruebas (no usar en reportes oficiales). */
    mockBases?: boolean;
    /** Hay al menos un valor real en periodos de comparacion. */
    comparisonAvailable?: boolean;
  };
};

export type InformeMetric = "u" | "v";

export type InformeGlobalFilters = {
  emp: string;
  sede: string;
  cat: string;
  lin: string;
  sub: string;
  item: string;
  q: string;
};

export const INFORME_EMPRESA_ORDER = [
  { key: "mtodo", label: "Comercializadora" },
  { key: "mercamio", label: "Mercamio" },
  { key: "bogota", label: "Merkmios" },
] as const;

export const EMPTY_INFORME_FILTERS: InformeGlobalFilters = {
  emp: "",
  sede: "",
  cat: "",
  lin: "",
  sub: "",
  item: "",
  q: "",
};
