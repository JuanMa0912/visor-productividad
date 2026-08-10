"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import { CHECKLIST_CATALOG } from "@/lib/checklists/catalog";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";

export default function ChecklistsHubPage() {
  const router = useRouter();
  const { user, status } = useRequireAuth();
  const { isAdmin, hasSpecialRole } = usePermissions();
  const ready = status === "authenticated" && Boolean(user);
  const canAccess = isAdmin;

  useEffect(() => {
    if (ready && !canAccess) {
      router.replace("/secciones");
    }
  }, [ready, canAccess, router]);

  if (!ready || !user) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <p className="text-sm text-slate-600">Cargando sección...</p>
        </div>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200/70 bg-white p-6">
          <p className="text-sm text-slate-600">Sin acceso a checklists.</p>
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
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Operación
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
              Checklists
            </h1>
            <p className="mt-1 max-w-xl text-sm text-slate-600">
              Tableros de auditoría ponderada por sede (solo administradores).
              Guarde y cargue JSON localmente; aún no hay persistencia en
              servidor.
            </p>
          </div>
          <Link
            href="/horario"
            className="text-sm font-medium text-sky-700 hover:underline"
          >
            ← Volver a operación
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CHECKLIST_CATALOG.map((entry) => {
            const available = entry.status === "available";
            const card = (
              <div
                className={`rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_12px_40px_-28px_rgba(15,23,42,0.35)] transition ${
                  available
                    ? "hover:-translate-y-0.5 hover:border-sky-300/80"
                    : "opacity-70"
                }`}
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                    <ClipboardCheck className="h-3.5 w-3.5" />
                    {entry.badge}
                  </span>
                  {!available && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                      Próximamente
                    </span>
                  )}
                </div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {entry.title}
                </h2>
                <p className="mt-1 text-sm text-slate-600">{entry.subtitle}</p>
                {available && (
                  <p className="mt-3 text-xs font-medium text-slate-500">
                    {entry.puntos} puntos · {entry.bloques} bloques
                  </p>
                )}
              </div>
            );

            if (!available) {
              return (
                <div key={entry.id} aria-disabled="true">
                  {card}
                </div>
              );
            }

            return (
              <Link key={entry.id} href={entry.href} className="block">
                {card}
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
