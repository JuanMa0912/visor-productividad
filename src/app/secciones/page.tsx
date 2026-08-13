"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import {
  CONTROL_ROOM_MODULES,
  PortalControlRoom,
  type ControlRoomDomain,
  type ControlRoomModule,
} from "@/components/portal/portal-control-room";
import {
  PORTAL_SECTIONS,
  canAccessPortalSubsection,
  isAdminOnlyPortalSubsection,
  resolvePortalSubsectionId,
  type PortalSectionId,
} from "@/lib/shared/portal-sections";
import {
  canAccessHorariosCompararBoard,
  canAccessInformeVariacion,
  canAccessProveedoresBoard,
  canAccessRotacionBoard,
} from "@/lib/shared/special-role-features";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import { useUaidSurfaceTheme } from "@/components/portal/uaid-surface-theme";
import { useProductTour } from "@/lib/ui/product-tour/use-product-tour";
import {
  TUTORIAL_LOCAL_STORAGE_KEYS,
  TUTORIAL_STATE_KEYS,
} from "@/lib/ui/tutorial-keys";
import { PORTAL_SECTIONS_TOUR_ANCHOR } from "@/lib/ui/portal-tours/sections-anchors";
import { buildPortalSectionsTourSteps } from "@/lib/ui/portal-tours/sections-tour-steps";
import "driver.js/dist/driver.css";
import "@/lib/ui/product-tour/product-tour.css";

const DOMAIN_COPY: Record<
  PortalSectionId,
  { focus: string; description: string }
> = {
  venta: {
    focus: "Resultado comercial",
    description:
      "Participación, proveedores y ventas por ítem — hacia dónde va la demanda.",
  },
  producto: {
    focus: "Causa y comportamiento",
    description:
      "Márgenes, rotación e informe de variación — dónde está el riesgo.",
  },
  operacion: {
    focus: "Ejecución en piso",
    description:
      "Consulta operativa, checklists y horarios — el día a día por sede.",
  },
};

export default function SeccionesPage() {
  const router = useRouter();
  const { user, status } = useRequireAuth();
  const { isAdmin, hasSpecialRole } = usePermissions();
  const { surface } = useUaidSurfaceTheme();
  const dark = surface === "dark";
  const ready = status === "authenticated" && Boolean(user);

  const visibleSections = useMemo(() => {
    if (!user) return [];
    const allowedDashboards = user.allowedDashboards;
    return isAdmin || allowedDashboards === null
      ? PORTAL_SECTIONS
      : PORTAL_SECTIONS.filter((section) =>
          allowedDashboards.includes(section.id),
        );
  }, [user, isAdmin]);

  const tourSteps = useMemo(
    () => buildPortalSectionsTourSteps(visibleSections.map((s) => s.id)),
    [visibleSections],
  );

  const { startTour } = useProductTour({
    localStorageKey: TUTORIAL_LOCAL_STORAGE_KEYS.portalSections,
    stateKey: TUTORIAL_STATE_KEYS.portalSections,
    steps: tourSteps,
    theme: "portal",
    userId: user?.id,
    ready,
    contentReady: visibleSections.length > 0,
  });

  const domains: ControlRoomDomain[] = useMemo(
    () =>
      visibleSections.map((section) => ({
        id: section.id,
        label: section.label,
        focus: DOMAIN_COPY[section.id].focus,
        description: DOMAIN_COPY[section.id].description,
        hubHref: section.href,
        accent: section.id,
      })),
    [visibleSections],
  );

  const visibleModules: ControlRoomModule[] = useMemo(() => {
    if (!user) return [];
    const allowedSubdashboards = user.allowedSubdashboards ?? null;
    const sectionIds = new Set(visibleSections.map((s) => s.id));
    const canSeeRotacion = canAccessRotacionBoard(
      user.specialRoles ?? null,
      isAdmin,
      allowedSubdashboards,
    );
    const canSeeInforme = canAccessInformeVariacion(
      user.role,
      user.allowedDashboards,
      user.allowedSubdashboards,
      user.specialRoles,
    );
    const canSeeComparar = canAccessHorariosCompararBoard(
      user.specialRoles ?? null,
      isAdmin,
    );

    return CONTROL_ROOM_MODULES.filter((module) => {
      if (!sectionIds.has(module.section)) return false;

      if (module.id === "precios-proveedor") return isAdmin;
      if (module.id === "proveedores") {
        return canAccessProveedoresBoard(isAdmin, allowedSubdashboards);
      }
      if (module.id === "rotacion") return isAdmin || canSeeRotacion;
      if (module.id === "informe-variacion") return isAdmin || canSeeInforme;
      if (module.id === "horarios-comparar") return canSeeComparar;

      if (isAdmin) return true;
      const subId = resolvePortalSubsectionId(module.id);
      if (!subId) return false;
      if (isAdminOnlyPortalSubsection(subId)) return false;
      return canAccessPortalSubsection(allowedSubdashboards, subId);
    });
  }, [user, isAdmin, visibleSections]);

  if (!ready || !user) {
    return (
      <div
        className={
          dark
            ? "min-h-screen bg-[#070b14] px-4 py-10 text-slate-300"
            : "min-h-screen bg-slate-50 px-4 py-10 text-slate-600"
        }
      >
        <div
          className={
            dark
              ? "mx-auto w-full max-w-md rounded-2xl border border-white/10 bg-slate-950/80 p-6"
              : "mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6"
          }
        >
          <p className="text-sm">Cargando secciones...</p>
        </div>
      </div>
    );
  }

  const canAccessCronograma = hasSpecialRole("cronograma");

  return (
    <div className={dark ? "min-h-screen bg-[#070b14]" : "min-h-screen bg-slate-50"}>
      <PortalBrandingHeader
        canAccessCronograma={canAccessCronograma}
        isAdmin={isAdmin}
        username={user.username}
        sede={user.sede}
        onTourHelp={startTour}
      />
      <PortalControlRoom
        domains={domains}
        modules={visibleModules}
        introId={PORTAL_SECTIONS_TOUR_ANCHOR.intro}
        gridId={PORTAL_SECTIONS_TOUR_ANCHOR.grid}
        domainTourId={(id) => PORTAL_SECTIONS_TOUR_ANCHOR.card(id)}
        onOpen={(href) => router.push(href)}
      />
      {visibleSections.length === 0 && (
        <div className="mx-auto max-w-6xl px-4 pb-10 lg:px-6">
          <div
            className={
              dark
                ? "rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
                : "rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            }
          >
            Tu usuario no tiene secciones asignadas en este momento.
          </div>
        </div>
      )}
    </div>
  );
}
