"use client";

import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export type StepperStepProps = {
  index: number;
  title: string;
  description?: string;
  summary?: ReactNode;
  isCompleted?: boolean;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
  accentClassName?: string;
};

export function StepperStep({
  index,
  title,
  description,
  summary,
  isCompleted = false,
  isOpen,
  onToggle,
  children,
  accentClassName = "bg-rose-500 text-white",
}: StepperStepProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_4px_16px_-8px_rgba(15,23,42,0.08)] transition-shadow print:border-none print:shadow-none">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-slate-50/60 print:hidden"
      >
        <span
          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            isCompleted ? "bg-emerald-500 text-white" : accentClassName
          }`}
          aria-hidden
        >
          {isCompleted ? <Check className="h-3.5 w-3.5" /> : index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-sm font-bold text-slate-900">{title}</p>
            {description ? (
              <p className="text-xs text-slate-500">{description}</p>
            ) : null}
          </div>
          {!isOpen && summary ? (
            <div className="mt-1 text-xs text-slate-600">{summary}</div>
          ) : null}
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>
      <div
        className={`border-t border-slate-100 px-5 py-4 print:border-none print:px-0 print:py-0 ${
          isOpen ? "" : "hidden"
        } print:block`}
      >
        {children}
      </div>
    </section>
  );
}

export function Stepper({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-3 ${className ?? ""}`}>{children}</div>
  );
}
