"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AppTopBar } from "@/components/portal/app-top-bar";
import {
  UaidControlAtmosphere,
  UaidCornerMarks,
  useUaidControlSurface,
} from "@/components/portal/uaid-control-chrome";
import { PORTAL_APP_VERSION_LABEL } from "@/lib/shared/uaid-brand";

type ShellProps = {
  children: ReactNode;
  maxWidthClassName?: string;
  backHref?: string;
  backLabel?: string;
  showBack?: boolean;
  /** `none` cuando el preview ya monta PortalBrandingHeader. */
  chrome?: "app-top-bar" | "none";
};

export function AdminUsuariosShell({
  children,
  maxWidthClassName = "max-w-[min(100%,72rem)]",
  backHref,
  backLabel,
  showBack = false,
  chrome = "app-top-bar",
}: ShellProps) {
  return (
    <>
      {chrome === "app-top-bar" ? (
        <AppTopBar
          showBack={showBack || Boolean(backHref)}
          backHref={backHref}
          backLabel={backLabel}
        />
      ) : null}
      <UaidControlAtmosphere>
        <div className="relative mx-auto w-full px-4 py-5 pb-24 sm:px-6 lg:px-6 lg:py-7">
          <div className={`mx-auto flex w-full flex-col gap-6 ${maxWidthClassName}`}>
            {children}
          </div>
        </div>
      </UaidControlAtmosphere>
    </>
  );
}

type HeaderProps = {
  /** Conservado por compatibilidad; el hero UAID 5.0 no usa icono en caja. */
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  nav?: ReactNode;
  liveLabel?: string;
};

export function AdminUsuariosPageHeader({
  title,
  description,
  actions,
  nav,
  liveLabel = "Sala de control admin",
}: HeaderProps) {
  const { muted, title: titleCls, hairline } = useUaidControlSurface();

  return (
    <header className="uaid-panel-rise">
      <div
        className={`mb-2 flex flex-wrap items-end justify-between gap-3 border-b pb-4 ${hairline}`}
      >
        <p
          className={`text-[10px] font-semibold tracking-[0.28em] uppercase ${muted}`}
        >
          Portal / Administración · {PORTAL_APP_VERSION_LABEL}
        </p>
        <div
          className={`flex flex-wrap items-center gap-3 text-[10px] font-semibold tracking-[0.14em] uppercase ${muted}`}
        >
          <span className="inline-flex items-center gap-1.5 normal-case tracking-normal">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="text-emerald-700">{liveLabel}</span>
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <p className="inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.22em] text-emerald-700 uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Usuarios del portal
          </p>
          <h1
            className={`mt-3 text-4xl font-semibold tracking-tight sm:text-5xl ${titleCls}`}
          >
            {title}
          </h1>
          {description ? (
            <p
              className={`mt-3 max-w-2xl text-sm leading-relaxed sm:text-[15px] ${muted}`}
            >
              {description}
            </p>
          ) : null}
          {nav ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">{nav}</div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}

type StatCardProps = {
  code: string;
  label: string;
  value: ReactNode;
  hint: string;
  badge?: ReactNode;
  accent?: "sky" | "emerald" | "slate";
};

const STAT_ACCENT = {
  sky: {
    stroke: "#0284c7",
    border: "border-sky-200",
    wash: "from-sky-50 via-transparent to-transparent",
  },
  emerald: {
    stroke: "#059669",
    border: "border-emerald-200",
    wash: "from-emerald-50 via-transparent to-transparent",
  },
  slate: {
    stroke: "#64748b",
    border: "border-slate-200",
    wash: "from-slate-50 via-transparent to-transparent",
  },
} as const;

export function AdminUsuariosStatCard({
  code,
  label,
  value,
  hint,
  badge,
  accent = "slate",
}: StatCardProps) {
  const { cardBg, muted, title } = useUaidControlSurface();
  const tone = STAT_ACCENT[accent];

  return (
    <div
      className={`uaid-module-in relative overflow-hidden rounded-xl border p-5 shadow-sm ${cardBg} ${tone.border}`}
    >
      <UaidCornerMarks color={tone.stroke} />
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 bg-linear-to-br ${tone.wash}`}
      />
      <div className="relative flex items-start justify-between gap-2">
        <p className={`font-mono text-[10px] tracking-[0.2em] ${muted}`}>
          {code}
        </p>
        {badge}
      </div>
      <p
        className={`relative mt-5 text-[11px] font-semibold tracking-[0.18em] uppercase ${muted}`}
      >
        {label}
      </p>
      <p
        className={`relative mt-1 text-3xl font-semibold tracking-tight tabular-nums ${title}`}
      >
        {value}
      </p>
      <p className={`relative mt-2 text-xs ${muted}`}>{hint}</p>
    </div>
  );
}

type ToolCardProps = {
  icon: LucideIcon;
  label: string;
  code: string;
  href?: string;
  accent?: "sky" | "rose" | "emerald";
  as?: "a" | "span";
};

const TOOL_ACCENT = {
  sky: {
    stroke: "#0284c7",
    border: "border-sky-200",
    wash: "from-sky-50 via-transparent to-transparent",
    soft: "bg-sky-50 text-sky-700",
  },
  rose: {
    stroke: "#e11d48",
    border: "border-rose-200",
    wash: "from-rose-50 via-transparent to-transparent",
    soft: "bg-rose-50 text-rose-700",
  },
  emerald: {
    stroke: "#059669",
    border: "border-emerald-200",
    wash: "from-emerald-50 via-transparent to-transparent",
    soft: "bg-emerald-50 text-emerald-700",
  },
} as const;

export function AdminUsuariosToolCard({
  icon: Icon,
  label,
  code,
  href,
  accent = "sky",
  as = href ? "a" : "span",
}: ToolCardProps) {
  const { cardBg, muted, title } = useUaidControlSurface();
  const tone = TOOL_ACCENT[accent];
  const className = `group relative overflow-hidden rounded-xl border p-4 text-left shadow-sm transition hover:bg-slate-50/80 ${cardBg} ${tone.border}`;
  const body = (
    <>
      <UaidCornerMarks color={tone.stroke} />
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 bg-linear-to-br ${tone.wash}`}
      />
      <div className="relative flex items-start justify-between gap-2">
        <p className={`font-mono text-[9px] tracking-[0.18em] ${muted}`}>
          {code}
        </p>
        <span
          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${tone.soft}`}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className={`relative mt-3 text-sm font-semibold tracking-tight ${title}`}>
        {label}
      </p>
      <p
        className={`relative mt-2 text-[10px] font-bold tracking-[0.14em] uppercase ${muted}`}
      >
        Abrir
      </p>
    </>
  );

  if (as === "a" && href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  return <span className={className}>{body}</span>;
}

export const adminUsuariosPillClass =
  "inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50";

export const adminUsuariosPrimaryPillClass =
  "inline-flex h-9 items-center gap-2 rounded-full bg-sky-600 px-3.5 text-xs font-semibold text-white shadow-sm shadow-sky-600/25 transition hover:bg-sky-700";

export const adminUsuariosSoftLinkClass =
  "inline-flex h-9 items-center gap-1.5 rounded-full border border-sky-200/80 bg-sky-50/70 px-3.5 text-xs font-semibold text-sky-800 shadow-sm transition hover:border-sky-300 hover:bg-sky-100/70";
