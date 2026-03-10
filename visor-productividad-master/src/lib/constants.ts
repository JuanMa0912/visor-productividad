import { LineMetrics } from "@/types";

export type Sede = { id: string; name: string };

export const MERCAMIO_SEDES = [
  "Calle 5ta",
  "La 39",
  "Plaza Norte",
  "Ciudad Jardin",
  "Centro Sur",
  "Palmira",
];

export const MERCATODO_SEDES = ["Floresta", "Floralia", "Guaduales"];

export const MERKMIOS_SEDES = ["Bogota", "Chia"];

export const BRANCH_LOCATIONS = [
  ...MERCAMIO_SEDES,
  ...MERCATODO_SEDES,
  ...MERKMIOS_SEDES,
];

export const SEDE_ORDER = [
  "Calle 5ta",
  "La 39",
  "Plaza Norte",
  "Ciudad Jardin",
  "Centro Sur",
  "Palmira",
  "Floresta",
  "Floralia",
  "Guaduales",
  "Bogota",
  "Chia",
];

export const SEDE_GROUPS: Array<{ id: string; name: string; sedes: string[] }> =
  [
    { id: "all", name: "Todas las sedes", sedes: BRANCH_LOCATIONS },
    { id: "mercamio", name: "Mercamio", sedes: MERCAMIO_SEDES },
    { id: "mercatodo", name: "Mercatodo", sedes: MERCATODO_SEDES },
    { id: "merkmios", name: "Merkmios", sedes: MERKMIOS_SEDES },
  ];

export const DEFAULT_SEDES: Sede[] = BRANCH_LOCATIONS.map((sede) => ({
  id: sede,
  name: sede,
}));

export const DEFAULT_LINES: Array<Pick<LineMetrics, "id" | "name">> = [
  { id: "cajas", name: "Cajas" },
  { id: "fruver", name: "Fruver" },
  { id: "industria", name: "Industria" },
  { id: "carnes", name: "Carnes" },
  { id: "pollo y pescado", name: "Pollo y pescado" },
  { id: "asadero", name: "Asadero" },
];

export const ALLOWED_LINE_IDS = DEFAULT_LINES.map((line) => line.id);
export const ALLOWED_LINE_SET = new Set<string>(ALLOWED_LINE_IDS);

