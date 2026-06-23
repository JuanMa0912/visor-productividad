import type { CeroRotacionEstado } from "@/lib/rotacion/cero-estado";
import type { RotacionSedeRowGroup } from "./rotacion-export-groups";
import {
  buildRotacionRowsKey,
  buildRowsBySede,
  filterRotationRowsByLineaAndCategoria,
  normalizeRotationRows,
  rowMatchesProductSearch,
  sortRotationRows,
  type RotationCategoriaFilterOption,
  type RotationRow,
  type RotationSortDirection,
  type RotationSortField,
} from "./rotacion-preamble";
import {
  buildRotacionRowsCacheKey,
  readRotacionRowsIdbCache,
} from "./rotacion-rows-idb-cache";
import {
  fetchRotacionRowsForCache,
  type RotacionRowsFetchResult,
} from "./rotacion-prefetch";

export type RotacionExportSedeMeta = {
  value: string;
  empresa: string;
  sedeId: string;
};

export type PrepareRotacionExportDataInput = {
  apiBasePath: string;
  authUserId: string | undefined;
  dateRange: { start: string; end: string };
  selectedSedeValues: string[];
  allSedeOptions: RotacionExportSedeMeta[];
  loadedSedeValueSet: ReadonlySet<string>;
  inMemoryPerSedeExportGroups: RotacionSedeRowGroup[];
  inMemoryPerSedeBaseRowsByKey: ReadonlyMap<string, RotationRow[]>;
  inMemoryCeroEstadoByKey: Readonly<Record<string, CeroRotacionEstado>>;
  inMemoryRestockEstadoByKey: Readonly<Record<string, CeroRotacionEstado>>;
  filterCatalogLineasN1: string[] | undefined;
  filterCatalogCategorias: RotationCategoriaFilterOption[] | undefined;
  selectedLineaN1Values: string[];
  selectedCategoriaKeys: string[];
  productSearchInput: string;
  tableSortField: RotationSortField | null;
  tableSortDirection: RotationSortDirection;
  onUnauthorized?: () => void;
  onForbidden?: (message: string) => void;
};

export type PrepareRotacionExportDataResult = {
  perSedeExportSourceGroups: RotacionSedeRowGroup[];
  perSedeBaseRowsByKey: Map<string, RotationRow[]>;
  ceroEstadoByKey: Record<string, CeroRotacionEstado>;
  restockEstadoByKey: Record<string, CeroRotacionEstado>;
};

