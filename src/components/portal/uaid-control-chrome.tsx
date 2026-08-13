"use client";

import type { ReactNode } from "react";
import { useUaidSurfaceTheme } from "@/components/portal/uaid-surface-theme";

export function UaidCornerMarks({ color }: { color: string }) {
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute top-2 left-2 h-2.5 w-2.5 border-t border-l"
        style={{ borderColor: color }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute top-2 right-2 h-2.5 w-2.5 border-t border-r"
        style={{ borderColor: color }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-2 left-2 h-2.5 w-2.5 border-b border-l"
        style={{ borderColor: color }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute right-2 bottom-2 h-2.5 w-2.5 border-r border-b"
        style={{ borderColor: color }}
      />
    </>
  );
}

export function useUaidControlSurface() {
  const { surface } = useUaidSurfaceTheme();
  const dark = surface === "dark";
  return {
    dark,
    pageBg: dark ? "bg-[#05070d] text-slate-100" : "bg-slate-50 text-slate-900",
    cardBg: dark ? "bg-[#080c16]/90" : "bg-white",
    panelBg: dark ? "bg-[#080c16]/95" : "bg-white",
    muted: dark ? "text-slate-400" : "text-slate-500",
    title: dark ? "text-white" : "text-slate-950",
    hairline: dark ? "border-white/10" : "border-slate-200",
    softBorder: dark ? "border-white/10" : "border-slate-200",
    inputCls: dark
      ? "h-9 w-full rounded-lg border border-white/10 bg-[#05070d] py-2 pr-3 pl-9 text-sm text-white outline-none placeholder:text-slate-600 focus:border-sky-400/40 focus:ring-1 focus:ring-sky-400/20"
      : "h-9 w-full rounded-lg border border-slate-200 bg-white py-2 pr-3 pl-9 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-400 focus:ring-1 focus:ring-sky-200",
    pill: dark
      ? "inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
      : "inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50",
    primaryPill: dark
      ? "inline-flex h-9 items-center gap-2 rounded-full border border-sky-400/30 bg-sky-500/15 px-3.5 text-xs font-semibold text-sky-200 transition hover:bg-sky-500/25"
      : "inline-flex h-9 items-center gap-2 rounded-full bg-sky-600 px-3.5 text-xs font-semibold text-white shadow-sm shadow-sky-600/25 transition hover:bg-sky-700",
  };
}

export function UaidControlAtmosphere({ children }: { children: ReactNode }) {
  const { dark, pageBg } = useUaidControlSurface();
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
      {children}
    </div>
  );
}
