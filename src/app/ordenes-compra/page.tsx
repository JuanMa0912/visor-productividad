"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import { usePermissions, useRequireAuth } from "@/lib/auth/auth-context";
import { canAccessOrdenesCompra } from "@/lib/shared/special-role-features";
import { OrdenesCompraBoard } from "./ordenes-compra-board";

export default function OrdenesCompraPage() {
  const router = useRouter();
  const { user, status } = useRequireAuth();
  const { isAdmin, hasSpecialRole } = usePermissions();
  const ready = status === "authenticated" && Boolean(user);
  const canAccess = canAccessOrdenesCompra(isAdmin);

  useEffect(() => {
    if (ready && !canAccess) router.replace("/secciones");
  }, [ready, canAccess, router]);

  if (!ready || !user) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200/70 bg-white p-6">
          <p className="text-sm text-slate-600">Cargando sección...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-foreground">
      <PortalBrandingHeader
        canAccessCronograma={hasSpecialRole("cronograma")}
        isAdmin={isAdmin}
        username={user.username}
        sede={user.sede}
        showSeccionesShortcut
      />
      <main className="mx-auto w-full max-w-[90rem] px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-start gap-3">
          <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
            <ClipboardList className="h-6 w-6 text-slate-700" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Admin · Venta
            </p>
            <h1 className="text-2xl font-semibold text-slate-900">Órdenes de compra</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Seguimiento visual de OC abiertas, incompletas y vencidas (SLA 7 días).
              Recarga diaria 8:00. Solo administradores.
            </p>
          </div>
        </div>
        <OrdenesCompraBoard />
      </main>
    </div>
  );
}
