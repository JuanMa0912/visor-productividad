export const splitCostosCsv = (raw: string | null | undefined): string[] =>
  String(raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

export const keepSelected = (selected: string[], allowed: Iterable<string>) => {
  const allow = new Set(allowed);
  if (allow.size === 0) return selected;
  return selected.filter((id) => allow.has(id));
};

/**
 * Vacío en sede = todas las visibles. Si hay empresa, se recorta a esas
 * empresas. Misma regla para la matriz y para el expand (clic / doble clic).
 */
export const resolveCostosSedes = (
  selectedSedes: readonly string[],
  allSedeKeys: readonly string[],
  selectedEmpresas: readonly string[] = [],
): string[] => {
  const matchesEmpresa = (key: string) =>
    selectedEmpresas.length === 0 ||
    selectedEmpresas.some((emp) => key.startsWith(`${emp}|`));
  const allVisible = allSedeKeys.filter(matchesEmpresa);
  const requested = selectedSedes.filter(matchesEmpresa);
  return requested.length > 0 ? requested : [...allVisible];
};

export type ProveedorFilterIds = {
  oc: string[];
  tercero: string[];
  criterio: string[];
};

export const parseProveedorFilterIds = (
  ids: Array<string | null | undefined> | null | undefined,
): ProveedorFilterIds => {
  const oc: string[] = [];
  const tercero: string[] = [];
  const criterio: string[] = [];
  for (const raw of ids ?? []) {
    const id = String(raw ?? "").trim();
    if (!id) continue;
    if (id.startsWith("oc:")) {
      const code = id.slice(3).trim();
      if (code) oc.push(code);
      continue;
    }
    if (id.startsWith("t:")) {
      const code = id.slice(2).trim();
      if (code) tercero.push(code);
      continue;
    }
    criterio.push(id);
  }
  return { oc, tercero, criterio };
};

export const hasProveedorFilter = (ids: ProveedorFilterIds) =>
  ids.oc.length > 0 || ids.tercero.length > 0 || ids.criterio.length > 0;
