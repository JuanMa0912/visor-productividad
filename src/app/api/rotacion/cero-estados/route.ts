import { NextResponse } from "next/server";
import {
  getSessionCookieOptions,
  requireAuthSession,
  verifyCsrf,
} from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/portal-sections";
import { canAccessRotacionBoard } from "@/lib/special-role-features";
import {
  CERO_ROTACION_ESTADO_VALUES,
  type CeroRotacionEstado,
  makeCeroRotacionEstadoKey,
  parseCeroRotacionEstado,
} from "@/lib/rotacion-cero-estado";
import {
  getRotationFilterCatalog,
  resolveVisibleSedes,
} from "@/app/api/rotacion/route";

const CACHE_CONTROL = "no-store";

type PgErrorLike = { code?: string };

const isMissingCeroEstadoTableError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as PgErrorLike).code === "42P01";

const normalizeCompactDateParam = (raw: string): string | null => {
  const value = raw.trim();
  if (!value) return null;
  if (/^[0-9]{8}$/.test(value)) return value;
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) {
    return value.replace(/-/g, "");
  }
  return null;
};

const parseSedeScope = (
  raw: string,
): { empresa: string; sedeId: string } | null => {
  const t = raw.trim();
  const sep = "::";
  const i = t.indexOf(sep);
  if (i <= 0) return null;
  const empresa = t.slice(0, i).trim();
  const sedeId = t.slice(i + sep.length).trim();
  if (!empresa || !sedeId) return null;
  return { empresa, sedeId };
};

const scopeKey = (scope: { empresa: string; sedeId: string }) =>
  `${scope.empresa}::${scope.sedeId}`;

const withSession = (
  session: NonNullable<Awaited<ReturnType<typeof requireAuthSession>>>,
  response: NextResponse,
) => {
  response.cookies.set(
    "vp_session",
    session.token,
    getSessionCookieOptions(session.expiresAt),
  );
  if (!response.headers.has("Cache-Control")) {
    response.headers.set("Cache-Control", CACHE_CONTROL);
  }
  return response;
};

