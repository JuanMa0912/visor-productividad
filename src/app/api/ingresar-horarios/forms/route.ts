import { NextResponse } from "next/server";
import {
  applySessionCookies,
  requireAuthSession,
  verifyCsrf,
} from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import {
  buildHorarioWorkedDateMap,
  getPopulatedHorarioRows,
  insertHorarioPlanillaDetalles,
  validateHorarioPlanillaPayload,
} from "@/lib/horario-planilla-persist";
import { canAccessPortalSection } from "@/lib/portal-sections";

const NO_STORE_CACHE_CONTROL = "no-store, private";

const isAllowedUser = (session: Awaited<ReturnType<typeof requireAuthSession>>) => {
  if (!session) return false;
  return (
    session.user.role === "admin" ||
    canAccessPortalSection(session.user.allowedDashboards, "operacion")
  );
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

  const body = (await req.json()) as Record<string, unknown>;

  const validated = validateHorarioPlanillaPayload(body);
  if (!validated.ok) {
    return withSession(
      NextResponse.json({ error: validated.error }, { status: 400 }),
    );
  }

  const { sede, seccion, fechaInicial, fechaFinal, mes, rows } = validated;

  if (getPopulatedHorarioRows(rows).length === 0) {
    return withSession(
      NextResponse.json(
        { error: "Debes registrar al menos un empleado o un horario." },
        { status: 400 },
      ),
    );
  }

  const workedDateMap = buildHorarioWorkedDateMap(fechaInicial, fechaFinal);
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

    await insertHorarioPlanillaDetalles(client, planillaId, rows, workedDateMap);

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
