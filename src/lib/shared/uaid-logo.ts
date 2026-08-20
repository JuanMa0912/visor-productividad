/**
 * Geometría de la marca UAID: U al centro, dos órbitas finas (átomo).
 * Misma figura en header, favicon y encabezados de impresión.
 */

export const UAID_LOGO_VIEWBOX = "0 0 32 32";

export const UAID_LOGO_GRADIENT = [
  { offset: "0%", color: "#38bdf8" },
  { offset: "46%", color: "#2563eb" },
  { offset: "100%", color: "#4338ca" },
] as const;

/** Centro óptico de la U (no el del tile). */
export const UAID_LOGO_CENTER = { x: 16, y: 16.85 };

/** U más grande, centrada con las órbitas. */
export const UAID_LOGO_U_PATH =
  "M10.05 7.5V20.05C10.05 23.85 12.75 26.15 16 26.15C19.25 26.15 21.95 23.85 21.95 20.05V7.5";

export const UAID_LOGO_U_STROKE = 1.82;

export const UAID_LOGO_ORBIT_STROKE = 0.72;

export const UAID_LOGO_ORBITS = [
  { rx: 13.15, ry: 3.2, rotate: -15 },
  { rx: 13.15, ry: 3.2, rotate: 15 },
] as const;

const round = (value: number) => Number(value.toFixed(2));

/** Elipse completa rotada, como path, para header y favicon. */
export function uaidLogoOrbitPath(orbit: {
  rx: number;
  ry: number;
  rotate: number;
}) {
  const { x: cx, y: cy } = UAID_LOGO_CENTER;
  const rad = (orbit.rotate * Math.PI) / 180;
  const x1 = round(cx + orbit.rx * Math.cos(rad));
  const y1 = round(cy + orbit.rx * Math.sin(rad));
  const x2 = round(cx - orbit.rx * Math.cos(rad));
  const y2 = round(cy - orbit.rx * Math.sin(rad));
  return `M${x1} ${y1}A${orbit.rx} ${orbit.ry} ${orbit.rotate} 1 1 ${x2} ${y2}A${orbit.rx} ${orbit.ry} ${orbit.rotate} 1 1 ${x1} ${y1}`;
}

export function uaidLogoOrbitPaths() {
  return UAID_LOGO_ORBITS.map(uaidLogoOrbitPath);
}