const rotacionAuthGate = async (
  session: NonNullable<Awaited<ReturnType<typeof requireAuthSession>>>,
) => {
  if (
    session.user.role !== "admin" &&
    (!canAccessPortalSection(session.user.allowedDashboards, "producto") ||
      !canAccessPortalSubsection(
        session.user.allowedSubdashboards,
        "rotacion",
      ))
  ) {
    return NextResponse.json(
      { error: "No tienes permisos para esta seccion." },
      { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }
  if (
    !canAccessRotacionBoard(
      session.user.specialRoles,
      session.user.role === "admin",
    )
  ) {
    return NextResponse.json(
      { error: "No tienes permisos para ver rotacion." },
      { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }
  return null;
};

const resolveAuthorizedScopesForRequest = async (
  session: NonNullable<Awaited<ReturnType<typeof requireAuthSession>>>,
  start: string,
  end: string,
  sedeScopeRaw: string[],
): Promise<
  | { ok: true; sedeIds: string[] }
  | { ok: false; response: NextResponse }
> => {
  const catalog = await getRotationFilterCatalog(start, end);
  const { visibleSedes } = resolveVisibleSedes(session.user, catalog);
  const visibleKeys = new Set(
    visibleSedes.map((s) => scopeKey({ empresa: s.empresa, sedeId: s.sedeId })),
  );

  const parsed = sedeScopeRaw
    .map(parseSedeScope)
    .filter((v): v is { empresa: string; sedeId: string } => v !== null);

  const authorizedSedeIds = new Set<string>();
  for (const scope of parsed) {
    if (visibleKeys.has(scopeKey(scope))) {
      authorizedSedeIds.add(scope.sedeId);
    }
  }

  if (authorizedSedeIds.size === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No hay sedes autorizadas en la solicitud." },
        { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    };
  }

  return { ok: true, sedeIds: Array.from(authorizedSedeIds) };
};

export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  const gate = await rotacionAuthGate(session);
  if (gate) return withSession(session, gate);

  const url = new URL(request.url);
  const start = normalizeCompactDateParam(url.searchParams.get("start") ?? "");
  const end = normalizeCompactDateParam(url.searchParams.get("end") ?? "");
  const sedeScopeRaw = url.searchParams.getAll("sedeScope").map((s) => s.trim());

  if (!start || !end) {
    return withSession(
      session,
      NextResponse.json(
        { error: "Parametros start y end requeridos (YYYYMMDD o YYYY-MM-DD)." },
        { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  if (sedeScopeRaw.length === 0) {
    return withSession(
      session,
      NextResponse.json(
        { estados: {} as Record<string, CeroRotacionEstado> },
        { headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  const resolved = await resolveAuthorizedScopesForRequest(
    session,
    start,
    end,
    sedeScopeRaw,
  );
  if (!resolved.ok) return withSession(session, resolved.response);

  const pool = await getDbPool();
  let result: { rows: Array<{ sede_id: string; item: string; estado: string }> };
  try {
    result = await pool.query<{
      sede_id: string;
      item: string;
      estado: string;
    }>(
      `
      SELECT sede_id, item, estado
      FROM rotacion_cero_item_estado
      WHERE sede_id = ANY($1::text[])
      `,
      [resolved.sedeIds],
    );
  } catch (error) {
    if (isMissingCeroEstadoTableError(error)) {
      return withSession(
        session,
        NextResponse.json(
          {
            error:
              "Falta la tabla rotacion_cero_item_estado. Ejecuta la migracion 20260429_rotacion_cero_item_estado.sql.",
          },
          { status: 503, headers: { "Cache-Control": CACHE_CONTROL } },
        ),
      );
    }
    throw error;
  }

  const estados: Record<string, CeroRotacionEstado> = {};
  for (const row of result.rows) {
    const parsed = parseCeroRotacionEstado(row.estado);
    if (!parsed) continue;
    estados[makeCeroRotacionEstadoKey(row.sede_id, row.item)] = parsed;
  }

  return withSession(
    session,
    NextResponse.json({ estados }, { headers: { "Cache-Control": CACHE_CONTROL } }),
  );
}

export async function PATCH(request: Request) {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  if (!(await verifyCsrf(request))) {
    return NextResponse.json(
      { error: "CSRF invalido." },
      { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  const gate = await rotacionAuthGate(session);
  if (gate) return withSession(session, gate);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withSession(
      session,
      NextResponse.json(
        { error: "Cuerpo JSON invalido." },
        { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  const empresa =
    typeof body === "object" && body !== null && "empresa" in body
      ? String((body as { empresa?: unknown }).empresa ?? "").trim()
      : "";
  const sedeId =
    typeof body === "object" && body !== null && "sedeId" in body
      ? String((body as { sedeId?: unknown }).sedeId ?? "").trim()
      : "";
  const item =
    typeof body === "object" && body !== null && "item" in body
      ? String((body as { item?: unknown }).item ?? "").trim()
      : "";
  const estadoRaw =
    typeof body === "object" && body !== null && "estado" in body
      ? String((body as { estado?: unknown }).estado ?? "").trim()
      : "";

  if (!empresa || !sedeId || !item) {
    return withSession(
      session,
      NextResponse.json(
        { error: "empresa, sedeId e item son obligatorios." },
        { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  const estado = parseCeroRotacionEstado(estadoRaw);
  if (!estado || !CERO_ROTACION_ESTADO_VALUES.includes(estado)) {
    return withSession(
      session,
      NextResponse.json(
        { error: "estado invalido." },
        { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  const url = new URL(request.url);
  const fromBody =
    typeof body === "object" && body !== null
      ? (body as { start?: unknown; end?: unknown })
      : {};
  const start = normalizeCompactDateParam(
    String(fromBody.start ?? url.searchParams.get("start") ?? ""),
  );
  const end = normalizeCompactDateParam(
    String(fromBody.end ?? url.searchParams.get("end") ?? ""),
  );
  if (!start || !end) {
    return withSession(
      session,
      NextResponse.json(
        {
          error:
            "start y end requeridos (YYYYMMDD o YYYY-MM-DD) en el cuerpo o query para validar sede.",
        },
        { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  const resolved = await resolveAuthorizedScopesForRequest(session, start, end, [
    scopeKey({ empresa, sedeId }),
  ]);
  if (!resolved.ok) return withSession(session, resolved.response);
  if (!resolved.sedeIds.includes(sedeId)) {
    return withSession(
      session,
      NextResponse.json(
        { error: "Sede no autorizada." },
        { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  const pool = await getDbPool();
  try {
    await pool.query(
      `
      INSERT INTO rotacion_cero_item_estado (sede_id, item, estado, updated_at, updated_by)
      VALUES ($1, $2, $3, now(), $4::uuid)
      ON CONFLICT (sede_id, item) DO UPDATE SET
        estado = EXCLUDED.estado,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by
      `,
      [sedeId, item, estado, session.user.id],
    );
  } catch (error) {
    if (isMissingCeroEstadoTableError(error)) {
      return withSession(
        session,
        NextResponse.json(
          {
            error:
              "Falta la tabla rotacion_cero_item_estado. Ejecuta la migracion 20260429_rotacion_cero_item_estado.sql.",
          },
          { status: 503, headers: { "Cache-Control": CACHE_CONTROL } },
        ),
      );
    }
    throw error;
  }

  return withSession(
    session,
    NextResponse.json(
      {
        ok: true,
        key: makeCeroRotacionEstadoKey(sedeId, item),
        estado,
      },
      { headers: { "Cache-Control": CACHE_CONTROL } },
    ),
  );
}
