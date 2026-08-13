"use client";

import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Boxes,
  ChevronDown,
  ClipboardCheck,
  Clock,
  GitCompareArrows,
  LineChart,
  Moon,
  Package,
  Percent,
  PieChart,
  RefreshCw,
  Search,
  Share2,
  Sun,
  Tags,
  TrendingUp,
  Truck,
  X,
} from "lucide-react";
import type { PortalSectionId } from "@/lib/shared/portal-sections";
import { useUaidSurfaceTheme } from "./uaid-surface-theme";

export type ControlRoomModule = {
  id: string;
  section: PortalSectionId;
  icon: LucideIcon;
  badge: string;
  title: string;
  description: string;
  href: string;
};

export type ControlRoomDomain = {
  id: PortalSectionId;
  label: string;
  focus: string;
  description: string;
  hubHref: string;
  accent: "venta" | "producto" | "operacion";
};

type AccentTone = {
  label: string;
  live: string;
  liveDot: string;
  stroke: string;
  glow: string;
  border: string;
  selectedRing: string;
  wash: string;
  soft: string;
  panelBorder: string;
};

const ACCENT_LIGHT: Record<"venta" | "producto" | "operacion", AccentTone> = {
  venta: {
    label: "text-sky-700",
    live: "text-emerald-600",
    liveDot: "bg-emerald-500",
    stroke: "#0284c7",
    glow: "rgba(14,165,233,0.22)",
    border: "border-sky-200",
    selectedRing: "ring-sky-300",
    wash: "from-sky-50 via-transparent to-transparent",
    soft: "bg-sky-50 text-sky-700",
    panelBorder: "border-sky-200",
  },
  producto: {
    label: "text-amber-700",
    live: "text-amber-600",
    liveDot: "bg-amber-500",
    stroke: "#d97706",
    glow: "rgba(245,158,11,0.2)",
    border: "border-amber-200",
    selectedRing: "ring-amber-300",
    wash: "from-amber-50 via-transparent to-transparent",
    soft: "bg-amber-50 text-amber-800",
    panelBorder: "border-amber-200",
  },
  operacion: {
    label: "text-rose-700",
    live: "text-rose-600",
    liveDot: "bg-rose-500",
    stroke: "#e11d48",
    glow: "rgba(244,63,94,0.18)",
    border: "border-rose-200",
    selectedRing: "ring-rose-300",
    wash: "from-rose-50 via-transparent to-transparent",
    soft: "bg-rose-50 text-rose-700",
    panelBorder: "border-rose-200",
  },
};

const ACCENT_DARK: Record<"venta" | "producto" | "operacion", AccentTone> = {
  venta: {
    label: "text-sky-300",
    live: "text-emerald-400",
    liveDot: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]",
    stroke: "#38bdf8",
    glow: "rgba(56,189,248,0.45)",
    border: "border-sky-400/25",
    selectedRing: "ring-sky-400/50",
    wash: "from-sky-500/10 via-transparent to-transparent",
    soft: "bg-sky-400/10 text-sky-300",
    panelBorder: "border-sky-400/30",
  },
  producto: {
    label: "text-amber-300",
    live: "text-amber-300",
    liveDot: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.75)]",
    stroke: "#fbbf24",
    glow: "rgba(251,191,36,0.4)",
    border: "border-amber-400/25",
    selectedRing: "ring-amber-400/50",
    wash: "from-amber-500/10 via-transparent to-transparent",
    soft: "bg-amber-400/10 text-amber-300",
    panelBorder: "border-amber-400/30",
  },
  operacion: {
    label: "text-rose-300",
    live: "text-rose-300",
    liveDot: "bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.75)]",
    stroke: "#fb7185",
    glow: "rgba(251,113,133,0.4)",
    border: "border-rose-400/25",
    selectedRing: "ring-rose-400/50",
    wash: "from-rose-500/10 via-transparent to-transparent",
    soft: "bg-rose-400/10 text-rose-300",
    panelBorder: "border-rose-400/30",
  },
};

