"use client";

import { useEffect } from "react";

/**
 * Error boundary de ULTIMO recurso.
 *
 * Next.js usa `global-error.tsx` solo cuando el error ocurre dentro del
 * propio `RootLayout` (provider, fuentes, head). En ese caso, ni el layout
 * ni `error.tsx` cargan, asi que aqui DEBE redefinirse `<html>` y `<body>`.
 *
 * Cubierto:
 *   - Falla del `AuthProvider` antes de montar la UI.
 *   - Excepciones en componentes globales (footer, presence heartbeat).
 *
 * Diseno: minimalista sin estilos del portal (Tailwind no necesariamente
 * esta disponible si el layout fallo). Inline styles para garantizar que
 * SIEMPRE se vea aceptable, incluso sin hojas de estilo.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[portal-global-error]", error);
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem 1rem",
          backgroundColor: "#f1f5f9",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          color: "#0f172a",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "28rem",
            borderRadius: "24px",
            border: "1px solid rgba(226, 232, 240, 0.7)",
            backgroundColor: "white",
            padding: "2rem",
            textAlign: "center",
            boxShadow: "0 28px 70px -45px rgba(15,23,42,0.4)",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.2em",
              color: "#b91c1c",
            }}
          >
            Error cr&iacute;tico
          </div>
          <h1
            style={{
              marginTop: "0.5rem",
              fontSize: "1.5rem",
              fontWeight: 700,
              color: "#0f172a",
            }}
          >
            El portal no pudo iniciar
          </h1>
          <p
            style={{
              marginTop: "0.75rem",
              fontSize: "0.875rem",
              color: "#475569",
              lineHeight: 1.5,
            }}
          >
            Ocurri&oacute; un error grave antes de cargar la interfaz. Intenta
            recargar la p&aacute;gina; si el problema persiste, contacta al
            equipo UAID con el c&oacute;digo de abajo.
          </p>

          {error.digest ? (
            <div
              style={{
                marginTop: "1rem",
                display: "inline-block",
                backgroundColor: "#f1f5f9",
                padding: "0.25rem 0.75rem",
                borderRadius: "9999px",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "11px",
                color: "#475569",
              }}
            >
              ref: {error.digest}
            </div>
          ) : null}

          <div style={{ marginTop: "1.75rem" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                cursor: "pointer",
                border: "1px solid rgba(191, 219, 254, 0.7)",
                backgroundColor: "#2563eb",
                color: "white",
                padding: "0.625rem 1.25rem",
                borderRadius: "9999px",
                fontSize: "11px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.18em",
              }}
            >
              Recargar el portal
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
