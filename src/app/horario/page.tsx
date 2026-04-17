"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Clock, GitCompareArrows } from "lucide-react";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import {
  PortalHubHeroCard,
  PortalHubModuleGrid,
  PortalHubShell,
  type HubModuleItem,
} from "@/components/portal/hub-section-cards";
import { canAccessPortalSection } from "@/lib/portal-sections";
import { canAccessHorariosCompararBoard } from "@/lib/special-role-features";

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
  const [ready, setReady] = useState(false);
  const [canSeeCompararHorarios, setCanSeeCompararHorarios] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [canAccessCronograma, setCanAccessCronograma] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const loadUser = async () => {
      try {
        const response = await fetch("/api/auth/me", {
          signal: controller.signal,
        });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) return;
        const payload = (await response.json()) as {
          user?: {
            role?: string;
            allowedDashboards?: string[] | null;
            specialRoles?: string[] | null;
          };
        };
        const userIsAdmin = payload.user?.role === "admin";
        if (
          !userIsAdmin &&
          !canAccessPortalSection(payload.user?.allowedDashboards, "operacion")
        ) {
          router.replace("/secciones");
          return;
        }
        if (isMounted) {
          setIsAdmin(userIsAdmin);
          setCanAccessCronograma(
            userIsAdmin ||
              Boolean(payload.user?.specialRoles?.includes("cronograma")),
          );
          setCanSeeCompararHorarios(
            canAccessHorariosCompararBoard(
              payload.user?.specialRoles,
              userIsAdmin,
            ),
          );
          setReady(true);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    };

    void loadUser();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [router]);

  const modules = useMemo(() => {
    if (!canSeeCompararHorarios) return BASE_OPERACION_MODULES;
    return [BASE_OPERACION_MODULES[0], COMPARAR_MODULE, BASE_OPERACION_MODULES[1]];
  }, [canSeeCompararHorarios]);

  if (!ready) {
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
        onBackToSecciones={() => router.push("/secciones")}
      />
      <PortalHubShell>
      <PortalHubHeroCard
        theme="operacion"
        icon={Activity}
        eyebrow="Operación • Enfoque • Ejecución"
        title="Ejecucion del negocio"
        description="Aqui se explica como la operacion soporta el resultado: uso de horas, personal, novedades y turnos por sede."
        moduleCount={modules.length}
      />
      <PortalHubModuleGrid
        theme="operacion"
        items={modules}
        onNavigate={(href) => router.push(href)}
        columnsClassName="gap-4 sm:grid-cols-2 lg:grid-cols-3"
      />
      </PortalHubShell>
    </div>
  );
}
