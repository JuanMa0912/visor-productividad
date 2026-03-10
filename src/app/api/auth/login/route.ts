import { NextResponse } from "next/server";
import {
  createSession,
  getClientIp,
  getSessionCookieOptions,
  verifyPassword,
} from "@/lib/auth";
import { getDbPool } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { username?: string; password?: string };
    const username = body.username?.trim();
    const password = body.password ?? "";

    if (!username || !password) {
      return NextResponse.json(
        { error: "Usuario y contraseña son obligatorios." },
        { status: 400 },
      );
    }

    const client = await (await getDbPool()).connect();
    try {
      const result = await client.query(
        `
        SELECT
          u.id,
          u.username,
          u.role,
          to_jsonb(u)->>'sede' AS sede,
          to_jsonb(u)->'allowed_sedes' AS "allowedSedes",
          to_jsonb(u)->'allowed_lines' AS "allowedLines",
          to_jsonb(u)->'allowed_dashboards' AS "allowedDashboards",
          to_jsonb(u)->'special_roles' AS "specialRoles",
          u.is_active,
          u.password_hash
        FROM app_users u
        WHERE u.username = $1
        LIMIT 1
        `,
        [username],
      );

      if (!result.rows || result.rows.length === 0) {
        return NextResponse.json(
          { error: "Credenciales inválidas." },
          { status: 401 },
        );
      }

      const user = result.rows[0] as {
        id: string;
        username: string;
        role: "admin" | "user";
        sede: string | null;
        allowedSedes: string[] | null;
        allowedLines: string[] | null;
        allowedDashboards: string[] | null;
        specialRoles: string[] | null;
        is_active: boolean;
        password_hash: string;
      };

      if (!user.is_active) {
        return NextResponse.json(
          { error: "Cuenta desactivada." },
          { status: 403 },
        );
      }

      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) {
        return NextResponse.json(
          { error: "Credenciales inválidas." },
          { status: 401 },
        );
      }

      const ip = getClientIp(req);
      const userAgent = req.headers.get("user-agent");
      const session = await createSession(user.id, ip, userAgent);

      await client.query(
        `
        INSERT INTO app_user_login_logs (user_id, ip, user_agent)
        VALUES ($1, $2, $3)
        `,
        [user.id, ip, userAgent],
      );

      await client.query(
        `
        UPDATE app_users
        SET last_login_at = now(), last_login_ip = $2, updated_at = now()
        WHERE id = $1
        `,
        [user.id, ip],
      );

      const response = NextResponse.json({
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          sede: user.sede,
          allowedSedes: user.allowedSedes,
          allowedLines: user.allowedLines,
          allowedDashboards: user.allowedDashboards,
          specialRoles: user.specialRoles,
        },
      });
      response.cookies.set(
        "vp_session",
        session.token,
        getSessionCookieOptions(session.expiresAt),
      );
      return response;
    } finally {
      client.release();
    }
  } catch (error) {
    return NextResponse.json(
      { error: "No se pudo iniciar sesión." },
      { status: 500 },
    );
  }
}

