"use client";

import { startTransition, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { prepareInformeData } from "@/lib/informe-variacion/aggregate";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";

type Prepared = ReturnType<typeof prepareInformeData>;

const scheduleIdle = (fn: () => void): (() => void) => {
  if (typeof requestIdleCallback !== "undefined") {
    const id = requestIdleCallback(fn, { timeout: 120 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
};

/** Prepara indices y contexto sin bloquear el primer paint del board. */
export const usePreparedInformeData = (payload: InformeVariacionPayload) => {
  const [prepared, setPrepared] = useState<Prepared | null>(null);

  useEffect(() => {
    setPrepared(null);
    let cancelled = false;
    let cancelIdle: (() => void) | undefined;

    const timeoutId = setTimeout(() => {
      cancelIdle = scheduleIdle(() => {
        if (cancelled) return;
        startTransition(() => setPrepared(prepareInformeData(payload)));
      });
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      cancelIdle?.();
    };
  }, [payload]);

  return prepared;
};

export function InformeBoardPreparing() {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white/80">
      <Loader2 className="h-7 w-7 animate-spin text-slate-500" />
      <p className="mt-3 text-sm text-slate-600">Indexando datos del informe…</p>
      <p className="mt-1 text-xs text-slate-400">
        Los indicadores apareceran en cuanto termine el primer calculo
      </p>
    </div>
  );
}
