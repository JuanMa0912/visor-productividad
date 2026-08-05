import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import {
  applySessionCookies,
  requireAdminSession,
} from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { computeShiftLaborMinutes } from "@/components/hourly-analysis/cashier-utils";
import {
  buildCashierEffectivenessRowsFromInvoices,
  buildCashierEffectivenessSummary,
  DEFAULT_MAX_ACTIVE_GAP_MINUTES,
  type CashierEffectivenessInput,
  type CashierInvoicePoint,
} from "@/lib/efectividad-cajero/metrics";
import { checkRateLimit } from "@/lib/shared/rate-limit";

const SEDE_CONFIGS = [
  { name: "Calle 5ta", centro: "001", empresa: "mercamio" },
  { name: "La 39", centro: "002", empresa: "mercamio" },
  { name: "Plaza Norte", centro: "003", empresa: "mercamio" },
  { name: "Ciudad Jardin", centro: "004", empresa: "mercamio" },
  { name: "Centro Sur", centro: "005", empresa: "mercamio" },
  { name: "Palmira", centro: "006", empresa: "mercamio" },
  { name: "Floresta", centro: "001", empresa: "mtodo" },
  { name: "Floralia", centro: "002", empresa: "mtodo" },
  { name: "Guaduales", centro: "003", empresa: "mtodo" },
  { name: "Bogota", centro: "001", empresa: "bogota" },
  { name: "Chia", centro: "002", empresa: "bogota" },
] as const;

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

/** Alineado con análisis de cajeros en hourly-analysis. */
const MAX_RANGE_DAYS = 62;

const getInclusiveDateRangeDays = (
  dateStart: string,
  dateEnd: string,
): number | null => {
  const startMs = Date.parse(`${dateStart}T12:00:00`);
  const endMs = Date.parse(`${dateEnd}T12:00:00`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    return null;
  }
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
};

const normalizeCol = (value: string) => value.trim().toLowerCase();

const parseMinuteOfDay = (raw: unknown): number | null => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    const h = Math.floor(raw);
    return h >= 0 && h <= 23 ? h * 60 : null;
  }
  if (raw instanceof Date) {
    return raw.getHours() * 60 + raw.getMinutes();
  }
  const str = String(raw).trim();
  if (!str) return null;
  const asInt = Number.parseInt(str, 10);
  if (!Number.isNaN(asInt) && asInt >= 0 && asInt <= 23 && /^\d{1,2}$/.test(str)) {
    return asInt * 60;
  }
  const timeMatch = str.match(/^(\d{1,2}):(\d{1,2})/);
  if (timeMatch) {
    const hour = Number.parseInt(timeMatch[1]!, 10);
    const minute = Number.parseInt(timeMatch[2]!, 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return hour * 60 + minute;
    }
  }
  return null;
};

const compactToIso = (value: string) => {
  const raw = String(value ?? "").trim();
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return null;
};

const normalizePersonMatchKey = (raw: string | null | undefined) =>
  (raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s._\-]+/g, "")
    .trim();

const normalizeCedulaDigits = (raw: string | null | undefined): string => {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const trimmed = digits.replace(/^0+/, "");
  return trimmed.length > 0 ? trimmed : digits;
};

