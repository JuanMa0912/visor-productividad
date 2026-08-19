"use client";

import { useCallback, useEffect, useState } from "react";
import { getChecklistCatalogEntry } from "@/lib/checklists/catalog";
import type { ChecklistRunRow } from "@/lib/checklists/session";

const cookieValue = (name: string) => {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : "";
};

export function ChecklistExpiredAdminPanel() {
  const [runs, setRuns] = useState<ChecklistRunRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/checklists/runs?scope=expired", {
      cache: "no-store",
    });
    const json = (await response.json()) as {
      runs?: ChecklistRunRow[];
      error?: string;
    };
    if (!response.ok) throw new Error(json.error || "No se pudieron cargar.");
    setRuns(json.runs ?? []);
  }, []);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "No se pudieron cargar.");
    });
  }, [load]);

  const reopen = async (runId: string, checklistId: string) => {
    setBusyId(runId);
    setError(null);
    try {
      const response = await fetch("/api/checklists/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": cookieValue("vp_csrf"),
        },
        body: JSON.stringify({ action: "reopen", runId, checklistId }),
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(json.error || "No se pudo habilitar.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo habilitar.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-base font-semibold text-slate-900">
        Intentos vencidos
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Si alguien no terminó en 20 minutos, habilita aquí otros 20 minutos.
      </p>
      {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
      {runs.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No hay intentos vencidos.</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100">
          {runs.map((run) => {
            const entry = getChecklistCatalogEntry(run.checklistId);
            return (
              <li
                key={run.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {run.username ?? run.userId} · {entry?.title ?? run.checklistId}
                  </p>
                  <p className="text-xs text-slate-500">
                    Venció {new Date(run.deadlineAt).toLocaleString("es-CO")}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyId === run.id}
                  onClick={() => void reopen(run.id, run.checklistId)}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  Habilitar 20 min
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
