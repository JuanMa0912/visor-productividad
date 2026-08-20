import { NextResponse } from "next/server";
import { applySessionCookies, requireAuthSession } from "@/lib/auth";
import { withPoolClient } from "@/lib/db";
import { loadPortalUpdatedAt } from "@/lib/shared/portal-freshness";

export const dynamic = "force-dynamic";

const CACHE_CONTROL = "private, no-store";

export async function GET() {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    const updatedAt = await withPoolClient(
      (client) => loadPortalUpdatedAt(client),
      { statementTimeoutMs: 3_000 },
    );
    const response = NextResponse.json(
      { updatedAt },
      { headers: { "Cache-Control": CACHE_CONTROL } },
    );
    return applySessionCookies(response, session);
  } catch (error) {
    console.error("[portal/freshness]", error);
    const response = NextResponse.json(
      { updatedAt: null },
      { headers: { "Cache-Control": CACHE_CONTROL } },
    );
    return applySessionCookies(response, session);
  }
}
