"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import { canAccessProveedoresBoard } from "@/lib/shared/special-role-features";

export default function ProveedoresPage() {
  const router = useRouter();
  const { user, status } = useRequireAuth();
  const { isAdmin, hasSpecialRole } = usePermissions();

  useEffect(() => {
    if (status !== "authenticated") return;
    if (!canAccessProveedoresBoard(isAdmin)) {
      router.replace("/secciones");
    }
  }, [status, isAdmin, router]);

  if (status !== "authenticated" || !user) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200/70 bg-white p-6">
          <p className="text-sm text-slate-600">Cargando módulo...</p>
        </div>
      </div>
    );
  }

  if (!canAccessProveedoresBoard(isAdmin)) {
    return null;
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
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-sky-100 bg-sky-50 text-sky-700">
            <Truck className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-sky-700">
              Venta • Proveedores
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900">
              Proveedores
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
              Tablero en construcción. Acceso limitado a administradores.
            </p>
          </div>
        </div>

        <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center shadow-sm">
          <p className="text-sm font-semibold text-slate-800">
            Contenido pendiente
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
            Aquí irá el tablero de proveedores. La ruta y el hub de Venta ya
            están registrados.
          </p>
        </section>
      </div>
    </div>
  );
}
