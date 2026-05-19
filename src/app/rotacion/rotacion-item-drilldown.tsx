"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  buildInventarioXItemDrilldownUrl,
  buildVentasXItemDrilldownUrl,
} from "@/lib/shared/item-drilldown-links";
import { cn } from "@/lib/shared/utils";

type RotacionItemDrilldownProps = {
  itemId: string;
  date: string;
  className?: string;
};

export function RotacionItemDrilldown({
  itemId,
  date,
  className,
}: RotacionItemDrilldownProps) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const ventasHref = buildVentasXItemDrilldownUrl(itemId, date);
  const inventarioHref = buildInventarioXItemDrilldownUrl(itemId, date);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target || rootRef.current?.contains(target)) return;
      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative inline-block", className)}>
      <button
        type="button"
        className="rounded px-0.5 text-left text-xs font-semibold text-slate-900 no-underline hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((prev) => !prev)}
      >
        {itemId}
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 min-w-[11.5rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          <a
            role="menuitem"
            href={ventasHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-slate-800 hover:bg-slate-50"
            onClick={() => setOpen(false)}
          >
            <span>Venta x item</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          </a>
          <a
            role="menuitem"
            href={inventarioHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-slate-800 hover:bg-slate-50"
            onClick={() => setOpen(false)}
          >
            <span>Inventario x item</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          </a>
        </div>
      ) : null}
    </div>
  );
}