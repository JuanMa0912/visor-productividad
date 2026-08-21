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
} from "@/lib/shared/portal-sections";
import { canAccessRotacionBoard } from "@/lib/shared/special-role-features";
import {
  makeCeroRotacionEstadoKey,
  parseCeroRotacionEstado,
} from "@/lib/rotacion/cero-estado";
import {
  getRotationFilterCatalog,
  resolveVisibleSedes,
} from "@/app/api/rotacion/route";
import { mergeDinastiaIntoRotationCatalog } from "@/lib/rotacion/dinastia-catalog";
import { userHasDinastiaAccess } from "@/lib/shared/data-tenant";
import { validateRestockSurtidoFotoPayload } from "@/lib/rotacion/restock-surtido-foto";

const CACHE_CONTROL = "no-store";
const MIGRATION_HINT =
  "Ejecuta db/migrations/20260819_rotacion_restock_surtido_foto.sql";

type PgErrorLike = { code?: string; message?: string };
type AuthSession = NonNullable<Awaited<ReturnType<typeof requireAuthSession>>>;
type SedeScope = { empresa: string; sedeId: string };

const isUndefinedRelation = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as PgErrorLike).code === "42P01";

const isMissingFotoTable = (error: unknown) =>
  isUndefinedRelation(error) &&
  /rotacion_restock_surtido_foto\b/i.test(
    String((error as PgErrorLike).message ?? ""),
  );

const normalizeCompactDateParam = (raw: string): string | null => {
  const value = raw.trim();
  if (!value) return null;
  if (/^[0-9]{8}$/.test(value)) return value;
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) {
    return value.replace(/-/g, "");
  }
  return null;
};

const parseSedeScope = (raw: string): SedeScope | null => {
  const t = raw.trim();
  const sep = "::";
  const i = t.indexOf(sep);
  if (i <= 0) return null;
  const empresa = t.slice(0, i).trim();
  const sedeId = t.slice(i + sep.length).trim();
  if (!empresa || !sedeId) return null;
  return { empresa, sedeId };
};

const scopeKey = (scope: SedeScope) => `${scope.empresa}::${scope.sedeId}`;

