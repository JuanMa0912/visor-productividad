import { NextResponse } from "next/server";
import {
  getSessionCookieOptions,
  requireAuthSession,
} from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/shared/portal-sections";
import {
  canAccessRotacionBoard,
  canViewRotacionSinventarioHistorial,
} from "@/lib/shared/special-role-features";
import {
  getRotationFilterCatalog,
  resolveVisibleSedes,
} from "@/app/api/rotacion/route";

const CACHE_CONTROL = "no-store";

type PgErrorLike = { code?: string };

const isMissingRelationError = (error: unknown): boolean =>
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
      session.user.allowedSubdashboards,
    )
  ) {
    return NextResponse.json(
      { error: "No tienes permisos para ver rotacion." },
      { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }
  if (
    !canViewRotacionSinventarioHistorial(
      session.user.specialRoles,
      session.user.role === "admin",
    )
  ) {
    return NextResponse.json(
      {
        error:
          "No tienes permiso para ver el historial de S.inventario. Se requiere rol especial historial_sinventario o ser administrador.",
      },
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
  | { ok: true; scopes: Array<{ empresa: string; sedeId: string }> }
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

  // Mantenemos la tupla (empresa, sedeId) porque sedeId no es unico entre
  // empresas: Mercamio 001 != Mercatodo 001 != Merkmios 001.
  const authorized = new Map<string, { empresa: string; sedeId: string }>();
  for (const scope of parsed) {
    const key = scopeKey(scope);
    if (visibleKeys.has(key)) {
      authorized.set(key, scope);
    }
  }

  if (authorized.size === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No hay sedes autorizadas en la solicitud." },
        { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    };
  }

  return { ok: true, scopes: Array.from(authorized.values()) };
};

export type RotacionSurtidoAuditRow = {
  id: string;
  empresa: string;
  sede_id: string;
  item: string;
  context: string;
  estado_anterior: string | null;
  estado_nuevo: string;
  changed_at: string;
  changed_by: string | null;
  username: string | null;
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
        { rows: [] as RotacionSurtidoAuditRow[], auditTableMissing: false },
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

  // Pasamos arrays paralelos (empresa[], sede_id[]) y filtramos por tupla
  // para no traer cambios de otras empresas que comparten sede_id (ej.
  // Mercatodo 001 vs Mercamio 001).
  const empresasArr = resolved.scopes.map((s) => s.empresa);
  const sedeIdsArr = resolved.scopes.map((s) => s.sedeId);

  const pool = await getDbPool();
  try {
    const result = await pool.query<RotacionSurtidoAuditRow>(
      `
      SELECT
        a.id::text AS id,
        a.empresa,
        a.sede_id,
        a.item,
        a.context,
        a.estado_anterior,
        a.estado_nuevo,
        a.changed_at::text AS changed_at,
        a.changed_by::text AS changed_by,
        u.username
      FROM rotacion_cero_item_estado_audit a
      JOIN unnest($1::text[], $2::text[]) AS t(empresa, sede_id)
        ON a.empresa = t.empresa AND a.sede_id = t.sede_id
      LEFT JOIN app_users u ON u.id = a.changed_by
      WHERE (a.changed_at AT TIME ZONE 'America/Bogota')::date >= to_date($3::text, 'YYYYMMDD')
        /* El periodo del tablero suele terminar antes que "hoy"; los cambios usan changed_at real. */
        AND (a.changed_at AT TIME ZONE 'America/Bogota')::date <= GREATEST(
          to_date($4::text, 'YYYYMMDD'),
          (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date
        )
      ORDER BY a.changed_at DESC
      LIMIT 2000
      `,
      [empresasArr, sedeIdsArr, start, end],
    );

    return withSession(
      session,
      NextResponse.json(
        {
          rows: result.rows,
          auditTableMissing: false,
        },
        { headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  } catch (error) {
    if (isMissingRelationError(error)) {
      return withSession(
        session,
        NextResponse.json(
          {
            rows: [] as RotacionSurtidoAuditRow[],
            auditTableMissing: true,
            message:
              "Falta la tabla rotacion_cero_item_estado_audit. Ejecuta db/migrations/20260515_rotacion_cero_item_estado_audit.sql.",
          },
          { headers: { "Cache-Control": CACHE_CONTROL } },
        ),
      );
    }
    throw error;
  }
}
