/** IDs de ancla del tutorial; deben existir en el DOM cuando el paso aplica. */
export const INVENTARIO_X_ITEM_TOUR_ANCHOR = {
  intro: "inventario-x-item-tour-intro",
  filters: "inventario-x-item-tour-filters",
  presets: "inventario-x-item-tour-presets",
  matrix: "inventario-x-item-tour-matrix",
  export: "inventario-x-item-tour-export",
} as const;

export type InventarioXItemTourAnchorId =
  (typeof INVENTARIO_X_ITEM_TOUR_ANCHOR)[keyof typeof INVENTARIO_X_ITEM_TOUR_ANCHOR];

export const inventarioXItemTourSelector = (
  anchorId: InventarioXItemTourAnchorId,
): string => `#${anchorId}`;
