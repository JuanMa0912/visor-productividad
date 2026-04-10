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

type Params = {
  params: Promise<{ id: string }>;
};

const DAY_ORDER = [
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
] as const;

const NO_STORE_CACHE_CONTROL = "no-store, private";

const isAllowedUser = (session: Awaited<ReturnType<typeof requireAuthSession>>) => {
  if (!session) return false;
  return (
    session.user.role === "admin" ||
    canAccessPortalSection(session.user.allowedDashboards, "operacion")
  );
};

const createEmptyDays = () => ({
  domingo: { he1: "", hs1: "", he2: "", hs2: "", conDescanso: false },
  lunes: { he1: "", hs1: "", he2: "", hs2: "", conDescanso: false },
  martes: { he1: "", hs1: "", he2: "", hs2: "", conDescanso: false },
  miercoles: { he1: "", hs1: "", he2: "", hs2: "", conDescanso: false },
  jueves: { he1: "", hs1: "", he2: "", hs2: "", conDescanso: false },
  viernes: { he1: "", hs1: "", he2: "", hs2: "", conDescanso: false },
  sabado: { he1: "", hs1: "", he2: "", hs2: "", conDescanso: false },
});

export async function GET(_req: Request, { params }: Params) {
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

  const { id } = await params;
  const planillaId = Number(id);
  if (!Number.isInteger(planillaId) || planillaId <= 0) {
    return withSession(
      NextResponse.json({ error: "Id invalido." }, { status: 400 }),
    );
  }

  const client = await (await getDbPool()).connect();
  try {
    const planillaResult = await client.query(
      `
      SELECT
        id,
        sede,
        seccion,
        fecha_inicial::text AS fecha_inicial,
        fecha_final::text AS fecha_final,
        mes,
        created_by_username,
        created_at::text AS created_at
      FROM horario_planillas
      WHERE id = $1
      `,
      [planillaId],
    );
    const planilla = planillaResult.rows?.[0] as
      | {
          id: number | string;
          sede?: string;
          seccion?: string;
          fecha_inicial?: string | null;
          fecha_final?: string | null;
          mes?: string | null;
          created_by_username?: string;
          created_at?: string;
        }
      | undefined;

    if (!planilla) {
      return withSession(
        NextResponse.json({ error: "Planilla no encontrada." }, { status: 404 }),
      );
    }

    const detailsResult = await client.query(
      `
      SELECT
        row_index,
        day_key,
        employee_name,
        employee_signature,
        COALESCE(TO_CHAR(he1, 'HH24:MI'), '') AS he1,
        COALESCE(TO_CHAR(hs1, 'HH24:MI'), '') AS hs1,
        COALESCE(TO_CHAR(he2, 'HH24:MI'), '') AS he2,
        COALESCE(TO_CHAR(hs2, 'HH24:MI'), '') AS hs2,
        is_rest_day
      FROM horario_planilla_detalles
      WHERE planilla_id = $1
      ORDER BY row_index ASC, array_position($2::text[], day_key)
      `,
      [planillaId, DAY_ORDER],
    );

    const rowsByIndex = new Map<
      number,
      {
        nombre: string;
        firma: string;
        days: ReturnType<typeof createEmptyDays>;
      }
    >();

    for (const rawRow of detailsResult.rows ?? []) {
      const row = rawRow as {
        row_index?: number | string;
        day_key?: (typeof DAY_ORDER)[number];
        employee_name?: string;
        employee_signature?: string | null;
        he1?: string;
        hs1?: string;
        he2?: string;
        hs2?: string;
        is_rest_day?: boolean;
      };
      const rowIndex = Number(row.row_index ?? 0);
      const dayKey = row.day_key;
      if (!DAY_ORDER.includes(dayKey as (typeof DAY_ORDER)[number])) {
        continue;
      }
      const resolvedDayKey = dayKey as (typeof DAY_ORDER)[number];

      const existing =
        rowsByIndex.get(rowIndex) ??
        {
          nombre: row.employee_name ?? "",
          firma: row.employee_signature ?? "",
          days: createEmptyDays(),
        };

      existing.nombre = row.employee_name ?? existing.nombre;
      existing.firma = row.employee_signature ?? existing.firma;
      existing.days[resolvedDayKey] = {
        he1: row.he1 ?? "",
        hs1: row.hs1 ?? "",
        he2: row.he2 ?? "",
        hs2: row.hs2 ?? "",
        conDescanso: Boolean(row.is_rest_day),
      };
      rowsByIndex.set(rowIndex, existing);
    }

    return withSession(
      NextResponse.json({
        form: {
          id: Number(planilla.id),
          sede: planilla.sede ?? "",
          seccion: planilla.seccion ?? "",
          fechaInicial: planilla.fecha_inicial ?? "",
          fechaFinal: planilla.fecha_final ?? "",
          mes: planilla.mes ?? "",
          createdByUsername: planilla.created_by_username ?? "",
          createdAt: planilla.created_at ?? "",
          rows: Array.from(rowsByIndex.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([rowIndex, value]) => ({
              rowIndex,
              nombre: value.nombre,
              firma: value.firma,
              days: value.days,
            })),
        },
      }),
    );
  } finally {
    client.release();
  }
}

export async function PATCH(req: Request, { params }: Params) {
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

  if (!(await verifyCsrf(req))) {
    return withSession(
      NextResponse.json({ error: "CSRF invalido." }, { status: 403 }),
    );
  }

  const { id } = await params;
  const planillaId = Number(id);
  if (!Number.isInteger(planillaId) || planillaId <= 0) {
    return withSession(
      NextResponse.json({ error: "Id invalido." }, { status: 400 }),
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

    const updateResult = await client.query(
      `
      UPDATE horario_planillas
      SET
        sede = $1,
        seccion = $2,
        fecha_inicial = NULLIF($3, '')::date,
        fecha_final = NULLIF($4, '')::date,
        mes = NULLIF($5, '')
      WHERE id = $6
      RETURNING id
      `,
      [sede, seccion, fechaInicial, fechaFinal, mes, planillaId],
    );

    if ((updateResult.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return withSession(
        NextResponse.json({ error: "Planilla no encontrada." }, { status: 404 }),
      );
    }

    await client.query(
      `DELETE FROM horario_planilla_detalles WHERE planilla_id = $1`,
      [planillaId],
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
    console.error("[ingresar-horarios/forms/:id] Error actualizando planilla:", error);
    return withSession(
      NextResponse.json(
        { error: "No se pudo actualizar la planilla." },
        { status: 500 },
      ),
    );
  } finally {
    client.release();
  }
}

export async function DELETE(req: Request, { params }: Params) {
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

  if (!(await verifyCsrf(req))) {
    return withSession(
      NextResponse.json({ error: "CSRF invalido." }, { status: 403 }),
    );
  }

  const { id } = await params;
  const planillaId = Number(id);
  if (!Number.isInteger(planillaId) || planillaId <= 0) {
    return withSession(
      NextResponse.json({ error: "Id invalido." }, { status: 400 }),
    );
  }

  const client = await (await getDbPool()).connect();
  try {
    const result = await client.query(
      `
      DELETE FROM horario_planillas
      WHERE id = $1
      RETURNING id
      `,
      [planillaId],
    );

    if ((result.rowCount ?? 0) === 0) {
      return withSession(
        NextResponse.json({ error: "Planilla no encontrada." }, { status: 404 }),
      );
    }

    return withSession(
      NextResponse.json({
        ok: true,
        planillaId,
      }),
    );
  } finally {
    client.release();
  }
}
