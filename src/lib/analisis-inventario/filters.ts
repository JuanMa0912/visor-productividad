import type { AnalisisInventarioSedeColumn } from "@/lib/analisis-inventario/types";

export type AnalisisInventarioDimensionFilters = {
  /** Códigos empresa en minúsculas. Vacío = todas. */
  empresas: string[];
  /** Claves `empresa|sedeId`. Vacío = todas (dentro de empresas). */
  sedes: string[];
  /** Códigos línea N1. */
  lineas: string[];
  /** Códigos sublínea N2. */
  sublineas: string[];
  /** Códigos ítem. */
  items: string[];
  /** Inventario unidades mayor a este valor (exclusive). null = sin filtro. */
  invMinUnits: number | null;
};

export type AnalisisInventarioFilterOption = {
  value: string;
  label: string;
};

export type AnalisisInventarioFilterCatalog = {
  lineas: AnalisisInventarioFilterOption[];
  sublineas: AnalisisInventarioFilterOption[];
  items: AnalisisInventarioFilterOption[];
};

const splitCsv = (raw: string | null): string[] => {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
};

const parseInvMin = (raw: string | null): number | null => {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(String(raw).replace(",", ".").trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
};

export const parseAnalisisInventarioDimensionFilters = (
  searchParams: URLSearchParams,
): AnalisisInventarioDimensionFilters => ({
  empresas: splitCsv(searchParams.get("empresas")).map((v) =>
    v.toLowerCase(),
  ),
  sedes: splitCsv(searchParams.get("sedes")).map((v) => v.toLowerCase()),
  lineas: splitCsv(searchParams.get("lineas")),
  sublineas: splitCsv(searchParams.get("sublineas")),
  items: splitCsv(searchParams.get("items")),
  invMinUnits: parseInvMin(searchParams.get("invMin")),
});

/**
 * Intersecta columnas del alcance con filtros de empresa/sede.
 * Selección vacía = sin recorte.
 */
export const applySedeColumnFilters = (
  columns: AnalisisInventarioSedeColumn[],
  filters: Pick<AnalisisInventarioDimensionFilters, "empresas" | "sedes">,
): AnalisisInventarioSedeColumn[] => {
  let next = columns;
  if (filters.empresas.length > 0) {
    const set = new Set(filters.empresas);
    next = next.filter((col) => set.has(col.empresa.toLowerCase()));
  }
  if (filters.sedes.length > 0) {
    const set = new Set(filters.sedes.map((k) => k.toLowerCase()));
    next = next.filter((col) => set.has(col.key.toLowerCase()));
  }
  return next;
};

export const columnsToSedePairs = (
  columns: AnalisisInventarioSedeColumn[],
): Array<{ empresa: string; sedeId: string }> =>
  columns.map((col) => ({ empresa: col.empresa, sedeId: col.sedeId }));

/** Cláusulas AND para línea / sublínea / ítem (params mutables). */
export const dimensionPathSql = (
  filters: Pick<
    AnalisisInventarioDimensionFilters,
    "lineas" | "sublineas" | "items"
  >,
  exprs: { lineaId: string; sublineaId: string; itemId: string },
  params: unknown[],
): string => {
  const parts: string[] = [];
  if (filters.lineas.length > 0) {
    params.push(filters.lineas);
    parts.push(`${exprs.lineaId} = ANY($${params.length}::text[])`);
  }
  if (filters.sublineas.length > 0) {
    params.push(filters.sublineas);
    parts.push(`${exprs.sublineaId} = ANY($${params.length}::text[])`);
  }
  if (filters.items.length > 0) {
    params.push(filters.items);
    parts.push(`${exprs.itemId} = ANY($${params.length}::text[])`);
  }
  if (parts.length === 0) return "";
  return `\n        AND ${parts.join("\n        AND ")}`;
};
