import type { MargenSedeCatalogOption } from "@/lib/margenes/margen-sede-catalog";

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

const ORDER_INDEX = new Map<string, number>(
  INFORME_SEDE_MATRIX_ORDER.map((key, index) => [key, index]),
);

export const informeSedeOrderIndex = (sedeKey: string): number =>
  ORDER_INDEX.get(sedeKey) ?? Number.MAX_SAFE_INTEGER;

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
