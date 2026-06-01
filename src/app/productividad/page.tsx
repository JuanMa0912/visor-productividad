"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  LineChart,
  Percent,
  RefreshCw,
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
  canAccessRotacionBoard,
  canAccessRotacionV4Board,
} from "@/lib/shared/special-role-features";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";

const BASE_PRODUCTO_MODULES: HubModuleItem[] = [
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
];

const ROTACION_MODULE: HubModuleItem = {
  id: "rotacion",
  icon: RefreshCw,
  badge: "ROTACION",
  title: "Inventario con baja salida",
  description:
    "Visualiza productos con baja rotacion y los items que no se estan moviendo por sede.",
  href: "/rotacion",
};

const ROTACION_V4_MODULE: HubModuleItem = {
  id: "rotacion-dos",
  icon: RefreshCw,
  badge: "ROTACION V4",
  title: "Rotacion v4 (prueba)",
  description:
    "Misma vista de rotacion leyendo la tabla rotacion_v4 para validar datos nuevos.",
  href: "/rotacion-dos",
};

export default function ProductividadHubPage() {
  const router = useRouter();
  const { user, status } = useRequireAuth();
  const { isAdmin, hasSection, hasSpecialRole } = usePermissions();

  useEffect(() => {
    if (status === "authenticated" && !hasSection("producto")) {
      router.replace("/secciones");
    }
  }, [status, hasSection, router]);

  const canSeeRotacion = useMemo(
    () =>
      canAccessRotacionBoard(
        user?.specialRoles ?? null,
        isAdmin,
        user?.allowedSubdashboards ?? null,
      ),
    [user?.specialRoles, user?.allowedSubdashboards, isAdmin],
  );

  const modules = useMemo(() => {
    if (!canSeeRotacion) return BASE_PRODUCTO_MODULES;
    const withRotacion = [...BASE_PRODUCTO_MODULES];
    withRotacion.splice(2, 0, ROTACION_MODULE);
    if (canAccessRotacionV4Board(isAdmin)) {
      withRotacion.splice(3, 0, ROTACION_V4_MODULE);
    }
    return withRotacion;
  }, [canSeeRotacion, isAdmin]);

  const allowedSubdashboards = user?.allowedSubdashboards ?? null;
  const visibleModules = useMemo(
    () =>
      modules.filter((module) => {
        if (isAdmin) return true;
        const subId = resolvePortalSubsectionId(module.id);
        if (!subId) return false;
        return canAccessPortalSubsection(allowedSubdashboards, subId);
      }),
    [allowedSubdashboards, isAdmin, modules],
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
        theme="producto"
        icon={Boxes}
        eyebrow="Producto • Enfoque • Causa"
        title="Causa comercial del resultado"
        description="Usa esta seccion para entender que lineas, productos y margenes explican el resultado del negocio por sede."
        moduleCount={visibleModules.length}
      />
      <PortalHubModuleGrid
        theme="producto"
        items={visibleModules}
        onNavigate={(href) => router.push(href)}
        columnsClassName="gap-4 md:grid-cols-2 xl:grid-cols-4"
      />
      </PortalHubShell>
    </div>
  );
}
