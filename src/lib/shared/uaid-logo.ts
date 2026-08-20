/**
 * Geometría de la marca UAID (U + red de datos).
 * Misma figura en header, favicon y encabezados de impresión.
 */

export const UAID_LOGO_VIEWBOX = "0 0 32 32";

export const UAID_LOGO_GRADIENT = [
  { offset: "0%", color: "#38bdf8" },
  { offset: "46%", color: "#2563eb" },
  { offset: "100%", color: "#4338ca" },
] as const;

/** U geométrica: unidad que sostiene la red. */
export const UAID_LOGO_U_PATH =
  "M10 11.2V20.4C10 23.85 12.7 25.9 16 25.9C19.3 25.9 22 23.85 22 20.4V11.2";

export const UAID_LOGO_U_STROKE = 2.55;

export const UAID_LOGO_NODES = [
  { cx: 10, cy: 11.2, r: 1.55 },
  { cx: 22, cy: 11.2, r: 1.55 },
  { cx: 16, cy: 16.15, r: 1.72 },
] as const;

export const UAID_LOGO_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 2],
  [2, 1],
];

export function uaidLogoEdgePoints() {
  return UAID_LOGO_EDGES.map(([from, to]) => ({
    from: UAID_LOGO_NODES[from],
    to: UAID_LOGO_NODES[to],
  }));
}
