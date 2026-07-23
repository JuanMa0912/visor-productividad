import { getCanonicalSedeName } from "@/lib/shared/sede-names";
import { empresaLabel, sedeKey, sedeLabel } from "@/lib/margenes/margen-final-query";

export type MargenSedeCatalogOption = {
  value: string;
  label: string;
  empresa: string;
  idCo: string;
  rowCount: number;
};

/**
 * Catálogo estático de sedes conocidas (sin consultar margen_final).
 * Evita un DISTINCT sobre millones de filas al abrir el picker.
 */
const STATIC_SEDE_ENTRIES: Array<{ idCo: string; empresa: string }> = [
  { idCo: "001", empresa: "mercamio" },
  { idCo: "002", empresa: "mercamio" },
  { idCo: "003", empresa: "mercamio" },
  { idCo: "004", empresa: "mercamio" },
  { idCo: "005", empresa: "mercamio" },
  { idCo: "006", empresa: "mercamio" },
  // Plantas excluidas (no son tiendas): 997 Desprese Pollo, 998 Panificadora, 999 Desposte Mixto.
  { idCo: "001", empresa: "mtodo" },
  { idCo: "002", empresa: "mtodo" },
  { idCo: "003", empresa: "mtodo" },
  { idCo: "001", empresa: "bogota" },
  { idCo: "002", empresa: "bogota" },
  { idCo: "001", empresa: "dinastia" },
  { idCo: "002", empresa: "dinastia" },
];

export const listMargenSedeCatalogOptions = (): MargenSedeCatalogOption[] => {
  const seen = new Set<string>();
  const options: MargenSedeCatalogOption[] = [];

  for (const entry of STATIC_SEDE_ENTRIES) {
    const value = sedeKey(entry.empresa, entry.idCo);
    if (seen.has(value)) continue;
    seen.add(value);
    const canonical = getCanonicalSedeName(entry.idCo, entry.empresa);
    options.push({
      value,
      label: canonical ?? sedeLabel(entry.empresa, entry.idCo),
      empresa: entry.empresa,
      idCo: entry.idCo.padStart(3, "0"),
      rowCount: 0,
    });
  }

  return options.sort((a, b) => {
    const empresaCmp = empresaLabel(a.empresa).localeCompare(
      empresaLabel(b.empresa),
      "es",
    );
    if (empresaCmp !== 0) return empresaCmp;
    return a.idCo.localeCompare(b.idCo, "es");
  });
};
