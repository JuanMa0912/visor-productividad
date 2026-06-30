import { isLocalPortalMigrationNoticeEnabled } from "@/lib/shared/local-portal-notices";
import { LocalMigrationNoticeBanner } from "@/components/portal/local-migration-notice-banner";

/** Renderiza el aviso solo con `LOCAL_PORTAL_MIGRATION_NOTICE` en el entorno local (no GCP). */
export function LocalMigrationNotice() {
  if (!isLocalPortalMigrationNoticeEnabled()) return null;
  return <LocalMigrationNoticeBanner />;
}
