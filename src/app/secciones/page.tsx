"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Activity, BarChart3, Boxes, ChevronRight } from "lucide-react";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import {
  PORTAL_SECTIONS,
  type PortalSectionId,
} from "@/lib/shared/portal-sections";
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

const SECTION_STYLES: Record<
  PortalSectionId,
  {
    radialWashClass: string;
    topBorderClass: string;
    eyebrowClass: string;
    badgeClasses: string;
    iconClasses: string;
    chevronBtnClasses: string;
  }
> = {
  venta: {
    radialWashClass:
      "bg-[radial-gradient(ellipse_120%_100%_at_50%_-25%,rgba(59,130,246,0.16),transparent_58%)]",
    topBorderClass: "before:bg-blue-500",
    eyebrowClass: "text-blue-600",
    badgeClasses:
      "border-blue-200/90 bg-blue-50/90 text-blue-700 ring-1 ring-blue-100/80",
    iconClasses: "border-blue-100 bg-blue-50 text-blue-600",
    chevronBtnClasses:
      "border-blue-200/80 bg-blue-50 text-blue-600 hover:bg-blue-100/90",
  },
  producto: {
    radialWashClass:
      "bg-[radial-gradient(ellipse_120%_100%_at_50%_-25%,rgba(245,158,11,0.16),transparent_58%)]",
    topBorderClass: "before:bg-amber-500",
    eyebrowClass: "text-amber-700",
    badgeClasses:
      "border-amber-200/90 bg-amber-50/90 text-amber-800 ring-1 ring-amber-100/80",
    iconClasses: "border-amber-100 bg-amber-50 text-amber-600",
    chevronBtnClasses:
      "border-amber-200/80 bg-amber-50 text-amber-700 hover:bg-amber-100/90",
  },
  operacion: {
    radialWashClass:
      "bg-[radial-gradient(ellipse_120%_100%_at_50%_-25%,rgba(244,63,94,0.14),transparent_58%)]",
    topBorderClass: "before:bg-rose-500",
    eyebrowClass: "text-rose-700",
    badgeClasses:
      "border-rose-200/90 bg-rose-50/90 text-rose-800 ring-1 ring-rose-100/80",
    iconClasses: "border-rose-100 bg-rose-50 text-rose-600",
    chevronBtnClasses:
      "border-rose-200/80 bg-rose-50 text-rose-700 hover:bg-rose-100/90",
  },
};

const SECTION_EYEBROW: Record<PortalSectionId, string> = {
  venta: "Venta • Enfoque • Resultado",
  producto: "Producto • Enfoque • Causa",
  operacion: "Operación • Enfoque • Ejecución",
};

const SECTION_BADGE_TAG: Record<PortalSectionId, string> = {
  venta: "VENTA",
  producto: "PRODUCTO",
  operacion: "OPERACIÓN",
};

const SECTION_ICONS: Record<PortalSectionId, typeof BarChart3> = {
  venta: BarChart3,
  producto: Boxes,
  operacion: Activity,
};

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

  if (!ready || !user) {
    return (
      <div className="min-h-screen bg-background px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-md rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <p className="text-sm text-slate-600">Cargando secciones...</p>
        </div>
      </div>
    );
  }

  const canAccessCronograma = hasSpecialRole("cronograma");
  const sectionCount = visibleSections.length;

  return (
    <div className="min-h-screen bg-slate-100 text-foreground">
      <PortalBrandingHeader
        canAccessCronograma={canAccessCronograma}
        isAdmin={isAdmin}
        username={user.username}
        sede={user.sede}
        onTourHelp={startTour}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-8 lg:px-6">
        <p
          id={PORTAL_SECTIONS_TOUR_ANCHOR.intro}
          className="max-w-5xl text-sm leading-6 text-slate-600"
        >
          El Portal UAID integra en un solo entorno la vision completa del
          negocio a traves de tres dimensiones clave:{" "}
          <strong className="font-semibold text-slate-800">Venta</strong>,{" "}
          <strong className="font-semibold text-slate-800">Producto</strong> y{" "}
          <strong className="font-semibold text-slate-800">Operacion</strong>,
          permitiendo entender no solo el resultado, sino tambien sus causas y
          la forma en que se ejecuta.
        </p>

        <div
          id={PORTAL_SECTIONS_TOUR_ANCHOR.grid}
          className="grid gap-4 lg:grid-cols-3"
        >
          {visibleSections.map((section, index) => {
            const styles = SECTION_STYLES[section.id];
            const Icon = SECTION_ICONS[section.id];
            const sectionNumber = String(index + 1).padStart(2, "0");
            const modulesCount = String(section.modules.length).padStart(
              2,
              "0",
            );
            return (
              <button
                key={section.id}
                id={PORTAL_SECTIONS_TOUR_ANCHOR.card(section.id)}
                type="button"
                onClick={() => router.push(section.href)}
                className={`group relative flex min-h-[280px] w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white px-6 py-6 text-left shadow-[0_16px_34px_-28px_rgba(15,23,42,0.32)] transition-all duration-500 ease-out before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-1 hover:-translate-y-1 hover:border-foreground/15 hover:shadow-floating ${styles.topBorderClass}`}
              >
                <span
                  aria-hidden
                  className={`pointer-events-none absolute inset-0 z-0 rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100 ${styles.radialWashClass}`}
                />
                <div className="relative z-1 flex items-start justify-between gap-3">
                  <span
                    className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-transform duration-500 ease-out will-change-transform group-hover:scale-105 ${styles.iconClasses}`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 text-right">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                      {sectionNumber} /{" "}
                      {String(Math.max(sectionCount, 1)).padStart(2, "0")}
                    </p>
                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                      {modulesCount} modulos
                    </p>
                  </div>
                </div>
                <p
                  className={`relative z-1 mt-4 text-[10px] font-bold uppercase tracking-[0.22em] ${styles.eyebrowClass}`}
                >
                  {SECTION_EYEBROW[section.id]}
                </p>
                <p
                  className={`relative z-1 mt-3 inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-[0.06em] ${styles.badgeClasses}`}
                >
                  <span className="text-[0.65rem] leading-none opacity-90">
                    •
                  </span>
                  {SECTION_BADGE_TAG[section.id]}
                </p>
                <span className="relative z-1 mt-3 block text-xl font-black leading-snug tracking-tight text-slate-900 sm:text-2xl">
                  {section.focus}
                </span>
                <span className="relative z-1 mt-3 block text-sm leading-relaxed text-slate-600">
                  {section.description}
                </span>
                <div className="relative z-1 mt-auto flex items-center justify-between gap-3 pt-8">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                    Abrir modulo
                  </span>
                  <span
                    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors ${styles.chevronBtnClasses}`}
                    aria-hidden
                  >
                    <ChevronRight className="h-4 w-4" strokeWidth={2.25} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {visibleSections.length === 0 && (
          <div className="rounded-2xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            Tu usuario no tiene secciones asignadas en este momento.
          </div>
        )}
      </div>
    </div>
  );
}
