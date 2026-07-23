import { NextResponse } from "next/server";
import {
  applySessionCookies,
  requireAdminSession,
  verifyCsrf,
} from "@/lib/auth";
import {
  clearCachedQueries,
  getCachedQueryStats,
} from "@/lib/margenes/query-cache";
import { resetMargenDataSourceCache } from "@/lib/margenes/margen-data-source";
import { checkRateLimit } from "@/lib/shared/rate-limit";

/**
 * POST /api/admin/cache/flush
 * Vacia la cache en memoria del proceso (informe variación + márgenes)
 * y el flag de disponibilidad de margen_final_roll / item_dia_roll.
 * No limpia sessionStorage de los browsers de los usuarios.
 */
export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const withSession = (response: NextResponse) =>
    applySessionCookies(response, session);

  const limitedUntil = checkRateLimit(req, {
    windowMs: 60_000,
    max: 20,
    keyPrefix: "admin-cache-flush",
  });
  if (limitedUntil) {
    const retryAfterSeconds = Math.ceil((limitedUntil - Date.now()) / 1000);
    return withSession(
      NextResponse.json(
        { error: "Demasiadas solicitudes." },
        { status: 429, headers: { "Retry-After": retryAfterSeconds.toString() } },
      ),
    );
  }

  if (!(await verifyCsrf(req))) {
    return withSession(
      NextResponse.json({ error: "CSRF inválido." }, { status: 403 }),
    );
  }

  const before = getCachedQueryStats();
  const { cleared } = clearCachedQueries();
  resetMargenDataSourceCache();
  const after = getCachedQueryStats();

  return withSession(
    NextResponse.json({
      ok: true,
      cleared,
      before,
      after,
      note: "Cache en memoria del proceso vaciada (queries + fuente roll). sessionStorage de clientes no se afecta; use bump de prefijo o hard refresh.",
    }),
  );
}

export async function GET() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  return applySessionCookies(
    NextResponse.json({
      ok: true,
      ...getCachedQueryStats(),
    }),
    session,
  );
}
