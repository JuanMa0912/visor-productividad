import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/shared/portal-sections";
import { parseKardexFilters } from "@/features/kardex/schema";

export const K_CACHE_CONTROL = "no-store";

export const requireKardexSession = async () => {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": K_CACHE_CONTROL } },
    );
  }
  if (
    !canAccessPortalSection(session.user.allowedDashboards, "producto") ||
    !canAccessPortalSubsection(session.user.allowedSubdashboards, "rotacion")
  ) {
    return NextResponse.json(
      { error: "No autorizado para consultar kardex." },
      { status: 403, headers: { "Cache-Control": K_CACHE_CONTROL } },
    );
  }
  return session;
};

export const withSessionCookie = <T extends NextResponse>(
  response: T,
  sessionToken: string,
) => {
  response.cookies.set("vp_session", sessionToken, getSessionCookieOptions());
  return response;
};

export const parseFiltersFromRequest = (request: Request) => {
  const { searchParams } = new URL(request.url);
  return parseKardexFilters(searchParams);
};
