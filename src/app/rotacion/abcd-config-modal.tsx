"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AbcdConfig } from "./rotacion-preamble";
import { normalizeAbcdConfig } from "./rotacion-preamble";

export type AbcdConfigSaveScope = "global" | "sede";

export interface AbcdConfigModalSedeTarget {
  empresa: string;
  sedeId: string;
  sedeName: string;
}

export interface AbcdConfigModalProps {
  onClose: () => void;
  initialConfig: AbcdConfig;
  singleSelectedSedeTarget: AbcdConfigModalSedeTarget | null;
  isSaving: boolean;
  onSave: (draft: AbcdConfig, scope: AbcdConfigSaveScope) => void | Promise<void>;
}

export const AbcdConfigModal = ({
  onClose,
  initialConfig,
  singleSelectedSedeTarget,
  isSaving,
  onSave,
}: AbcdConfigModalProps) => {
  const [draftConfig, setDraftConfig] = useState<AbcdConfig>(initialConfig);
  const [saveScope, setSaveScope] = useState<AbcdConfigSaveScope>("global");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rotacion-abcd-modal-title"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-3 top-3 rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          onClick={onClose}
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>
        <h2
          id="rotacion-abcd-modal-title"
          className="pr-10 text-lg font-bold text-emerald-900"
        >
          Clasificacion ABCD
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Umbrales por venta acumulada del periodo (D llega hasta 100%).
        </p>
        <div className="mt-4 space-y-2 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
          <p className="text-xs font-semibold text-emerald-900">
            Guardar configuracion para:
          </p>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name="abcd-save-scope"
              checked={saveScope === "global"}
              onChange={() => setSaveScope("global")}
              className="h-4 w-4 border-slate-300 text-emerald-600 focus:ring-emerald-200"
            />
            <span>Todas las sedes</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              name="abcd-save-scope"
              checked={saveScope === "sede"}
              onChange={() => setSaveScope("sede")}
              disabled={!singleSelectedSedeTarget}
              className="h-4 w-4 border-slate-300 text-emerald-600 focus:ring-emerald-200 disabled:opacity-50"
            />
            <span>
              Solo esta sede
              {singleSelectedSedeTarget
                ? ` (${singleSelectedSedeTarget.sedeName})`
                : " (selecciona una sola sede)"}
            </span>
          </label>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-semibold text-emerald-900">
            A hasta %
            <input
              type="number"
              min={1}
              max={100}
              value={draftConfig.aUntilPercent}
              onChange={(event) =>
                setDraftConfig((prev) =>
                  normalizeAbcdConfig({
                    ...prev,
                    aUntilPercent: Number(event.target.value || 0),
                  }),
                )
              }
              className="mt-1 h-9 w-full rounded-lg border border-emerald-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
          <label className="text-xs font-semibold text-emerald-900">
            B hasta %
            <input
              type="number"
              min={1}
              max={100}
              value={draftConfig.bUntilPercent}
              onChange={(event) =>
                setDraftConfig((prev) =>
                  normalizeAbcdConfig({
                    ...prev,
                    bUntilPercent: Number(event.target.value || 0),
                  }),
                )
              }
              className="mt-1 h-9 w-full rounded-lg border border-emerald-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
          <label className="text-xs font-semibold text-emerald-900">
            C hasta %
            <input
              type="number"
              min={1}
              max={100}
              value={draftConfig.cUntilPercent}
              onChange={(event) =>
                setDraftConfig((prev) =>
                  normalizeAbcdConfig({
                    ...prev,
                    cUntilPercent: Number(event.target.value || 0),
                  }),
                )
              }
              className="mt-1 h-9 w-full rounded-lg border border-emerald-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="rounded-full bg-emerald-700 text-white hover:bg-emerald-800"
            disabled={
              isSaving ||
              (saveScope === "sede" && !singleSelectedSedeTarget)
            }
            onClick={() => void onSave(draftConfig, saveScope)}
          >
            {isSaving ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </div>
    </div>
  );
};
