import { NextResponse } from "next/server";
import { applySessionCookies, requireAdminSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { checkRateLimit } from "@/lib/shared/rate-limit";

export type FailedLoginRow = {
  id: number;
  username: string;
  userId: string | null;
  failureReason: string;
  loggedAt: string;
  ip: string | null;
  userAgent: string | null;
};

export type FailedLoginListResponse = {
  rows: FailedLoginRow[];
  generatedAt: string;
};

const toIso = (value: Date | string | null): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
};

export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const withSession = (response: NextResponse) =>
    applySessionCookies(response, session);

  const limitedUntil = checkRateLimit(req, {
    windowMs: 60_000,
    max: 60,
    keyPrefix: "admin-login-failures-get",
  });
  if (limitedUntil) {
    return withSession(
      NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 }),
    );
  }

  const url = new URL(req.url);
  const username = url.searchParams.get("user")?.trim().toLowerCase() || null;
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw)
    ? Math.min(200, Math.max(1, Math.trunc(limitRaw)))
    : 50;

  const client = await (await getDbPool()).connect();
  try {
    const result = username
      ? await client.query(
          `
          SELECT
            id,
            username,
            user_id AS "userId",
            failure_reason AS "failureReason",
            logged_at AS "loggedAt",
            ip,
            user_agent AS "userAgent"
          FROM app_user_login_attempt_log
          WHERE lower(username) = $1
          ORDER BY logged_at DESC
          LIMIT $2
          `,
          [username, limit],
        )
      : await client.query(
          `
          SELECT
            id,
            username,
            user_id AS "userId",
            failure_reason AS "failureReason",
            logged_at AS "loggedAt",
            ip,
            user_agent AS "userAgent"
          FROM app_user_login_attempt_log
          ORDER BY logged_at DESC
          LIMIT $1
          `,
          [limit],
        );

    const rows: FailedLoginRow[] = (result.rows ?? []).map((row) => ({
      id: Number(row.id),
      username: String(row.username ?? ""),
      userId: row.userId ?? null,
      failureReason: String(row.failureReason ?? "other"),
      loggedAt: toIso(row.loggedAt) ?? new Date().toISOString(),
      ip: row.ip ?? null,
      userAgent: row.userAgent ?? null,
    }));

    return withSession(
      NextResponse.json({
        rows,
        generatedAt: new Date().toISOString(),
      } satisfies FailedLoginListResponse),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /app_user_login_attempt_log/i.test(message) &&
      /does not exist|no existe/i.test(message)
    ) {
      return withSession(
        NextResponse.json(
          {
            error:
              "Falta aplicar db/migrations/20260715_user_audit_trail.sql",
            rows: [],
            generatedAt: new Date().toISOString(),
          },
          { status: 503 },
        ),
      );
    }
    console.error("[admin/login-failures]", error);
    return withSession(
      NextResponse.json(
        { error: "No se pudieron cargar los fallos de login." },
        { status: 500 },
      ),
    );
  } finally {
    client.release();
  }
}
