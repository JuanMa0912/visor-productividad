/**
 * Plantillas de jornada para "Mismo horario que lunes" (rol replicar_lunes / admin).
 * Entrada = primer HE (he1). Salida del día = última HS (hs2); hs1 y he2 vacíos.
 */

export type LunesSchedulePresetKey = "1" | "2" | "3";

export type LunesSchedulePreset = {
  key: LunesSchedulePresetKey;
  label: string;
  /** HH:mm 24 h — primera entrada */
  he1: string;
  /** HH:mm 24 h — última salida del día (segunda HS) */
  hs2: string;
};

export const LUNES_SCHEDULE_PRESETS: readonly LunesSchedulePreset[] = [
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

export const LUNES_PRESET_BY_KEY: Record<
  LunesSchedulePresetKey,
  LunesSchedulePreset
> = Object.fromEntries(
  LUNES_SCHEDULE_PRESETS.map((p) => [p.key, p]),
) as Record<LunesSchedulePresetKey, LunesSchedulePreset>;
