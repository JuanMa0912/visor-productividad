/** IDs de ancla del tutorial; deben existir en el DOM cuando el paso aplica. */
export const MARGENES_TOUR_ANCHOR = {
  intro: "margenes-tour-intro",
  filters: "margenes-tour-filters",
  tabs: "margenes-tour-tabs",
  kpi: "margenes-tour-kpi",
  main: "margenes-tour-main",
} as const;

export type MargenesTourAnchorId =
  (typeof MARGENES_TOUR_ANCHOR)[keyof typeof MARGENES_TOUR_ANCHOR];

export const margenesTourSelector = (anchorId: MargenesTourAnchorId): string =>
  `#${anchorId}`;
