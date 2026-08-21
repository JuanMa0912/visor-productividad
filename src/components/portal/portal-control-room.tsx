"use client";

import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowUpRight,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Clock,
  GitCompare,
  LineChart,
  Percent,
  PieChart,
  RefreshCw,
  Search,
  Share2,
  Tags,
  TrendingUp,
  Truck,
} from "lucide-react";
import type { PortalSectionId } from "@/lib/shared/portal-sections";
import {
  formatPortalFreshnessTooltip,
  formatPortalUpdatedAt,
  type PortalFreshnessSource,
} from "@/lib/shared/portal-freshness";

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
  accent: PortalSectionId;
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

const ACCENT: Record<PortalSectionId, AccentTone> = {
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

/** Catálogo alineado a `/venta`, `/productividad` y `/horario`. */
export const CONTROL_ROOM_MODULES: ControlRoomModule[] = [
  {
    id: "analisis-de-inventario",
    section: "venta",
    icon: PieChart,
    badge: "DIAS INV.",
    title: "Días de inventario",
    description:
      "Cobertura por sede, inventario por ítem y ventas por ítem en un mismo tablero con pestañas. Las URLs de cada vista se mantienen.",
    href: "/analisis-de-inventario",
  },
  {
    id: "participacion-comercial",
    section: "venta",
    icon: Share2,
    badge: "MIX",
    title: "Participación comercial",
    description:
      "Cuánto aporta cada línea en una sede (o cada sede en una línea), por almacén, con drill a toda la estructura.",
    href: "/participacion-comercial",
  },
  {
    id: "proveedores",
    section: "venta",
    icon: Truck,
    badge: "PROVEEDORES",
    title: "Proveedores",
    description:
      "Registro de visitas por QR (entrada/salida), métricas y ventas por proveedor.",
    href: "/proveedores",
  },
  {
    id: "precios-proveedor",
    section: "venta",
    icon: Tags,
    badge: "COSTOS",
    title: "Costos",
    description: "Precio de venta y costo de entrada por ítem y sede, con proveedor.",
    href: "/costos",
  },
  {
    id: "ordenes-compra",
    section: "venta",
    icon: ClipboardList,
    badge: "ADMIN",
    title: "Órdenes de compra",
    description:
      "Tablero admin: OC abiertas, incompletas y vencidas (SLA 7 días). Recarga diaria 8:00.",
    href: "/ordenes-compra",
  },
  {
    id: "productividad-home",
    section: "producto",
    icon: LineChart,
    badge: "MIX Y LINEA",
    title: "Desempeño comercial por sede",
    description:
      "Revisa que lineas y sedes empujan o frenan el resultado con comparativos de venta y desempeño.",
    href: "/",
  },
  {
    id: "margenes",
    section: "producto",
    icon: Percent,
    badge: "MARGENES",
    title: "Rentabilidad por linea",
    description:
      "Entiende el aporte de cada linea al resultado desde margen, utilidad y rentabilidad.",
    href: "/margenes",
  },
  {
    id: "rotacion",
    section: "producto",
    icon: RefreshCw,
    badge: "ROTACION",
    title: "Inventario con baja salida",
    description:
      "Visualiza productos con baja rotacion y los items que no se estan moviendo por sede.",
    href: "/rotacion",
  },
  {
    id: "informe-variacion",
    section: "producto",
    icon: TrendingUp,
    badge: "INFORME",
    title: "Informe de Variacion",
    description:
      "Analiza variaciones comerciales MoM y YoY por sede, linea, sublinea e item desde margen unificado.",
    href: "/informe-variacion",
  },
  {
    id: "jornada-extendida",
    section: "operacion",
    icon: Activity,
    badge: "EJECUCION",
    title: "Consulta operativa",
    description:
      "Consulta horas trabajadas, novedades y uso del personal por sede y fecha para medir eficiencia operativa.",
    href: "/jornada-extendida",
  },
  {
    id: "horarios-comparar",
    section: "operacion",
    icon: GitCompare,
    badge: "COMPARAR",
    title: "Planilla vs asistencia",
    description:
      "Compara horarios registrados en planillas con las marcaciones reales por sede y fecha.",
    href: "/horarios-comparar",
  },
  {
    id: "checklists",
    section: "operacion",
    icon: ClipboardCheck,
    badge: "SEGUIMIENTO",
    title: "Checklists",
    description:
      "Auditorías ponderadas por sede (bodega y próximos formatos) con plan de acción y comparativo.",
    href: "/checklists",
  },
  {
    id: "ingresar-horarios",
    section: "operacion",
    icon: Clock,
    badge: "TURNOS",
    title: "Registro de horarios",
    description:
      "Programa y administra horarios del personal para sostener la operacion diaria.",
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

/** Sala de control de `/secciones`. Solo claro, para no pelear con el header actual. */
export function PortalControlRoom({
  domains,
  modules,
  introId,
  gridId,
  domainTourId,
  onOpen,
}: PortalControlRoomProps) {
  const [selected, setSelected] = useState<PortalSectionId | null>(null);
  const [query, setQuery] = useState("");
  const [updatedAtLabel, setUpdatedAtLabel] = useState<string | null>(null);
  const [updatedAtDetail, setUpdatedAtDetail] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/portal/freshness", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const json = (await response.json()) as {
          updatedAt?: string | null;
          sources?: PortalFreshnessSource[];
        };
        const iso = json.updatedAt?.trim() ?? "";
        const label = iso ? formatPortalUpdatedAt(iso) : "";
        const detail = formatPortalFreshnessTooltip(json.sources ?? []);
        if (!cancelled && label) {
          setUpdatedAtLabel(label);
          setUpdatedAtDetail(detail);
        }
      })
      .catch(() => {
        /* sin fecha si el snapshot no responde */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const countBySection = useMemo(() => {
    const map: Record<PortalSectionId, number> = {
      venta: 0,
      producto: 0,
      operacion: 0,
    };
    for (const item of modules) map[item.section] += 1;
    return map;
  }, [modules]);

  const activeDomain = domains.find((domain) => domain.id === selected) ?? null;

  const activeModules = useMemo(() => {
    if (!selected) return [];
    const q = query.trim().toLowerCase();
    return modules.filter((item) => {
      if (item.section !== selected) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.badge.toLowerCase().includes(q)
      );
    });
  }, [modules, selected, query]);

  const selectedIndex = selected
    ? Math.max(
        0,
        domains.findIndex((domain) => domain.id === selected),
      )
    : 0;

  const toggleDomain = (id: PortalSectionId) => {
    setQuery("");
    setSelected((prev) => (prev === id ? null : id));
  };

  const leftDomains = useMemo(() => {
    if (!selected) return [];
    return domains.filter((_, index) => index < selectedIndex);
  }, [domains, selected, selectedIndex]);

  const rightExtras = useMemo(() => {
    if (!selected) return [];
    return domains.filter((_, index) => index > selectedIndex);
  }, [domains, selected, selectedIndex]);

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
        className={`group relative overflow-hidden rounded-xl border bg-white p-5 text-left shadow-sm transition-all duration-500 hover:bg-slate-50 ${accent.border}`}
      >
        <CornerMarks color={accent.stroke} />
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 bg-linear-to-br ${accent.wash}`}
        />
        <div className="relative flex items-start justify-between gap-3">
          <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500">
            SEC — {String(index + 1).padStart(2, "0")}
          </p>
          <p
            className={`inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.18em] uppercase ${accent.live}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${accent.liveDot}`} />
            Live
          </p>
        </div>
        <h2 className="relative mt-5 text-2xl font-semibold tracking-tight text-slate-950">
          {domain.label}
        </h2>
        <p className="relative mt-2 line-clamp-3 min-h-[3.6rem] text-sm leading-relaxed text-slate-500">
          {domain.description}
        </p>
        <div className="relative mt-5">
          <Sparkline color={accent.stroke} />
        </div>
        <div className="relative mt-4 flex items-center justify-between border-t border-slate-200 pt-3">
          <span className="text-[10px] font-bold tracking-[0.18em] text-slate-500 uppercase">
            {String(count).padStart(2, "0")} módulos
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] text-slate-500 uppercase">
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
        className={`group relative w-full overflow-hidden rounded-xl border bg-white text-left shadow-sm transition-[box-shadow,transform] duration-500 ease-out ${
          motion === "left" ? "uaid-dock-left" : "uaid-dock-right"
        } ${accent.border} ${
          isSelected ? `ring-1 ${accent.selectedRing} p-4` : "p-3 hover:bg-slate-50"
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
          <p className="font-mono text-[9px] tracking-[0.18em] text-slate-500">
            SEC — {String(index + 1).padStart(2, "0")}
          </p>
          {isSelected ? (
            <span
              className={`text-[9px] font-bold tracking-[0.14em] uppercase ${accent.live}`}
            >
              Abierto
            </span>
          ) : null}
        </div>
        <h3
          className={`relative mt-2 font-semibold tracking-tight text-slate-950 ${
            isSelected ? "text-xl" : "text-sm"
          }`}
        >
          {domain.label}
        </h3>
        {isSelected ? (
          <>
            <p className="relative mt-2 hidden line-clamp-3 text-xs leading-relaxed text-slate-500 xl:block">
              {domain.description}
            </p>
            <div className="relative mt-3 hidden xl:block">
              <Sparkline color={accent.stroke} />
            </div>
          </>
        ) : (
          <p className="relative mt-1 text-[10px] font-bold tracking-[0.14em] text-slate-500 uppercase">
            {String(count).padStart(2, "0")} módulos
          </p>
        )}
      </button>
    );
  };

  return (
    <div className="relative isolate min-h-[calc(100vh-3.5rem)] overflow-hidden bg-slate-50 text-slate-900">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        style={{
          backgroundImage:
            "radial-gradient(rgba(100,116,139,0.18) 0.7px, transparent 0.7px)",
          backgroundSize: "22px 22px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_top,rgba(14,165,233,0.08),transparent_60%)]"
      />

      <div
        className={`relative mx-auto w-full px-4 py-5 pb-10 lg:px-6 lg:py-7 ${
          activeDomain ? "max-w-[92rem]" : "max-w-6xl"
        }`}
      >
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4">
          <p className="text-[10px] font-semibold tracking-[0.28em] text-slate-500 uppercase">
            Portal / Secciones
          </p>
          <div className="flex flex-wrap items-center gap-3 text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
            <span className="inline-flex items-center gap-1.5 normal-case tracking-normal">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="text-emerald-700">Sistema en línea</span>
            </span>
            {updatedAtLabel ? (
              <span
                className="font-mono normal-case tracking-[0.08em] text-slate-500"
                title={
                  updatedAtDetail ||
                  "Máximo entre rotación, informe de variación y horas"
                }
              >
                Actualizado {updatedAtLabel}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mb-8 max-w-3xl">
          <h1 className="bg-linear-to-r from-sky-500 via-blue-600 to-indigo-600 bg-clip-text text-4xl font-black tracking-tight text-transparent sm:text-5xl">
            Secciones
          </h1>
          <p
            id={introId}
            className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-500 sm:text-[15px]"
          >
            El Portal UAID integra venta, producto y operación. Al abrir un
            dominio, sus módulos quedan al centro; solo ves los tableros a los
            que tienes acceso.
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
              className="grid items-start gap-3 xl:grid-cols-[108px_minmax(0,1fr)_148px] xl:gap-4"
            >
              <aside className="order-2 hidden flex-col gap-3 xl:order-1 xl:flex">
                {leftDomains.map((domain, index) =>
                  renderDockCard(
                    domain,
                    domains.findIndex((entry) => entry.id === domain.id),
                    "compact",
                    "left",
                    index * 70,
                  ),
                )}
              </aside>

              <section
                className={`uaid-panel-rise relative order-1 min-w-0 overflow-hidden rounded-xl border bg-white shadow-lg xl:order-2 ${ACCENT[activeDomain.accent].panelBorder}`}
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
                <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold tracking-[0.22em] text-slate-500 uppercase">
                      Módulos
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                      <span
                        className={`font-semibold ${ACCENT[activeDomain.accent].label}`}
                      >
                        {activeDomain.label}
                      </span>
                      <span className="text-slate-500">
                        · {activeDomain.focus}
                      </span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="relative block w-full sm:w-48">
                      <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Filtrar…"
                        className="w-full rounded-lg border border-slate-200 bg-white py-2 pr-3 pl-9 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-400 focus:ring-1 focus:ring-sky-200"
                      />
                    </label>
                  </div>
                </div>

                {activeModules.length === 0 ? (
                  <p className="px-5 py-10 text-sm text-slate-500">
                    No hay módulos con ese filtro.
                  </p>
                ) : (
                  <div className="grid gap-px bg-slate-100 lg:grid-cols-2">
                    {activeModules.map((item, index) => {
                      const accent = ACCENT[item.section];
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onOpen(item.href)}
                          className="uaid-module-in flex items-start gap-4 bg-white px-5 py-5 text-left transition-colors hover:bg-slate-50 sm:px-6 sm:py-6"
                          style={{
                            animationDelay: `${160 + Math.min(index, 8) * 45}ms`,
                          }}
                        >
                          <span
                            className={`mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${accent.soft}`}
                          >
                            <Icon className="h-5 w-5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-base font-semibold text-slate-950 sm:text-[17px]">
                                {item.title}
                              </span>
                              <span className="font-mono text-[10px] tracking-[0.14em] text-slate-500 uppercase">
                                {item.badge}
                              </span>
                            </span>
                            <span className="mt-1.5 block text-sm leading-relaxed text-slate-600">
                              {item.description}
                            </span>
                          </span>
                          <ArrowUpRight className="mt-1 h-5 w-5 shrink-0 text-slate-400" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              <aside className="order-3 grid grid-cols-3 gap-2 xl:hidden">
                {domains.map((domain, index) =>
                  renderDockCard(
                    domain,
                    index,
                    domain.id === selected ? "selected" : "compact",
                    "right",
                    index * 40,
                  ),
                )}
              </aside>
              <aside className="order-3 hidden flex-col gap-3 xl:flex">
                {renderDockCard(
                  activeDomain,
                  selectedIndex,
                  "selected",
                  "right",
                  40,
                )}
                {rightExtras.map((domain, index) =>
                  renderDockCard(
                    domain,
                    domains.findIndex((entry) => entry.id === domain.id),
                    "compact",
                    "right",
                    110 + index * 70,
                  ),
                )}
              </aside>
            </div>
          )}

          {!activeDomain ? (
            <p className="mt-6 text-center text-sm text-slate-500">
              Elige un dominio para abrir el menú al centro.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
