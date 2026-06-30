const readMigrationNoticeFlag = (): string | undefined =>
  process.env.NEXT_PUBLIC_LOCAL_PORTAL_MIGRATION_NOTICE?.trim().toLowerCase();

const isTruthyEnv = (value: string | undefined): boolean =>
  value === "true" || value === "1" || value === "yes";

/**
 * Aviso de migración de acceso al portal.
 * Solo debe activarse en `.env.local` del entorno de desarrollo en tu PC.
 * Nunca configurar en GCP: en producción la bandera se ignora aunque exista.
 */
export const isLocalPortalMigrationNoticeEnabled = (): boolean => {
  const flag = readMigrationNoticeFlag();
  if (!isTruthyEnv(flag)) return false;
  return process.env.NODE_ENV === "development";
};

if (
  typeof process !== "undefined" &&
  process.env.NODE_ENV === "production" &&
  isTruthyEnv(readMigrationNoticeFlag())
) {
  console.warn(
    "[local-notice] NEXT_PUBLIC_LOCAL_PORTAL_MIGRATION_NOTICE está definida pero se ignora en producción (p. ej. GCP). No mostrar este aviso en servidores.",
  );
}
