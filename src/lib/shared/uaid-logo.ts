/**
 * Geometría de la marca UAID: U fina + un punto de dato.
 * Misma figura en header, favicon y encabezados de impresión.
 */

export const UAID_LOGO_VIEWBOX = "0 0 32 32";

export const UAID_LOGO_GRADIENT = [
  { offset: "0%", color: "#38bdf8" },
  { offset: "46%", color: "#2563eb" },
  { offset: "100%", color: "#4338ca" },
] as const;

/** U abierta, trazo fino, cuenco redondo. */
export const UAID_LOGO_U_PATH =
  "M10.6 8.6V20.35C10.6 24.05 13.05 26.45 16 26.45C18.95 26.45 21.4 24.05 21.4 20.35V8.6";

export const UAID_LOGO_U_STROKE = 1.7;

/** Punto de dato en el hueco de la U. */
export const UAID_LOGO_DOT = { cx: 16, cy: 14.2, r: 1.05 } as const;
