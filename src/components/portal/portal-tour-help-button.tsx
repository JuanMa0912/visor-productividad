"use client";

import { CircleHelp } from "lucide-react";

type PortalTourHelpButtonProps = {
  onClick: () => void;
  label?: string;
  className?: string;
};

export function PortalTourHelpButton({
  onClick,
  label = "Ayuda",
  className = "",
}: PortalTourHelpButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Ver tutorial interactivo"
      className={`group inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-slate-700 shadow-sm backdrop-blur-xs transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-900 ${className}`}
    >
      <CircleHelp
        className="h-4 w-4 text-violet-600 transition group-hover:text-violet-700"
        aria-hidden
      />
      {label}
    </button>
  );
}
