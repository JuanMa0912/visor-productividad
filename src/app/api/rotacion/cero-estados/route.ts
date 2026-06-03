import { NextResponse } from "next/server";
import type { Pool } from "pg";
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
  CERO_ROTACION_ESTADO_VALUES,
  type CeroRotacionEstado,
  type RotacionSurtidoEstadoContext,
  makeCeroRotacionEstadoKey,
  parseCeroRotacionEstado,
  parseRotacionSurtidoEstadoContext,
} from "@/lib/rotacion/cero-estado";
import {
  getRotationFilterCatalog,
  resolveVisibleSedes,
} from "@/app/api/rotacion/route";

const CACHE_CONTROL = "no-store";

type PgErrorLike = { code?: string; message?: string };

const isUndefinedRelationError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as PgErrorLike).code === "42P01";

const isMissingCeroEstadoTableError = (error: unknown): boolean =>
  isUndefinedRelationError(error) &&
  /rotacion_cero_item_estado\b/i.test(
    String((error as PgErrorLike).message ?? ""),
  );

const isMissingAuditTableError = (error: unknown): boolean =>
  isUndefinedRelationError(error) &&
  /rotacion_cero_item_estado_audit/i.test(
    String((error as PgErrorLike).message ?? ""),
  );

const isUndefinedObjectError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as PgErrorLike).code === "42703";

/** Columna `context` aún no migrada (42703 en mensaje). */
const isMissingContextColumnError = (error: unknown): boolean => {
  if (!isUndefinedObjectError(error)) return false;
  const msg = String((error as PgErrorLike).message ?? "");
  return /\bcontext\b/i.test(msg);
};

const MIGRATION_RESTOCK_CONTEXT_HINT =
  "Ejecuta en la base de datos la migracion db/migrations/20260514_rotacion_cero_item_estado_restock_context.sql (columna context y clave primaria por contexto).";

const readEstadoAnterior = async (
  pool: Pool,
  empresa: string,
  sedeId: string,
  item: string,
  context: RotacionSurtidoEstadoContext,
): Promise<string | null> => {
  try {
    const r = await pool.query<{ estado: string }>(
      `
      SELECT estado
      FROM rotacion_cero_item_estado
      WHERE empresa = $1 AND sede_id = $2 AND item = $3 AND context = $4
      `,
      [empresa, sedeId, item, context],
    );
    return r.rows[0]?.estado ?? null;
  } catch (error) {
    if (!isMissingContextColumnError(error)) throw error;
    const r2 = await pool.query<{ estado: string }>(
      `
      SELECT estado
      FROM rotacion_cero_item_estado
      WHERE empresa = $1 AND sede_id = $2 AND item = $3
      `,
      [empresa, sedeId, item],
    );
    return r2.rows[0]?.estado ?? null;
  }
};

