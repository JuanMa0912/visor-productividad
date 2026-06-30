import { isLocalPortalMigrationNoticeEnabled } from "@/lib/shared/local-portal-notices";
import { LocalMigrationNoticeBanner } from "@/components/portal/local-migration-notice-banner";

/** Renderiza el aviso solo en `npm run dev` con la variable local activada. */
export function LocalMigrationNotice() {
  if (!isLocalPortalMigrationNoticeEnabled()) return null;
  return <LocalMigrationNoticeBanner />;
}
