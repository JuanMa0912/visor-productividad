/**
 * Plantillas de jornada para "Mismo horario que lunes" (rol replicar_lunes / admin).
 * Entrada = primer HE (he1). Salida del día = última HS (hs2); hs1 y he2 vacíos.
 */

import { normalizeScheduleTime } from "@/lib/schedule-time";

/** Planilla del día: coincide con un preset si primera entrada y última salida son las del preset. */
export function planMatchesLunesPreset(
  plan: { he1: string; hs1: string; he2: string; hs2: string },
  preset: { he1: string; hs2: string },
): boolean {
  const he1 = normalizeScheduleTime(plan.he1 ?? "");
  const hs2 = normalizeScheduleTime(plan.hs2 ?? "");
  return he1 === preset.he1 && hs2 === preset.hs2;
}

export type LunesSchedulePresetKey = "1" | "2" | "3";

export type LunesSchedulePreset = {
  key: LunesSchedulePresetKey;
  label: string;
  /** HH:mm 24 h — primera entrada */
  he1: string;
  /** HH:mm 24 h — última salida del día (segunda HS) */
  hs2: string;
};

export const LUNES_PRESETS_STORAGE_KEY = "vp:ingresar-horarios:lunes-presets-v1";

export const DEFAULT_LUNES_SCHEDULE_PRESETS: readonly LunesSchedulePreset[] = [
  {
    key: "1",
    label: "Recepción",
    he1: "05:15",
    hs2: "12:35",
  },
  {
    key: "2",
    label: "Despostadores",
    he1: "06:30",
    hs2: "13:40",
  },
  {
    key: "3",
    label: "Despostadores T2",
    he1: "10:30",
    hs2: "17:20",
  },
];

/** @deprecated usar DEFAULT_LUNES_SCHEDULE_PRESETS */
export const LUNES_SCHEDULE_PRESETS = DEFAULT_LUNES_SCHEDULE_PRESETS;

export const LUNES_PRESET_BY_KEY: Record<
  LunesSchedulePresetKey,
  LunesSchedulePreset
> = Object.fromEntries(
  DEFAULT_LUNES_SCHEDULE_PRESETS.map((p) => [p.key, { ...p }]),
) as Record<LunesSchedulePresetKey, LunesSchedulePreset>;

export function presetsToByKey(
  presets: readonly LunesSchedulePreset[],
): Record<LunesSchedulePresetKey, LunesSchedulePreset> {
  return Object.fromEntries(
    presets.map((p) => [p.key, { ...p }]),
  ) as Record<LunesSchedulePresetKey, LunesSchedulePreset>;
}

function isPresetKey(k: unknown): k is LunesSchedulePresetKey {
  return k === "1" || k === "2" || k === "3";
}

/** Combina lo guardado con los valores por defecto; siempre 3 claves fijas. */
export function mergeLunesPresetsWithDefaults(
  stored: unknown,
): LunesSchedulePreset[] {
  const defaults = DEFAULT_LUNES_SCHEDULE_PRESETS.map((p) => ({ ...p }));
  if (!Array.isArray(stored)) {
    return defaults;
  }
  const fromStore = new Map<LunesSchedulePresetKey, Partial<LunesSchedulePreset>>();
  for (const item of stored) {
    if (!item || typeof item !== "object") continue;
    const key = (item as LunesSchedulePreset).key;
    if (!isPresetKey(key)) continue;
    fromStore.set(key, item as LunesSchedulePreset);
  }
  return defaults.map((d) => {
    const s = fromStore.get(d.key);
    if (!s) return d;
    const label =
      typeof s.label === "string" && s.label.trim().length > 0
        ? s.label.trim()
        : d.label;
    const he1 = normalizeScheduleTime(s.he1 ?? "") || d.he1;
    const hs2 = normalizeScheduleTime(s.hs2 ?? "") || d.hs2;
    return { ...d, label, he1, hs2 };
  });
}

export function loadLunesPresetsFromStorage(): LunesSchedulePreset[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LUNES_PRESETS_STORAGE_KEY);
    if (!raw) return null;
    return mergeLunesPresetsWithDefaults(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function saveLunesPresetsToStorage(presets: LunesSchedulePreset[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LUNES_PRESETS_STORAGE_KEY,
      JSON.stringify(presets),
    );
  } catch {
    /* ignore quota */
  }
}
