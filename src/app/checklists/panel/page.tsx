"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutDashboard } from "lucide-react";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import {
  PortalHubHeroCard,
  PortalHubShell,
} from "@/components/portal/hub-section-cards";
import { useAuth, usePermissions } from "@/lib/auth/auth-context";
import { canAccessChecklistPanel } from "@/lib/checklists/access";
import { getChecklistCatalogEntry, checklistItemLabel } from "@/lib/checklists/catalog";
import { formatChecklistPeriod, getChecklistPeriod } from "@/lib/checklists/period";
import type { ChecklistRunRow } from "@/lib/checklists/session";
import {
  formatPriorAnswer,
  parseChecklistSnapshot,
} from "@/lib/checklists/snapshot";

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

const mediaSrc = (payload: string, mime = "image/jpeg") => {
  const value = payload.trim();
  if (!value) return "";
  if (value.startsWith("data:")) return value;
  return `data:${mime};base64,${value}`;
};

type ReviewEvidence = { itemKey: string; fotoBase64: string; mime: string };

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
  const [review, setReview] = useState<ChecklistRunRow | null>(null);
  const [reviewEvidence, setReviewEvidence] = useState<Record<string, ReviewEvidence>>(
    {},
  );
  const [reviewSignature, setReviewSignature] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  const allowed = canAccessChecklistPanel(user?.specialRoles, isAdmin);

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/checklists/panel?year=${year}&month=${month}`,
      { cache: "no-store" },
    );
    const text = await response.text();
    let json: { runs?: ChecklistRunRow[]; error?: string } = {};
    try {
      json = text
        ? (JSON.parse(text) as { runs?: ChecklistRunRow[]; error?: string })
        : {};
    } catch {
      throw new Error(
        response.ok
          ? "El panel devolvió una respuesta ilegible."
          : "No se pudo cargar el panel.",
      );
    }
    if (!response.ok) throw new Error(json.error || "No se pudo cargar el panel.");
    setError(null);
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

  const remove = async (run: ChecklistRunRow) => {
    const title = getChecklistCatalogEntry(run.checklistId)?.title ?? run.checklistId;
    const ok = window.confirm(
      `¿Borrar el checklist de ${title} en ${run.sede ?? "sede"} (${run.username ?? "sin responsable"})? Esta acción no se puede deshacer.`,
    );
    if (!ok) return;
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
          action: "delete",
          runId: run.id,
        }),
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(json.error || "No se pudo borrar.");
      if (review?.id === run.id) {
        setReview(null);
        setReviewEvidence({});
        setReviewSignature(null);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar.");
    } finally {
      setBusyId(null);
    }
  };

  const openReview = async (run: ChecklistRunRow) => {
    setReview(run);
    setReviewEvidence({});
    setReviewSignature(null);
    setReviewLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/checklists/panel?runId=${encodeURIComponent(run.id)}`,
        { cache: "no-store" },
      );
      const json = (await response.json()) as {
        run?: ChecklistRunRow;
        evidence?: ReviewEvidence[];
        signaturePng?: string | null;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(json.error || "No se pudo cargar la revisión.");
      }
      if (json.run) setReview(json.run);
      const next: Record<string, ReviewEvidence> = {};
      for (const item of json.evidence ?? []) {
        if (item.itemKey) next[item.itemKey] = item;
      }
      setReviewEvidence(next);
      setReviewSignature(json.signaturePng ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la revisión.");
    } finally {
      setReviewLoading(false);
    }
  };

  const closeReview = () => {
    setReview(null);
    setReviewEvidence({});
    setReviewSignature(null);
  };

  const reviewAnswers = useMemo(() => {
    if (!review) return [];
    const snapshot = parseChecklistSnapshot(review.answers);
    return Object.entries(snapshot.answers).map(([key, value]) => ({
      key,
      label: checklistItemLabel(review.checklistId, key),
      value: formatPriorAnswer(value.v),
      note: value.n?.trim() || null,
    }));
  }, [review]);

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
      <PortalHubShell>
        <PortalHubHeroCard
          theme="operacion"
          icon={LayoutDashboard}
          eyebrow="Operación • Checklists"
          title="Panel de checklists"
          description="Sedes, puntajes, tiempo y responsables. Desde aquí se revisan, desbloquean o borran intentos."
          moduleCount={runs.length}
          countNoun="registros"
          actions={
            <div className="flex flex-wrap items-end justify-end gap-3">
              <Link
                href="/checklists"
                className="inline-flex h-9 items-center rounded-full border border-slate-200/90 bg-white px-3.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              >
                ← Checklists
              </Link>
              <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                Mes
                <input
                  type="month"
                  className="mt-1 block rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-900"
                  value={periodValue}
                  onChange={(event) => {
                    const [nextYear, nextMonth] = event.target.value.split("-");
                    setYear(Number(nextYear));
                    setMonth(Number(nextMonth));
                  }}
                />
              </label>
            </div>
          }
        />
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-[0_16px_34px_-28px_rgba(15,23,42,0.28)]">
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
                <th className="px-3 py-2">Acciones</th>
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
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => void openReview(run)}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Ver
                        </button>
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
                        <button
                          type="button"
                          disabled={busyId === run.id}
                          onClick={() => void remove(run)}
                          className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-60"
                        >
                          Borrar
                        </button>
                      </div>
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
        {review ? (
          <div
            className="fixed inset-0 z-50 flex items-start justify-end bg-slate-950/40 p-4"
            onClick={closeReview}
          >
            <div
              className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="border-b border-slate-200 px-5 py-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  Revisión
                </p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">
                  {getChecklistCatalogEntry(review.checklistId)?.title ??
                    review.checklistId}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {review.sede ?? "—"} · {review.username ?? "—"} ·{" "}
                  {review.status === "completed"
                    ? "Completado"
                    : review.status === "expired"
                      ? "Vencido"
                      : "En curso"}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {reviewLoading ? (
                  <p className="text-sm text-slate-500">Cargando respuestas...</p>
                ) : null}
                {reviewAnswers.length === 0 && !reviewLoading ? (
                  <p className="text-sm text-slate-500">
                    Este intento no tiene respuestas guardadas.
                  </p>
                ) : (
                  <ol className="space-y-4">
                    {reviewAnswers.map((item) => {
                      const photo = reviewEvidence[item.key];
                      const src = photo
                        ? mediaSrc(photo.fotoBase64, photo.mime)
                        : "";
                      return (
                        <li key={item.key} className="text-sm">
                          <p className="font-medium text-slate-900">{item.label}</p>
                          <p className="text-slate-700">
                            Respuesta:{" "}
                            <span className="font-semibold">{item.value}</span>
                          </p>
                          {item.note ? (
                            <p className="text-xs text-slate-500">Nota: {item.note}</p>
                          ) : null}
                          {src ? (
                            // eslint-disable-next-line @next/next/no-img-element -- data URL de evidencia
                            <img
                              src={src}
                              alt={`Evidencia ${item.label}`}
                              className="mt-2 max-h-48 rounded-lg border border-slate-200 object-contain"
                            />
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                )}
                {reviewSignature ? (
                  <div className="mt-6 border-t border-slate-200 pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Firma
                    </p>
                    {/* eslint-disable-next-line @next/next/no-img-element -- data URL de firma */}
                    <img
                      src={mediaSrc(reviewSignature, "image/png")}
                      alt="Firma del checklist"
                      className="mt-2 max-h-32 rounded-lg border border-slate-200 bg-white object-contain"
                    />
                  </div>
                ) : null}
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
                <button
                  type="button"
                  disabled={busyId === review.id}
                  onClick={() => void remove(review)}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-semibold text-rose-800 disabled:opacity-60"
                >
                  Borrar
                </button>
                <button
                  type="button"
                  onClick={closeReview}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </PortalHubShell>
    </div>
  );
}
