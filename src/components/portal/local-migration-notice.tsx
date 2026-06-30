"use client";

import { useEffect, useState } from "react";
import { Info, X } from "lucide-react";

const DISMISS_STORAGE_KEY = "vp-local-migration-notice-dismissed-v1";

export function LocalMigrationNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(DISMISS_STORAGE_KEY) === "1") return;
    } catch {
      // ignore
    }

    void fetch("/api/local-portal-migration-notice", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { enabled: false }))
      .then((data: { enabled?: boolean }) => {
        if (data.enabled) setVisible(true);
      })
      .catch(() => {
        // ignore
      });
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setVisible(false);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-sky-200/80 bg-gradient-to-r from-sky-50 via-white to-sky-50"
    >
      <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <Info
          className="mt-0.5 h-5 w-5 shrink-0 text-sky-700"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 space-y-1 pr-2">
          <p className="text-sm font-semibold text-sky-950">
            Actualización del portal en curso
          </p>
          <p className="text-sm leading-relaxed text-slate-700">
            Estamos implementando mejoras en la plataforma de Inteligencia de
            Datos de la UAID. En los próximos días el acceso a este entorno
            cambiará; les informaremos oportunamente la nueva dirección de
            ingreso. Mientras tanto, puede seguir utilizando el portal con
            normalidad.
          </p>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
            Aviso del entorno local
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-md p-1.5 text-slate-500 transition hover:bg-sky-100 hover:text-slate-800"
          aria-label="Ocultar aviso"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
