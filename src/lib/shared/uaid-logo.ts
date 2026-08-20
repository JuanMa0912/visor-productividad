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

const UAID_LOGO_CENTER = { x: 16, y: 16.05 };

/** U compacta en el núcleo. */
export const UAID_LOGO_U_PATH =
  "M11.45 10.15V19.55C11.45 22.6 13.5 24.5 16 24.5C18.5 24.5 20.55 22.6 20.55 19.55V10.15";

export const UAID_LOGO_U_STROKE = 1.62;

export const UAID_LOGO_ORBIT_STROKE = 0.72;

export const UAID_LOGO_ORBITS = [
  { rx: 12.8, ry: 3.65, rotate: -20 },
  { rx: 12.8, ry: 3.65, rotate: 20 },
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
