import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isExcelDianExportPublic } from "@/lib/excel-dian/public-export-env";

/** Misma cookie que `SESSION_COOKIE` en `@/lib/auth` (no importar auth aqui). */
const SESSION_COOKIE = "vp_session";

const isDev = process.env.NODE_ENV !== "production";
const allowUnsafeEval =
  isDev || process.env.CSP_UNSAFE_EVAL === "true";
const enableUpgradeInsecure =
  process.env.UPGRADE_INSECURE_REQUESTS === "true";

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

const isLikelyStaticAsset = (pathname: string) =>
  /\.(?:ico|png|jpe?g|webp|svg|gif|woff2?|ttf|eot|txt|json|map|xml|webmanifest)$/i.test(
    pathname,
  );

/**
 * Decide si una request debe recibir CSP. Excluimos rutas internas de Next,
 * APIs (devuelven JSON, no HTML) y assets binarios. El navegador solo aplica
 * CSP a respuestas HTML; ponerla en JSON/assets solo aniade overhead.
 */
const shouldApplyCsp = (pathname: string) => {
  if (pathname.startsWith("/_next")) return false;
  if (pathname.startsWith("/api/")) return false;
  if (isLikelyStaticAsset(pathname)) return false;
  return true;
};

/**
 * Genera 128 bits aleatorios serializados en base64. Suficiente entropia para
 * que el nonce sea impredecible por request y un atacante no pueda precomputar
 * scripts inline aceptados por la CSP.
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Construye la Content-Security-Policy con el nonce dinamico.
 *
 *   - `'strict-dynamic'` permite que los scripts con nonce carguen otros
 *     scripts (necesario para que Next.js complete la hidratacion).
 *   - `'unsafe-eval'` queda opt-in via `CSP_UNSAFE_EVAL=true` por si alguna
 *     libreria third-party lo requiere. Eliminarlo da el maximo score.
 *   - `style-src 'unsafe-inline'` se mantiene porque Tailwind y `<style jsx>`
 *     emiten estilos inline; estos son mucho menos peligrosos que scripts
 *     inline (los estilos no ejecutan codigo).
 */
function buildCsp(nonce: string): string {
  const scriptSrcParts = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    allowUnsafeEval ? "'unsafe-eval'" : "",
  ].filter(Boolean);

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrcParts.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    isDev
      ? "connect-src 'self' ws: wss: http: https:"
      : "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(enableUpgradeInsecure ? ["upgrade-insecure-requests"] : []),
  ];

  return directives.join("; ").replace(/\s{2,}/g, " ").trim();
}

/**
 * Aplica el header CSP a una response existente sin perder los headers
 * que NextResponse hubiera seteado por su cuenta (cookies, status, etc).
 */
function attachCsp(response: NextResponse, csp: string) {
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

/**
 * Proxy global del portal UAID.
 *
 * Responsabilidades:
 *   1. Generar un `nonce` por request y construir/aplicar la CSP dinamica.
 *      Esto reemplaza al `unsafe-inline` de `script-src` con un nonce
 *      criptograficamente unico, mitigando XSS sin romper la hidratacion.
 *   2. Proteger las paginas privadas: sin cookie de sesion se redirige a
 *      `/login`. Las rutas `/api/*` se dejan pasar porque cada endpoint
 *      tiene su propia validacion server-side.
 *
 * Orden importante: primero calculamos la CSP, luego decidimos la auth y
 * adjuntamos la CSP a la response que termine devolviendo (next o redirect).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Para rutas sin CSP (assets, APIs, _next), conservamos exactamente el
  // comportamiento previo del proxy original (solo auth, sin headers extra).
  const applyCsp = shouldApplyCsp(pathname);
  const nonce = applyCsp ? generateNonce() : "";
  const csp = applyCsp ? buildCsp(nonce) : "";

  // Pase libre para rutas internas de Next y APIs (mantenemos chequeo
  // explicito para no encadenarlos al flujo de auth/CSP).
  if (pathname.startsWith("/_next")) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.next();
  if (isLikelyStaticAsset(pathname)) return NextResponse.next();

  // Propagamos el nonce al request via `x-nonce` para que Next.js lo aplique
  // automaticamente a sus scripts framework y para que cualquier Server
  // Component pueda leerlo con `headers().get("x-nonce")`.
  const requestHeaders = new Headers(request.headers);
  if (applyCsp) {
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
  }

  // Pagina publica: dejamos pasar con la CSP aplicada en la response.
  if (isPublicPagePath(pathname)) {
    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });
    return applyCsp ? attachCsp(response, csp) : response;
  }

  // Pagina privada sin sesion -> redirect a /login. No aplicamos CSP a la
  // redireccion porque el navegador no renderiza HTML de un 307.
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (!hasSession) {
    const login = new URL("/login", request.url);
    login.searchParams.set("from", pathname);
    return NextResponse.redirect(login);
  }

  // Pagina privada autenticada: pase + CSP.
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  return applyCsp ? attachCsp(response, csp) : response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/webpack-hmr|_next/data).*)",
  ],
};
