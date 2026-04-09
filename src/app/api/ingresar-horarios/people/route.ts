import { NextResponse } from "next/server";
import { applySessionCookies, requireAuthSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { canAccessPortalSection } from "@/lib/portal-sections";

const NO_STORE_CACHE_CONTROL = "no-store, private";

const isAllowedUser = (session: Awaited<ReturnType<typeof requireAuthSession>>) => {
  if (!session) return false;
  return (
    session.user.role === "admin" ||
    canAccessPortalSection(session.user.allowedDashboards, "operacion")
  );
};

const normalizeText = (value?: string | null) => (value ?? "").trim();

const HAS_SCHEDULE_CONTENT_SQL = `
  (
    d.is_rest_day = TRUE
    OR d.he1 IS NOT NULL
    OR d.hs1 IS NOT NULL
    OR d.he2 IS NOT NULL
    OR d.hs2 IS NOT NULL
  )
`;

export async function GET(req: Request) {
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

  const { searchParams } = new URL(req.url);
  const selectedEmployee = normalizeText(searchParams.get("employee"));
  const client = await (await getDbPool()).connect();

  try {
    const peopleResult = await client.query(
      `
      SELECT
        TRIM(d.employee_name) AS employee_name,
        COUNT(*) FILTER (WHERE ${HAS_SCHEDULE_CONTENT_SQL}) AS record_count,
        COUNT(DISTINCT d.planilla_id) FILTER (WHERE ${HAS_SCHEDULE_CONTENT_SQL}) AS form_count,
        MIN(d.worked_date)::text AS first_worked_date,
        MAX(d.worked_date)::text AS last_worked_date
      FROM horario_planilla_detalles d
      WHERE TRIM(COALESCE(d.employee_name, '')) <> ''
      GROUP BY TRIM(d.employee_name)
      ORDER BY TRIM(d.employee_name) ASC
      `,
    );

    let records: Array<{
      planillaId: number;
      sede: string;
      seccion: string;
      mes: string;
      fechaInicial: string;
      fechaFinal: string;
      workedDate: string;
      dayKey: string;
      he1: string;
      hs1: string;
      he2: string;
      hs2: string;
      conDescanso: boolean;
      createdByUsername: string;
      createdAt: string;
    }> = [];

    if (selectedEmployee) {
      const recordsResult = await client.query(
        `
        SELECT
          d.planilla_id,
          p.sede,
          p.seccion,
          COALESCE(p.mes, '') AS mes,
          COALESCE(p.fecha_inicial::text, '') AS fecha_inicial,
          COALESCE(p.fecha_final::text, '') AS fecha_final,
          COALESCE(d.worked_date::text, '') AS worked_date,
          d.day_key,
          COALESCE(TO_CHAR(d.he1, 'HH24:MI'), '') AS he1,
          COALESCE(TO_CHAR(d.hs1, 'HH24:MI'), '') AS hs1,
          COALESCE(TO_CHAR(d.he2, 'HH24:MI'), '') AS he2,
          COALESCE(TO_CHAR(d.hs2, 'HH24:MI'), '') AS hs2,
          d.is_rest_day,
          p.created_by_username,
          p.created_at::text AS created_at
        FROM horario_planilla_detalles d
        INNER JOIN horario_planillas p ON p.id = d.planilla_id
        WHERE UPPER(TRIM(COALESCE(d.employee_name, ''))) = UPPER(TRIM($1))
          AND ${HAS_SCHEDULE_CONTENT_SQL}
        ORDER BY
          COALESCE(d.worked_date, p.fecha_inicial, p.fecha_final) DESC NULLS LAST,
          d.planilla_id DESC,
          d.day_key ASC
        `,
        [selectedEmployee],
      );

      records = (recordsResult.rows ?? []).map((row) => ({
        planillaId: Number((row as { planilla_id?: number | string }).planilla_id ?? 0),
        sede: normalizeText((row as { sede?: string }).sede),
        seccion: normalizeText((row as { seccion?: string }).seccion),
        mes: normalizeText((row as { mes?: string }).mes),
        fechaInicial: normalizeText((row as { fecha_inicial?: string }).fecha_inicial),
        fechaFinal: normalizeText((row as { fecha_final?: string }).fecha_final),
        workedDate: normalizeText((row as { worked_date?: string }).worked_date),
        dayKey: normalizeText((row as { day_key?: string }).day_key),
        he1: normalizeText((row as { he1?: string }).he1),
        hs1: normalizeText((row as { hs1?: string }).hs1),
        he2: normalizeText((row as { he2?: string }).he2),
        hs2: normalizeText((row as { hs2?: string }).hs2),
        conDescanso: Boolean((row as { is_rest_day?: boolean }).is_rest_day),
        createdByUsername: normalizeText(
          (row as { created_by_username?: string }).created_by_username,
        ),
        createdAt: normalizeText((row as { created_at?: string }).created_at),
      }));
    }

    return withSession(
      NextResponse.json({
        people: (peopleResult.rows ?? []).map((row) => ({
          name: normalizeText((row as { employee_name?: string }).employee_name),
          recordCount: Number(
            (row as { record_count?: number | string }).record_count ?? 0,
          ),
          formCount: Number(
            (row as { form_count?: number | string }).form_count ?? 0,
          ),
          firstWorkedDate: normalizeText(
            (row as { first_worked_date?: string }).first_worked_date,
          ),
          lastWorkedDate: normalizeText(
            (row as { last_worked_date?: string }).last_worked_date,
          ),
        })),
        selectedEmployee,
        records,
      }),
    );
  } finally {
    client.release();
  }
}
