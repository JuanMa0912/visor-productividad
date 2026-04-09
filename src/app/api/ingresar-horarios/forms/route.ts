import { NextResponse } from "next/server";
import {
  applySessionCookies,
  requireAuthSession,
  verifyCsrf,
} from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { canAccessPortalSection } from "@/lib/portal-sections";

type DayKey =
  | "domingo"
  | "lunes"
  | "martes"
  | "miercoles"
  | "jueves"
  | "viernes"
  | "sabado";

type DayScheduleInput = {
  he1?: string;
  hs1?: string;
  he2?: string;
  hs2?: string;
  conDescanso?: boolean;
};

type RowScheduleInput = {
  nombre?: string;
  firma?: string;
  days?: Partial<Record<DayKey, DayScheduleInput>>;
};

const DAY_ORDER: DayKey[] = [
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
];

const NO_STORE_CACHE_CONTROL = "no-store, private";

const isDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const normalizeText = (value?: string) => (value ?? "").trim();

const normalizeTime = (value?: string) => {
  const trimmed = (value ?? "").trim();
  return /^\d{2}:\d{2}$/.test(trimmed) ? `${trimmed}:00` : null;
};

const isAllowedUser = (session: Awaited<ReturnType<typeof requireAuthSession>>) => {
  if (!session) return false;
  return (
    session.user.role === "admin" ||
    canAccessPortalSection(session.user.allowedDashboards, "operacion")
  );
};

