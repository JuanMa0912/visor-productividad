"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PieChart } from "lucide-react";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";

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
          <p className="text-sm text-slate-600">Cargando modulo...</p>
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
      <div className="mx-auto w-full max-w-3xl px-4 py-8 lg:px-6">
        <Link
          href="/venta"
          className="inline-flex text-sm font-semibold text-blue-700 underline-offset-4 hover:underline"
        >
          Volver a Venta
        </Link>
        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 border-t-4 border-t-blue-500 bg-white px-6 py-8 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.28)]">
          <div className="flex flex-wrap items-start gap-4">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600">
              <PieChart className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-600">
                Venta • Analisis
              </p>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
                Análisis de inventario
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                Este modulo esta en construccion. Aqui podras profundizar en el
                inventario frente a la venta con vistas analiticas.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