const getTableColumns = async (client: PoolClient, tableName: string) => {
  const result = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
    `,
    [tableName],
  );
  return (result.rows ?? [])
    .map((row) => (row as { column_name?: string }).column_name)
    .filter((value): value is string => Boolean(value));
};

const pickColumn = (
  columns: string[],
  candidates: readonly string[],
): string | null => {
  const set = new Map(columns.map((c) => [normalizeCol(c), c]));
  for (const candidate of candidates) {
    const hit = set.get(normalizeCol(candidate));
    if (hit) return hit;
  }
  return null;
};

const resolveSede = (sedeName: string) =>
  SEDE_CONFIGS.find(
    (cfg) => normalizePersonMatchKey(cfg.name) === normalizePersonMatchKey(sedeName),
  ) ?? null;

export async function GET(request: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const withSession = (response: NextResponse) =>
    applySessionCookies(response, session);

  const limitedUntil = checkRateLimit(request, {
    windowMs: 60_000,
    max: 30,
    keyPrefix: "exp-efectividad-cajero",
  });
  if (limitedUntil) {
    const retryAfterSeconds = Math.ceil((limitedUntil - Date.now()) / 1000);
    return withSession(
      NextResponse.json(
        { error: "Demasiadas solicitudes." },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
      ),
    );
  }

  const url = new URL(request.url);
  const dateStart = url.searchParams.get("dateStart")?.trim() ?? "";
  const dateEnd = url.searchParams.get("dateEnd")?.trim() ?? "";
  const sedeName = url.searchParams.get("sede")?.trim() ?? "";
  const maxGapRaw = Number(url.searchParams.get("maxGapMinutes") ?? DEFAULT_MAX_ACTIVE_GAP_MINUTES);
  const maxGapMinutes =
    Number.isFinite(maxGapRaw) && maxGapRaw > 0 && maxGapRaw <= 30
      ? maxGapRaw
      : DEFAULT_MAX_ACTIVE_GAP_MINUTES;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStart) || !/^\d{4}-\d{2}-\d{2}$/.test(dateEnd)) {
    return withSession(
      NextResponse.json(
        { error: "dateStart y dateEnd deben ser YYYY-MM-DD." },
        { status: 400 },
      ),
    );
  }
  if (dateStart > dateEnd) {
    return withSession(
      NextResponse.json({ error: "dateStart no puede ser mayor que dateEnd." }, { status: 400 }),
    );
  }
  const rangeDays = getInclusiveDateRangeDays(dateStart, dateEnd);
  if (!rangeDays || rangeDays > MAX_RANGE_DAYS) {
    return withSession(
      NextResponse.json(
        {
          error: `El rango no puede superar ${MAX_RANGE_DAYS} días.`,
        },
        { status: 400 },
      ),
    );
  }
  const sede = resolveSede(sedeName);
  if (!sede) {
    return withSession(
      NextResponse.json({ error: "Sede no reconocida para el experimento." }, { status: 400 }),
    );
  }

  const startCompact = dateStart.replace(/-/g, "");
  const endCompact = dateEnd.replace(/-/g, "");
  const client = await (await getDbPool()).connect();

  try {
    const salesColumns = await getTableColumns(client, "ventas_cajas");
    if (salesColumns.length === 0) {
      return withSession(
        NextResponse.json(
          { error: "No hay datos de ventas disponibles para el experimento." },
          { status: 500 },
        ),
      );
    }

    const idCol =
      pickColumn(salesColumns, ["id_vend_cc", "cedula_cajero", "cedula", "id_vendedor", "usuario"]) ??
      null;
    const nameCol =
      pickColumn(salesColumns, ["vendedor", "cajero", "nombre_cajero", "nombre_vendedor"]) ??
      null;
    if (!idCol && !nameCol) {
      return withSession(
        NextResponse.json(
          { error: "No se pudo identificar cajeros en los datos de ventas." },
          { status: 500 },
        ),
      );
    }

    const idExpr = idCol
      ? `NULLIF(BTRIM(${quoteIdentifier(idCol)}::text), '')`
      : "NULL";
    const nameExpr = nameCol
      ? `NULLIF(BTRIM(${quoteIdentifier(nameCol)}::text), '')`
      : "NULL";
    const personNameSelect = nameCol
      ? `COALESCE(${nameExpr}, ${idExpr}, 'Sin identificar')`
      : `COALESCE(${idExpr}, 'Sin identificar')`;

    const salesResult = await client.query(
      `
      SELECT
        COALESCE(${idExpr}, 'sin-id') || '|' || COALESCE(${nameExpr}, 'sin-nombre') AS person_key,
        ${idExpr} AS person_id,
        ${personNameSelect} AS person_name,
        fecha_dcto,
        hora_final_hora,
        COALESCE(total_bruto, 0) AS total_sales
      FROM ventas_cajas
      WHERE fecha_dcto >= $1 AND fecha_dcto <= $2
        AND centro_operacion = $3
        AND (empresa_bd = $4 OR ($4 IS NULL AND empresa_bd IS NULL))
        AND COALESCE(total_bruto, 0) > 0
      `,
      [startCompact, endCompact, sede.centro, sede.empresa],
    );

    type Agg = {
      personKey: string;
      personId: string | null;
      personName: string;
      invoices: CashierInvoicePoint[];
    };
    const byPerson = new Map<string, Agg>();

    for (const row of salesResult.rows ?? []) {
      const typed = row as {
        person_key: string;
        person_id?: string | null;
        person_name: string;
        fecha_dcto: string | number;
        hora_final_hora: unknown;
        total_sales: string | number;
      };
      const date = compactToIso(String(typed.fecha_dcto ?? ""));
      const minute = parseMinuteOfDay(typed.hora_final_hora);
      if (!date || minute == null) continue;
      const sales = Number(typed.total_sales) || 0;
      if (sales <= 0) continue;

      const personKey = typed.person_key?.trim() || "sin-identificar";
      let agg = byPerson.get(personKey);
      if (!agg) {
        agg = {
          personKey,
          personId: typed.person_id?.trim() || null,
          personName: typed.person_name?.trim() || "Sin identificar",
          invoices: [],
        };
        byPerson.set(personKey, agg);
      }
      agg.invoices.push({ date, minuteOfDay: minute, sales });
    }

    // Marcas de asistencia (depto cajas) para horas marcadas.
    const attendanceColumns = await getTableColumns(client, "asistencia_horas");
    const attIdCol =
      pickColumn(attendanceColumns, [
        "cedula",
        "numero",
        "identificacion",
        "documento",
        "documento_empleado",
      ]) ?? null;
    const attNameCol =
      pickColumn(attendanceColumns, [
        "nombre_completo",
        "nombres",
        "nombre_empleado",
        "empleado",
        "nombre",
      ]) ?? null;
    const hasApellidos = attendanceColumns.some(
      (c) => normalizeCol(c) === "apellidos",
    );

    const markedByCedula = new Map<string, number>();
    const markedByName = new Map<string, number>();

    if (attIdCol || attNameCol) {
      const employeeIdExpr = attIdCol
        ? `NULLIF(BTRIM(${quoteIdentifier(attIdCol)}::text), '')`
        : "NULL";
      const employeeNameExpr =
        attNameCol && hasApellidos
          ? `NULLIF(BTRIM(CONCAT_WS(' ', ${quoteIdentifier(attNameCol)}::text, apellidos::text)), '')`
          : attNameCol
            ? `NULLIF(BTRIM(${quoteIdentifier(attNameCol)}::text), '')`
            : "NULL";

      const sedeTokens: Record<string, string[]> = {
        "Calle 5ta": ["calle 5", "la 5a", "5ta", "calle5"],
        "La 39": ["la 39", "39"],
        "Plaza Norte": ["plaza norte"],
        "Ciudad Jardin": ["ciudad jardin", "jardin"],
        "Centro Sur": ["centro sur"],
        Palmira: ["palmira"],
        Floresta: ["floresta"],
        Floralia: ["floralia"],
        Guaduales: ["guaduales"],
        Bogota: ["bogota", "bogotá"],
        Chia: ["chia", "chía"],
      };
      const tokens = sedeTokens[sede.name] ?? [sede.name.toLowerCase()];
      const sedeClause = tokens
        .map((_, i) => `LOWER(COALESCE(sede, '')) LIKE $${i + 3}`)
        .join(" OR ");

      const attResult = await client.query(
        `
        SELECT
          ${employeeIdExpr} AS employee_id,
          ${employeeNameExpr} AS employee_name,
          fecha,
          hora_entrada,
          hora_intermedia1,
          hora_intermedia2,
          hora_salida
        FROM asistencia_horas
        WHERE fecha >= $1::date AND fecha <= $2::date
          AND (${sedeClause})
          AND LOWER(COALESCE(departamento, '')) LIKE '%caja%'
        `,
        [dateStart, dateEnd, ...tokens.map((t) => `%${t}%`)],
      );

      for (const row of attResult.rows ?? []) {
        const typed = row as {
          employee_id: string | null;
          employee_name: string | null;
          hora_entrada: unknown;
          hora_intermedia1: unknown;
          hora_intermedia2: unknown;
          hora_salida: unknown;
        };
        const minutes = computeShiftLaborMinutes({
          markInMinute: parseMinuteOfDay(typed.hora_entrada),
          markOutMinute: parseMinuteOfDay(typed.hora_salida),
          break1Minute: parseMinuteOfDay(typed.hora_intermedia1),
          break2Minute: parseMinuteOfDay(typed.hora_intermedia2),
        });
        if (minutes == null || minutes <= 0) continue;
        const hours = minutes / 60;
        const ced = normalizeCedulaDigits(typed.employee_id);
        if (ced.length >= 6) {
          markedByCedula.set(ced, (markedByCedula.get(ced) ?? 0) + hours);
        }
        const nameKey = normalizePersonMatchKey(typed.employee_name);
        if (nameKey) {
          markedByName.set(nameKey, (markedByName.get(nameKey) ?? 0) + hours);
        }
      }
    }

    const inputs: CashierEffectivenessInput[] = [...byPerson.values()].map(
      (agg) => {
        const ced = normalizeCedulaDigits(agg.personId);
        let markedHours = 0;
        if (ced.length >= 6 && markedByCedula.has(ced)) {
          markedHours = markedByCedula.get(ced) ?? 0;
        } else {
          const nameKey = normalizePersonMatchKey(agg.personName);
          markedHours = markedByName.get(nameKey) ?? 0;
        }
        return {
          personKey: agg.personKey,
          personName: agg.personName,
          personId: agg.personId,
          invoices: agg.invoices,
          markedHours,
        };
      },
    );

    const rows = buildCashierEffectivenessRowsFromInvoices(
      inputs,
      maxGapMinutes,
    );
    const summary = buildCashierEffectivenessSummary(rows);

    return withSession(
      NextResponse.json({
        experimental: true,
        sede: sede.name,
        dateStart,
        dateEnd,
        maxGapMinutes,
        maxRangeDays: MAX_RANGE_DAYS,
        rule: {
          summary:
            "Minutos efectivos = suma de brechas entre facturas consecutivas del mismo día solo si la brecha ≤ maxGapMinutes (ritmo continuo). Huecos largos no cuentan.",
          maxGapMinutes,
        },
        summary,
        rows,
      }),
    );
  } catch (error) {
    console.error("[exp/efectividad-cajero]", error);
    return withSession(
      NextResponse.json(
        { error: "No se pudo calcular efectividad." },
        { status: 500 },
      ),
    );
  } finally {
    client.release();
  }
}
