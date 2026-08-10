"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { BodegaGerencialBoard } from "@/app/checklists/bodega-board";
import { getChecklistCatalogEntry } from "@/lib/checklists/catalog";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import { canAccessPortalSubsection } from "@/lib/shared/portal-sections";

export default function ChecklistByIdPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const { user, status } = useRequireAuth();
  const { isAdmin } = usePermissions();
  const ready = status === "authenticated" && Boolean(user);

  const allowed = canAccessPortalSubsection(
    user?.allowedSubdashboards,
    "checklists",
  );
  const canAccess = isAdmin || allowed;
  const entry = getChecklistCatalogEntry(id);

  useEffect(() => {
    if (ready && !canAccess) {
      router.replace("/secciones");
    }
  }, [ready, canAccess, router]);

  if (!ready || !user) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200/70 bg-white p-6">
          <p className="text-sm text-slate-600">Cargando checklist...</p>
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

  if (id === "bodega-gerencial" && entry?.status === "available") {
    return <BodegaGerencialBoard />;
  }

  const title = entry?.title ?? "Checklist";
  const comingSoon = entry?.status === "coming_soon";

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-lg rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {comingSoon
            ? "Este checklist estará disponible próximamente."
            : "No encontramos este checklist."}
        </p>
        <Link
          href="/checklists"
          className="mt-4 inline-block text-sm font-medium text-sky-700 hover:underline"
        >
          ← Volver a checklists
        </Link>
      </div>
    </div>
  );
}
