"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

export function LocalMigrationNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
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

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-[100] border-y-[6px] border-yellow-400 bg-red-600 shadow-[0_6px_24px_rgba(127,29,29,0.55)]"
    >
      <div
        className="px-4 py-4 sm:px-6 lg:px-8"
        style={{
          backgroundImage:
            "repeating-linear-gradient(-45deg, rgba(0,0,0,0.08) 0, rgba(0,0,0,0.08) 8px, transparent 8px, transparent 16px)",
        }}
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
          <div
            className="flex shrink-0 items-center justify-center self-start rounded-xl border-4 border-yellow-300 bg-red-800 p-3.5 shadow-inner sm:self-center"
            aria-hidden="true"
          >
            <AlertTriangle
              className="h-11 w-11 text-yellow-300"
              strokeWidth={2.75}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-yellow-300">
              Aviso importante · lea antes de continuar
            </p>
            <p className="text-lg font-black uppercase leading-tight tracking-wide text-white sm:text-2xl">
              Actualización del portal en curso
            </p>
            <p className="max-w-4xl text-sm font-semibold leading-relaxed text-red-50 sm:text-base">
              Estamos implementando mejoras en la plataforma de Inteligencia de
              Datos de la UAID.{" "}
              <span className="font-black text-yellow-200">
                En los próximos días el acceso a este entorno cambiará.
              </span>{" "}
              Les informaremos oportunamente la nueva dirección de ingreso.
              Mientras tanto, puede seguir utilizando el portal con normalidad.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