export const CONTROL_ROOM_MODULES: ControlRoomModule[] = [
  {
    id: "ventas-x-item",
    section: "venta",
    icon: BarChart3,
    badge: "VENTAS",
    title: "Ventas por item",
    description: "Comportamiento de venta por item y sede.",
    href: "/ventas-x-item",
  },
  {
    id: "inventario-x-item",
    section: "venta",
    icon: Package,
    badge: "INVENTARIO",
    title: "Inventario x item",
    description: "Inventario por referencia dentro de venta.",
    href: "/inventario-x-item",
  },
  {
    id: "analisis-de-inventario",
    section: "venta",
    icon: PieChart,
    badge: "DIAS INV.",
    title: "Días de inventario",
    description: "Cobertura por sede con drill y mapa de calor.",
    href: "/analisis-de-inventario",
  },
  {
    id: "participacion-comercial",
    section: "venta",
    icon: Share2,
    badge: "MIX",
    title: "Participación comercial",
    description: "Aporte de línea/sede al mix comercial.",
    href: "/participacion-comercial",
  },
  {
    id: "proveedores",
    section: "venta",
    icon: Truck,
    badge: "PROVEEDORES",
    title: "Proveedores",
    description: "Visitas QR, métricas y ventas por proveedor.",
    href: "/proveedores",
  },
  {
    id: "precios-proveedor",
    section: "venta",
    icon: Tags,
    badge: "EXP · ADMIN",
    title: "Precios proveedor",
    description: "Heatmap experimental precio / COGS.",
    href: "/exp/precios-proveedor",
  },
  {
    id: "productividad-home",
    section: "producto",
    icon: LineChart,
    badge: "MIX Y LINEA",
    title: "Desempeño comercial por sede",
    description: "Líneas y sedes que empujan o frenan el resultado.",
    href: "/",
  },
  {
    id: "margenes",
    section: "producto",
    icon: Percent,
    badge: "MARGENES",
    title: "Rentabilidad por linea",
    description: "Margen, utilidad y rentabilidad por línea.",
    href: "/margenes",
  },
  {
    id: "rotacion",
    section: "producto",
    icon: RefreshCw,
    badge: "ROTACION",
    title: "Inventario con baja salida",
    description: "Baja rotación e ítems quietos por sede.",
    href: "/rotacion",
  },
  {
    id: "informe-variacion",
    section: "producto",
    icon: TrendingUp,
    badge: "INFORME",
    title: "Informe de Variacion",
    description: "Variaciones MoM / YoY desde margen unificado.",
    href: "/informe-variacion",
  },
  {
    id: "jornada-extendida",
    section: "operacion",
    icon: Activity,
    badge: "EJECUCION",
    title: "Consulta operativa",
    description: "Horas, novedades y uso de personal.",
    href: "/jornada-extendida",
  },
  {
    id: "horarios-comparar",
    section: "operacion",
    icon: GitCompareArrows,
    badge: "COMPARAR",
    title: "Planilla vs asistencia",
    description: "Planillas vs marcaciones reales.",
    href: "/horarios-comparar",
  },
  {
    id: "checklists",
    section: "operacion",
    icon: ClipboardCheck,
    badge: "SEGUIMIENTO",
    title: "Checklists",
    description: "Auditorías ponderadas y plan de acción.",
    href: "/checklists",
  },
  {
    id: "ingresar-horarios",
    section: "operacion",
    icon: Clock,
    badge: "TURNOS",
    title: "Registro de horarios",
    description: "Programa turnos del personal por sede.",
    href: "/ingresar-horarios",
  },
];

function CornerMarks({ color }: { color: string }) {
  const arm = "h-3 w-3 border";
  return (
    <>
      <span
        aria-hidden
        className={`pointer-events-none absolute top-3 left-3 ${arm} border-r-0 border-b-0`}
        style={{ borderColor: color }}
      />
      <span
        aria-hidden
        className={`pointer-events-none absolute top-3 right-3 ${arm} border-b-0 border-l-0`}
        style={{ borderColor: color }}
      />
      <span
        aria-hidden
        className={`pointer-events-none absolute bottom-3 left-3 ${arm} border-t-0 border-r-0`}
        style={{ borderColor: color }}
      />
      <span
        aria-hidden
        className={`pointer-events-none absolute right-3 bottom-3 ${arm} border-t-0 border-l-0`}
        style={{ borderColor: color }}
      />
    </>
  );
}

