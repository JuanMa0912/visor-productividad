import type { AuthRole } from "@/lib/auth/types";
import type { PortalSectionId } from "@/lib/shared/portal-sections";
import {
  canAccessPortalSubsection,
  isAdminOnlyPortalSubsection,
  resolvePortalSubsectionId,
} from "@/lib/shared/portal-sections";
import {
  canAccessHorariosCompararBoard,
  canAccessInformeVariacion,
  canAccessOrdenesCompra,
  canAccessPreciosProveedor,
  canAccessProveedoresBoard,
  canAccessRotacionBoard,
} from "@/lib/shared/special-role-features";
import {
  VENTA_ITEM_BOARD_MODULE_ID,
  canAccessVentaItemBoard,
  firstVentaItemBoardHref,
} from "@/lib/shared/venta-item-board";

export type ControlRoomModuleAccess = {
  id: string;
  section: PortalSectionId;
  href?: string;
};

export type ControlRoomAccessInput = {
  role: AuthRole;
  isAdmin: boolean;
  allowedDashboards: string[] | null;
  allowedSubdashboards: string[] | null;
  specialRoles: string[] | null;
  visibleSectionIds: PortalSectionId[];
};

/**
 * Misma regla que los hubs `/venta`, `/productividad` y `/horario`.
 * No relaja opt-in (costos, OC) ni roles especiales (comparar horarios).
 */
export const canSeeControlRoomModule = (
  module: ControlRoomModuleAccess,
  input: ControlRoomAccessInput,
): boolean => {
  if (!input.visibleSectionIds.includes(module.section)) return false;

  const subs = input.allowedSubdashboards;
  if (module.id === "precios-proveedor") {
    return canAccessPreciosProveedor(
      input.role,
      input.allowedDashboards,
      subs,
    );
  }
  if (module.id === "proveedores") {
    return canAccessProveedoresBoard(input.isAdmin, subs);
  }
  if (module.id === "ordenes-compra") {
    return canAccessOrdenesCompra(input.role, input.allowedDashboards, subs);
  }
  if (module.id === "rotacion") {
    return canAccessRotacionBoard(input.specialRoles, input.isAdmin, subs);
  }
  if (module.id === "informe-variacion") {
    return canAccessInformeVariacion(
      input.role,
      input.allowedDashboards,
      subs,
      input.specialRoles,
    );
  }
  if (module.id === "horarios-comparar") {
    if (!canAccessHorariosCompararBoard(input.specialRoles, input.isAdmin)) {
      return false;
    }
    if (input.isAdmin) return true;
    const subId = resolvePortalSubsectionId(module.id);
    if (!subId) return false;
    return canAccessPortalSubsection(subs, subId);
  }

  if (module.id === VENTA_ITEM_BOARD_MODULE_ID) {
    return canAccessVentaItemBoard(input.isAdmin, subs);
  }

  if (input.isAdmin) return true;
  const subId = resolvePortalSubsectionId(module.id);
  if (!subId) return false;
  if (isAdminOnlyPortalSubsection(subId)) return false;
  return canAccessPortalSubsection(subs, subId);
};

export const filterControlRoomModules = <T extends ControlRoomModuleAccess>(
  modules: T[],
  input: ControlRoomAccessInput,
): T[] =>
  modules
    .filter((module) => canSeeControlRoomModule(module, input))
    .map((module) => {
      if (module.id !== VENTA_ITEM_BOARD_MODULE_ID) return module;
      return {
        ...module,
        href: firstVentaItemBoardHref(input.isAdmin, input.allowedSubdashboards),
      };
    });

export const sectionIdsWithVisibleModules = (
  modules: ReadonlyArray<{ section: PortalSectionId }>,
): PortalSectionId[] => {
  const present = new Set(modules.map((module) => module.section));
  return (["venta", "producto", "operacion"] as const).filter((id) =>
    present.has(id),
  );
};
