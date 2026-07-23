import { LineMetrics } from "@/types";
import { normalizeKeyCompact } from "./normalize";

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

export const DINASTIA_SEDES = [
  "Dinastia 1 Santa Elena",
  "Dinastia 2 CR Primera",
];

export const BRANCH_LOCATIONS = [
  ...MERCAMIO_SEDES,
  ...MERCATODO_SEDES,
  ...MERKMIOS_SEDES,
  ...DINASTIA_SEDES,
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
  "Dinastia 1 Santa Elena",
  "Dinastia 2 CR Primera",
];

/**
 * Prefijos en textos de sede (inventario, asistencia) para comparar y mostrar
 * alineado con la tabla de horas / productividad.
 */
export function stripSedeLabelPrefixes(name: string): string {
  let s = name.trim();
  s = s.replace(/^\s*mercamio\s+/i, "").trim();
  s = s.replace(/^\s*merkmios\s+/i, "").trim();
  s = s.replace(/^\s*sede\s+/i, "").trim();
  return s;
}

/**
 * Clave compacta → índice en {@link SEDE_ORDER} (misma lógica que productividad / tabla de horas).
 * Incluye alias que aparecen en inventario u otras fuentes.
 */
export const SEDE_ORDER_INDEX_MAP: Map<string, number> = (() => {
  const map = new Map<string, number>();
  SEDE_ORDER.forEach((name, index) => {
    map.set(normalizeKeyCompact(name), index);
  });
  const addAlias = (alias: string, canonical: string) => {
    const index = SEDE_ORDER.indexOf(canonical);
    if (index < 0) return;
    const key = normalizeKeyCompact(alias);
    if (!map.has(key)) map.set(key, index);
  };
  addAlias("CL 5", "Calle 5ta");
  addAlias("CL5", "Calle 5ta");
  addAlias("Cra 39", "La 39");
  addAlias("CRA 39", "La 39");
  addAlias("Palmira Nro 1", "Palmira");
  addAlias("Palmira Nro. 1", "Palmira");
  addAlias("Merkmios La 80", "Bogota");
  addAlias("Mercamios La 80", "Bogota");
  addAlias("Plaza Mayor Chia", "Chia");
  addAlias("Plaza Mayor de Chia", "Chia");
  addAlias("Palmira Mercamio", "Palmira");
  addAlias("Mercatodo Floralia", "Floralia");
  addAlias("DINASTIA 1 SANTA ELENA", "Dinastia 1 Santa Elena");
  addAlias("Dinastia 001", "Dinastia 1 Santa Elena");
  addAlias("DINASTIA 2 CR PRIMERA", "Dinastia 2 CR Primera");
  addAlias("Dinastia 002", "Dinastia 2 CR Primera");
  return map;
})();

/** Índice en {@link SEDE_ORDER}; desconocidos al final (como en tablas de horas). */
export function getSedeOrderIndexForRawName(raw: string): number {
  const stripped = stripSedeLabelPrefixes(raw);
  const key = normalizeKeyCompact(stripped);
  let index = SEDE_ORDER_INDEX_MAP.get(key);
  if (index !== undefined) return index;
  if (key.startsWith("sede") && key.length > 4) {
    index = SEDE_ORDER_INDEX_MAP.get(key.slice(4));
    if (index !== undefined) return index;
  }
  return Number.MAX_SAFE_INTEGER;
}

export const SEDE_GROUPS: Array<{ id: string; name: string; sedes: string[] }> =
  [
    { id: "all", name: "Todas las sedes", sedes: BRANCH_LOCATIONS },
    { id: "mercamio", name: "Mercamio", sedes: MERCAMIO_SEDES },
    { id: "mercatodo", name: "Mercatodo", sedes: MERCATODO_SEDES },
    { id: "merkmios", name: "Merkmios", sedes: MERKMIOS_SEDES },
    { id: "dinastia", name: "Dinastía", sedes: DINASTIA_SEDES },
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

