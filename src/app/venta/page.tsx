"use client";

import { useEffect, useState } from "react";
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
  canAccessPortalSection,
  canAccessPortalSubsection,
  resolvePortalSubsectionId,
} from "@/lib/portal-sections";

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
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [canAccessCronograma, setCanAccessCronograma] = useState(false);
  const [visibleModules, setVisibleModules] = useState<HubModuleItem[]>([]);

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
            allowedSubdashboards?: string[] | null;
            specialRoles?: string[] | null;
          };
        };
        const userIsAdmin = payload.user?.role === "admin";
        if (
          !userIsAdmin &&
          !canAccessPortalSection(payload.user?.allowedDashboards, "venta")
        ) {
          router.replace("/secciones");
          return;
        }
        if (isMounted) {
          const allowedSubdashboards = payload.user?.allowedSubdashboards;
          setIsAdmin(userIsAdmin);
          setCanAccessCronograma(
            userIsAdmin ||
              Boolean(payload.user?.specialRoles?.includes("cronograma")),
          );
          const nextVisibleModules = VENTA_MODULES.filter((module) =>
            userIsAdmin
              ? true
              : (() => {
                  const subId = resolvePortalSubsectionId(module.id);
                  if (!subId) return false;
                  return canAccessPortalSubsection(allowedSubdashboards, subId);
                })(),
          );
          if (nextVisibleModules.length === 0) {
            router.replace("/secciones");
            return;
          }
          setVisibleModules(nextVisibleModules);
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
