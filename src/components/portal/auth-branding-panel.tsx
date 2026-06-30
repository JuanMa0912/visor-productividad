type AuthBrandingPanelProps = {
  className?: string;
};

/** Panel izquierdo de branding UAID (login, cambio de contraseña, etc.). */
export function AuthBrandingPanel({ className = "" }: AuthBrandingPanelProps) {
  return (
    <aside
      className={`relative flex flex-col items-start justify-center overflow-hidden bg-linear-to-br from-slate-950 via-blue-950 to-blue-800 px-8 py-12 text-white lg:px-16 lg:py-16 ${className}`.trim()}
    >
      <div className="pointer-events-none absolute -top-24 -right-24 h-96 w-96 rounded-full bg-blue-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-sky-400/15 blur-3xl" />

      <div className="relative z-10">
        <p className="text-sm font-semibold uppercase tracking-[0.32em] text-blue-300">
          Portal corporativo
        </p>
        <h1 className="mt-3 text-6xl font-black uppercase tracking-tight text-white sm:text-7xl lg:text-8xl">
          UAID
        </h1>
        <p className="mt-4 max-w-md text-lg font-medium text-blue-100">
          Unidad de Analítica e Inteligencia de Datos
        </p>
        <p className="mt-8 max-w-md text-sm leading-relaxed text-blue-200/80">
          Datos confiables para decisiones claras. Indicadores de
          productividad, márgenes, rotación y ventas consolidados para
          Mercamio, Mercatodo y Merkmios.
        </p>
      </div>

      <div className="absolute right-8 bottom-8 left-8 z-10 flex items-center justify-between text-xs text-blue-200/60 lg:right-16 lg:bottom-12 lg:left-16">
        <p>© 2026 Mercamio · Todos los derechos reservados</p>
        <p className="rounded-full bg-white/10 px-2.5 py-0.5 font-mono text-[10px]">
          v4.0
        </p>
      </div>
    </aside>
  );
}

export function AuthBrandingPanelFallback() {
  return (
    <div className="bg-linear-to-br from-slate-950 via-blue-950 to-blue-800" />
  );
}
