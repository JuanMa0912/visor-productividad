import { ImageResponse } from "next/og";

/**
 * Favicon dinamico del Portal UAID.
 *
 * Next.js 15+ detecta `icon.tsx` en `src/app/` y lo registra como
 * `<link rel="icon">` automaticamente. Generamos el icono con codigo (no PNG)
 * para no depender de un editor de imagenes y poder iterar rapido si cambia
 * el branding.
 *
 * Se renderiza una sola vez en build (es una imagen estatica).
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 22,
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
        }}
      >
        U
      </div>
    ),
    { ...size },
  );
}
