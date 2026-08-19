import { NextResponse } from "next/server";
import {
  applySessionCookies,
  extendSessionOnActivity,
  getUserSession,
} from "@/lib/auth";

/**
 * Renueva la sesion y las metricas de uso solo cuando el cliente reporta
 * actividad real (clic, teclado, scroll, navegacion). No se llama en idle.
 */
export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let path: string | null = null;
  try {
    const body = (await request.json().catch(() => null)) as
      | { path?: unknown }
      | null;
    if (body && typeof body.path === "string") {
      path = body.path;
    }
  } catch {
    path = null;
  }

  const expiresAt = await extendSessionOnActivity(session.token, path);
  const response = NextResponse.json({ ok: true });
  return applySessionCookies(response, { ...session, expiresAt });
}
