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
 * Cierre definitivo del portal local (sin login). Activar en ServPruebas / PC
 * tras migrar usuarios a la nube. En GCP usar `VISOR_DEPLOYMENT=gcp` y no
 * definir `LOCAL_PORTAL_CLOSED`.
 */
export const isLocalPortalClosed = (): boolean => {
  if (!isTruthyEnv(resolveEnvValue("LOCAL_PORTAL_CLOSED"))) {
    return false;
  }
  return !isGcpDeployment();
};

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
  if (isLocalPortalClosed()) return false;
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
