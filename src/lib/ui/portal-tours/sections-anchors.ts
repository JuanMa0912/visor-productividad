import type { PortalSectionId } from "@/lib/shared/portal-sections";

const PREFIX = "portal-sections-tour";

export const PORTAL_SECTIONS_TOUR_ANCHOR = {
  intro: `${PREFIX}-intro`,
  grid: `${PREFIX}-grid`,
  card: (sectionId: PortalSectionId) => `${PREFIX}-card-${sectionId}`,
} as const;

export const portalSectionsTourSelector = (id: string): string => `#${id}`;
