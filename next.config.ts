import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const enableReactCompiler = process.env.NEXT_ENABLE_REACT_COMPILER === "true";

const enableUpgradeInsecure =
  process.env.UPGRADE_INSECURE_REQUESTS === "true";
const allowUnsafeEval = process.env.CSP_UNSAFE_EVAL === "true";
const allowedDevOrigins = (
  process.env.ALLOWED_DEV_ORIGINS ??
  "192.168.80.173"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev || allowUnsafeEval ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  isDev ? "connect-src 'self' ws: wss: http: https:" : "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  // Solo aplicar upgrade-insecure-requests cuando hay HTTPS real
  ...(enableUpgradeInsecure ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
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
    value: isDev ? "unsafe-none" : "same-origin",
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
  reactCompiler: enableReactCompiler,
  poweredByHeader: false,
  allowedDevOrigins,
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

