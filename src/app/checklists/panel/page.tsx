"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import { useAuth, usePermissions } from "@/lib/auth/auth-context";
import { canAccessChecklistPanel } from "@/lib/checklists/access";
import { getChecklistCatalogEntry } from "@/lib/checklists/catalog";
import { formatChecklistPeriod, getChecklistPeriod } from "@/lib/checklists/period";
import type { ChecklistRunRow } from "@/lib/checklists/session";

const cookieValue = (name: string) => {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : "";
};

const formatDuration = (seconds: number | null) => {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
};

export default function ChecklistPanelPage() {
  const router = useRouter();
  const { user, status } = useAuth();
  const { isAdmin, hasSpecialRole } = usePermissions();
  const current = getChecklistPeriod();
  const [year, setYear] = useState(current.year);
  const [month, setMonth] = useState(current.month);
  const [runs, setRuns] = useState<ChecklistRunRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const allowed = canAccessChecklistPanel(user?.specialRoles, isAdmin);

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/checklists/panel?year=${year}&month=${month}`,
      { cache: "no-store" },
    );
    const json = (await response.json()) as {
      runs?: ChecklistRunRow[];
      error?: string;
    };
    if (!response.ok) throw new Error(json.error || "No se pudo cargar el panel.");
    setRuns(json.runs ?? []);
  }, [month, year]);

  useEffect(() => {
    if (status === "authenticated" && !allowed) {
      router.replace("/checklists");
    }
  }, [allowed, router, status]);

  useEffect(() => {
    if (!allowed) return;
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "No se pudo cargar.");
    });
  }, [allowed, load]);

  const unlock = async (run: ChecklistRunRow) => {
    setBusyId(run.id);
    setError(null);
    try {
      const response = await fetch("/api/checklists/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": cookieValue("vp_csrf"),
        },
        body: JSON.stringify({
          action: "reopen",
          runId: run.id,
          checklistId: run.checklistId,
        }),
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(json.error || "No se pudo desbloquear.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo desbloquear.");
    } finally {
      setBusyId(null);
    }
  };

  const periodValue = useMemo(
    () => formatChecklistPeriod({ year, month }),
    [month, year],
  );

  if (status !== "authenticated" || !user) {
    return (
      <div className="p-8 text-sm text-slate-600">Cargando panel...</div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <PortalBrandingHeader
        canAccessCronograma={hasSpecialRole("cronograma")}
        isAdmin={isAdmin}
        username={user.username}
        sede={user.sede}
        showSeccionesShortcut
      />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/checklists" className="text-sm text-sky-700 hover:underline">
              ← Checklists
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">
              Panel de checklists
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Sedes, puntajes, tiempo y responsables. Desde aquí se desbloquean
              intentos vencidos o sin terminar.
            </p>
          </div>
          <label className="text-xs font-semibold text-slate-600">
            Mes
            <input
              type="month"
              className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={periodValue}
              onChange={(event) => {
                const [nextYear, nextMonth] = event.target.value.split("-");
                setYear(Number(nextYear));
                setMonth(Number(nextMonth));
              }}
            />
          </label>
        </div>
        {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Sede</th>
                <th className="px-3 py-2">Checklist</th>
                <th className="px-3 py-2">Rol</th>
                <th className="px-3 py-2">Responsable</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Tiempo</th>
                <th className="px-3 py-2">Puntaje</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const entry = getChecklistCatalogEntry(run.checklistId);
                const locked = run.status === "expired";
                return (
                  <tr key={run.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <div className="font-medium">{run.sede ?? "—"}</div>
                      <div className="text-xs text-slate-500">{run.empresa}</div>
                    </td>
                    <td className="px-3 py-2">{entry?.title ?? run.checklistId}</td>
                    <td className="px-3 py-2 capitalize">{run.actorRole ?? "—"}</td>
                    <td className="px-3 py-2">{run.username ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {new Date(run.startedAt).toLocaleString("es-CO")}
                    </td>
                    <td className="px-3 py-2">{formatDuration(run.durationSeconds)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {run.scorePct == null ? "—" : `${run.scorePct.toFixed(1)}%`}
                    </td>
                    <td className="px-3 py-2">
                      {run.status === "completed"
                        ? "Completado"
                        : run.status === "expired"
                          ? "Vencido"
                          : "En curso"}
                    </td>
                    <td className="px-3 py-2">
                      {locked ? (
                        <button
                          type="button"
                          disabled={busyId === run.id}
                          onClick={() => void unlock(run)}
                          className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
                        >
                          Desbloquear
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                    No hay checklists en este mes.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
