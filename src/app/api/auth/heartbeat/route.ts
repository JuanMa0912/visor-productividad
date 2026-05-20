import { NextResponse } from "next/server";
import {
  applySessionCookies,
  getUserSession,
  updateSessionLastPath,
} from "@/lib/auth";

/**
 * Refresca la sesion (y de paso last_activity_at + last_path) cuando el cliente
 * reporta actividad reciente. El componente <PresenceHeartbeat /> lo llama
 * mientras la pestana este visible y el usuario haya interactuado en el ultimo
 * minuto, enviando { path: window.location.pathname } en el body.
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
  if (path) {
    try {
      await updateSessionLastPath(path);
    } catch (error) {
      console.warn("[heartbeat] no se pudo guardar last_path", error);
    }
  }

  const response = NextResponse.json({ ok: true });
  return applySessionCookies(response, session);
}
