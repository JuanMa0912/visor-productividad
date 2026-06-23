/** IDs de ancla del tutorial; deben existir en el DOM cuando el paso aplica. */
export const ROTACION_TOUR_ANCHOR = {
  intro: "rotacion-tour-intro",
  filters: "rotacion-tour-filters",
  dates: "rotacion-tour-dates",
  lineFilters: "rotacion-tour-line-filters",
  abcdConfig: "rotacion-tour-abcd-config",
  table: "rotacion-tour-table",
  tableAbcd: "rotacion-tour-table-abcd",
  tableFilters: "rotacion-tour-table-filters",
  tableSearch: "rotacion-tour-table-search",
  export: "rotacion-tour-export",
} as const;

export type RotacionTourAnchorId =
  (typeof ROTACION_TOUR_ANCHOR)[keyof typeof ROTACION_TOUR_ANCHOR];

export const rotacionTourSelector = (anchorId: RotacionTourAnchorId): string =>
  `#${anchorId}`;
