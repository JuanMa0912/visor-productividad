"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ClipboardCheck,
  MonitorSmartphone,
  Store,
  Warehouse,
} from "lucide-react";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import {
  PortalHubHeroCard,
  PortalHubModuleGrid,
  PortalHubShell,
  type HubModuleItem,
} from "@/components/portal/hub-section-cards";
import { ChecklistExpiredAdminPanel } from "@/app/checklists/checklist-expired-admin";
import { canAccessChecklistPanel } from "@/lib/checklists/access";
import { CHECKLIST_CATALOG } from "@/lib/checklists/catalog";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import { canAccessPortalSubsection } from "@/lib/shared/portal-sections";

const CHECKLIST_ICONS = {
  "bodega-gerencial": Warehouse,
  "punto-venta": Store,
  "sala-comercial": ClipboardCheck,
  "cajas-operacion": MonitorSmartphone,
} as const;

export default function ChecklistsHubPage() {
  const router = useRouter();
  const { user, status } = useRequireAuth();
  const { isAdmin, hasSpecialRole } = usePermissions();
  const ready = status === "authenticated" && Boolean(user);
  const canAccess =
    isAdmin ||
    canAccessPortalSubsection(user?.allowedSubdashboards, "checklists");
  const canSeePanel = canAccessChecklistPanel(user?.specialRoles, isAdmin);

  const modules = useMemo<HubModuleItem[]>(
    () =>
      CHECKLIST_CATALOG.map((entry) => {
        const available = entry.status === "available";
        return {
          id: entry.id,
          icon:
            CHECKLIST_ICONS[entry.id as keyof typeof CHECKLIST_ICONS] ??
            ClipboardCheck,
          badge: entry.badge,
          title: entry.title,
          description: entry.subtitle,
          href: entry.href,
          disabled: !available,
          footerLabel: available
            ? `${entry.puntos} puntos · ${entry.bloques} bloques`
            : "Próximamente",
        };
      }),
    [],
  );

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
      <PortalHubShell className="max-w-3xl gap-5 py-4 sm:py-6">
        <PortalHubHeroCard
          theme="operacion"
          icon={ClipboardCheck}
          eyebrow="Operación • Checklists"
          title="Checklists"
          description="Un checklist al mes por sede. El revisor lo cruza. En celular: marca, foto si es P/NC y firma al final."
          moduleCount={modules.length}
          density="compact"
          actions={
            <div className="flex flex-wrap justify-end gap-2">
              {canSeePanel ? (
                <Link
                  href="/checklists/panel"
                  className="inline-flex h-9 items-center rounded-full border border-rose-200/80 bg-rose-50 px-3.5 text-[10px] font-bold uppercase tracking-[0.18em] text-rose-800 hover:bg-rose-100/90"
                >
                  Panel
                </Link>
              ) : null}
              <Link
                href="/horario"
                className="inline-flex h-9 items-center rounded-full border border-slate-200/90 bg-white px-3.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              >
                ← Operación
              </Link>
            </div>
          }
        />
        <PortalHubModuleGrid
          theme="operacion"
          items={modules}
          onNavigate={(href) => router.push(href)}
          density="compact"
          columnsClassName="gap-2"
        />
        {canSeePanel ? <ChecklistExpiredAdminPanel /> : null}
      </PortalHubShell>
    </div>
  );
}
