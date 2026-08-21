import { withPoolClient } from "@/lib/db";
import { resolveRotacionCleanMatview } from "@/lib/rotacion/source-tables";
import { getRotacionSourceTable } from "@/lib/rotacion/source-context";

export type RotacionSedeSalesTrendPoint = {
  day: string;
  sales: number;
};

const MAX_ITEMS = 8_000;

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

export const fillDailySalesTrend = (
  start: string,
  end: string,
  hits: Array<{ day: string; sales: number }>,
): RotacionSedeSalesTrendPoint[] => {
  const byDay = new Map(
    hits.map((row) => [row.day.slice(0, 10), Number(row.sales) || 0]),
  );
  return enumerateIsoDays(start, end).map((day) => ({
    day,
    sales: byDay.get(day) ?? 0,
  }));
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
  if (itemIds.length === 0) {
    return fillDailySalesTrend(input.start, input.end, []);
  }

  const table = resolveRotacionCleanMatview(getRotacionSourceTable());
  const rows = await withPoolClient(async (client) => {
    const exists = await client.query<{ ok: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
      ) AS ok
      `,
      [table],
    );
    if (!exists.rows[0]?.ok) return [];

    const result = await client.query<{ day: string; sales: string | number }>(
      `
      SELECT
        TO_CHAR(fecha, 'YYYY-MM-DD') AS day,
        SUM(COALESCE(venta_sin_impuesto_dia, 0))::numeric AS sales
      FROM ${table}
      WHERE LOWER(TRIM(empresa)) = LOWER(TRIM($1))
        AND LPAD(TRIM(sede_id), 3, '0') = LPAD(TRIM($2), 3, '0')
        AND fecha BETWEEN $3::date AND $4::date
        AND BTRIM(item) = ANY($5::text[])
      GROUP BY fecha
      ORDER BY fecha
      `,
      [input.empresa, input.sedeId, input.start, input.end, itemIds],
    );
    return result.rows ?? [];
  });

  return fillDailySalesTrend(
    input.start,
    input.end,
    rows.map((row) => ({
      day: String(row.day ?? "").slice(0, 10),
      sales: Number(row.sales) || 0,
    })),
  );
}
