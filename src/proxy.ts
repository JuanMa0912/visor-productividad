import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Misma cookie que `SESSION_COOKIE` en `@/lib/auth` (no importar auth aquí). */
const SESSION_COOKIE = "vp_session";

const isPublicPagePath = (pathname: string) => {
  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  if (pathname === "/ExcelDian" || pathname.startsWith("/ExcelDian/")) return true;
  return false;
};

const isLikelyStaticAsset = (pathname: string) =>
  /\.(?:ico|png|jpe?g|webp|svg|gif|woff2?|ttf|eot|txt|json|map|xml|webmanifest)$/i.test(
    pathname,
  );

/**
 * Protege el portal UAID en el borde: sin cookie de sesión solo se permite
 * iniciar sesión y el tablero público Excel DIAN. Las rutas `/api/*` no se
 * redirigen aquí (cada endpoint sigue usando su propia validación).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/_next")) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.next();
  if (isLikelyStaticAsset(pathname)) return NextResponse.next();

  if (isPublicPagePath(pathname)) return NextResponse.next();

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (!hasSession) {
    const login = new URL("/login", request.url);
    login.searchParams.set("from", pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/webpack-hmr|_next/data).*)",
  ],
};
