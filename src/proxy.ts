import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isExcelDianExportPublic } from "@/lib/excel-dian/public-export-env";
import {
  isExcelDianApiPath,
  isExcelDianAuthApiPath,
  isExcelDianPagePath,
  isLocalPortalClosed,
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
    isExcelDianExportPublic() &&
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
 *
 * Nota: la `Content-Security-Policy` se sirve estaticamente desde
 * `next.config.ts`. Se intento mover a CSP con nonce dinamico, pero
 * Next.js 16 no esta auto-inyectando el nonce en los scripts framework
 * (rompe la hidratacion en produccion). Se documenta para revisitar.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Pase libre para rutas internas de Next, APIs y assets.
  if (pathname.startsWith("/_next")) return NextResponse.next();
  if (pathname.startsWith("/logos/")) return NextResponse.next();

  const excelDianOnly = isLocalPortalExcelDianOnly();
  const portalClosed = isLocalPortalClosed();

  if (portalClosed || excelDianOnly) {
    if (pathname.startsWith("/api/")) {
      if (isPublicApiPath(pathname)) return NextResponse.next();
      if (
        excelDianOnly &&
        (isExcelDianApiPath(pathname) || isExcelDianAuthApiPath(pathname))
      ) {
        return NextResponse.next();
      }
      return clearAuthCookies(
        NextResponse.json(
          {
            error: excelDianOnly
              ? "Este servidor local solo expone Excel DIAN. Usa https://uaid.mercamio.com.co para el resto del portal."
              : "Este portal local fue cerrado. Ingresa en https://uaid.mercamio.com.co",
          },
          { status: 503 },
        ),
      );
    }

    if (excelDianOnly && isExcelDianPagePath(pathname)) {
      return NextResponse.next();
    }

    if (pathname === "/login" || pathname.startsWith("/login/")) {
      if (portalClosed && !excelDianOnly) {
        const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
        if (!hasSession) return NextResponse.next();
        return clearAuthCookies(NextResponse.next());
      }
      return NextResponse.next();
    }

    if (portalClosed && !excelDianOnly && isPublicPagePath(pathname)) {
      const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
      if (!hasSession) return NextResponse.next();
      return clearAuthCookies(NextResponse.next());
    }

    const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
    if (excelDianOnly) {
      if (hasSession) {
        return NextResponse.redirect(new URL("/ExcelDian", request.url));
      }
      const login = new URL("/login", request.url);
      login.searchParams.set("from", "/ExcelDian");
      return NextResponse.redirect(login);
    }

    const login = new URL("/login", request.url);
    return clearAuthCookies(NextResponse.redirect(login));
  }

  if (pathname.startsWith("/api/")) return NextResponse.next();

  // Pagina publica: dejamos pasar sin chequeo de cookie.
  if (isPublicPagePath(pathname)) return NextResponse.next();

  // Pagina privada sin sesion -> redirect a /login.
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (!hasSession) {
    const login = new URL("/login", request.url);
    // La raiz `/` es un modulo concreto; el destino post-login del portal es `/secciones`.
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
