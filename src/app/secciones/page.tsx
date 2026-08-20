"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import {
  CONTROL_ROOM_MODULES,
  PortalControlRoom,
  type ControlRoomDomain,
} from "@/components/portal/portal-control-room";
import { PORTAL_SECTIONS } from "@/lib/shared/portal-sections";
import { filterControlRoomModules } from "@/lib/shared/control-room-access";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import { useProductTour } from "@/lib/ui/product-tour/use-product-tour";
import {
  TUTORIAL_LOCAL_STORAGE_KEYS,
  TUTORIAL_STATE_KEYS,
} from "@/lib/ui/tutorial-keys";
import { PORTAL_SECTIONS_TOUR_ANCHOR } from "@/lib/ui/portal-tours/sections-anchors";
import { buildPortalSectionsTourSteps } from "@/lib/ui/portal-tours/sections-tour-steps";
import "driver.js/dist/driver.css";
import "@/lib/ui/product-tour/product-tour.css";

export default function SeccionesPage() {
  const router = useRouter();
  const { user, status } = useRequireAuth();
  const { isAdmin, hasSpecialRole } = usePermissions();
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
    () => buildPortalSectionsTourSteps(visibleSections.map((section) => section.id)),
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
        focus: section.focus,
        description: section.description,
        hubHref: section.href,
        accent: section.id,
      })),
    [visibleSections],
  );

  const visibleModules = useMemo(() => {
    if (!user) return [];
    return filterControlRoomModules(CONTROL_ROOM_MODULES, {
      role: user.role,
      isAdmin,
      allowedDashboards: user.allowedDashboards,
      allowedSubdashboards: user.allowedSubdashboards,
      specialRoles: user.specialRoles,
      visibleSectionIds: visibleSections.map((section) => section.id),
    });
  }, [user, isAdmin, visibleSections]);

  if (!ready || !user) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-600">
        <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6">
          <p className="text-sm">Cargando secciones...</p>
        </div>
      </div>
    );
  }

  const canAccessCronograma = hasSpecialRole("cronograma");

  return (
    <div className="min-h-screen bg-slate-50">
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
      {visibleSections.length === 0 ? (
        <div className="mx-auto max-w-6xl px-4 pb-10 lg:px-6">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Tu usuario no tiene secciones asignadas en este momento.
          </div>
        </div>
      ) : null}
    </div>
  );
}
