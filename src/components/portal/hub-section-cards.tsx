"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/shared/utils";

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

const resolveHubTheme = (theme: HubSectionTheme) =>
  HUB_THEME_STYLES[theme] ?? HUB_THEME_STYLES.operacion;

const renderHubIcon = (Icon: LucideIcon | undefined, className: string) => {
  // Lucide 0.56+ entrega forwardRef (typeof === "object"), no una function.
  if (Icon == null) return null;
  return <Icon className={className} />;
};

type HubShellProps = { children: ReactNode; className?: string };

export function PortalHubShell({ children, className = "" }: HubShellProps) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-8 text-foreground lg:px-6",
        className,
      )}
    >
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
  tourAnchorId?: string;
  actions?: ReactNode;
  countNoun?: string;
  density?: "default" | "compact";
};

export function PortalHubHeroCard({
  theme,
  icon: Icon,
  eyebrow,
  title,
  description,
  moduleCount,
  tourAnchorId,
  actions,
  countNoun = "modulos",
  density = "default",
}: HubHeroCardProps) {
  const styles = resolveHubTheme(theme);
  const countLabel = String(Math.max(0, moduleCount)).padStart(2, "0");
  const compact = density === "compact";

  return (
    <div
      id={tourAnchorId}
      className={cn(
        "relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_34px_-28px_rgba(15,23,42,0.28)] before:absolute before:inset-x-0 before:top-0 before:h-1",
        styles.topBorderClass,
        compact ? "px-4 py-4" : "px-6 py-6",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-start gap-3">
          <span
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-xl border",
              styles.iconClasses,
              compact ? "h-9 w-9" : "h-11 w-11",
            )}
          >
            {renderHubIcon(Icon, compact ? "h-4 w-4" : "h-5 w-5")}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={`text-[10px] font-bold uppercase tracking-[0.22em] ${styles.eyebrowClass}`}
            >
              {eyebrow}
            </p>
            <h1
              className={cn(
                "font-black tracking-tight text-slate-900",
                compact
                  ? "mt-1 text-xl"
                  : "mt-2 text-2xl sm:text-[1.65rem]",
              )}
            >
              {title}
            </h1>
            <p
              className={cn(
                "max-w-3xl leading-relaxed text-slate-600",
                compact ? "mt-1 text-xs sm:text-sm" : "mt-2 text-sm",
              )}
            >
              {description}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {actions}
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
            {countLabel} {countNoun}
          </p>
        </div>
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
  href?: string;
  disabled?: boolean;
  footerLabel?: string;
};

type HubModuleCardProps = {
  theme: HubSectionTheme;
  item: HubModuleItem;
  index: number;
  total: number;
  onNavigate: (href: string) => void;
  density?: "default" | "compact";
};

export function PortalHubModuleCard({
  theme,
  item,
  index,
  total,
  onNavigate,
  density = "default",
}: HubModuleCardProps) {
  const styles = resolveHubTheme(theme);
  const Icon = item.icon;
  const sectionNumber = String(index + 1).padStart(2, "0");
  const totalLabel = String(Math.max(total, 1)).padStart(2, "0");
  const isDisabled = item.disabled === true;
  const footerLabel = item.footerLabel ?? "Abrir modulo";
  const compact = density === "compact";

  const cardClassName = compact
    ? `group relative flex min-h-14 w-full items-center gap-3 overflow-hidden rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left shadow-[0_8px_20px_-18px_rgba(15,23,42,0.35)] transition-colors before:absolute before:inset-y-0 before:left-0 before:w-1 ${styles.topBorderClass} ${
        isDisabled
          ? "cursor-not-allowed opacity-70 before:bg-slate-300"
          : "active:bg-slate-50 hover:border-foreground/15 hover:bg-slate-50/80"
      }`
    : `group relative flex h-full min-h-[300px] w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white px-6 py-6 text-left shadow-[0_16px_34px_-28px_rgba(15,23,42,0.32)] transition-all duration-500 ease-out before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-1 ${styles.topBorderClass} ${
        isDisabled
          ? "cursor-not-allowed opacity-75 before:bg-slate-300"
          : "hover:-translate-y-1 hover:border-foreground/15 hover:shadow-floating"
      }`;

  const chevron = !isDisabled ? (
    <span
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${styles.chevronBtnClasses}`}
      aria-hidden
    >
      <ChevronRight className="h-4 w-4" strokeWidth={2.25} />
    </span>
  ) : (
    <span
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-400"
      aria-hidden
    >
      <ChevronRight className="h-4 w-4" strokeWidth={2.25} />
    </span>
  );

  const content = compact ? (
    <>
      <span
        className={`relative z-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${styles.iconClasses}`}
      >
        {renderHubIcon(Icon, "h-4 w-4")}
      </span>
      <div className="relative z-1 min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-bold leading-tight text-slate-900">
            {item.title}
          </span>
          <span
            className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${styles.badgeClasses}`}
          >
            {item.badge}
          </span>
        </div>
        <p className="mt-0.5 hidden text-xs text-slate-500 sm:line-clamp-1 sm:block">
          {item.description}
        </p>
        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          {footerLabel}
        </p>
      </div>
      {chevron}
    </>
  ) : (
    <>
      {!isDisabled ? (
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 z-0 rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100 ${styles.radialWashClass}`}
        />
      ) : null}
      <div className="relative z-1 flex items-start justify-between gap-3">
        <span
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-transform duration-500 ease-out will-change-transform ${
            isDisabled ? "" : "group-hover:scale-105"
          } ${styles.iconClasses}`}
        >
          {renderHubIcon(Icon, "h-5 w-5")}
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
      <span className="relative z-1 mt-3 block min-h-[3.5rem] text-xl font-black leading-snug tracking-tight text-slate-900 sm:text-2xl">
        {item.title}
      </span>
      <span className="relative z-1 mt-3 line-clamp-4 min-h-[5.5rem] flex-1 text-sm leading-relaxed text-slate-600">
        {item.description}
      </span>
      <div className="relative z-1 mt-auto flex items-center justify-between gap-3 pt-8">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
          {footerLabel}
        </span>
        {chevron}
      </div>
    </>
  );

  if (isDisabled) {
    return (
      <div
        aria-disabled="true"
        className={cardClassName}
        title="Modulo en mantenimiento y desarrollo"
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onNavigate(item.href ?? "/")}
      className={cardClassName}
    >
      {content}
    </button>
  );
}

type HubModuleGridProps = {
  theme: HubSectionTheme;
  items: HubModuleItem[];
  onNavigate: (href: string) => void;
  columnsClassName?: string;
  tourAnchorId?: string;
  density?: "default" | "compact";
};

export function PortalHubModuleGrid({
  theme,
  items,
  onNavigate,
  columnsClassName = "gap-4 sm:grid-cols-2 lg:grid-cols-3",
  tourAnchorId,
  density = "default",
}: HubModuleGridProps) {
  const total = items.length;
  return (
    <div id={tourAnchorId} className={`mt-4 grid ${columnsClassName}`}>
      {items.map((item, index) => (
        <PortalHubModuleCard
          key={item.id}
          theme={theme}
          item={item}
          index={index}
          total={total}
          onNavigate={onNavigate}
          density={density}
        />
      ))}
    </div>
  );
}
