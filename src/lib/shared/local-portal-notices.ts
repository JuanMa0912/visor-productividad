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

/**
 * Aviso de migración de acceso al portal.
 * Activar en `.env.local` de ServPruebas / PC con `npm run build` + PM2 o `npm start`.
 * En GCP usar `VISOR_DEPLOYMENT=gcp` y no definir `LOCAL_PORTAL_MIGRATION_NOTICE`.
 */
export const isLocalPortalMigrationNoticeEnabled = (): boolean => {
  if (!isTruthyEnv(resolveEnvValue("LOCAL_PORTAL_MIGRATION_NOTICE"))) {
    return false;
  }
  return !isGcpDeployment();
};

if (
  typeof process !== "undefined" &&
  isGcpDeployment() &&
  isTruthyEnv(resolveEnvValue("LOCAL_PORTAL_MIGRATION_NOTICE"))
) {
  console.warn(
    "[local-notice] LOCAL_PORTAL_MIGRATION_NOTICE ignorada (VISOR_DEPLOYMENT=gcp).",
  );
}
