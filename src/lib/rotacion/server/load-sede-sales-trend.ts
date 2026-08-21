import { withPoolClient } from "@/lib/db";
import { resolveRotacionCleanMatview } from "@/lib/rotacion/source-tables";
import { getRotacionSourceTable } from "@/lib/rotacion/source-context";

export type RotacionSedeSalesTrendPoint = {
  /** Lunes de la semana ISO (clave estable del punto). */
  day: string;
  week: number;
  weekYear: number;
  sales: number;
  units: number;
  inventoryValue: number;
};

const MAX_ITEMS = 8_000;
const MS_DAY = 86_400_000;

const parseIsoNoon = (iso: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatIsoDay = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/** Semana ISO-8601 (lunes–domingo). El 1 jun 2026 es lunes = semana 23. */
export const isoWeekOf = (
  iso: string,
): { year: number; week: number; monday: string } | null => {
  const date = parseIsoNoon(iso);
  if (!date) return null;
  const weekday = (date.getDay() + 6) % 7;
  const monday = new Date(date);
  monday.setDate(date.getDate() - weekday);
  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  const year = thursday.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const jan4Weekday = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Weekday);
  const week =
    Math.round((monday.getTime() - week1Monday.getTime()) / (7 * MS_DAY)) + 1;
  return { year, week, monday: formatIsoDay(monday) };
};

export type RotacionIsoWeekBucket = {
  year: number;
  week: number;
  monday: string;
  days: string[];
};

export const enumerateIsoWeeks = (
  start: string,
  end: string,
): RotacionIsoWeekBucket[] => {
  const groups = new Map<string, RotacionIsoWeekBucket>();
  const order: string[] = [];
  for (const day of enumerateIsoDays(start, end)) {
    const parts = isoWeekOf(day);
    if (!parts) continue;
    const key = `${parts.year}-W${String(parts.week).padStart(2, "0")}`;
    let group = groups.get(key);
    if (!group) {
      group = { year: parts.year, week: parts.week, monday: parts.monday, days: [] };
      groups.set(key, group);
      order.push(key);
    }
    group.days.push(day);
  }
  return order.map((key) => groups.get(key)!);
};

const emptyWeekPoint = (
  week: RotacionIsoWeekBucket,
): RotacionSedeSalesTrendPoint => ({
  day: week.monday,
  week: week.week,
  weekYear: week.year,
  sales: 0,
  units: 0,
  inventoryValue: 0,
});

export const enumerateIsoDays = (start: string, end: string): string[] => {
  const days: string[] = [];
  const cursor = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return days;
  while (cursor <= last) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, "0");
    const day = String(cursor.getDate()).padStart(2, "0");
    days.push(`${year}-${month}-${day}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
};

type DailyHit = {
  day: string;
  sales?: number;
  units?: number;
  inventoryValue?: number;
};

const indexHitsByDay = (hits: DailyHit[]) => {
  const byDay = new Map<
    string,
    { sales: number; units: number; inventoryValue: number }
  >();
  for (const row of hits) {
    const day = row.day.slice(0, 10);
    byDay.set(day, {
      sales: Number(row.sales) || 0,
      units: Number(row.units) || 0,
      inventoryValue: Number(row.inventoryValue) || 0,
    });
  }
  return byDay;
};

/** Conservado para pruebas del relleno diario; la gráfica usa semanas. */
export const fillDailySalesTrend = (
  start: string,
  end: string,
  hits: DailyHit[],
): Array<{
  day: string;
  sales: number;
  units: number;
  inventoryValue: number;
}> => {
  const byDay = indexHitsByDay(hits);
  return enumerateIsoDays(start, end).map((day) => ({
    day,
    sales: byDay.get(day)?.sales ?? 0,
    units: byDay.get(day)?.units ?? 0,
    inventoryValue: byDay.get(day)?.inventoryValue ?? 0,
  }));
};

/** Ventas = suma de la semana. Inventario = última foto con dato en el recorte. */
export const bucketTrendByIsoWeek = (
  start: string,
  end: string,
  hits: DailyHit[],
): RotacionSedeSalesTrendPoint[] => {
  const byDay = indexHitsByDay(hits);
  return enumerateIsoWeeks(start, end).map((week) => {
    let sales = 0;
    let lastHit: { units: number; inventoryValue: number } | null = null;
    for (const day of week.days) {
      const hit = byDay.get(day);
      if (!hit) continue;
      sales += hit.sales;
      lastHit = { units: hit.units, inventoryValue: hit.inventoryValue };
    }
    if (!lastHit) return emptyWeekPoint(week);
    return {
      day: week.monday,
      week: week.week,
      weekYear: week.year,
      sales,
      units: lastHit.units,
      inventoryValue: lastHit.inventoryValue,
    };
  });
};

export async function loadRotacionSedeSalesTrend(input: {
  empresa: string;
  sedeId: string;
  start: string;
  end: string;
  itemIds: string[];
}): Promise<RotacionSedeSalesTrendPoint[]> {
  const itemIds = [
    ...new Set(input.itemIds.map((id) => String(id ?? "").trim()).filter(Boolean)),
  ].slice(0, MAX_ITEMS);

  const table = resolveRotacionCleanMatview(getRotacionSourceTable());
  const rows = await withPoolClient(async (client) => {
    const exists = await client.query<{ ok: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1 FROM pg_matviews WHERE matviewname = $1
      ) AS ok
      `,
      [table],
    );
    if (!exists.rows[0]?.ok) return [];

    const params: unknown[] = [
      input.empresa,
      input.sedeId,
      input.start,
      input.end,
    ];
    let itemSql = "";
    if (itemIds.length > 0) {
      params.push(itemIds);
      itemSql = ` AND BTRIM(item) = ANY($${params.length}::text[])`;
    }

    const result = await client.query<{
      day: string;
      sales: string | number;
      units: string | number;
      inventory_value: string | number;
    }>(
      `
      SELECT
        TO_CHAR(fecha, 'YYYY-MM-DD') AS day,
        SUM(COALESCE(venta_sin_impuesto_dia, 0))::numeric AS sales,
        SUM(COALESCE(inventory_units_dia, 0))::numeric AS units,
        SUM(COALESCE(inventory_value_dia, 0))::numeric AS inventory_value
      FROM ${table}
      WHERE LOWER(TRIM(empresa)) = LOWER(TRIM($1))
        AND LPAD(TRIM(sede_id::text), 3, '0') = LPAD(TRIM($2::text), 3, '0')
        AND fecha BETWEEN $3::date AND $4::date
        ${itemSql}
      GROUP BY fecha
      ORDER BY fecha
      `,
      params,
    );
    return result.rows ?? [];
  });

  return bucketTrendByIsoWeek(
    input.start,
    input.end,
    rows.map((row) => ({
      day: String(row.day ?? "").slice(0, 10),
      sales: Number(row.sales) || 0,
      units: Number(row.units) || 0,
      inventoryValue: Number(row.inventory_value) || 0,
    })),
  );
}