function Sparkline({ color }: { color: string }) {
  return (
    <svg aria-hidden viewBox="0 0 160 40" className="h-10 w-full" fill="none">
      <path
        d="M0 30 C16 28 22 14 38 16 C54 18 58 32 78 26 C98 20 104 8 122 12 C140 16 148 24 160 10"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        opacity="0.95"
      />
      <path
        d="M0 30 C16 28 22 14 38 16 C54 18 58 32 78 26 C98 20 104 8 122 12 C140 16 148 24 160 10 V40 H0 Z"
        fill={color}
        opacity="0.1"
      />
    </svg>
  );
}

type PortalControlRoomProps = {
  domains: ControlRoomDomain[];
  modules: ControlRoomModule[];
  introId?: string;
  gridId?: string;
  domainTourId?: (id: PortalSectionId) => string;
  onOpen: (href: string) => void;
};

/**
 * Sala de control UAID 5.0.
 * Claro por defecto; oscuro opcional. Dominio se abre como panel expandido.
 */
export function PortalControlRoom({
  domains,
  modules,
  introId,
  gridId,
  domainTourId,
  onOpen,
}: PortalControlRoomProps) {
  const { surface, setSurface } = useUaidSurfaceTheme();
  const dark = surface === "dark";
  const ACCENT = dark ? ACCENT_DARK : ACCENT_LIGHT;

  const [selected, setSelected] = useState<PortalSectionId | null>(null);
  const [query, setQuery] = useState("");

  const corteLabel = useMemo(() => {
    try {
      return new Intl.DateTimeFormat("es-CO", {
        hour: "2-digit",
        minute: "2-digit",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    } catch {
      return "";
    }
  }, []);

  const countBySection = useMemo(() => {
    const map: Record<PortalSectionId, number> = {
      venta: 0,
      producto: 0,
      operacion: 0,
    };
    for (const m of modules) map[m.section] += 1;
    return map;
  }, [modules]);

  const activeDomain = domains.find((d) => d.id === selected) ?? null;

  const activeModules = useMemo(() => {
    if (!selected) return [];
    const q = query.trim().toLowerCase();
    return modules.filter((m) => {
      if (m.section !== selected) return false;
      if (!q) return true;
      return (
        m.title.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.badge.toLowerCase().includes(q)
      );
    });
  }, [modules, selected, query]);

  const selectedIndex = selected
    ? Math.max(
        0,
        domains.findIndex((d) => d.id === selected),
      )
    : 0;

  const toggleDomain = (id: PortalSectionId) => {
    setQuery("");
    setSelected((prev) => (prev === id ? null : id));
  };

  const leftDomains = useMemo(() => {
    if (!selected) return [];
    return domains.filter((_, i) => i < selectedIndex);
  }, [domains, selected, selectedIndex]);

  const rightExtras = useMemo(() => {
    if (!selected) return [];
    return domains.filter((_, i) => i > selectedIndex);
  }, [domains, selected, selectedIndex]);

  const pageBg = dark ? "bg-[#05070d] text-slate-100" : "bg-slate-50 text-slate-900";
  const cardBg = dark ? "bg-[#080c16]/90" : "bg-white";
  const cardHover = dark ? "hover:bg-[#0a101c]" : "hover:bg-slate-50";
  const muted = dark ? "text-slate-400" : "text-slate-500";
  const title = dark ? "text-white" : "text-slate-950";
  const hairline = dark ? "border-white/10" : "border-slate-200";
  const panelBg = dark ? "bg-[#080c16]/95" : "bg-white";
  const moduleBg = dark ? "bg-[#080c16] hover:bg-[#0c121f]" : "bg-white hover:bg-slate-50";
  const inputCls = dark
    ? "w-full rounded-lg border border-white/10 bg-[#05070d] py-2 pr-3 pl-9 text-sm text-white outline-none placeholder:text-slate-600 focus:border-sky-400/40 focus:ring-1 focus:ring-sky-400/20"
    : "w-full rounded-lg border border-slate-200 bg-white py-2 pr-3 pl-9 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-400 focus:ring-1 focus:ring-sky-200";

  const renderIdleCard = (domain: ControlRoomDomain, index: number) => {
    const accent = ACCENT[domain.accent];
    const count = countBySection[domain.id];
    return (
      <button
        key={domain.id}
        id={domainTourId?.(domain.id)}
        type="button"
        aria-expanded={false}
        onClick={() => toggleDomain(domain.id)}
        className={`group relative overflow-hidden rounded-xl border p-5 text-left shadow-sm transition-all duration-500 ${cardBg} ${accent.border} ${cardHover}`}
      >
        <CornerMarks color={accent.stroke} />
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 bg-linear-to-br ${accent.wash}`}
        />
        <div className="relative flex items-start justify-between gap-3">
          <p className={`font-mono text-[10px] tracking-[0.2em] ${muted}`}>
            SEC — {String(index + 1).padStart(2, "0")}
          </p>
          <p
            className={`inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.18em] uppercase ${accent.live}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${accent.liveDot}`} />
            Live
          </p>
        </div>
        <h2 className={`relative mt-5 text-2xl font-semibold tracking-tight ${title}`}>
          {domain.label}
        </h2>
        <p className={`relative mt-2 line-clamp-3 min-h-[3.6rem] text-sm leading-relaxed ${muted}`}>
          {domain.description}
        </p>
        <div className="relative mt-5">
          <Sparkline color={accent.stroke} />
        </div>
        <div className={`relative mt-4 flex items-center justify-between border-t pt-3 ${hairline}`}>
          <span className={`text-[10px] font-bold tracking-[0.18em] uppercase ${muted}`}>
            {String(count).padStart(2, "0")} módulos
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] uppercase ${
              dark ? "border-white/15 text-slate-400" : "border-slate-200 text-slate-500"
            }`}
          >
            Abrir
            <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
          </span>
        </div>
      </button>
    );
  };

  const renderDockCard = (
    domain: ControlRoomDomain,
    index: number,
    variant: "compact" | "selected",
    motion: "left" | "right",
    delayMs = 0,
  ) => {
    const accent = ACCENT[domain.accent];
    const count = countBySection[domain.id];
    const isSelected = variant === "selected";
    return (
      <button
        key={`${domain.id}-${selected ?? "none"}`}
        id={isSelected ? domainTourId?.(domain.id) : undefined}
        type="button"
        aria-expanded={isSelected}
        onClick={() => toggleDomain(domain.id)}
        className={`group relative w-full overflow-hidden rounded-xl border text-left shadow-sm transition-[box-shadow,transform] duration-500 ease-out ${
          motion === "left" ? "uaid-dock-left" : "uaid-dock-right"
        } ${cardBg} ${accent.border} ${
          isSelected ? `ring-1 ${accent.selectedRing} p-4` : `p-3 ${cardHover}`
        }`}
        style={{
          animationDelay: `${delayMs}ms`,
          ...(isSelected
            ? {
                boxShadow: `0 0 0 1px ${accent.stroke}33, 0 18px 40px -22px ${accent.glow}`,
              }
            : {}),
        }}
      >
        {isSelected ? <CornerMarks color={accent.stroke} /> : null}
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 bg-linear-to-br ${accent.wash}`}
        />
        <div className="relative flex items-start justify-between gap-2">
          <p className={`font-mono text-[9px] tracking-[0.18em] ${muted}`}>
            SEC — {String(index + 1).padStart(2, "0")}
          </p>
          {isSelected ? (
            <span className={`text-[9px] font-bold tracking-[0.14em] uppercase ${accent.live}`}>
              Abierto
            </span>
          ) : null}
        </div>
        <h3
          className={`relative mt-2 font-semibold tracking-tight ${title} ${
            isSelected ? "text-xl" : "text-sm"
          }`}
        >
          {domain.label}
        </h3>
        {isSelected ? (
          <>
            <p className={`relative mt-2 line-clamp-3 text-xs leading-relaxed ${muted}`}>
              {domain.description}
            </p>
            <div className="relative mt-3">
              <Sparkline color={accent.stroke} />
            </div>
          </>
        ) : (
          <p className={`relative mt-1 text-[10px] font-bold tracking-[0.14em] uppercase ${muted}`}>
            {String(count).padStart(2, "0")} módulos
          </p>
        )}
      </button>
    );
  };

  return (
    <div className={`relative isolate min-h-[calc(100vh-3.5rem)] overflow-hidden ${pageBg}`}>
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 ${dark ? "opacity-[0.45]" : "opacity-[0.55]"}`}
        style={{
          backgroundImage: dark
            ? "radial-gradient(rgba(148,163,184,0.22) 0.7px, transparent 0.7px)"
            : "radial-gradient(rgba(100,116,139,0.18) 0.7px, transparent 0.7px)",
          backgroundSize: "22px 22px",
        }}
      />
      <div
        aria-hidden
        className={
          dark
            ? "pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.12),transparent_60%)]"
            : "pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top,rgba(14,165,233,0.08),transparent_60%)]"
        }
      />

      <div className="relative mx-auto w-full max-w-6xl px-4 py-5 pb-24 lg:px-6 lg:py-7">
        <div className={`mb-2 flex flex-wrap items-end justify-between gap-3 border-b pb-4 ${hairline}`}>
          <p className={`text-[10px] font-semibold tracking-[0.28em] uppercase ${muted}`}>
            Portal / Secciones
          </p>
          <div className={`flex flex-wrap items-center gap-3 text-[10px] font-semibold tracking-[0.14em] uppercase ${muted}`}>
            <span className="inline-flex items-center gap-1.5 normal-case tracking-normal">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className={dark ? "text-emerald-300/90" : "text-emerald-700"}>
                Sistema en línea
              </span>
            </span>
            {corteLabel ? (
              <span className="font-mono normal-case tracking-[0.08em]">
                Corte {corteLabel}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mb-8 max-w-3xl">
          <p
            className={`inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.22em] uppercase ${
              dark ? "text-emerald-300/90" : "text-emerald-700"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {domains.length} dominios activos
          </p>
          <h1 className={`mt-3 text-4xl font-semibold tracking-tight sm:text-5xl ${title}`}>
            Secciones
          </h1>
          <p
            id={introId}
            className={`mt-3 max-w-2xl text-sm leading-relaxed sm:text-[15px] ${muted}`}
          >
            Al abrir un dominio, la card pasa a la derecha, el menú de módulos
            queda al centro y las demás se apartan al borde más cercano.
          </p>
        </div>

        <div id={gridId}>
          {!activeDomain ? (
            <div className="grid gap-4 md:grid-cols-3">
              {domains.map((domain, index) => renderIdleCard(domain, index))}
            </div>
          ) : (
            <div
              key={activeDomain.id}
              className="grid items-start gap-4 lg:grid-cols-[160px_minmax(0,1fr)_220px]"
            >
              {/* Izquierda */}
              <aside className="order-2 flex flex-col gap-3 lg:order-1">
                {leftDomains.length === 0 ? (
                  <div
                    className={`uaid-dock-left hidden rounded-xl border border-dashed p-3 text-center text-[10px] tracking-[0.14em] uppercase lg:block ${hairline} ${muted}`}
                  >
                    Borde izq.
                  </div>
                ) : (
                  leftDomains.map((domain, i) =>
                    renderDockCard(
                      domain,
                      domains.findIndex((d) => d.id === domain.id),
                      "compact",
                      "left",
                      i * 70,
                    ),
                  )
                )}
              </aside>

              {/* Centro */}
              <section
                className={`uaid-panel-rise relative order-1 overflow-hidden rounded-xl border shadow-lg lg:order-2 ${panelBg} ${ACCENT[activeDomain.accent].panelBorder}`}
                style={{
                  animationDelay: "80ms",
                  boxShadow: `0 0 0 1px ${ACCENT[activeDomain.accent].stroke}22, 0 20px 48px -28px ${ACCENT[activeDomain.accent].glow}`,
                }}
              >
                <div
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-px"
                  style={{
                    background: `linear-gradient(90deg, transparent, ${ACCENT[activeDomain.accent].stroke}, transparent)`,
                  }}
                />
                <div
                  className={`flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 ${hairline}`}
                >
                  <div className="min-w-0">
                    <p className={`text-[10px] font-bold tracking-[0.22em] uppercase ${muted}`}>
                      Módulos
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                      <span className={`font-semibold ${ACCENT[activeDomain.accent].label}`}>
                        {activeDomain.label}
                      </span>
                      <span className={muted}>· {activeDomain.focus}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="relative block w-full sm:w-48">
                      <Search
                        className={`pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 ${muted}`}
                      />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Filtrar…"
                        className={inputCls}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => onOpen(activeDomain.hubHref)}
                      className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[10px] font-bold tracking-[0.14em] uppercase ${
                        dark ? "border-white/10" : "border-slate-200"
                      } ${ACCENT[activeDomain.accent].soft}`}
                    >
                      Hub
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
                        dark
                          ? "border-white/10 text-slate-400 hover:bg-white/5 hover:text-white"
                          : "border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                      title="Cerrar"
                      aria-label="Cerrar dominio"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {activeModules.length === 0 ? (
                  <p className={`px-5 py-10 text-sm ${muted}`}>
                    No hay módulos con ese filtro.
                  </p>
                ) : (
                  <div
                    className={`grid gap-px sm:grid-cols-2 ${
                      dark ? "bg-white/5" : "bg-slate-100"
                    }`}
                  >
                    {activeModules.map((m, i) => {
                      const accent = ACCENT[m.section];
                      const Icon = m.icon;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => onOpen(m.href)}
                          className={`uaid-module-in flex items-start gap-3 px-4 py-4 text-left transition-colors sm:px-5 ${moduleBg}`}
                          style={{
                            animationDelay: `${160 + Math.min(i, 8) * 45}ms`,
                          }}
                        >
                          <span
                            className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${accent.soft}`}
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className={`font-medium ${title}`}>{m.title}</span>
                              <span
                                className={`font-mono text-[9px] tracking-[0.14em] uppercase ${muted}`}
                              >
                                {m.badge}
                              </span>
                            </span>
                            <span className={`mt-1 block text-[13px] leading-snug ${muted}`}>
                              {m.description}
                            </span>
                          </span>
                          <ArrowUpRight
                            className={`mt-1 h-4 w-4 shrink-0 ${
                              dark ? "text-slate-600" : "text-slate-400"
                            }`}
                          />
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Derecha */}
              <aside className="order-3 flex flex-col gap-3">
                {renderDockCard(activeDomain, selectedIndex, "selected", "right", 40)}
                {rightExtras.map((domain, i) =>
                  renderDockCard(
                    domain,
                    domains.findIndex((d) => d.id === domain.id),
                    "compact",
                    "right",
                    110 + i * 70,
                  ),
                )}
              </aside>
            </div>
          )}

          {!activeDomain ? (
            <p className={`mt-6 text-center text-sm ${muted}`}>
              Elige un dominio para abrir el menú al centro.
            </p>
          ) : null}
        </div>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
        <div
          className={`pointer-events-auto inline-flex items-center gap-1 rounded-full border p-1 shadow-lg backdrop-blur ${
            dark
              ? "border-white/10 bg-[#0b1220]/90"
              : "border-slate-200 bg-white/95"
          }`}
        >
          <button
            type="button"
            onClick={() => setSurface("light")}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[10px] font-bold tracking-[0.16em] uppercase transition-colors ${
              !dark ? "bg-sky-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            <Sun className="h-3.5 w-3.5" />
            Claro
          </button>
          <button
            type="button"
            onClick={() => setSurface("dark")}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[10px] font-bold tracking-[0.16em] uppercase transition-colors ${
              dark
                ? "bg-slate-100 text-slate-900"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <Moon className="h-3.5 w-3.5" />
            Oscuro
          </button>
        </div>
      </div>
    </div>
  );
}
