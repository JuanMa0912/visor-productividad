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

export type ControlRoomModuleAccess = {
  id: string;
  section: PortalSectionId;
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

  if (input.isAdmin) return true;
  const subId = resolvePortalSubsectionId(module.id);
  if (!subId) return false;
  if (isAdminOnlyPortalSubsection(subId)) return false;
  return canAccessPortalSubsection(subs, subId);
};

export const filterControlRoomModules = <T extends ControlRoomModuleAccess>(
  modules: T[],
  input: ControlRoomAccessInput,
): T[] => modules.filter((module) => canSeeControlRoomModule(module, input));
