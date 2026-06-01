"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Activity, Clock, GitCompareArrows } from "lucide-react";
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
import { canAccessHorariosCompararBoard } from "@/lib/shared/special-role-features";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";

const BASE_OPERACION_MODULES: HubModuleItem[] = [
  {
    id: "jornada-extendida",
    icon: Activity,
    badge: "EJECUCION",
    title: "Consulta operativa",
    description:
      "Consulta horas trabajadas, novedades y uso del personal por sede y fecha para medir eficiencia operativa.",
    href: "/jornada-extendida",
  },
  {
    id: "ingresar-horarios",
    icon: Clock,
    badge: "TURNOS",
    title: "Registro de horarios",
    description:
      "Programa y administra horarios del personal para sostener la operacion diaria.",
    href: "/ingresar-horarios",
  },
];

const COMPARAR_MODULE: HubModuleItem = {
  id: "horarios-comparar",
  icon: GitCompareArrows,
  badge: "COMPARAR",
  title: "Planilla vs asistencia",
  description:
    "Compara horarios registrados en planillas con las marcaciones reales por sede y fecha.",
  href: "/horarios-comparar",
};

export default function HorarioHubPage() {
  const router = useRouter();
  const { user, status } = useRequireAuth();
  const { isAdmin, hasSection, hasSpecialRole } = usePermissions();

  // Si el usuario esta autenticado pero no tiene la seccion `operacion`,
  // lo mandamos al hub raiz (`/secciones`).
  useEffect(() => {
    if (status === "authenticated" && !hasSection("operacion")) {
      router.replace("/secciones");
    }
  }, [status, hasSection, router]);

  const canSeeCompararHorarios = useMemo(
    () =>
      canAccessHorariosCompararBoard(user?.specialRoles ?? null, isAdmin),
    [user?.specialRoles, isAdmin],
  );

  const modules = useMemo(() => {
    if (!canSeeCompararHorarios) return BASE_OPERACION_MODULES;
    return [BASE_OPERACION_MODULES[0], COMPARAR_MODULE, BASE_OPERACION_MODULES[1]];
  }, [canSeeCompararHorarios]);

  const allowedSubdashboards = user?.allowedSubdashboards ?? null;
  const visibleModules = useMemo(
    () => {
      return modules.filter((module) => {
        if (isAdmin) return true;
        const subId = resolvePortalSubsectionId(module.id);
        if (!subId) return false;
        return canAccessPortalSubsection(allowedSubdashboards, subId);
      });
    },
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
        theme="operacion"
        icon={Activity}
        eyebrow="Operación • Enfoque • Ejecución"
        title="Ejecucion del negocio"
        description="Aqui se explica como la operacion soporta el resultado: uso de horas, personal, novedades y turnos por sede."
        moduleCount={visibleModules.length}
      />
      <PortalHubModuleGrid
        theme="operacion"
        items={visibleModules}
        onNavigate={(href) => router.push(href)}
        columnsClassName="gap-4 sm:grid-cols-2 lg:grid-cols-3"
      />
      </PortalHubShell>
    </div>
  );
}
