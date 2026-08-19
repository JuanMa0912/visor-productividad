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
