import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import {
  getSessionCookieOptions,
  hashPassword,
  requireAuthSession,
  verifyPassword,
} from "@/lib/auth";

export async function POST(req: Request) {
  const session = await requireAuthSession();
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

  const body = (await req.json()) as {
    currentPassword?: string;
    newPassword?: string;
  };

  const currentPassword = body.currentPassword ?? "";
  const newPassword = body.newPassword ?? "";

  if (!currentPassword || !newPassword) {
    return withSession(
      NextResponse.json(
        { error: "Debes enviar contraseña actual y nueva contraseña." },
        { status: 400 },
      ),
    );
  }

  if (newPassword.length < 8) {
    return withSession(
      NextResponse.json(
        { error: "La nueva contraseña debe tener mínimo 8 caracteres." },
        { status: 400 },
      ),
    );
  }

  const client = await (await getDbPool()).connect();
  try {
    const userResult = await client.query(
      `
      SELECT password_hash
      FROM app_users
      WHERE id = $1
      LIMIT 1
      `,
      [session.user.id],
    );

    const user = userResult.rows?.[0] as { password_hash?: string } | undefined;
    if (!user?.password_hash) {
      return withSession(
        NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 }),
      );
    }

    const validCurrent = await verifyPassword(currentPassword, user.password_hash);
    if (!validCurrent) {
      return withSession(
        NextResponse.json(
          { error: "La contraseña actual no es correcta." },
          { status: 401 },
        ),
      );
    }

    const sameAsCurrent = await verifyPassword(newPassword, user.password_hash);
    if (sameAsCurrent) {
      return withSession(
        NextResponse.json(
          { error: "La nueva contraseña debe ser diferente a la actual." },
          { status: 400 },
        ),
      );
    }

    const newHash = await hashPassword(newPassword);
    await client.query(
      `
      UPDATE app_users
      SET password_hash = $2, updated_at = now()
      WHERE id = $1
      `,
      [session.user.id, newHash],
    );

    return withSession(NextResponse.json({ ok: true }));
  } catch {
    return withSession(
      NextResponse.json(
        { error: "No se pudo actualizar la contraseña." },
        { status: 500 },
      ),
    );
  } finally {
    client.release();
  }
}
