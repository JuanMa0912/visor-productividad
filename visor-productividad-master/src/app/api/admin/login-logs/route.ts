import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { getSessionCookieOptions, requireAdminSession } from "@/lib/auth";

export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const withSession = (response: NextResponse) => {
    response.cookies.set(
      "vp_session",
      session.token,
      getSessionCookieOptions(session.expiresAt),
    );
    return response;
  };

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 20), 100);

  const client = await (await getDbPool()).connect();
  try {
    const result = await client.query(
      `
      SELECT l.id, l.logged_at, l.ip, l.user_agent, u.id as user_id, u.username
      FROM app_user_login_logs l
      JOIN app_users u ON u.id = l.user_id
      ORDER BY l.logged_at DESC
      LIMIT $1
      `,
      [limit],
    );
    return withSession(NextResponse.json({ logs: result.rows ?? [] }));
  } finally {
    client.release();
  }
}

export async function DELETE() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const withSession = (response: NextResponse) => {
    response.cookies.set(
      "vp_session",
      session.token,
      getSessionCookieOptions(session.expiresAt),
    );
    return response;
  };

  const client = await (await getDbPool()).connect();
  try {
    const result = await client.query("DELETE FROM app_user_login_logs");
    return withSession(NextResponse.json({ deleted: result.rowCount ?? 0 }));
  } finally {
    client.release();
  }
}
