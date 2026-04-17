"use client";

import type { LucideIcon } from "lucide-react";
import { ArrowLeft, ChevronRight } from "lucide-react";

export type HubSectionTheme = "venta" | "producto" | "operacion";

export const HUB_THEME_STYLES: Record<
  HubSectionTheme,
  {
    radialWashClass: string;
    topBorderClass: string;
    eyebrowClass: string;
    badgeClasses: string;
    iconClasses: string;
    chevronBtnClasses: string;
  }
> = {
  venta: {
    radialWashClass:
      "bg-[radial-gradient(ellipse_120%_100%_at_50%_-25%,rgba(59,130,246,0.16),transparent_58%)]",
    topBorderClass: "before:bg-blue-500",
    eyebrowClass: "text-blue-600",
    badgeClasses:
      "border-blue-200/90 bg-blue-50/90 text-blue-700 ring-1 ring-blue-100/80",
    iconClasses: "border-blue-100 bg-blue-50 text-blue-600",
    chevronBtnClasses:
      "border-blue-200/80 bg-blue-50 text-blue-600 hover:bg-blue-100/90",
  },
  producto: {
    radialWashClass:
      "bg-[radial-gradient(ellipse_120%_100%_at_50%_-25%,rgba(245,158,11,0.16),transparent_58%)]",
    topBorderClass: "before:bg-amber-500",
    eyebrowClass: "text-amber-700",
    badgeClasses:
      "border-amber-200/90 bg-amber-50/90 text-amber-800 ring-1 ring-amber-100/80",
    iconClasses: "border-amber-100 bg-amber-50 text-amber-600",
    chevronBtnClasses:
      "border-amber-200/80 bg-amber-50 text-amber-700 hover:bg-amber-100/90",
  },
  operacion: {
    radialWashClass:
      "bg-[radial-gradient(ellipse_120%_100%_at_50%_-25%,rgba(244,63,94,0.14),transparent_58%)]",
    topBorderClass: "before:bg-rose-500",
    eyebrowClass: "text-rose-700",
    badgeClasses:
      "border-rose-200/90 bg-rose-50/90 text-rose-800 ring-1 ring-rose-100/80",
    iconClasses: "border-rose-100 bg-rose-50 text-rose-600",
    chevronBtnClasses:
      "border-rose-200/80 bg-rose-50 text-rose-700 hover:bg-rose-100/90",
  },
};

type HubShellProps = { children: React.ReactNode };

export function PortalHubShell({ children }: HubShellProps) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-8 text-foreground lg:px-6">
      {children}
    </div>
  );
}

type HubBackRowProps = { onBack: () => void };

export function PortalHubBackRow({ onBack }: HubBackRowProps) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-end gap-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200/90 bg-white px-3.5 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition-colors hover:border-slate-300 hover:bg-slate-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Volver a secciones
      </button>
    </div>
  );
}

type HubHeroCardProps = {
  theme: HubSectionTheme;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  moduleCount: number;
};

export function PortalHubHeroCard({
  theme,
  icon: Icon,
  eyebrow,
  title,
  description,
  moduleCount,
}: HubHeroCardProps) {
  const styles = HUB_THEME_STYLES[theme];
  const countLabel = String(Math.max(0, moduleCount)).padStart(2, "0");

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-6 py-6 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.28)] before:absolute before:inset-x-0 before:top-0 before:h-1 ${styles.topBorderClass}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-start gap-4">
          <span
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${styles.iconClasses}`}
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={`text-[10px] font-bold uppercase tracking-[0.22em] ${styles.eyebrowClass}`}
            >
              {eyebrow}
            </p>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900 sm:text-[1.65rem]">
              {title}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
              {description}
            </p>
          </div>
        </div>
        <p className="shrink-0 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
          {countLabel} modulos
        </p>
      </div>
    </div>
  );
}

export type HubModuleItem = {
  id: string;
  icon: LucideIcon;
  badge: string;
  title: string;
  description: string;
  href: string;
};

type HubModuleCardProps = {
  theme: HubSectionTheme;
  item: HubModuleItem;
  index: number;
  total: number;
  onNavigate: (href: string) => void;
};

export function PortalHubModuleCard({
  theme,
  item,
  index,
  total,
  onNavigate,
}: HubModuleCardProps) {
  const styles = HUB_THEME_STYLES[theme];
  const Icon = item.icon;
  const sectionNumber = String(index + 1).padStart(2, "0");
  const totalLabel = String(Math.max(total, 1)).padStart(2, "0");

  return (
    <button
      type="button"
      onClick={() => onNavigate(item.href)}
      className={`group relative flex min-h-[280px] w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white px-6 py-6 text-left shadow-[0_16px_34px_-28px_rgba(15,23,42,0.32)] transition-all duration-500 ease-out before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-1 hover:-translate-y-1 hover:border-foreground/15 hover:shadow-floating ${styles.topBorderClass}`}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 z-0 rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100 ${styles.radialWashClass}`}
      />
      <div className="relative z-1 flex items-start justify-between gap-3">
        <span
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-transform duration-500 ease-out will-change-transform group-hover:scale-105 ${styles.iconClasses}`}
        >
          <Icon className="h-5 w-5" />
        </span>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
          {sectionNumber} / {totalLabel}
        </p>
      </div>
      <p
        className={`relative z-1 mt-4 inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-[0.06em] ${styles.badgeClasses}`}
      >
        <span className="text-[0.65rem] leading-none opacity-90">•</span>
        {item.badge}
      </p>
      <span className="relative z-1 mt-3 block text-xl font-black leading-snug tracking-tight text-slate-900 sm:text-2xl">
        {item.title}
      </span>
      <span className="relative z-1 mt-3 block text-sm leading-relaxed text-slate-600">
        {item.description}
      </span>
      <div className="relative z-1 mt-8 flex items-center justify-between gap-3 pt-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
          Abrir modulo
        </span>
        <span
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors ${styles.chevronBtnClasses}`}
          aria-hidden
        >
          <ChevronRight className="h-4 w-4" strokeWidth={2.25} />
        </span>
      </div>
    </button>
  );
}

type HubModuleGridProps = {
  theme: HubSectionTheme;
  items: HubModuleItem[];
  onNavigate: (href: string) => void;
  columnsClassName?: string;
};

export function PortalHubModuleGrid({
  theme,
  items,
  onNavigate,
  columnsClassName = "gap-4 sm:grid-cols-2 lg:grid-cols-3",
}: HubModuleGridProps) {
  const total = items.length;
  return (
    <div className={`mt-6 grid ${columnsClassName}`}>
      {items.map((item, index) => (
        <PortalHubModuleCard
          key={item.id}
          theme={theme}
          item={item}
          index={index}
          total={total}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}
