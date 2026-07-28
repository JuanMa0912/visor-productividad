import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const isTruthyEnv = (value: string | undefined): boolean => {
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
};

const parseEnvValue = (raw: string): string => {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
};

/** Lee una clave de process.env y, si falta, del `.env.local` en disco (runtime PM2). */
const resolveEnvValue = (key: string): string | undefined => {
  const fromProcess = process.env[key]?.trim();
  const envPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) {
    return fromProcess && fromProcess.length > 0 ? fromProcess : undefined;
  }

  let fromFile: string | undefined;
  for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const envKey = trimmed.slice(0, eq).trim();
    if (envKey !== key) continue;
    fromFile = parseEnvValue(trimmed.slice(eq + 1));
    break;
  }

  if (fromFile && fromFile.length > 0) return fromFile;
  return fromProcess && fromProcess.length > 0 ? fromProcess : undefined;
};

const isGcpDeployment = (): boolean =>
  resolveEnvValue("VISOR_DEPLOYMENT")?.trim().toLowerCase() === "gcp";

export const DEFAULT_LOCAL_PORTAL_CLOUD_URL = "https://uaid.mercamio.com.co";

/**
 * Cierre del portal local general (resto de modulos). Con esta flag activa,
 * login y `/ExcelDian` siguen operativos (bases DIAN no van a GCP).
 * En GCP usar `VISOR_DEPLOYMENT=gcp` y no definir `LOCAL_PORTAL_CLOSED`.
 */
export const isLocalPortalClosed = (): boolean => {
  if (!isTruthyEnv(resolveEnvValue("LOCAL_PORTAL_CLOSED"))) {
    return false;
  }
  return !isGcpDeployment();
};

/**
 * Modo reducido en el server local (192.168.35.232): solo login + `/ExcelDian`.
 * Opcional si el portal sigue abierto pero quieres ocultar el resto de modulos.
 */
export const isLocalPortalExcelDianOnly = (): boolean => {
  if (isGcpDeployment()) return false;
  return isTruthyEnv(resolveEnvValue("LOCAL_PORTAL_EXCEL_DIAN_ONLY"));
};

/**
 * Portal restringido pero Excel DIAN sigue operativo (bases DIAN no van a GCP).
 * Activo con `LOCAL_PORTAL_CLOSED=true` automaticamente, sin flags extra.
 */
export const isLocalPortalExcelDianBypass = (): boolean => {
  if (isGcpDeployment()) return false;
  return isLocalPortalClosed() || isLocalPortalExcelDianOnly();
};

export const isExcelDianPagePath = (pathname: string): boolean =>
  pathname === "/ExcelDian" || pathname.startsWith("/ExcelDian/");

export const isExcelDianApiPath = (pathname: string): boolean =>
  pathname === "/api/excel-dian/export" ||
  pathname.startsWith("/api/excel-dian/");

/** APIs minimas para sesion en modo Excel DIAN local. */
export const isExcelDianAuthApiPath = (pathname: string): boolean =>
  pathname === "/api/auth/login" ||
  pathname === "/api/auth/me" ||
  pathname === "/api/auth/logout" ||
  pathname === "/api/auth/heartbeat";

export const isLocalPortalRestricted = (): boolean =>
  isLocalPortalClosed() || isLocalPortalExcelDianOnly();

/** URL del portal en la nube para redirigir desde el entorno local cerrado. */
export const getLocalPortalCloudUrl = (): string => {
  const raw = resolveEnvValue("LOCAL_PORTAL_CLOUD_URL")?.trim();
  if (!raw) return DEFAULT_LOCAL_PORTAL_CLOUD_URL;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return DEFAULT_LOCAL_PORTAL_CLOUD_URL;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_LOCAL_PORTAL_CLOUD_URL;
  }
};

/**
 * Aviso de migración de acceso al portal.
 * Activar en `.env.local` de ServPruebas / PC con `npm run build` + PM2 o `npm start`.
 * En GCP usar `VISOR_DEPLOYMENT=gcp` y no definir `LOCAL_PORTAL_MIGRATION_NOTICE`.
 */
export const isLocalPortalMigrationNoticeEnabled = (): boolean => {
  if (isLocalPortalRestricted()) return false;
  if (!isTruthyEnv(resolveEnvValue("LOCAL_PORTAL_MIGRATION_NOTICE"))) {
    return false;
  }
  return !isGcpDeployment();
};

if (
  typeof process !== "undefined" &&
  isGcpDeployment() &&
  isTruthyEnv(resolveEnvValue("LOCAL_PORTAL_CLOSED"))
) {
  console.warn(
    "[local-notice] LOCAL_PORTAL_CLOSED ignorada (VISOR_DEPLOYMENT=gcp).",
  );
}

if (
  typeof process !== "undefined" &&
  isGcpDeployment() &&
  isTruthyEnv(resolveEnvValue("LOCAL_PORTAL_MIGRATION_NOTICE"))
) {
  console.warn(
    "[local-notice] LOCAL_PORTAL_MIGRATION_NOTICE ignorada (VISOR_DEPLOYMENT=gcp).",
  );
}

if (
  typeof process !== "undefined" &&
  isGcpDeployment() &&
  isTruthyEnv(resolveEnvValue("LOCAL_PORTAL_EXCEL_DIAN_ONLY"))
) {
  console.warn(
    "[local-notice] LOCAL_PORTAL_EXCEL_DIAN_ONLY ignorada (VISOR_DEPLOYMENT=gcp). Excel DIAN vive solo en el server local.",
  );
}
