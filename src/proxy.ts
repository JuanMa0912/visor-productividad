import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isExcelDianExportPublic } from "@/lib/excel-dian/public-export-env";

/** Misma cookie que `SESSION_COOKIE` en `@/lib/auth` (no importar auth aqui). */
const SESSION_COOKIE = "vp_session";

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
  if (pathname.startsWith("/api/")) return NextResponse.next();
  // public/logos/ (login y cabeceras); sin esto el proxy redirige a /login sin sesion.
  if (pathname.startsWith("/logos/")) return NextResponse.next();

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
