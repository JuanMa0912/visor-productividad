import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { applySessionCookies, requireAuthSession, verifyCsrf } from "@/lib/auth";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/portal-sections";
import {
  MAX_ITEM_PRESETS,
  normalizeItemPresetsFromUnknown,
  type ItemPreset,
} from "@/lib/inventario-x-item-presets";

const CACHE_CONTROL = "private, no-store";

const ensurePresetsTable = async () => {
  const client = await (await getDbPool()).connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventario_x_item_user_presets (
        user_id uuid PRIMARY KEY REFERENCES app_users (id) ON DELETE CASCADE,
        presets jsonb NOT NULL DEFAULT '[]'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  } finally {
    client.release();
  }
};

type AuthSession = NonNullable<Awaited<ReturnType<typeof requireAuthSession>>>;

const jsonWithSession = async (
  session: AuthSession,
  data: unknown,
  status = 200,
) => {
  const res = NextResponse.json(data, {
    status,
    headers: { "Cache-Control": CACHE_CONTROL },
  });
  await applySessionCookies(res, session);
  return res;
};

const assertInventarioAccess = (session: AuthSession) => {
  if (session.user.role === "admin") return true;
  return (
    canAccessPortalSection(session.user.allowedDashboards, "venta") &&
    canAccessPortalSubsection(
      session.user.allowedSubdashboards,
      "inventario-x-item",
    )
  );
};

export async function GET() {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  if (!assertInventarioAccess(session)) {
    return jsonWithSession(session, { error: "No tienes permisos para esta seccion." }, 403);
  }

  try {
    await ensurePresetsTable();
    const client = await (await getDbPool()).connect();
    try {
      const result = await client.query(
        `
        SELECT presets
        FROM inventario_x_item_user_presets
        WHERE user_id = $1::uuid
        LIMIT 1
        `,
        [session.user.id],
      );
      const raw = result.rows?.[0]?.presets ?? [];
      const presets = normalizeItemPresetsFromUnknown(raw);
      return jsonWithSession(session, { presets } satisfies { presets: ItemPreset[] });
    } finally {
      client.release();
    }
  } catch {
    return jsonWithSession(session, { error: "No se pudieron cargar los presets." }, 500);
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
    return jsonWithSession(session, { error: "CSRF inválido." }, 403);
  }

  if (!assertInventarioAccess(session)) {
    return jsonWithSession(session, { error: "No tienes permisos para esta seccion." }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonWithSession(session, { error: "Cuerpo JSON inválido." }, 400);
  }

  if (!body || typeof body !== "object" || !("presets" in body)) {
    return jsonWithSession(session, { error: "Se requiere el campo presets (arreglo)." }, 400);
  }

  const rawPresets = (body as { presets: unknown }).presets;
  if (!Array.isArray(rawPresets)) {
    return jsonWithSession(session, { error: "presets debe ser un arreglo." }, 400);
  }

  if (rawPresets.length > MAX_ITEM_PRESETS) {
    return jsonWithSession(session, { error: `Máximo ${MAX_ITEM_PRESETS} presets.` }, 400);
  }

  const presets = normalizeItemPresetsFromUnknown(rawPresets);

  try {
    await ensurePresetsTable();
    const client = await (await getDbPool()).connect();
    try {
      await client.query(
        `
        INSERT INTO inventario_x_item_user_presets (user_id, presets, updated_at)
        VALUES ($1::uuid, $2::jsonb, now())
        ON CONFLICT (user_id) DO UPDATE SET
          presets = EXCLUDED.presets,
          updated_at = now()
        `,
        [session.user.id, JSON.stringify(presets)],
      );
      return jsonWithSession(session, { ok: true, presets });
    } finally {
      client.release();
    }
  } catch {
    return jsonWithSession(session, { error: "No se pudieron guardar los presets." }, 500);
  }
}
