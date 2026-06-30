const isTruthyEnv = (value: string | undefined): boolean => {
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
};

const readMigrationNoticeFlag = (): string | undefined =>
  process.env.LOCAL_PORTAL_MIGRATION_NOTICE?.trim().toLowerCase();

/** VM GCP suele ir detrás de proxy con TRUST_PROXY=true; el entorno local no. */
const isLikelyGcpServer = (): boolean =>
  isTruthyEnv(process.env.TRUST_PROXY?.trim().toLowerCase());

/**
 * Aviso de migración de acceso al portal.
 * Activar solo en `.env.local` de tu PC con `npm run build` + `npm start`.
 * Nunca definir en el servidor GCP (ni la variable ni desplegar con ella).
 */
export const isLocalPortalMigrationNoticeEnabled = (): boolean => {
  if (!isTruthyEnv(readMigrationNoticeFlag())) return false;
  return !isLikelyGcpServer();
};

if (
  typeof process !== "undefined" &&
  isLikelyGcpServer() &&
  isTruthyEnv(readMigrationNoticeFlag())
) {
  console.warn(
    "[local-notice] LOCAL_PORTAL_MIGRATION_NOTICE ignorada en servidor GCP (TRUST_PROXY=true). Quita esa variable del .env.local del servidor.",
  );
}
