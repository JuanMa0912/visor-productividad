"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Package, PieChart } from "lucide-react";
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
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";

const VENTA_MODULES: HubModuleItem[] = [
  {
    id: "ventas-x-item",
    icon: BarChart3,
    badge: "VENTAS",
    title: "Ventas por item",
    description:
      "Consulta el comportamiento de la venta por item y sede para detectar concentraciones, variaciones y participacion comercial.",
    href: "/ventas-x-item",
  },
  {
    id: "inventario-x-item",
    icon: Package,
    badge: "INVENTARIO",
    title: "Inventario x item",
    description:
      "Consolida el inventario por referencia y su lectura resumida dentro de la seccion de venta.",
    href: "/inventario-x-item",
  },
  {
    id: "analisis-de-inventario",
    icon: PieChart,
    badge: "ANALISIS",
    title: "Análisis de inventario",
    description:
      "Profundiza en variaciones, concentracion y lectura analitica del inventario frente a la venta.",
    href: "/analisis-de-inventario",
  },
];

export default function VentaHubPage() {
  const router = useRouter();
  const { user, status } = useRequireAuth();
  const { isAdmin, hasSection, hasSpecialRole } = usePermissions();

  // Si esta autenticado pero no tiene acceso a la seccion `venta`,
  // lo mandamos al hub raiz.
  useEffect(() => {
    if (status === "authenticated" && !hasSection("venta")) {
      router.replace("/secciones");
    }
  }, [status, hasSection, router]);

  const allowedSubdashboards = user?.allowedSubdashboards ?? null;
  const visibleModules = useMemo(
    () =>
      VENTA_MODULES.filter((module) => {
        if (isAdmin) return true;
        const subId = resolvePortalSubsectionId(module.id);
        if (!subId) return false;
        return canAccessPortalSubsection(allowedSubdashboards, subId);
      }),
    [allowedSubdashboards, isAdmin],
  );

  useEffect(() => {
    if (status === "authenticated" && visibleModules.length === 0) {
      router.replace("/secciones");
    }
  }, [status, router, visibleModules.length]);

  const canAccessCronograma = hasSpecialRole("cronograma");

  if (status !== "authenticated" || !user) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <p className="text-sm text-slate-600">Cargando seccion...</p>
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
        sede={user.sede}
        showSeccionesShortcut
      />
      <PortalHubShell>
        <PortalHubHeroCard
          theme="venta"
          icon={BarChart3}
          eyebrow="Venta • Enfoque • Resultado"
          title="Resultado comercial del negocio"
          description="Usa esta seccion para leer el desempeno comercial, seguir tendencias por sede e ingresar a los modulos que explican la venta por item."
          moduleCount={visibleModules.length}
        />
        <PortalHubModuleGrid
          theme="venta"
          items={visibleModules}
          onNavigate={(href) => router.push(href)}
          columnsClassName="gap-4 sm:grid-cols-2 lg:grid-cols-3"
        />
      </PortalHubShell>
    </div>
  );
}
