import { ImageResponse } from "next/og";

/**
 * Apple touch icon (iOS, Safari, "Agregar a pantalla de inicio").
 * Variante de mayor resolucion del favicon, mismo branding.
 *
 * Next.js detecta `apple-icon.tsx` automaticamente y lo registra como
 * `<link rel="apple-touch-icon">`.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 130,
          background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontWeight: 800,
          letterSpacing: "-0.05em",
          fontFamily: "system-ui, sans-serif",
          borderRadius: 38,
        }}
      >
        U
      </div>
    ),
    { ...size },
  );
}
