import { PROVEEDORES_VISITAS_TZ } from "@/lib/proveedores/board-filters";
import type {
  ProveedorVisitaRow,
  ProveedorVisitasMetrics,
} from "@/lib/proveedores/types";

const round1 = (value: number) => Math.round(value * 10) / 10;

/** YYYY-MM-DD de la entrada en calendario Colombia. */
export const visitaEntradaIsoDateBogota = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PROVEEDORES_VISITAS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
};

export const rowMatchesVisitasScope = (
  row: Pick<ProveedorVisitaRow, "sedeName" | "entradaAt">,
  args: { dateStart: string; dateEnd: string; sedeName?: string | null },
): boolean => {
  const dia = visitaEntradaIsoDateBogota(row.entradaAt);
  if (!dia || dia < args.dateStart || dia > args.dateEnd) return false;
  const sede = (args.sedeName ?? "").trim();
  if (sede && row.sedeName !== sede) return false;
  return true;
};

const hourBogota = (iso: string): number => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 0;
  const raw = new Intl.DateTimeFormat("en-US", {
    timeZone: PROVEEDORES_VISITAS_TZ,
    hour: "numeric",
    hourCycle: "h23",
  }).format(d);
  const hour = Number.parseInt(raw, 10);
  return Number.isFinite(hour) ? hour : 0;
};

const avgMins = (values: number[]): number | null => {
  if (values.length === 0) return null;
  return round1(values.reduce((sum, n) => sum + n, 0) / values.length);
};

const medianMins = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return round1(sorted[mid] ?? 0);
  return round1(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
};

/** Recalcula tarjetas y tablas solo con filas del día/sede pedidos. */
export const metricsFromVisitaRows = (
  rows: ProveedorVisitaRow[],
): ProveedorVisitasMetrics => {
  const closedMins = rows
    .map((row) => row.duracionMinutos)
    .filter((n): n is number => n != null && Number.isFinite(n));
  const bySedeMap = new Map<
    string,
    { visitas: number; abiertas: number; mins: number[] }
  >();
  const byProveedorMap = new Map<string, { visitas: number; mins: number[] }>();
  const byDayMap = new Map<string, { visitas: number; abiertas: number }>();
  const byHourMap = new Map<number, number>();
  const proveedores = new Set<string>();
  const visitantes = new Set<string>();

  for (const row of rows) {
    const abierta = row.salidaAt == null;
    const sede = bySedeMap.get(row.sedeName) ?? {
      visitas: 0,
      abiertas: 0,
      mins: [],
    };
    sede.visitas += 1;
    if (abierta) sede.abiertas += 1;
    if (row.duracionMinutos != null) sede.mins.push(row.duracionMinutos);
    bySedeMap.set(row.sedeName, sede);

    const prov = byProveedorMap.get(row.proveedorNombre) ?? {
      visitas: 0,
      mins: [],
    };
    prov.visitas += 1;
    if (row.duracionMinutos != null) prov.mins.push(row.duracionMinutos);
    byProveedorMap.set(row.proveedorNombre, prov);

    const dia = visitaEntradaIsoDateBogota(row.entradaAt);
    const day = byDayMap.get(dia) ?? { visitas: 0, abiertas: 0 };
    day.visitas += 1;
    if (abierta) day.abiertas += 1;
    byDayMap.set(dia, day);

    const hour = hourBogota(row.entradaAt);
    byHourMap.set(hour, (byHourMap.get(hour) ?? 0) + 1);

    const provKey = row.proveedorNombre.trim().toLowerCase();
    if (provKey) proveedores.add(provKey);
    if (row.visitanteCedula) visitantes.add(row.visitanteCedula);
  }

  return {
    totalVisitas: rows.length,
    abiertas: rows.filter((row) => row.salidaAt == null).length,
    cerradas: rows.filter((row) => row.salidaAt != null).length,
    proveedoresUnicos: proveedores.size,
    visitantesUnicos: visitantes.size,
    duracionPromedioMin: avgMins(closedMins),
    duracionMedianaMin: medianMins(closedMins),
    bySede: [...bySedeMap.entries()]
      .map(([sedeName, v]) => ({
        sedeName,
        visitas: v.visitas,
        abiertas: v.abiertas,
        duracionPromedioMin: avgMins(v.mins),
      }))
      .sort((a, b) => b.visitas - a.visitas || a.sedeName.localeCompare(b.sedeName)),
    byProveedor: [...byProveedorMap.entries()]
      .map(([proveedorNombre, v]) => ({
        proveedorNombre,
        visitas: v.visitas,
        duracionPromedioMin: avgMins(v.mins),
      }))
      .sort(
        (a, b) =>
          b.visitas - a.visitas || a.proveedorNombre.localeCompare(b.proveedorNombre),
      )
      .slice(0, 12),
    byDay: [...byDayMap.entries()]
      .map(([date, v]) => ({
        date,
        visitas: v.visitas,
        abiertas: v.abiertas,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    byHour: [...byHourMap.entries()]
      .map(([hour, visitas]) => ({ hour, visitas }))
      .sort((a, b) => a.hour - b.hour),
  };
};

const VISITAS_LIST_LIMIT = 500;

export const resolveVisitasBoardView = ({
  rows,
  metrics,
  dateStart,
  dateEnd,
  sedeName,
}: {
  rows: ProveedorVisitaRow[];
  metrics: ProveedorVisitasMetrics | null;
  dateStart: string;
  dateEnd: string;
  sedeName?: string | null;
}): { rows: ProveedorVisitaRow[]; metrics: ProveedorVisitasMetrics | null } => {
  const scoped = rows.filter((row) =>
    rowMatchesVisitasScope(row, { dateStart, dateEnd, sedeName }),
  );
  const truncated = rows.length >= VISITAS_LIST_LIMIT;
  if (!truncated && metrics && scoped.length !== metrics.totalVisitas) {
    return { rows: scoped, metrics: metricsFromVisitaRows(scoped) };
  }
  return { rows: scoped, metrics };
};
