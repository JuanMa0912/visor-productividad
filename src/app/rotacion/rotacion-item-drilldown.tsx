"use client";

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

  return (
    <a
      href={inventarioHref}
      target="_blank"
      rel="noopener noreferrer"
      title="Abrir Inventario x item"
      className={cn(
        "rounded px-0.5 text-xs font-semibold text-slate-900 no-underline hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60",
        className,
      )}
    >
      {itemId}
    </a>
  );
}
