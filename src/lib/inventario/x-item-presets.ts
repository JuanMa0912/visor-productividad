import { INVENTARIO_X_ITEM_MAX_SELECTED_ITEMS } from "@/lib/inventario/x-item";

export const MAX_ITEM_PRESETS = 25;

export type ItemPreset = {
  id: string;
  name: string;
  items: string[];
  createdAt: number;
};

/** Normaliza y valida el arreglo guardado en BD o en migración desde localStorage. */
export function normalizeItemPresetsFromUnknown(input: unknown): ItemPreset[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry): ItemPreset | null => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Partial<ItemPreset>;
      if (typeof candidate.id !== "string" || !candidate.id.trim()) return null;
      if (typeof candidate.name !== "string" || !candidate.name.trim()) return null;
      if (!Array.isArray(candidate.items)) return null;
      return {
        id: candidate.id.trim(),
        name: candidate.name.trim(),
        items: candidate.items
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .slice(0, INVENTARIO_X_ITEM_MAX_SELECTED_ITEMS),
        createdAt:
          typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt)
            ? candidate.createdAt
            : Date.now(),
      };
    })
    .filter((preset): preset is ItemPreset => Boolean(preset))
    .slice(0, MAX_ITEM_PRESETS);
}
