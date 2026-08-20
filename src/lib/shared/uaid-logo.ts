/**
 * Geometría de la marca UAID: cerebro en trazo blanco.
 * Misma figura en header, favicon y encabezados de impresión.
 */

export const UAID_LOGO_VIEWBOX = "0 0 32 32";

export const UAID_LOGO_GRADIENT = [
  { offset: "0%", color: "#38bdf8" },
  { offset: "46%", color: "#2563eb" },
  { offset: "100%", color: "#4338ca" },
] as const;

export const UAID_LOGO_STROKE = 1.45;

/**
 * Contorno + cisura + pliegues. Pocas curvas para que se lea a 32px.
 */
export const UAID_LOGO_PATHS = [
  "M16 7C20.6 7 24 10.9 24 16.1C24 19.6 22.1 22.5 19.4 24C18.2 24.7 16.9 24.3 16 23.2C15.1 24.3 13.8 24.7 12.6 24C9.9 22.5 8 19.6 8 16.1C8 10.9 11.4 7 16 7Z",
  "M16 8.6V22.4",
  "M11.2 12.2C13 13.1 14.4 14.6 14.8 16.8",
  "M20.8 12.2C19 13.1 17.6 14.6 17.2 16.8",
  "M11.4 17.6C12.8 18.4 14.1 19.8 14.6 21.4",
  "M20.6 17.6C19.2 18.4 17.9 19.8 17.4 21.4",
] as const;
