"use client";

import Link from "next/link";
import { usePermissions } from "@/lib/auth/auth-context";
import { cn } from "@/lib/shared/utils";
import {
  visibleVentaItemBoardTabs,
  type VentaItemBoardTabId,
} from "@/lib/shared/venta-item-board";

type VentaItemBoardTabsProps = {
  active: VentaItemBoardTabId;
  className?: string;
};

export function VentaItemBoardTabs({
  active,
  className,
}: VentaItemBoardTabsProps) {
  const { hasSubsection } = usePermissions();
  const tabs = visibleVentaItemBoardTabs(hasSubsection);

  if (tabs.length < 2) return null;

  return (
    <nav
      role="tablist"
      aria-label="Pestañas de días de inventario, inventario y ventas por ítem"
      className={cn(
        "flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm",
        className,
      )}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            role="tab"
            aria-selected={selected}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-semibold transition",
              selected
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