const tryInsertSurtidoAudit = async (
  pool: Pool,
  params: {
    empresa: string;
    sedeId: string;
    item: string;
    context: RotacionSurtidoEstadoContext;
    estadoAnterior: string | null;
    estadoNuevo: CeroRotacionEstado;
    changedBy: string;
  },
) => {
  try {
    await pool.query(
      `
      INSERT INTO rotacion_cero_item_estado_audit (
        empresa, sede_id, item, context, estado_anterior, estado_nuevo, changed_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::uuid)
      `,
      [
        params.empresa,
        params.sedeId,
        params.item,
        params.context,
        params.estadoAnterior,
        params.estadoNuevo,
        params.changedBy,
      ],
    );
  } catch (error) {
    if (isMissingAuditTableError(error)) return;
    console.error("[rotacion] rotacion_cero_item_estado_audit insert:", error);
  }
};

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

  // Mantenemos la tupla (empresa, sedeId): sedeId NO es unico entre empresas
  // (Mercamio 001 vs Mercatodo 001 vs Merkmios 001 son sedes distintas).
  // Si solo guardaramos sedeId perderiamos esa distincion y mezclariamos
  // los estados S.inventario entre sedes que comparten numero.
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
        {
          estados: {} as Record<string, CeroRotacionEstado>,
          estadosRestock: {} as Record<string, CeroRotacionEstado>,
        },
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

  // Pasamos arrays paralelos (empresa[], sede_id[]) al SQL y matcheamos por
  // tupla con `unnest(...) AS t(empresa, sede_id)` para no mezclar empresas
  // que comparten sede_id (ej. Mercatodo 001 con Mercamio 001).
  const empresasArr = resolved.scopes.map((s) => s.empresa);
  const sedeIdsArr = resolved.scopes.map((s) => s.sedeId);

  const pool = await getDbPool();
  let result: {
    rows: Array<{
      empresa: string;
      sede_id: string;
      item: string;
      estado: string;
      context: RotacionSurtidoEstadoContext;
    }>;
  };
  try {
    result = await pool.query<{
      empresa: string;
      sede_id: string;
      item: string;
      estado: string;
      context: RotacionSurtidoEstadoContext;
    }>(
      `
      SELECT e.empresa, e.sede_id, e.item, e.estado, e.context
      FROM rotacion_cero_item_estado e
      JOIN unnest($1::text[], $2::text[]) AS t(empresa, sede_id)
        ON e.empresa = t.empresa AND e.sede_id = t.sede_id
      `,
      [empresasArr, sedeIdsArr],
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
    if (isMissingContextColumnError(error)) {
      try {
        result = await pool.query<{
          empresa: string;
          sede_id: string;
          item: string;
          estado: string;
          context: RotacionSurtidoEstadoContext;
        }>(
          `
          SELECT e.empresa, e.sede_id, e.item, e.estado, 'cero'::text AS context
          FROM rotacion_cero_item_estado e
          JOIN unnest($1::text[], $2::text[]) AS t(empresa, sede_id)
            ON e.empresa = t.empresa AND e.sede_id = t.sede_id
          `,
          [empresasArr, sedeIdsArr],
        );
      } catch (fallbackErr) {
        if (isMissingCeroEstadoTableError(fallbackErr)) {
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
        throw fallbackErr;
      }
    } else {
      throw error;
    }
  }

  const estados: Record<string, CeroRotacionEstado> = {};
  const estadosRestock: Record<string, CeroRotacionEstado> = {};
  for (const row of result.rows) {
    const parsed = parseCeroRotacionEstado(row.estado);
    if (!parsed) continue;
    const key = makeCeroRotacionEstadoKey(row.empresa, row.sede_id, row.item);
    const ctx =
      parseRotacionSurtidoEstadoContext(
        typeof row.context === "string" ? row.context : undefined,
      ) ?? "cero";
    if (ctx === "restock") estadosRestock[key] = parsed;
    else estados[key] = parsed;
  }

  return withSession(
    session,
    NextResponse.json(
      { estados, estadosRestock },
      { headers: { "Cache-Control": CACHE_CONTROL } },
    ),
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

  const contextRaw =
    typeof body === "object" && body !== null && "context" in body
      ? String((body as { context?: unknown }).context ?? "").trim()
      : "";
  const context: RotacionSurtidoEstadoContext =
    parseRotacionSurtidoEstadoContext(contextRaw) ?? "cero";

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
  // Verificamos la tupla completa (empresa, sedeId): no basta con que el sedeId
  // este en la lista, porque sedeIds chocan entre empresas (Mercamio 001
  // y Mercatodo 001 son sedes distintas que comparten numero).
  const isAuthorized = resolved.scopes.some(
    (scope) => scope.empresa === empresa && scope.sedeId === sedeId,
  );
  if (!isAuthorized) {
    return withSession(
      session,
      NextResponse.json(
        { error: "Sede no autorizada." },
        { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  const pool = await getDbPool();
  let estadoAnterior: string | null = null;
  try {
    estadoAnterior = await readEstadoAnterior(pool, empresa, sedeId, item, context);
  } catch {
    estadoAnterior = null;
  }

  try {
    await pool.query(
      `
      INSERT INTO rotacion_cero_item_estado (empresa, sede_id, item, context, estado, updated_at, updated_by)
      VALUES ($1, $2, $3, $4, $5, now(), $6::uuid)
      ON CONFLICT (empresa, sede_id, item, context) DO UPDATE SET
        estado = EXCLUDED.estado,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by
      `,
      [empresa, sedeId, item, context, estado, session.user.id],
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
    if (isMissingContextColumnError(error)) {
      if (context === "restock") {
        return withSession(
          session,
          NextResponse.json(
            {
              error: `Estados de restock requieren la columna context en la base de datos. ${MIGRATION_RESTOCK_CONTEXT_HINT}`,
            },
            { status: 503, headers: { "Cache-Control": CACHE_CONTROL } },
          ),
        );
      }
      try {
        await pool.query(
          `
          INSERT INTO rotacion_cero_item_estado (empresa, sede_id, item, estado, updated_at, updated_by)
          VALUES ($1, $2, $3, $4, now(), $5::uuid)
          ON CONFLICT (empresa, sede_id, item) DO UPDATE SET
            estado = EXCLUDED.estado,
            updated_at = now(),
            updated_by = EXCLUDED.updated_by
          `,
          [empresa, sedeId, item, estado, session.user.id],
        );
      } catch (legacyErr) {
        if (isMissingCeroEstadoTableError(legacyErr)) {
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
        throw legacyErr;
      }
    } else {
      throw error;
    }
  }

  if (estadoAnterior !== estado) {
    await tryInsertSurtidoAudit(pool, {
      empresa,
      sedeId,
      item,
      context,
      estadoAnterior,
      estadoNuevo: estado,
      changedBy: session.user.id,
    });
  }

  return withSession(
    session,
    NextResponse.json(
      {
        ok: true,
        key: makeCeroRotacionEstadoKey(empresa, sedeId, item),
        estado,
        context,
      },
      { headers: { "Cache-Control": CACHE_CONTROL } },
    ),
  );
}
