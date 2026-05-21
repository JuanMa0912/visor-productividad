"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ExternalLink } from "lucide-react";

import { buildInventarioXItemDrilldownUrl } from "@/lib/shared/item-drilldown-links";
import { cn } from "@/lib/shared/utils";

type RotacionItemDrilldownProps = {
  itemId: string;
  /** Fecha tope del rango (compat). Si `dateStart` no se provee, se expande a mes corrido. */
  date: string;
  /** Inicio del rango exacto que se esta viendo en rotacion (para igualar el DI). */
  dateStart?: string;
  className?: string;
};

export function RotacionItemDrilldown({
  itemId,
  date,
  dateStart,
  className,
}: RotacionItemDrilldownProps) {
  const inventarioHref = buildInventarioXItemDrilldownUrl(
    itemId,
    dateStart ?? date,
    dateStart ? date : undefined,
  );

  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const popoverId = useId();

  const closePopover = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (wrapperRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      closePopover();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePopover();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, closePopover]);

  return (
    <span ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        title="Ver opciones del item"
        className={cn(
          "rounded px-0.5 text-xs font-semibold text-slate-900 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60",
          className,
        )}
      >
        {itemId}
      </button>
      {open ? (
        <div
          ref={popoverRef}
          id={popoverId}
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 min-w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        >
          <a
            href={inventarioHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={closePopover}
            role="menuitem"
            title="Abrir inventario por sede"
            className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-sky-50 hover:text-sky-700 focus-visible:bg-sky-50 focus-visible:outline-none"
          >
            <span>Inventario x sede</span>
            <ExternalLink className="h-3.5 w-3.5 text-slate-400" aria-hidden />
          </a>
        </div>
      ) : null}
    </span>
  );
}
