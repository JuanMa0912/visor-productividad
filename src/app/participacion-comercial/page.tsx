"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Share2 } from "lucide-react";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import { ParticipacionComercialBoard } from "./participacion-comercial-board";

export default function ParticipacionComercialPage() {
  const router = useRouter();
  const { user, status } = useRequireAuth();
  const { isAdmin, hasSection, hasSubsection, hasSpecialRole } =
    usePermissions();

  useEffect(() => {
    if (status !== "authenticated") return;
    if (!hasSection("venta") || !hasSubsection("participacion-comercial")) {
      router.replace("/secciones");
    }
  }, [status, hasSection, hasSubsection, router]);

  if (status !== "authenticated" || !user) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200/70 bg-white p-6">
          <p className="text-sm text-slate-600">Cargando módulo...</p>
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
      <div className="mx-auto w-full max-w-[1400px] px-4 py-6 lg:px-6">
        <Link
          href="/venta"
          className="inline-flex text-sm font-semibold text-blue-700 underline-offset-4 hover:underline"
        >
          Volver a Venta
        </Link>
        <div className="mt-4 mb-6 flex flex-wrap items-start gap-4">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-700">
            <Share2 className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-indigo-700">
              Venta • Mix
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900">
              Participación comercial
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
              Cuánto aporta cada línea en una sede (o cada sede en una línea),
              por almacén, con drill a categoría, sublínea e ítem.
            </p>
          </div>
        </div>
        <ParticipacionComercialBoard />
      </div>
    </div>
  );
}
