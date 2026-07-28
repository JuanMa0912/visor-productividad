import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isExcelDianPublicAccess } from "@/lib/excel-dian/public-export-env";
import {
  isExcelDianApiPath,
  isExcelDianAuthApiPath,
  isExcelDianPagePath,
  isLocalPortalClosed,
  isLocalPortalExcelDianBypass,
  isLocalPortalExcelDianOnly,
} from "@/lib/shared/local-portal-notices";

/** Misma cookie que `SESSION_COOKIE` en `@/lib/auth` (no importar auth aqui). */
const SESSION_COOKIE = "vp_session";
const CSRF_COOKIE = "vp_csrf";

const clearAuthCookies = (response: NextResponse) => {
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(CSRF_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
};

const isPublicPagePath = (pathname: string) => {
  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  if (
    isExcelDianPublicAccess() &&
    (pathname === "/ExcelDian" || pathname.startsWith("/ExcelDian/"))
  ) {
    return true;
  }
  return false;
};

const isPublicApiPath = (pathname: string) =>
  pathname === "/api/local-portal-migration-notice" ||
  pathname === "/api/health";

/**
 * Proxy global del portal UAID.
 *
 * Responsabilidad: proteger paginas privadas redirigiendo a `/login`
 * cuando no hay cookie de sesion. Las rutas `/api/*` se dejan pasar
 * porque cada endpoint tiene su propia validacion server-side.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/_next")) return NextResponse.next();
  if (pathname.startsWith("/logos/")) return NextResponse.next();

  const portalClosed = isLocalPortalClosed();
  const excelDianOnly = isLocalPortalExcelDianOnly();
  const excelDianBypass = isLocalPortalExcelDianBypass();
  const restricted = portalClosed || excelDianOnly;

  if (restricted) {
    if (pathname.startsWith("/api/")) {
      if (isPublicApiPath(pathname)) return NextResponse.next();
      if (
        excelDianBypass &&
        (isExcelDianApiPath(pathname) || isExcelDianAuthApiPath(pathname))
      ) {
        return NextResponse.next();
      }
      return clearAuthCookies(
        NextResponse.json(
          {
            error:
              "Este portal local fue cerrado. Usa /ExcelDian para informes DIAN o ingresa en https://uaid.mercamio.com.co",
          },
          { status: 503 },
        ),
      );
    }

    if (excelDianBypass && isExcelDianPagePath(pathname)) {
      return NextResponse.next();
    }

    if (pathname === "/login" || pathname.startsWith("/login/")) {
      return NextResponse.next();
    }

    if (excelDianBypass) {
      return NextResponse.redirect(new URL("/ExcelDian", request.url));
    }

    const login = new URL("/login", request.url);
    return clearAuthCookies(NextResponse.redirect(login));
  }

  if (pathname.startsWith("/api/")) return NextResponse.next();

  if (isPublicPagePath(pathname)) return NextResponse.next();

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (!hasSession) {
    const login = new URL("/login", request.url);
    const returnPath = pathname === "/" ? "/secciones" : pathname;
    login.searchParams.set("from", returnPath);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/webpack-hmr|_next/data|logos/).*)",
  ],
};