const fetchCeroEstadosForSedes = async (
  start: string,
  end: string,
  sedeValues: string[],
): Promise<{
  estados: Record<string, CeroRotacionEstado>;
  estadosRestock: Record<string, CeroRotacionEstado>;
}> => {
  if (sedeValues.length === 0) {
    return { estados: {}, estadosRestock: {} };
  }
  const params = new URLSearchParams();
  params.set("start", start);
  params.set("end", end);
  sedeValues.forEach((value) => params.append("sedeScope", value));
  const response = await fetch(
    `/api/rotacion/cero-estados?${params.toString()}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    return { estados: {}, estadosRestock: {} };
  }
  const data = (await response.json()) as {
    estados?: Record<string, CeroRotacionEstado>;
    estadosRestock?: Record<string, CeroRotacionEstado>;
  };
  return {
    estados: data.estados ?? {},
    estadosRestock: data.estadosRestock ?? {},
  };
};

const processRowsForExport = (
  rawRows: RotationRow[],
  input: Pick<
    PrepareRotacionExportDataInput,
    | "filterCatalogLineasN1"
    | "filterCatalogCategorias"
    | "selectedLineaN1Values"
    | "selectedCategoriaKeys"
    | "productSearchInput"
    | "tableSortField"
    | "tableSortDirection"
  >,
): {
  perSedeExportSourceGroups: RotacionSedeRowGroup[];
  perSedeBaseRowsByKey: Map<string, RotationRow[]>;
} => {
  const normalized = normalizeRotationRows(rawRows);
  const catalogFiltered = filterRotationRowsByLineaAndCategoria(
    normalized,
    input.filterCatalogLineasN1 ?? [],
    input.selectedLineaN1Values,
    input.filterCatalogCategorias ?? [],
    input.selectedCategoriaKeys,
  );
  const sorted = sortRotationRows(
    catalogFiltered,
    input.tableSortField,
    input.tableSortDirection,
  );
  const afterProduct = sorted.filter((row) =>
    rowMatchesProductSearch(row, input.productSearchInput),
  );
  return {
    perSedeExportSourceGroups: buildRowsBySede(afterProduct),
    perSedeBaseRowsByKey: new Map(
      buildRowsBySede(sorted).map((group) => [
        `${group.empresa}-${group.sedeId}`,
        group.rows,
      ]),
    ),
  };
};

export const prepareRotacionExportData = async (
  input: PrepareRotacionExportDataInput,
): Promise<PrepareRotacionExportDataResult | null> => {
  const sedeOptionsByValue = new Map(
    input.allSedeOptions.map((option) => [option.value, option]),
  );
  const selectedOptions = input.selectedSedeValues
    .map((value) => sedeOptionsByValue.get(value))
    .filter((option): option is RotacionExportSedeMeta => Boolean(option));
  if (selectedOptions.length === 0) return null;

  const loadedValueSet = new Set(
    input.selectedSedeValues.filter((value) =>
      input.loadedSedeValueSet.has(value),
    ),
  );
  const missingValues = input.selectedSedeValues.filter(
    (value) => !input.loadedSedeValueSet.has(value),
  );

  let fetchedGroups: RotacionSedeRowGroup[] = [];
  const fetchedBaseByKey = new Map<string, RotationRow[]>();
  let extraCero: Record<string, CeroRotacionEstado> = {};
  let extraRestock: Record<string, CeroRotacionEstado> = {};

  if (missingValues.length > 0) {
    const missingOptions = missingValues
      .map((value) => sedeOptionsByValue.get(value))
      .filter((option): option is RotacionExportSedeMeta => Boolean(option));
    if (missingOptions.length === 0) return null;

    const rowsScopeKey = buildRotacionRowsKey({
      start: input.dateRange.start,
      end: input.dateRange.end,
      empresas: missingOptions.map((option) => option.empresa),
      sedeIds: missingOptions.map((option) => option.sedeId),
      lineasN1: [],
      categoriaKeys: [],
    });
    const cacheKey = buildRotacionRowsCacheKey(
      input.apiBasePath,
      input.authUserId,
      rowsScopeKey,
    );

    let fetchResult: RotacionRowsFetchResult | null =
      await readRotacionRowsIdbCache(cacheKey);
    if (!fetchResult) {
      fetchResult = await fetchRotacionRowsForCache({
        apiBasePath: input.apiBasePath,
        cacheKey,
        start: input.dateRange.start,
        end: input.dateRange.end,
        sedeSelections: missingOptions.map((option) => ({
          empresa: option.empresa,
          sedeId: option.sedeId,
        })),
        onUnauthorized: input.onUnauthorized,
        onForbidden: input.onForbidden,
      });
    }
    if (!fetchResult) return null;

    const processed = processRowsForExport(fetchResult.rows, input);
    fetchedGroups = processed.perSedeExportSourceGroups;
    for (const [key, rows] of processed.perSedeBaseRowsByKey) {
      fetchedBaseByKey.set(key, rows);
    }

    const ceroData = await fetchCeroEstadosForSedes(
      input.dateRange.start,
      input.dateRange.end,
      missingValues,
    );
    extraCero = ceroData.estados;
    extraRestock = ceroData.estadosRestock;
  }

  const inMemoryGroups = input.inMemoryPerSedeExportGroups.filter((group) =>
    loadedValueSet.has(`${group.empresa}::${group.sedeId}`),
  );
  const perSedeBaseRowsByKey = new Map(input.inMemoryPerSedeBaseRowsByKey);
  for (const [key, rows] of fetchedBaseByKey) {
    perSedeBaseRowsByKey.set(key, rows);
  }

  return {
    perSedeExportSourceGroups: [...inMemoryGroups, ...fetchedGroups],
    perSedeBaseRowsByKey,
    ceroEstadoByKey: { ...input.inMemoryCeroEstadoByKey, ...extraCero },
    restockEstadoByKey: {
      ...input.inMemoryRestockEstadoByKey,
      ...extraRestock,
    },
  };
};
