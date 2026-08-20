import { NextResponse } from "next/server";
import { applySessionCookies, requireAuthSession } from "@/lib/auth";
import { withPoolClient } from "@/lib/db";
import { loadPortalFreshness } from "@/lib/shared/portal-freshness";

export const dynamic = "force-dynamic";

const CACHE_CONTROL = "private, no-store";

export async function GET() {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    const freshness = await withPoolClient(
      (client) => loadPortalFreshness(client),
      { statementTimeoutMs: 3_000 },
    );
    const response = NextResponse.json(freshness, {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
    return applySessionCookies(response, session);
  } catch (error) {
    console.error("[portal/freshness]", error);
    const response = NextResponse.json(
      { updatedAt: null, sources: [] },
      { headers: { "Cache-Control": CACHE_CONTROL } },
    );
    return applySessionCookies(response, session);
  }
}
