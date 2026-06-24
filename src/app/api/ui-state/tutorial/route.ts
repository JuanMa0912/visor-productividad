import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { applySessionCookies, requireAuthSession, verifyCsrf } from "@/lib/auth";
import {
  TUTORIAL_STATE_KEYS,
  readTutorialCompletedFromState,
  type TutorialStateKey,
} from "@/lib/ui/tutorial-keys";

const CACHE_CONTROL = "private, no-store";

const ALLOWED_KEYS = new Set<string>(Object.values(TUTORIAL_STATE_KEYS));

const parseTutorialKey = (request: Request): TutorialStateKey | null => {
  const key = new URL(request.url).searchParams.get("key")?.trim() ?? "";
  if (!ALLOWED_KEYS.has(key)) return null;
  return key as TutorialStateKey;
};

const ensureUiStateTable = async () => {
  const client = await (await getDbPool()).connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_user_ui_state (
        user_id uuid PRIMARY KEY REFERENCES app_users (id) ON DELETE CASCADE,
        state jsonb NOT NULL DEFAULT '{}'::jsonb,
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

export async function GET(request: Request) {
  const stateKey = parseTutorialKey(request);
  if (!stateKey) {
    return NextResponse.json(
      { error: "Clave de tutorial invalida." },
      { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  try {
    await ensureUiStateTable();
    const client = await (await getDbPool()).connect();
    try {
      const result = await client.query(
        `
        SELECT state
        FROM app_user_ui_state
        WHERE user_id = $1::uuid
        LIMIT 1
        `,
        [session.user.id],
      );
      const state = result.rows?.[0]?.state ?? {};
      return jsonWithSession(session, {
        completed: readTutorialCompletedFromState(state, stateKey),
      });
    } finally {
      client.release();
    }
  } catch {
    return jsonWithSession(
      session,
      { error: "No se pudo consultar el estado del tutorial." },
      500,
    );
  }
}

export async function POST(request: Request) {
  const stateKey = parseTutorialKey(request);
  if (!stateKey) {
    return NextResponse.json(
      { error: "Clave de tutorial invalida." },
      { status: 400, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  if (!(await verifyCsrf(request))) {
    return jsonWithSession(session, { error: "CSRF invalido." }, 403);
  }

  try {
    await ensureUiStateTable();
    const client = await (await getDbPool()).connect();
    try {
      await client.query(
        `
        INSERT INTO app_user_ui_state (user_id, state, updated_at)
        VALUES (
          $1::uuid,
          jsonb_build_object($2::text, true),
          now()
        )
        ON CONFLICT (user_id) DO UPDATE SET
          state = app_user_ui_state.state || jsonb_build_object($2::text, true),
          updated_at = now()
        `,
        [session.user.id, stateKey],
      );
      return jsonWithSession(session, { ok: true, completed: true });
    } finally {
      client.release();
    }
  } catch {
    return jsonWithSession(
      session,
      { error: "No se pudo guardar el estado del tutorial." },
      500,
    );
  }
}