const buildWorkedDateMap = (start: string, end: string) => {
  const map = new Map<DayKey, string>();
  if (!isDateKey(start) || !isDateKey(end) || start > end) {
    return map;
  }

  const cursor = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  while (cursor <= endDate) {
    const dayKey = DAY_ORDER[cursor.getDay()];
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, "0");
    const day = String(cursor.getDate()).padStart(2, "0");
    map.set(dayKey, `${year}-${month}-${day}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return map;
};

const rowHasContent = (row: RowScheduleInput) => {
  if (normalizeText(row.nombre) || normalizeText(row.firma)) return true;
  return DAY_ORDER.some((dayKey) => {
    const day = row.days?.[dayKey];
    return Boolean(
      day?.conDescanso ||
      normalizeText(day?.he1) ||
      normalizeText(day?.hs1) ||
      normalizeText(day?.he2) ||
      normalizeText(day?.hs2),
    );
  });
};

export async function GET() {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } },
    );
  }

  const withSession = (response: NextResponse) => {
    response.headers.set("Cache-Control", NO_STORE_CACHE_CONTROL);
    return applySessionCookies(response, session);
  };

  if (!isAllowedUser(session)) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para esta seccion." },
        { status: 403 },
      ),
    );
  }

  const client = await (await getDbPool()).connect();
  try {
    const result = await client.query(
      `
      SELECT
        p.id,
        p.sede,
        p.seccion,
        p.fecha_inicial::text AS fecha_inicial,
        p.fecha_final::text AS fecha_final,
        p.mes,
        p.created_by_username,
        p.created_at::text AS created_at,
        COUNT(DISTINCT d.row_index) AS employee_count,
        COUNT(*) AS detail_count
      FROM horario_planillas p
      LEFT JOIN horario_planilla_detalles d ON d.planilla_id = p.id
      GROUP BY
        p.id,
        p.sede,
        p.seccion,
        p.fecha_inicial,
        p.fecha_final,
        p.mes,
        p.created_by_username,
        p.created_at
      ORDER BY p.created_at DESC
      LIMIT 100
      `,
    );

    return withSession(
      NextResponse.json({
        forms: (result.rows ?? []).map((row) => ({
          id: Number((row as { id: number | string }).id),
          sede: (row as { sede?: string }).sede ?? "",
          seccion: (row as { seccion?: string }).seccion ?? "",
          fechaInicial: (row as { fecha_inicial?: string }).fecha_inicial ?? "",
          fechaFinal: (row as { fecha_final?: string }).fecha_final ?? "",
          mes: (row as { mes?: string | null }).mes ?? "",
          createdByUsername:
            (row as { created_by_username?: string }).created_by_username ?? "",
          createdAt: (row as { created_at?: string }).created_at ?? "",
          employeeCount: Number(
            (row as { employee_count?: number | string }).employee_count ?? 0,
          ),
          detailCount: Number(
            (row as { detail_count?: number | string }).detail_count ?? 0,
          ),
        })),
      }),
    );
  } finally {
    client.release();
  }
}

export async function POST(req: Request) {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const withSession = (response: NextResponse) => {
    response.headers.set("Cache-Control", NO_STORE_CACHE_CONTROL);
    return applySessionCookies(response, session);
  };

  if (!isAllowedUser(session)) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para esta seccion." },
        { status: 403 },
      ),
    );
  }

  if (!(await verifyCsrf(req))) {
    return withSession(
      NextResponse.json({ error: "CSRF inválido." }, { status: 403 }),
    );
  }

  const body = (await req.json()) as {
    sede?: string;
    seccion?: string;
    fechaInicial?: string;
    fechaFinal?: string;
    mes?: string;
    rows?: RowScheduleInput[];
  };

  const sede = normalizeText(body.sede);
  const seccion = normalizeText(body.seccion);
  const fechaInicial = normalizeText(body.fechaInicial);
  const fechaFinal = normalizeText(body.fechaFinal);
  const mes = normalizeText(body.mes);
  const rows = Array.isArray(body.rows) ? body.rows : [];

  if (!sede || !seccion) {
    return withSession(
      NextResponse.json(
        { error: "Sede y seccion son obligatorias." },
        { status: 400 },
      ),
    );
  }
  if (
    (fechaInicial && !isDateKey(fechaInicial)) ||
    (fechaFinal && !isDateKey(fechaFinal))
  ) {
    return withSession(
      NextResponse.json(
        { error: "Las fechas deben usar formato YYYY-MM-DD." },
        { status: 400 },
      ),
    );
  }
  if (fechaInicial && fechaFinal && fechaInicial > fechaFinal) {
    return withSession(
      NextResponse.json(
        { error: "La fecha inicial no puede ser mayor que la final." },
        { status: 400 },
      ),
    );
  }

  const populatedRows = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => rowHasContent(row));

  if (populatedRows.length === 0) {
    return withSession(
      NextResponse.json(
        { error: "Debes registrar al menos un empleado o un horario." },
        { status: 400 },
      ),
    );
  }

  const workedDateMap = buildWorkedDateMap(fechaInicial, fechaFinal);
  const client = await (await getDbPool()).connect();

  try {
    await client.query("BEGIN");
    const planillaResult = await client.query(
      `
      INSERT INTO horario_planillas (
        sede,
        seccion,
        fecha_inicial,
        fecha_final,
        mes,
        created_by_user_id,
        created_by_username
      )
      VALUES ($1, $2, NULLIF($3, '')::date, NULLIF($4, '')::date, NULLIF($5, ''), $6, $7)
      RETURNING id
      `,
      [
        sede,
        seccion,
        fechaInicial,
        fechaFinal,
        mes,
        session.user.id,
        session.user.username,
      ],
    );

    const planillaId = Number(
      (planillaResult.rows?.[0] as { id?: number | string } | undefined)?.id ?? 0,
    );

    for (const { row, index } of populatedRows) {
      for (const dayKey of DAY_ORDER) {
        const day = row.days?.[dayKey] ?? {};
        const isRestDay = Boolean(day.conDescanso);
        const he1 = normalizeTime(day.he1);
        const hs1 = normalizeTime(day.hs1);
        const he2 = normalizeTime(day.he2);
        const hs2 = normalizeTime(day.hs2);
        const employeeName = normalizeText(row.nombre);
        const employeeSignature = normalizeText(row.firma);
        const hasDayContent = Boolean(isRestDay || he1 || hs1 || he2 || hs2);

        if (!employeeName && !employeeSignature && !hasDayContent) {
          continue;
        }

        await client.query(
          `
          INSERT INTO horario_planilla_detalles (
            planilla_id,
            row_index,
            day_key,
            worked_date,
            employee_name,
            employee_signature,
            he1,
            hs1,
            he2,
            hs2,
            is_rest_day
          )
          VALUES (
            $1,
            $2,
            $3,
            NULLIF($4, '')::date,
            $5,
            NULLIF($6, ''),
            NULLIF($7, '')::time,
            NULLIF($8, '')::time,
            NULLIF($9, '')::time,
            NULLIF($10, '')::time,
            $11
          )
          `,
          [
            planillaId,
            index,
            dayKey,
            workedDateMap.get(dayKey) ?? "",
            employeeName,
            employeeSignature,
            he1 ?? "",
            hs1 ?? "",
            he2 ?? "",
            hs2 ?? "",
            isRestDay,
          ],
        );
      }
    }

    await client.query("COMMIT");
    return withSession(
      NextResponse.json({
        ok: true,
        planillaId,
      }),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[ingresar-horarios/forms] Error guardando planilla:", error);
    return withSession(
      NextResponse.json(
        { error: "No se pudo guardar la planilla." },
        { status: 500 },
      ),
    );
  } finally {
    client.release();
  }
}
