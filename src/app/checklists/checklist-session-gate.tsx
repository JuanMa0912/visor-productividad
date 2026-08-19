"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Lock, Play } from "lucide-react";
import { useAuth, usePermissions } from "@/lib/auth/auth-context";
import { BODEGA_DEFAULT_CFG } from "@/lib/checklists/bodega-gerencial";
import {
  canAccessChecklistPanel,
  canFillChecklistAsEncargado,
  canFillChecklistAsRevisor,
} from "@/lib/checklists/access";
import {
  CHECKLIST_DURATION_MINUTES,
  formatCountdown,
  remainingMs,
  type ChecklistActorRole,
  type ChecklistRunRow,
  type ChecklistSessionId,
} from "@/lib/checklists/session";
import { parseChecklistSnapshot, type ChecklistSnapshot } from "@/lib/checklists/snapshot";
import { missingChecklistPhotoKeys } from "@/lib/checklists/evidence";
import { ChecklistRunProvider } from "@/app/checklists/checklist-run-context";
import { ChecklistSignaturePad } from "@/app/checklists/checklist-signature-pad";
import { compressImageFileToJpegBase64 } from "@/app/checklists/checklist-photo-control";

const cookieValue = (name: string) => {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : "";
};

type GateProps = {
  checklistId: ChecklistSessionId;
  title: string;
  children: React.ReactNode;
};

