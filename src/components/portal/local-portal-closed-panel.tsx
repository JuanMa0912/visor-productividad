import { ArrowUpRight, Cloud } from "lucide-react";
import {
  AuthBrandingPanel,
  AuthBrandingPanelFallback,
} from "@/components/portal/auth-branding-panel";
import { MercamioLogo, MercatodoLogo } from "@/components/portal/brand-logos";

type LocalPortalClosedPanelProps = {
  cloudUrl: string;
};

/** Pantalla de cierre del portal local: sin formulario de login. */
export function LocalPortalClosedPanel({ cloudUrl }: LocalPortalClosedPanelProps) {
  const cloudHost = (() => {
    try {
      return new URL(cloudUrl).host;
    } catch {
      return "uaid.mercamio.com.co";
    }
  })();

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      <AuthBrandingPanel className="min-h-[280px] lg:min-h-screen" />

      <main className="flex items-center justify-center bg-slate-50 px-6 py-12 lg:px-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center justify-center gap-5 border-b border-slate-200 pb-6">
            <MercamioLogo className="h-16 w-auto" />
            <MercatodoLogo className="h-16 w-auto" />
          </div>

          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 shadow-sm">
            <Cloud className="h-3.5 w-3.5 text-blue-600" aria-hidden />
            Migración completada
          </div>

          <h2 className="mt-5 text-3xl font-bold text-slate-900">
            Este portal ya no está disponible
          </h2>

          <p className="mt-4 text-sm leading-relaxed text-slate-600">
            El acceso al Portal UAID en este servidor local fue cerrado. Toda la
            operación —productividad, márgenes, rotación, horarios y tableros—
            continúa en la plataforma en la nube, con la misma información y
            permisos de siempre.
          </p>

          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Si llegaste aquí por un favorito o un enlace antiguo, usa el botón
            de abajo para ingresar al portal vigente. Tus credenciales no
            cambian.
          </p>

          <a
            href={cloudUrl}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white shadow-md shadow-blue-600/25 transition-all hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-600/30 active:scale-[0.99]"
          >
            Ir al portal en la nube
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </a>

          <p className="mt-4 text-center text-xs text-slate-500">
            <span className="font-mono text-slate-600">{cloudHost}</span>
          </p>

          <p className="mt-8 text-center text-xs text-slate-500">
            ¿Problemas para ingresar?{" "}
            <a
              href="mailto:soporte@mercamio.com.co"
              className="font-semibold text-blue-600 underline-offset-4 hover:underline"
            >
              Contacta al equipo UAID
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}

export function LocalPortalClosedPanelFallback() {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      <AuthBrandingPanelFallback />
      <div className="flex items-center justify-center bg-slate-50 px-6">
        <div className="h-[360px] w-full max-w-sm animate-pulse rounded-2xl bg-slate-200/60" />
      </div>
    </div>
  );
}
