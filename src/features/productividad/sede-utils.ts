import {
  SEDE_GROUPS,
  SEDE_ORDER,
  type Sede,
} from "@/lib/shared/constants";
import { normalizeKeyCompact } from "@/lib/shared/normalize";

export const normalizeSedeKey = normalizeKeyCompact;

export const SEDE_ORDER_MAP = new Map(
  SEDE_ORDER.map((name, index) => [normalizeSedeKey(name), index]),
);

export const sortSedesByOrder = (sedes: Sede[]) => {
  return [...sedes].sort((a, b) => {
    const aKey = normalizeSedeKey(a.id || a.name);
    const bKey = normalizeSedeKey(b.id || b.name);
    const aOrder = SEDE_ORDER_MAP.get(aKey) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = SEDE_ORDER_MAP.get(bKey) ?? Number.MAX_SAFE_INTEGER;

    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.name.localeCompare(b.name, "es");
  });
};

export const buildCompanyOptions = (): Sede[] =>
  SEDE_GROUPS.filter((group) => group.id !== "all").map((group) => ({
    id: group.id,
    name: group.name,
  }));

export const resolveSelectedSedeIds = (
  selectedSede: string,
  selectedCompanies: string[],
  availableSedes: Sede[],
): string[] => {
  const availableByKey = new Map(
    availableSedes.map((sede) => [normalizeSedeKey(sede.id), sede.id]),
  );

  if (selectedCompanies.length > 0) {
    const resolved = new Set<string>();
    selectedCompanies.forEach((companyId) => {
      const group = SEDE_GROUPS.find(
        (candidate) => candidate.id === companyId,
      );
      if (!group) return;
      group.sedes.forEach((sedeId) => {
        const resolvedId = availableByKey.get(normalizeSedeKey(sedeId));
        if (resolvedId) resolved.add(resolvedId);
      });
    });
    return Array.from(resolved);
  }

  if (selectedSede) {
    const resolved = availableByKey.get(normalizeSedeKey(selectedSede));
    return resolved ? [resolved] : [];
  }

  return availableSedes.map((sede) => sede.id);
};
