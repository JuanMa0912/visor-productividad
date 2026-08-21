import {
  canAccessPortalSubsection,
  type PortalSubsectionId,
} from "@/lib/shared/portal-sections";

export type VentaItemBoardTabId =
  | "analisis-de-inventario"
  | "inventario-x-item"
  | "ventas-x-item";

export type VentaItemBoardTab = {
  id: VentaItemBoardTabId;
  href: string;
  label: string;
};

/** Tarjeta única en `/secciones` y `/venta`; las pestañas siguen las 3 URLs. */
export const VENTA_ITEM_BOARD_MODULE_ID = "analisis-de-inventario";

export const VENTA_ITEM_BOARD_TABS: readonly VentaItemBoardTab[] = [
  {
    id: "analisis-de-inventario",
    href: "/analisis-de-inventario",
    label: "Días de inventario",
  },
  {
    id: "inventario-x-item",
    href: "/inventario-x-item",
    label: "Inventario por sede",
  },
  {
    id: "ventas-x-item",
    href: "/ventas-x-item",
    label: "Ventas por ítem",
  },
];

export const canAccessVentaItemBoard = (
  isAdmin: boolean,
  allowedSubdashboards: unknown,
): boolean => {
  if (isAdmin) return true;
  return VENTA_ITEM_BOARD_TABS.some((tab) =>
    canAccessPortalSubsection(allowedSubdashboards, tab.id),
  );
};

export const firstVentaItemBoardHref = (
  isAdmin: boolean,
  allowedSubdashboards: unknown,
): string => {
  for (const tab of VENTA_ITEM_BOARD_TABS) {
    if (isAdmin || canAccessPortalSubsection(allowedSubdashboards, tab.id)) {
      return tab.href;
    }
  }
  return VENTA_ITEM_BOARD_TABS[0].href;
};

export const visibleVentaItemBoardTabs = (
  canSee: (subsection: PortalSubsectionId) => boolean,
): VentaItemBoardTab[] =>
  VENTA_ITEM_BOARD_TABS.filter((tab) => canSee(tab.id));
