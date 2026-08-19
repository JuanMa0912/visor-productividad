import type { OcCumplimiento } from "./types";

export const OC_SLA_DAYS = 7;

export type OcVista =
  | "todas"
  | "abiertas"
  | "incompletas"
  | "vencidas"
  | "cumplidas"
  | "ayer";

export type OcFlags = {
  cumplida: boolean;
  incompleta: boolean;
  pendiente: boolean;
  vencidaSla: boolean;
  aTiempo: boolean;
};

export type OcBadge =
  | "cumplida"
  | "vencida"
  | "incompleta"
  | "pendiente"
  | "a_tiempo";

const nearly = (a: number, b: number) => Math.abs(a - b) < 0.0001;

export const yyyymmddToday = (now = new Date()): string => {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
};

export const yyyymmddAddDays = (yyyymmdd: string, days: number): string => {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
};

/** Dias de `from` a `to` (YYYYMMDD). Positivo = to es posterior. */
export const yyyymmddDiffDays = (from: string, to: string): number => {
  const a = (from || "").trim();
  const b = (to || "").trim();
  if (!/^\d{8}$/.test(a) || !/^\d{8}$/.test(b)) return 0;
  const parse = (s: string) =>
    Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  return Math.round((parse(b) - parse(a)) / 86_400_000);
};

export const formatYyyymmdd = (value: string | null | undefined): string => {
  const v = (value ?? "").trim();
  if (!/^\d{8}$/.test(v)) return v || "—";
  return `${v.slice(6, 8)}/${v.slice(4, 6)}/${v.slice(0, 4)}`;
};

export function ocFlags(input: {
  indEstado: string;
  cantidad: number;
  cantidadEnt: number;
  fechaDcto: string;
  todayYyyymmdd: string;
}): OcFlags {
  const cant = Number.isFinite(input.cantidad) ? input.cantidad : 0;
  const ent = Number.isFinite(input.cantidadEnt) ? input.cantidadEnt : 0;
  const cumplida =
    input.indEstado.trim() === "2" || (cant > 0 && (ent > cant || nearly(ent, cant)));
  const incompleta = !cumplida && ent > 0.0001 && ent < cant - 0.0001;
  const pendiente = !cumplida && ent <= 0.0001;
  const limite = yyyymmddAddDays((input.fechaDcto || "").trim(), OC_SLA_DAYS);
  const vencidaSla = !cumplida && Boolean(limite) && limite < input.todayYyyymmdd;
  return {
    cumplida,
    incompleta,
    pendiente,
    vencidaSla,
    aTiempo: !cumplida && !vencidaSla,
  };
}

export function ocPrimaryBadge(flags: OcFlags): OcBadge {
  if (flags.cumplida) return "cumplida";
  if (flags.vencidaSla) return "vencida";
  if (flags.incompleta) return "incompleta";
  if (flags.pendiente) return "pendiente";
  return "a_tiempo";
}

const roundPct = (n: number) => Math.round(n * 10) / 10;

export function qtyRatioPct(entregada: number, pedida: number): number {
  if (!(pedida > 0)) return 0;
  return roundPct((entregada / pedida) * 100);
}

/** Cerradas = 100%. Abiertas/incompletas = qty recibida. Vencidas no entran. */
export function buildOcCumplimiento(input: {
  cerradasCount: number;
  cerradasCantidad: number;
  abiertasCount: number;
  abiertasCantidad: number;
  abiertasEnt: number;
  incompletasCount: number;
  incompletasCantidad: number;
  incompletasEnt: number;
}): OcCumplimiento {
  const cerradasCant = Math.max(0, input.cerradasCantidad);
  const abiertasCant = Math.max(0, input.abiertasCantidad);
  return {
    cerradas: {
      count: input.cerradasCount,
      pct: input.cerradasCount > 0 ? 100 : 0,
    },
    abiertas: {
      count: input.abiertasCount,
      pct: qtyRatioPct(input.abiertasEnt, abiertasCant),
    },
    incompletas: {
      count: input.incompletasCount,
      pct: qtyRatioPct(input.incompletasEnt, input.incompletasCantidad),
    },
    total: {
      count: input.cerradasCount + input.abiertasCount,
      pct: qtyRatioPct(cerradasCant + input.abiertasEnt, cerradasCant + abiertasCant),
    },
  };
}

export const EMPTY_OC_CUMPLIMIENTO: OcCumplimiento = buildOcCumplimiento({
  cerradasCount: 0,
  cerradasCantidad: 0,
  abiertasCount: 0,
  abiertasCantidad: 0,
  abiertasEnt: 0,
  incompletasCount: 0,
  incompletasCantidad: 0,
  incompletasEnt: 0,
});

export function ocMatchesVista(
  flags: OcFlags,
  vista: OcVista,
  fechaDcto: string,
  yesterdayYyyymmdd: string,
): boolean {
  if (vista === "todas") return true;
  if (vista === "abiertas") return !flags.cumplida;
  if (vista === "incompletas") return flags.incompleta;
  if (vista === "vencidas") return flags.vencidaSla;
  if (vista === "cumplidas") return flags.cumplida;
  if (vista === "ayer") return (fechaDcto || "").trim() === yesterdayYyyymmdd;
  return true;
}
