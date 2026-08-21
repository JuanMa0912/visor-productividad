"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import { VentaItemBoardTabs } from "@/components/portal/venta-item-board-tabs";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import { AnalisisInventarioBoard } from "./analisis-inventario-board";

export default function AnalisisDeInventarioPage() {
  const router = useRouter();
  const { user, status } = useRequireAuth();
  const { isAdmin, hasSection, hasSubsection, hasSpecialRole } =
    usePermissions();

  useEffect(() => {
    if (status !== "authenticated") return;
    if (!hasSection("venta") || !hasSubsection("analisis-de-inventario")) {
      router.replace("/secciones");
    }
  }, [status, hasSection, hasSubsection, router]);

  const canAccessCronograma = hasSpecialRole("cronograma");

  if (status !== "authenticated" || !user) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <p className="text-sm text-slate-600">Cargando módulo...</p>
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
      <div className="mx-auto w-full max-w-[1400px] px-4 py-6 lg:px-6">
        <div className="mb-6 flex flex-wrap items-start gap-4">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-teal-100 bg-teal-50 text-teal-700">
            <Layers className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-teal-700">
              Venta • Inventario
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900">
              Días de inventario
            </h1>
            <VentaItemBoardTabs
              active="analisis-de-inventario"
              className="mt-4 max-w-3xl"
            />
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600">
              Cobertura de inventario por sede con drill categoría → línea →
              sublínea → ítem y mapa de calor para comparar sedes.
            </p>
          </div>
        </div>
        <AnalisisInventarioBoard username={user.username} />
      </div>
    </div>
  );
}