const withSession = (session: AuthSession, response: NextResponse) => {
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

const rotacionAuthGate = async (session: AuthSession) => {
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
  return null;
};

const resolveAuthorizedScopes = async (
  session: AuthSession,
  start: string,
  end: string,
  sedeScopeRaw: string[],
): Promise<
  | { ok: true; scopes: SedeScope[] }
  | { ok: false; response: NextResponse }
> => {
  const catalogRaw = await getRotationFilterCatalog(start, end);
  const catalog = userHasDinastiaAccess(session.user)
    ? mergeDinastiaIntoRotationCatalog(catalogRaw)
    : catalogRaw;
  const { visibleSedes } = resolveVisibleSedes(session.user, catalog);
  const visibleKeys = new Set(
    visibleSedes.map((s) => scopeKey({ empresa: s.empresa, sedeId: s.sedeId })),
  );
  const authorized = new Map<string, SedeScope>();
  for (const raw of sedeScopeRaw) {
    const scope = parseSedeScope(raw);
    if (!scope) continue;
    const key = scopeKey(scope);
    if (visibleKeys.has(key)) authorized.set(key, scope);
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

const isAuthorizedScope = (
  scopes: SedeScope[],
  empresa: string,
  sedeId: string,
) => scopes.some((scope) => scope.empresa === empresa && scope.sedeId === sedeId);

const queryLastRestockSurtido = async (
  pool: Awaited<ReturnType<typeof getDbPool>>,
  empresa: string,
  sedeId: string,
  item: string,
): Promise<{ at: string; username: string | null } | null> => {
  try {
    const audit = await pool.query<{
      changed_at: Date;
      username: string | null;
    }>(
      `
      SELECT a.changed_at, u.username
      FROM rotacion_cero_item_estado_audit a
      LEFT JOIN app_users u ON u.id = a.changed_by
      WHERE a.empresa = $1
        AND a.sede_id = $2
        AND a.item = $3
        AND a.context = 'restock'
        AND a.estado_nuevo = 'surtido'
      ORDER BY a.changed_at DESC
      LIMIT 1
      `,
      [empresa, sedeId, item],
    );
    const row = audit.rows[0];
    if (row) {
      return {
        at: row.changed_at.toISOString(),
        username: row.username?.trim() || null,
      };
    }
  } catch (error) {
    if (!isUndefinedRelation(error)) throw error;
  }

  try {
    const estado = await pool.query<{
      updated_at: Date;
      username: string | null;
    }>(
      `
      SELECT e.updated_at, u.username
      FROM rotacion_cero_item_estado e
      LEFT JOIN app_users u ON u.id = e.updated_by
      WHERE e.empresa = $1
        AND e.sede_id = $2
        AND e.item = $3
        AND e.context = 'restock'
        AND e.estado = 'surtido'
      LIMIT 1
      `,
      [empresa, sedeId, item],
    );
    const row = estado.rows[0];
    if (row) {
      return {
        at: row.updated_at.toISOString(),
        username: row.username?.trim() || null,
      };
    }
  } catch (error) {
    if (!isUndefinedRelation(error)) throw error;
  }

  return null;
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
  if (!start || !end) {
    return withSession(
      session,
      NextResponse.json(
        { error: "Parametros start y end requeridos." },
        { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  const empresa = (url.searchParams.get("empresa") ?? "").trim();
  const sedeId = (url.searchParams.get("sedeId") ?? "").trim();
  const item = (url.searchParams.get("item") ?? "").trim();
  const sedeScopeRaw = url.searchParams.getAll("sedeScope").map((s) => s.trim());
  if (empresa && sedeId) sedeScopeRaw.push(`${empresa}::${sedeId}`);

  const resolved = await resolveAuthorizedScopes(
    session,
    start,
    end,
    sedeScopeRaw,
  );
  if (!resolved.ok) return withSession(session, resolved.response);

  const pool = await getDbPool();

  if (empresa && sedeId && item) {
    if (!isAuthorizedScope(resolved.scopes, empresa, sedeId)) {
      return withSession(
        session,
        NextResponse.json(
          { error: "Sede no autorizada." },
          { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
        ),
      );
    }
    try {
      const result = await pool.query<{
        foto_base64: string;
        mime: string;
        updated_at: Date;
      }>(
        `
        SELECT foto_base64, mime, updated_at
        FROM rotacion_restock_surtido_foto
        WHERE empresa = $1 AND sede_id = $2 AND item = $3
        `,
        [empresa, sedeId, item],
      );
      const row = result.rows[0];
      const surtido = await queryLastRestockSurtido(
        pool,
        empresa,
        sedeId,
        item,
      );
      return withSession(
        session,
        NextResponse.json(
          {
            foto: row
              ? {
                  fotoBase64: row.foto_base64,
                  mime: row.mime,
                  updatedAt: row.updated_at.toISOString(),
                }
              : null,
            surtido,
          },
          { headers: { "Cache-Control": CACHE_CONTROL } },
        ),
      );
    } catch (error) {
      if (isMissingFotoTable(error)) {
        const surtido = await queryLastRestockSurtido(
          pool,
          empresa,
          sedeId,
          item,
        );
        return withSession(
          session,
          NextResponse.json(
            { foto: null, surtido },
            { headers: { "Cache-Control": CACHE_CONTROL } },
          ),
        );
      }
      throw error;
    }
  }

  try {
    const result = await pool.query<{
      empresa: string;
      sede_id: string;
      item: string;
      mime: string;
      updated_at: Date;
    }>(
      `
      SELECT f.empresa, f.sede_id, f.item, f.mime, f.updated_at
      FROM rotacion_restock_surtido_foto f
      JOIN unnest($1::text[], $2::text[]) AS t(empresa, sede_id)
        ON f.empresa = t.empresa AND f.sede_id = t.sede_id
      `,
      [
        resolved.scopes.map((s) => s.empresa),
        resolved.scopes.map((s) => s.sedeId),
      ],
    );
    const fotos: Record<string, { mime: string; updatedAt: string }> = {};
    for (const row of result.rows) {
      fotos[makeCeroRotacionEstadoKey(row.empresa, row.sede_id, row.item)] = {
        mime: row.mime,
        updatedAt: row.updated_at.toISOString(),
      };
    }
    return withSession(
      session,
      NextResponse.json({ fotos }, { headers: { "Cache-Control": CACHE_CONTROL } }),
    );
  } catch (error) {
    if (isMissingFotoTable(error)) {
      return withSession(
        session,
        NextResponse.json(
          { fotos: {} },
          { headers: { "Cache-Control": CACHE_CONTROL } },
        ),
      );
    }
    throw error;
  }
}

export async function PUT(request: Request) {
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

  const rec =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const empresa = String(rec.empresa ?? "").trim();
  const sedeId = String(rec.sedeId ?? "").trim();
  const item = String(rec.item ?? "").trim();
  const start = normalizeCompactDateParam(String(rec.start ?? ""));
  const end = normalizeCompactDateParam(String(rec.end ?? ""));
  if (!empresa || !sedeId || !item || !start || !end) {
    return withSession(
      session,
      NextResponse.json(
        { error: "empresa, sedeId, item, start y end son obligatorios." },
        { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  const validated = validateRestockSurtidoFotoPayload(
    String(rec.fotoBase64 ?? ""),
    String(rec.mime ?? "image/jpeg"),
  );
  if (!validated.ok) {
    return withSession(
      session,
      NextResponse.json(
        { error: validated.error },
        { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  const resolved = await resolveAuthorizedScopes(session, start, end, [
    `${empresa}::${sedeId}`,
  ]);
  if (!resolved.ok) return withSession(session, resolved.response);
  if (!isAuthorizedScope(resolved.scopes, empresa, sedeId)) {
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
    const estadoRes = await pool.query<{ estado: string }>(
      `
      SELECT estado
      FROM rotacion_cero_item_estado
      WHERE empresa = $1 AND sede_id = $2 AND item = $3 AND context = 'restock'
      `,
      [empresa, sedeId, item],
    );
    if (parseCeroRotacionEstado(estadoRes.rows[0]?.estado) !== "surtido") {
      return withSession(
        session,
        NextResponse.json(
          {
            error:
              "Solo se puede adjuntar foto cuando el item restock ya esta surtido.",
          },
          { status: 409, headers: { "Cache-Control": CACHE_CONTROL } },
        ),
      );
    }
  } catch (error) {
    if (!isUndefinedRelation(error)) throw error;
    return withSession(
      session,
      NextResponse.json(
        { error: "No hay estado restock para este item." },
        { status: 409, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  try {
    await pool.query(
      `
      INSERT INTO rotacion_restock_surtido_foto (
        empresa, sede_id, item, foto_base64, mime, updated_at, updated_by
      ) VALUES ($1, $2, $3, $4, $5, now(), $6::uuid)
      ON CONFLICT (empresa, sede_id, item) DO UPDATE SET
        foto_base64 = EXCLUDED.foto_base64,
        mime = EXCLUDED.mime,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by
      `,
      [
        empresa,
        sedeId,
        item,
        validated.base64,
        validated.mime,
        session.user.id,
      ],
    );
  } catch (error) {
    if (isMissingFotoTable(error)) {
      return withSession(
        session,
        NextResponse.json(
          { error: `Falta la tabla de fotos de restock. ${MIGRATION_HINT}` },
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
        key: makeCeroRotacionEstadoKey(empresa, sedeId, item),
        mime: validated.mime,
        updatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": CACHE_CONTROL } },
    ),
  );
}