export function ChecklistSessionGate({
  checklistId,
  title,
  children,
}: GateProps) {
  const { user } = useAuth();
  const { isAdmin } = usePermissions();
  const specialRoles = user?.specialRoles ?? [];
  const canEncargado = canFillChecklistAsEncargado(specialRoles, isAdmin);
  const canRevisor = canFillChecklistAsRevisor(specialRoles, isAdmin);
  const canUnlock = canAccessChecklistPanel(specialRoles, isAdmin);

  const [run, setRun] = useState<ChecklistRunRow | null>(null);
  const [priorRun, setPriorRun] = useState<ChecklistRunRow | null>(null);
  const [evidenceKeys, setEvidenceKeys] = useState<string[]>([]);
  const [signOpen, setSignOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [actorRole, setActorRole] = useState<ChecklistActorRole>(
    canEncargado ? "encargado" : "revisor",
  );
  const [empresa, setEmpresa] = useState(BODEGA_DEFAULT_CFG[0]?.empresa ?? "");
  const [sede, setSede] = useState(BODEGA_DEFAULT_CFG[0]?.sedes[0] ?? "");
  const latestSnapshot = useRef<ChecklistSnapshot | null>(null);

  const sedes =
    BODEGA_DEFAULT_CFG.find((row) => row.empresa === empresa)?.sedes ?? [];

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/checklists/runs?checklistId=${encodeURIComponent(checklistId)}`,
      { cache: "no-store" },
    );
    const json = (await response.json()) as {
      run?: ChecklistRunRow | null;
      priorRun?: ChecklistRunRow | null;
      evidenceKeys?: string[];
      error?: string;
    };
    if (!response.ok) throw new Error(json.error || "No se pudo leer el intento.");
    setRun(json.run ?? null);
    setPriorRun(json.priorRun ?? null);
    setEvidenceKeys(json.evidenceKeys ?? json.run?.evidenceKeys ?? []);
    if (json.run?.empresa) setEmpresa(json.run.empresa);
    if (json.run?.sede) setSede(json.run.sede);
    if (json.run?.actorRole) setActorRole(json.run.actorRole);
  }, [checklistId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void load()
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "No se pudo cargar.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    if (run?.status !== "in_progress") return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [run?.status]);

  const leftMs = useMemo(() => {
    if (!run || run.status !== "in_progress") return 0;
    return remainingMs(run.deadlineAt, new Date(now));
  }, [now, run]);

  useEffect(() => {
    if (run?.status !== "in_progress" || leftMs > 0) return;
    void load().catch(() => {
      setRun((current) =>
        current ? { ...current, status: "expired", remainingMs: 0 } : current,
      );
    });
  }, [leftMs, load, run?.status]);

  const mutate = async (
    action: "start" | "complete" | "reopen",
    extra?: Record<string, unknown>,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const csrf = cookieValue("vp_csrf");
      const response = await fetch("/api/checklists/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrf,
        },
        body: JSON.stringify({
          action,
          checklistId,
          runId: run?.id,
          actorRole,
          empresa,
          sede,
          snapshot: action === "complete" ? latestSnapshot.current : undefined,
          ...extra,
        }),
      });
      const text = await response.text();
      const json = (
        text
          ? (JSON.parse(text) as {
              run?: ChecklistRunRow;
              priorRun?: ChecklistRunRow | null;
              evidenceKeys?: string[];
              error?: string;
            })
          : {}
      ) as {
        run?: ChecklistRunRow;
        priorRun?: ChecklistRunRow | null;
        evidenceKeys?: string[];
        error?: string;
      };
      if (!response.ok) {
        if (json.run) setRun(json.run);
        if (json.priorRun) setPriorRun(json.priorRun);
        throw new Error(json.error || "No se pudo actualizar el intento.");
      }
      setRun(json.run ?? null);
      setPriorRun(json.priorRun ?? null);
      if (json.evidenceKeys) setEvidenceKeys(json.evidenceKeys);
      if (action === "complete") setSignOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar.");
    } finally {
      setBusy(false);
    }
  };

  const requestComplete = () => {
    const snapshot = latestSnapshot.current;
    const missing = missingChecklistPhotoKeys(
      snapshot?.answers ?? {},
      evidenceKeys,
    );
    if (missing.length > 0) {
      setError(
        `Hay ${missing.length} punto(s) en P o NC sin foto. Sube la foto de cada uno antes de finalizar.`,
      );
      return;
    }
    setError(null);
    setSignOpen(true);
  };

  const uploadEvidence = useCallback(
    async (itemKey: string, file: File) => {
      if (!run?.id) throw new Error("No hay un intento en curso.");
      const fotoBase64 = await compressImageFileToJpegBase64(file);
      const csrf = cookieValue("vp_csrf");
      const response = await fetch("/api/checklists/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrf,
        },
        body: JSON.stringify({
          action: "photo",
          checklistId,
          runId: run.id,
          itemKey,
          fotoBase64,
          mime: "image/jpeg",
        }),
      });
      const json = (await response.json()) as {
        evidenceKeys?: string[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(json.error || "No se pudo guardar la foto.");
      }
      setEvidenceKeys(json.evidenceKeys ?? []);
    },
    [checklistId, run?.id],
  );

  const saveSnapshot = useCallback(
    (snapshot: ChecklistSnapshot) => {
      latestSnapshot.current = snapshot;
      if (!run?.id) return;
      const csrf = cookieValue("vp_csrf");
      void fetch("/api/checklists/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrf,
        },
        body: JSON.stringify({
          action: "save",
          checklistId,
          runId: run.id,
          snapshot,
        }),
      }).catch(() => undefined);
    },
    [checklistId, run?.id],
  );

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-600">
        Cargando checklist...
      </div>
    );
  }

  if (!canEncargado && !canRevisor && !isAdmin) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-3 text-sm text-slate-600">
            Este checklist solo lo diligencian personas con rol de encargado de
            sede o de revisor. Pide ese rol en administración de usuarios.
          </p>
        </div>
      </div>
    );
  }

  const running = run?.status === "in_progress" && leftMs > 0;
  const expired =
    run?.status === "expired" || (run?.status === "in_progress" && leftMs <= 0);
  const completed = run?.status === "completed";
  const idle = !run || completed;
  const priorSnapshot = priorRun
    ? parseChecklistSnapshot(priorRun.answers)
    : null;

  return (
    <div className="relative">
      {running ? (
        <div className="sticky top-0 z-30 flex flex-col gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-4">
          <p className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-amber-950">
            <Clock3 className={`h-4 w-4 shrink-0 ${leftMs <= 180_000 ? "text-rose-600" : ""}`} />
            <span className="min-w-0">
              {run?.actorRole === "revisor" ? "Revisor" : "Encargado"} ·{" "}
              {run?.sede}
            </span>
            <span
              className={`tabular-nums ${leftMs <= 180_000 ? "text-rose-700" : "text-amber-900"}`}
            >
              {formatCountdown(leftMs)}
            </span>
            <span className="font-normal text-amber-800">
              / {CHECKLIST_DURATION_MINUTES}:00
            </span>
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={requestComplete}
            className="min-h-11 w-full rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 sm:min-h-0 sm:w-auto sm:py-1.5 sm:text-xs"
          >
            Finalizar checklist
          </button>
          {error && !signOpen ? (
            <p className="w-full text-xs font-medium text-rose-700">{error}</p>
          ) : null}
        </div>
      ) : null}

      {idle ? (
        <div className="mx-auto max-w-lg px-4 py-6 sm:py-12">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Confirma el inicio. Tendrás{" "}
              <strong>{CHECKLIST_DURATION_MINUTES} minutos exactos</strong>. Cada
              checklist se hace <strong>una vez al mes por sede</strong>. El
              revisor ve lo que respondió el encargado y lo compara con lo que
              encuentra.
            </p>
            {canEncargado && canRevisor ? (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setActorRole("encargado")}
                  className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${
                    actorRole === "encargado"
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  Encargado
                </button>
                <button
                  type="button"
                  onClick={() => setActorRole("revisor")}
                  className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${
                    actorRole === "revisor"
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  Revisor
                </button>
              </div>
            ) : (
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Rol: {canRevisor && !canEncargado ? "Revisor" : "Encargado de sede"}
              </p>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">
                Empresa
                <select
                  className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-base sm:text-sm"
                  value={empresa}
                  onChange={(event) => {
                    const next = event.target.value;
                    setEmpresa(next);
                    const nextSedes =
                      BODEGA_DEFAULT_CFG.find((row) => row.empresa === next)
                        ?.sedes ?? [];
                    setSede(nextSedes[0] ?? "");
                  }}
                >
                  {BODEGA_DEFAULT_CFG.map((row) => (
                    <option key={row.empresa} value={row.empresa}>
                      {row.empresa}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Sede
                <select
                  className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-base sm:text-sm"
                  value={sede}
                  onChange={(event) => setSede(event.target.value)}
                >
                  {sedes.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {completed ? (
              <p className="mt-2 text-sm text-emerald-700">
                Ya hay un intento finalizado. Si es de este mes en esa sede, no
                se puede repetir.
              </p>
            ) : null}
            {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => void mutate("start")}
              className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60"
            >
              <Play className="h-4 w-4" />
              Comenzar checklist
            </button>
          </div>
        </div>
      ) : null}

      {expired ? (
        <div className="mx-auto max-w-lg px-4 py-6 sm:py-12">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 sm:p-6">
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-rose-900">
              <Lock className="h-4 w-4" />
              Checklist cerrado
            </p>
            <p className="mt-3 text-sm leading-6 text-rose-900/80">
              Los {CHECKLIST_DURATION_MINUTES} minutos se agotaron o no se
              terminó. Quien tenga el panel de checklists puede desbloquearlo.
            </p>
            {error ? <p className="mt-3 text-sm text-rose-800">{error}</p> : null}
            {canUnlock ? (
              <button
                type="button"
                disabled={busy || !run?.id}
                onClick={() => void mutate("reopen")}
                className="mt-5 min-h-12 w-full rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 sm:w-auto"
              >
                Desbloquear 20 minutos más
              </button>
            ) : (
              <p className="mt-4 text-xs text-rose-800/80">
                Pide a alguien con panel de checklists que lo desbloquee.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {running ? (
        <ChecklistRunProvider
          value={{
            actorRole: run?.actorRole ?? actorRole,
            runId: run?.id ?? null,
            priorSnapshot,
            evidenceKeys,
            saveSnapshot,
            uploadEvidence,
          }}
        >
          {children}
        </ChecklistRunProvider>
      ) : null}

      {signOpen ? (
        <ChecklistSignaturePad
          busy={busy}
          error={error}
          onCancel={() => setSignOpen(false)}
          onConfirm={(signaturePng) => {
            void mutate("complete", { signaturePng });
          }}
        />
      ) : null}
    </div>
  );
}
