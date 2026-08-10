export type ChecklistAnswer = "C" | "P" | "NC" | "NA";

export type ChecklistItemState = {
  v: ChecklistAnswer | null;
  h: string;
  cz: string;
  ac: string;
  r: string;
  f: string;
  es: "Pendiente" | "En proceso" | "Cerrada";
};

export type ChecklistQuestion = {
  c: number;
  x: string;
  k: string;
  /** 3=crítico, 2=alto, 1=medio */
  w: 1 | 2 | 3;
  p: number;
  ac: string;
};

export type ChecklistBlock = {
  l: string;
  t: string;
  a: string;
  q: ChecklistQuestion[];
};

export type ChecklistEmpresaSedes = {
  empresa: string;
  sedes: string[];
};

export type ChecklistMeta = {
  empresa: string;
  sede: string;
  fecha: string;
  auditor: string;
  responsable: string;
};

export type ChecklistCatalogEntry = {
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  puntos: number;
  bloques: number;
  status: "available" | "coming_soon";
  href: string;
};

export type BlockScore = {
  l: string;
  t: string;
  a: string;
  peso: number;
  ap: number;
  pts: number;
  pct: number | null;
  ev: number;
  n: number;
};

export type ChecklistComputeResult = {
  p: number;
  po: number;
  pend: number;
  ev: number;
  tot: number;
  cr: number;
  hl: number;
  bl: BlockScore[];
  cnt: Record<ChecklistAnswer, number>;
  pct: number | null;
  max: number | null;
};

export const ANSWER_FACTOR: Record<Exclude<ChecklistAnswer, "NA">, number> = {
  C: 1,
  P: 0.5,
  NC: 0,
};

export const emptyItemState = (): ChecklistItemState => ({
  v: null,
  h: "",
  cz: "",
  ac: "",
  r: "",
  f: "",
  es: "Pendiente",
});
