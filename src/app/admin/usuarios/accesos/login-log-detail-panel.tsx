"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getPathLabel } from "@/lib/shared/path-labels";

type LoginLogContextResponse = {
  log: {
    id: number;
    loggedAt: string;
    ip: string | null;
  };
  session: {
    id: string;
    ip: string | null;
    startedAt: string;
  } | null;
  activityWindow: {
    endsAt: string | null;
    observationCount: number;
    activeMinutes: number;
    firstPath: string | null;
    lastPath: string | null;
    firstObservedAt: string | null;
    lastObservedAt: string | null;
  };
};

const formatDateTime = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

export function LoginLogDetailPanel({ logId }: { logId: number }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LoginLogContextResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/login-logs/${logId}/context`);
        if (!response.ok) {
          throw new Error("No se pudo cargar el detalle de la sesión.");
        }
        const payload = (await response.json()) as LoginLogContextResponse;
        if (!cancelled) setData(payload);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Error inesperado.");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [logId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-4 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando actividad posterior al login…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="px-4 py-4 text-sm text-amber-800">{error ?? "Sin datos."}</div>
    );
  }

  return (
    <div className="grid gap-3 border-t border-indigo-100 bg-indigo-50/30 px-4 py-4 text-sm sm:grid-cols-2">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Ventana de actividad
        </p>
        <ul className="mt-2 space-y-1 text-slate-700">
          <li>
            <span className="text-slate-500">Minutos activos:</span>{" "}
            <strong>{data.activityWindow.activeMinutes}</strong>
          </li>
          <li>
            <span className="text-slate-500">Pings:</span>{" "}
            {data.activityWindow.observationCount}
          </li>
          <li>
            <span className="text-slate-500">Hasta:</span>{" "}
            {data.activityWindow.endsAt
              ? formatDateTime(data.activityWindow.endsAt)
              : "Siguiente login o +12 h"}
          </li>
        </ul>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Navegación
        </p>
        <ul className="mt-2 space-y-1 text-slate-700">
          <li>
            <span className="text-slate-500">Primer tablero:</span>{" "}
            {getPathLabel(data.activityWindow.firstPath)}
          </li>
          <li>
            <span className="text-slate-500">Último tablero:</span>{" "}
            {getPathLabel(data.activityWindow.lastPath)}
          </li>
          {data.session ? (
            <li>
              <span className="text-slate-500">Sesión desde:</span>{" "}
              {formatDateTime(data.session.startedAt)}
              {data.session.ip ? ` · IP ${data.session.ip}` : ""}
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
