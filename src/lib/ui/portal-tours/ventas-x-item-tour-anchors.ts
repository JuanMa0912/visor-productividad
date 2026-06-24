/** IDs de ancla del tutorial; deben existir en el DOM cuando el paso aplica. */
export const VENTAS_X_ITEM_TOUR_ANCHOR = {
  intro: "ventas-x-item-tour-intro",
  loadDb: "ventas-x-item-tour-load-db",
  items: "ventas-x-item-tour-items",
  results: "ventas-x-item-tour-results",
  charts: "ventas-x-item-tour-charts",
  export: "ventas-x-item-tour-export",
} as const;

export type VentasXItemTourAnchorId =
  (typeof VENTAS_X_ITEM_TOUR_ANCHOR)[keyof typeof VENTAS_X_ITEM_TOUR_ANCHOR];

export const ventasXItemTourSelector = (anchorId: VentasXItemTourAnchorId): string =>
  `#${anchorId}`;
