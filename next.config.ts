/*  */import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const enableReactCompiler = process.env.NEXT_ENABLE_REACT_COMPILER === "true";
const standaloneBuild = process.env.NEXT_BUILD_STANDALONE === "1";
const skipTypecheckInBuild = process.env.NEXT_BUILD_SKIP_TYPECHECK === "1";

// Cross-Origin-Opener-Policy requiere HTTPS (o localhost). Si el despliegue
// corre por HTTP plano, `same-origin` se ignora con un warning en consola.
// Set `COOP_DISABLED=true` para servir el valor permisivo (`unsafe-none`) y
// evitar el ruido. Recomendado solo mientras no haya HTTPS configurado.
const coopDisabled = process.env.COOP_DISABLED === "true";
const allowedDevOrigins = (
  process.env.ALLOWED_DEV_ORIGINS ??
  "192.168.80.173"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Construye el CSP estatico. Mantenemos `'unsafe-inline'` en `script-src`
// porque Next.js 16 (App Router) emite scripts inline de hidratacion/RSC
// que no podemos firmar con un hash estable. Se intento migrar a nonce
// dinamico via `src/proxy.ts`, pero el framework no auto-inyecto el nonce
// en sus propios scripts y se rompio la hidratacion en produccion.
// `connect-src` permite `https:` y `wss:` para `data:` / heartbeats y
// para el HMR de turbopack en dev (en prod basta con `self`).
const upgradeInsecure =
  process.env.UPGRADE_INSECURE_REQUESTS === "true" ? "; upgrade-insecure-requests" : "";

const cspValue = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  isDev ? "connect-src 'self' ws: wss: http: https:" : "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ") + upgradeInsecure;

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: cspValue,
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: isDev || coopDisabled ? "unsafe-none" : "same-origin",
  },
  {
    key: "Cross-Origin-Resource-Policy",
    value: isDev ? "cross-origin" : "same-origin",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  ...(standaloneBuild ? { output: "standalone" } : {}),
  typescript: {
    ignoreBuildErrors: skipTypecheckInBuild,
  },
  reactCompiler: enableReactCompiler,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  serverExternalPackages: ["@notionhq/client"],
  experimental: {
    // Lower peak memory during webpack; slightly slower compile (Next 15+).
    webpackMemoryOptimizations: true,
    serverSourceMaps: false,
  },
  allowedDevOrigins,
  // Silencia logs de incoming requests muy ruidosos en consola de dev.
  // Solo afecta `npm run dev`; no impacta produccion.
  // - auth/heartbeat y auth/me se ejecutan en bucle (polling de sesion)
  // - inventario-x-item, ventas-x-item y rotacion mandan TODAS las sedes/lineas/items
  //   por query string y generan URLs de varios miles de chars
  logging: {
    incomingRequests: {
      ignore: [
        /^\/api\/auth\/(heartbeat|me)$/,
        /^\/api\/inventario-x-item/,
        /^\/api\/ventas-x-item/,
        /^\/api\/rotacion/,
      ],
    },
  },
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
