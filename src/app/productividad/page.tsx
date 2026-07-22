"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  LineChart,
  Percent,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import {
  PortalHubHeroCard,
  PortalHubModuleGrid,
  PortalHubShell,
  type HubModuleItem,
} from "@/components/portal/hub-section-cards";
import {
  canAccessPortalSubsection,
  resolvePortalSubsectionId,
} from "@/lib/shared/portal-sections";
import {
  canAccessInformeVariacion,
  canAccessRotacionBoard,
} from "@/lib/shared/special-role-features";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import { useProductTour } from "@/lib/ui/product-tour/use-product-tour";
import { PORTAL_HUB_TOUR_CONFIG } from "@/lib/ui/portal-tours/hub-tour-config";
import {
  PORTAL_HUB_TOUR_ANCHOR,
  buildPortalHubTourSteps,
} from "@/lib/ui/portal-tours/hub-tour-steps";
import "driver.js/dist/driver.css";
import "@/lib/ui/product-tour/product-tour.css";

/** Catálogo fijo de módulos Producto (orden de UI). */
const PRODUCTO_MODULES: HubModuleItem[] = [
  {
    id: "productividad-home",
    icon: LineChart,
    badge: "MIX Y LINEA",
    title: "Desempeño comercial por sede",
    description:
      "Revisa que lineas y sedes empujan o frenan el resultado con comparativos de venta y desempeño.",
    href: "/",
  },
  {
    id: "margenes",
    icon: Percent,
    badge: "MARGENES",
    title: "Rentabilidad por linea",
    description:
      "Entiende el aporte de cada linea al resultado desde margen, utilidad y rentabilidad.",
    href: "/margenes",
  },
  {
    id: "rotacion",
    icon: RefreshCw,
    badge: "ROTACION",
    title: "Inventario con baja salida",
    description:
      "Visualiza productos con baja rotacion y los items que no se estan moviendo por sede.",
    href: "/rotacion",
  },
  {
    id: "informe-variacion",
    icon: TrendingUp,
    badge: "INFORME",
    title: "Informe de Variacion",
    description:
      "Analiza variaciones comerciales MoM y YoY por sede, linea, sublinea e item desde margen unificado.",
    href: "/informe-variacion",
  },
];

const hubTour = PORTAL_HUB_TOUR_CONFIG.producto;

export default function ProductividadHubPage() {
  const router = useRouter();
  const { user, status } = useRequireAuth();
  const { isAdmin, hasSection, hasSpecialRole } = usePermissions();
  const ready = status === "authenticated" && Boolean(user);

  useEffect(() => {
    if (ready && !hasSection("producto")) {
      router.replace("/secciones");
    }
  }, [ready, hasSection, router]);

  const allowedSubdashboards = user?.allowedSubdashboards ?? null;

  const canSeeRotacion = useMemo(
    () =>
      canAccessRotacionBoard(
        user?.specialRoles ?? null,
        isAdmin,
        allowedSubdashboards,
      ),
    [user?.specialRoles, allowedSubdashboards, isAdmin],
  );

  const canSeeInforme = useMemo(
    () =>
      user
        ? canAccessInformeVariacion(
            user.role,
            user.allowedDashboards,
            user.allowedSubdashboards,
            user.specialRoles,
          )
        : false,
    [user],
  );

  const visibleModules = useMemo(() => {
    if (!user && !isAdmin) return [];
    return PRODUCTO_MODULES.filter((module) => {
      if (isAdmin) return true;
      if (module.id === "rotacion") return canSeeRotacion;
      if (module.id === "informe-variacion") return canSeeInforme;
      const subId = resolvePortalSubsectionId(module.id);
      if (!subId) return false;
      return canAccessPortalSubsection(allowedSubdashboards, subId);
    });
  }, [
    allowedSubdashboards,
    canSeeInforme,
    canSeeRotacion,
    isAdmin,
    user,
  ]);

  // Un solo módulo permitido: ir directo (evita hub vacío/confuso).
  useEffect(() => {
    if (!ready) return;
    if (visibleModules.length === 1 && visibleModules[0]?.href) {
      router.replace(visibleModules[0].href);
      return;
    }
    if (visibleModules.length === 0) {
      router.replace("/secciones");
    }
  }, [ready, router, visibleModules]);

  const tourSteps = useMemo(() => buildPortalHubTourSteps("producto"), []);

  const { startTour } = useProductTour({
    localStorageKey: hubTour.localStorageKey,
    stateKey: hubTour.stateKey,
    steps: tourSteps,
    theme: hubTour.theme,
    userId: user?.id,
    ready,
    contentReady: visibleModules.length > 1,
  });

  const canAccessCronograma = hasSpecialRole("cronograma");

  if (!ready || !user) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <p className="text-sm text-slate-600">Cargando seccion...</p>
        </div>
      </div>
    );
  }

  if (visibleModules.length <= 1) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <p className="text-sm text-slate-600">Abriendo modulo...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-foreground">
      <PortalBrandingHeader
        canAccessCronograma={canAccessCronograma}
        isAdmin={isAdmin}
        username={user.username}
        sede={typeof user.sede === "string" ? user.sede : null}
        showSeccionesShortcut
        onTourHelp={startTour}
      />
      <PortalHubShell>
        <PortalHubHeroCard
          theme="producto"
          icon={Boxes}
          eyebrow="Producto • Enfoque • Causa"
          title="Causa comercial del resultado"
          description="Usa esta seccion para entender que lineas, productos y margenes explican el resultado del negocio por sede."
          moduleCount={visibleModules.length}
          tourAnchorId={PORTAL_HUB_TOUR_ANCHOR.hero}
        />
        <PortalHubModuleGrid
          theme="producto"
          items={visibleModules}
          onNavigate={(href) => router.push(href)}
          columnsClassName="gap-4 md:grid-cols-2 xl:grid-cols-4"
          tourAnchorId={PORTAL_HUB_TOUR_ANCHOR.modules}
        />
      </PortalHubShell>
    </div>
  );
}
