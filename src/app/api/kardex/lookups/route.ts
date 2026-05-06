import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getSessionCookieOptions } from "@/lib/auth";
import { getKardexLookups } from "@/features/kardex/repo";
import { parseFiltersFromRequest, requireKardexSession, K_CACHE_CONTROL } from "../_shared";

export async function GET(request: Request) {
  const session = await requireKardexSession();
  if (session instanceof NextResponse) return session;

  try {
    const filters = parseFiltersFromRequest(request);
    const lookups = await getKardexLookups(filters);
    const response = NextResponse.json(lookups, {
      headers: { "Cache-Control": K_CACHE_CONTROL },
    });
    response.cookies.set("vp_session", session.token, getSessionCookieOptions(session.expiresAt));
    return response;
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Filtros invalidos.", details: error.issues },
        { status: 400, headers: { "Cache-Control": K_CACHE_CONTROL } },
      );
    }
    console.error("[kardex][lookups] error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Error interno consultando lookups de kardex." },
      { status: 500, headers: { "Cache-Control": K_CACHE_CONTROL } },
    );
  }
}
