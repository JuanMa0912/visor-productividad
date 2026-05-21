/**
 * Plantillas de jornada para "Mismo horario que lunes" (rol replicar_lunes / admin).
 * Entrada = primer HE (he1). Salida del día = última HS (hs2); hs1 y he2 vacíos.
 */

import { normalizeScheduleTime } from "@/lib/horarios/schedule-time";

/** Planilla del día: coincide con un preset si primera entrada y última salida son las del preset. */
export function planMatchesLunesPreset(
  plan: { he1: string; hs1: string; he2: string; hs2: string },
  preset: { he1: string; hs2: string },
): boolean {
  const he1 = normalizeScheduleTime(plan.he1 ?? "");
  const hs2 = normalizeScheduleTime(plan.hs2 ?? "");
  return he1 === preset.he1 && hs2 === preset.hs2;
}

/**
 * Llaves de los presets. Las tres originales son "1" | "2" | "3" y nunca se
 * pueden eliminar; los presets creados por usuarios con el rol especial
 * `crear_horario_predeterminado` reciben llaves `c-<timestamp>-<rand>`.
 */
export type LunesSchedulePresetKey = string;

export type LunesSchedulePreset = {
  key: LunesSchedulePresetKey;
  label: string;
  /** HH:mm 24 h — primera entrada */
  he1: string;
  /** HH:mm 24 h — última salida del día (segunda HS) */
  hs2: string;
};

export const LUNES_PRESETS_STORAGE_KEY = "vp:ingresar-horarios:lunes-presets-v1";

export const BUILTIN_LUNES_PRESET_KEYS: readonly LunesSchedulePresetKey[] = [
  "1",
  "2",
  "3",
];

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
);

export function presetsToByKey(
  presets: readonly LunesSchedulePreset[],
): Record<LunesSchedulePresetKey, LunesSchedulePreset> {
  return Object.fromEntries(presets.map((p) => [p.key, { ...p }]));
}

const BUILTIN_KEY_SET = new Set<LunesSchedulePresetKey>(
  BUILTIN_LUNES_PRESET_KEYS,
);

/** Solo los presets fijos originales no se pueden eliminar. */
export function isBuiltinLunesPresetKey(key: string): boolean {
  return BUILTIN_KEY_SET.has(key);
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Genera una llave estable para un preset creado en runtime (no original).
 * Formato: `c-<timestamp>-<random>` para que sea facil de identificar.
 */
export function createCustomLunesPresetKey(): LunesSchedulePresetKey {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `c-${ts}-${rand}`;
}

/**
 * Combina lo guardado con los valores por defecto:
 * - Los 3 presets originales siempre estan presentes (pueden tener nombre/horas
 *   editados).
 * - Cualquier preset adicional que se haya guardado se conserva al final.
 */
export function mergeLunesPresetsWithDefaults(
  stored: unknown,
): LunesSchedulePreset[] {
  const defaults = DEFAULT_LUNES_SCHEDULE_PRESETS.map((p) => ({ ...p }));
  if (!Array.isArray(stored)) {
    return defaults;
  }
  const builtinOverrides = new Map<
    LunesSchedulePresetKey,
    Partial<LunesSchedulePreset>
  >();
  const customs: LunesSchedulePreset[] = [];
  const seenCustomKeys = new Set<string>();
  for (const item of stored) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<LunesSchedulePreset>;
    const key = raw.key;
    if (!isNonEmptyString(key)) continue;
    if (isBuiltinLunesPresetKey(key)) {
      builtinOverrides.set(key, raw);
      continue;
    }
    if (seenCustomKeys.has(key)) continue;
    const label = isNonEmptyString(raw.label) ? raw.label.trim() : "";
    const he1 = normalizeScheduleTime(raw.he1 ?? "");
    const hs2 = normalizeScheduleTime(raw.hs2 ?? "");
    if (!label || !he1 || !hs2) continue;
    seenCustomKeys.add(key);
    customs.push({ key, label, he1, hs2 });
  }
  const mergedBuiltins = defaults.map((d) => {
    const s = builtinOverrides.get(d.key);
    if (!s) return d;
    const label = isNonEmptyString(s.label) ? s.label.trim() : d.label;
    const he1 = normalizeScheduleTime(s.he1 ?? "") || d.he1;
    const hs2 = normalizeScheduleTime(s.hs2 ?? "") || d.hs2;
    return { ...d, label, he1, hs2 };
  });
  return [...mergedBuiltins, ...customs];
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
