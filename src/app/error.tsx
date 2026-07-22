"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";

/**
 * Error boundary global del Portal UAID.
 *
 * Next.js detecta `src/app/error.tsx` y lo usa cuando un error NO capturado
 * sucede en cualquier parte del arbol bajo `RootLayout`. Recibe la prop
 * `reset` que permite reintentar el render del segmento afectado sin
 * recargar toda la pagina.
 *
 * IMPORTANTE: debe ser `"use client"` (Next lo exige) y el `error.digest`
 * es util para correlacionar logs de servidor con lo que vio el usuario.
 *
 * Casos cubiertos:
 *   - Excepciones en componentes client.
 *   - Errores de fetch que escalan a `throw`.
 *   - Errores de hidratacion.
 *
 * Casos NO cubiertos (van a `global-error.tsx`):
 *   - Errores dentro del propio `RootLayout`.
 *   - Errores antes de que cargue React.
 */
export default function PortalErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // En produccion deberia ir a un logger (Sentry, Datadog, etc). Por ahora
    // dejamos console.error para que aparezca en el servidor de logs de
    // Next y el devtools del cliente. NO incluyas datos del usuario aqui.
    console.error("[portal-error-boundary]", error);

    // Tras un deploy, el cliente puede pedir chunks viejos (404) y caer aqui.
    // Recargar una vez suele resolver el desfase HTML/JS.
    const isChunkError =
      error.name === "ChunkLoadError" ||
      /Loading chunk [\w-]+ failed/i.test(error.message) ||
      /Failed to load chunk/i.test(error.message);
    if (!isChunkError || typeof window === "undefined") return;

    const reloadKey = "vp_chunk_reload";
    try {
      if (sessionStorage.getItem(reloadKey) === "1") {
        sessionStorage.removeItem(reloadKey);
        return;
      }
      sessionStorage.setItem(reloadKey, "1");
      window.location.reload();
    } catch {
      // sessionStorage puede fallar en modo restringido; no bloqueamos la UI.
    }
  }, [error]);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-3xl border border-slate-200/70 bg-white p-8 text-center shadow-[0_28px_70px_-45px_rgba(15,23,42,0.4)]">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
          <AlertTriangle className="h-8 w-8 text-red-600" aria-hidden />
        </div>

        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-red-700">
          Algo sali&oacute; mal
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">
          No pudimos cargar esta secci&oacute;n
        </h1>
        <p className="mt-3 text-sm text-slate-600">
          Ocurri&oacute; un error inesperado al renderizar la p&aacute;gina.
          Puedes intentar de nuevo o volver al portal. Si el problema persiste,
          comparte el c&oacute;digo de abajo con el equipo UAID.
        </p>

        {error.digest ? (
          <p className="mt-4 inline-block rounded-full bg-slate-100 px-3 py-1 font-mono text-[11px] text-slate-600">
            ref: {error.digest}
          </p>
        ) : null}

        <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-blue-200/70 bg-blue-600 px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-white transition-all hover:bg-blue-700"
          >
            <RotateCw className="h-3.5 w-3.5" aria-hidden />
            Reintentar
          </button>
          <Link
            href="/secciones"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200/70 bg-slate-100 px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700 transition-all hover:border-slate-300"
          >
            Volver a secciones
          </Link>
        </div>
      </div>
    </div>
  );
}
