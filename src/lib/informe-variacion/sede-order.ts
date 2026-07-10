import type { MargenSedeCatalogOption } from "@/lib/margenes/margen-sede-catalog";
import type {
  InformeCompactRow,
  InformeVariacionPayload,
} from "@/lib/informe-variacion/types";

/**
 * Orden fijo de columnas en la matriz comparativa entre sedes (informe variación).
 * Floresta → … → Chía; no depende del sort alfabético del catálogo.
 */
export const INFORME_SEDE_MATRIX_ORDER = [
  "mtodo|001", // Floresta · Comercializadora
  "mtodo|002", // Floralia
  "mtodo|003", // Guaduales
  "mercamio|001", // Calle 5ta
  "mercamio|002", // La 39
  "mercamio|003", // Plaza Norte
  "mercamio|004", // Ciudad Jardín
  "mercamio|005", // Centro Sur
  "mercamio|006", // Palmira
  "bogota|001", // Bogotá
  "bogota|002", // Chía
] as const;

const SEDE_KEY_ALIASES: Record<string, string> = {
  "mercatodo|001": "mtodo|001",
  "mercatodo|002": "mtodo|002",
  "mercatodo|003": "mtodo|003",
  "merkmios|001": "bogota|001",
  "merkmios|002": "bogota|002",
};

const canonicalInformeSedeKey = (sedeKey: string): string => {
  const normalized = sedeKey.trim().toLowerCase();
  return SEDE_KEY_ALIASES[normalized] ?? normalized;
};

const ORDER_INDEX = new Map<string, number>(
  INFORME_SEDE_MATRIX_ORDER.map((key, index) => [key, index]),
);

export const informeSedeOrderIndex = (sedeKey: string): number =>
  ORDER_INDEX.get(canonicalInformeSedeKey(sedeKey)) ?? Number.MAX_SAFE_INTEGER;

export const sortInformeSedeCatalog = (
  catalog: MargenSedeCatalogOption[],
): MargenSedeCatalogOption[] =>
  [...catalog].sort((a, b) => {
    const byFixed = informeSedeOrderIndex(a.value) - informeSedeOrderIndex(b.value);
    if (byFixed !== 0) return byFixed;
    const empresaCmp = a.empresa.localeCompare(b.empresa, "es");
    if (empresaCmp !== 0) return empresaCmp;
    return a.idCo.localeCompare(b.idCo, "es");
  });

/** Reordena columnas de sede y remapea índices en filas (también con payload cacheado). */
export const reorderInformeVariacionSedes = (
  payload: InformeVariacionPayload,
): InformeVariacionPayload => {
  if (payload.sedes.length <= 1) return payload;

  const ordered = payload.sedes
    .map((sede, index) => ({ sede, index }))
    .sort(
      (a, b) =>
        informeSedeOrderIndex(a.sede.key) - informeSedeOrderIndex(b.sede.key),
    );

  const isIdentity = ordered.every((entry, newIndex) => entry.index === newIndex);
  if (isIdentity) return payload;

  const sedes = ordered.map((entry) => entry.sede);
  const remap = new Array<number>(payload.sedes.length);
  ordered.forEach((entry, newIndex) => {
    remap[entry.index] = newIndex;
  });

  const rows = payload.rows.map((row) => {
    const sedeIdx = remap[row[0]];
    if (sedeIdx === undefined) return row;
    return [
      sedeIdx,
      row[1],
      row[2],
      row[3],
      row[4],
      row[5],
      row[6],
      row[7],
      row[8],
      row[9],
      row[10],
      row[11] ?? 0,
      row[12] ?? 0,
      row[13] ?? 0,
    ] as InformeCompactRow;
  });

  return { ...payload, sedes, rows };
};
