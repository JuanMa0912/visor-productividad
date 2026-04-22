"use client";

import { useEffect, useMemo, useState } from "react";
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
import { canAccessPortalSection } from "@/lib/portal-sections";
import { canAccessRotacionBoard } from "@/lib/special-role-features";

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

export default function ProductividadHubPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [canSeeRotacion, setCanSeeRotacion] = useState(false);
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
          !canAccessPortalSection(payload.user?.allowedDashboards, "producto")
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
          setCanSeeRotacion(
            canAccessRotacionBoard(payload.user?.specialRoles, userIsAdmin),
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
    if (!canSeeRotacion) return BASE_PRODUCTO_MODULES;
    const withRotacion = [...BASE_PRODUCTO_MODULES];
    withRotacion.splice(2, 0, ROTACION_MODULE);
    return withRotacion;
  }, [canSeeRotacion]);

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
        theme="producto"
        icon={Boxes}
        eyebrow="Producto • Enfoque • Causa"
        title="Causa comercial del resultado"
        description="Usa esta seccion para entender que lineas, productos y margenes explican el resultado del negocio por sede."
        moduleCount={modules.length}
      />
      <PortalHubModuleGrid
        theme="producto"
        items={modules}
        onNavigate={(href) => router.push(href)}
        columnsClassName="gap-4 md:grid-cols-2 xl:grid-cols-4"
      />
      </PortalHubShell>
    </div>
  );
}
