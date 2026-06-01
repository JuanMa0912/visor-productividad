import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";

/**
 * Pagina 404 global del Portal UAID.
 *
 * Next.js detecta `src/app/not-found.tsx` automaticamente y la usa cuando:
 *   - Un usuario navega a una ruta que no existe.
 *   - Cualquier componente llama `notFound()` de `next/navigation`.
 *
 * Diseno alineado con el resto del portal (slate + blue, footer global).
 * Como este archivo es server component por default, NO incluye logica
 * dinamica que requiera el cliente.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-3xl border border-slate-200/70 bg-white p-8 text-center shadow-[0_28px_70px_-45px_rgba(15,23,42,0.4)]">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
          <Compass className="h-8 w-8 text-blue-600" aria-hidden />
        </div>

        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">
          Error 404
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">
          P&aacute;gina no encontrada
        </h1>
        <p className="mt-3 text-sm text-slate-600">
          La direcci&oacute;n que intentaste abrir no existe o fue movida. Si
          llegaste hasta aqu&iacute; desde un enlace antiguo, av&iacute;sale al
          equipo UAID para actualizarlo.
        </p>

        <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/secciones"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-blue-200/70 bg-blue-600 px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-white transition-all hover:bg-blue-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Volver a secciones
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200/70 bg-slate-100 px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700 transition-all hover:border-slate-300"
          >
            Ir al login
          </Link>
        </div>
      </div>
    </div>
  );
}
