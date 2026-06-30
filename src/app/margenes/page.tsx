"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Loader2, RefreshCcw } from "lucide-react";
import { AppTopBar } from "@/components/portal/app-top-bar";
import { PortalTourHelpButton } from "@/components/portal/portal-tour-help-button";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import { compactDateToIso } from "@/lib/margenes/margen-final-query";
import { defaultMargenDateRange } from "@/lib/margenes/date-range";
import { listMargenSedeCatalogOptions } from "@/lib/margenes/margen-sede-catalog";
import { formatDayLabel } from "@/lib/margenes/drill-queries";
import { useProductTour } from "@/lib/ui/product-tour/use-product-tour";
import { TUTORIAL_LOCAL_STORAGE_KEYS, TUTORIAL_STATE_KEYS } from "@/lib/ui/tutorial-keys";
import { MARGENES_TOUR_ANCHOR } from "@/lib/ui/portal-tours/margenes-tour-anchors";
import { MARGENES_TOUR_STEPS } from "@/lib/ui/portal-tours/margenes-tour-steps";
import {
  MargenesSedePickerModal,
  type MargenSedePickerOption,
} from "@/app/margenes/margenes-sede-picker-modal";
import { MargenesBoard } from "@/app/margenes/margenes-board";
import "driver.js/dist/driver.css";
import "@/lib/ui/product-tour/product-tour.css";

type MargenMeta = {
  ready: boolean;
  table: string;
  rowCount: number;
  rowCountIsEstimate?: boolean;
  minDate: string | null;
  maxDate: string | null;
  distinctDateCount?: number;
  invalidDateRows?: number;
  dates?: Array<{ value: string; rowCount: number }>;
  sedeCount: number;
  message?: string | null;
  error?: string;
};


export default function MargenesPage() {
  const router = useRouter();
  const { user, status } = useRequireAuth();
  const { hasSection, hasSubsection } = usePermissions();
  const boardReady = status === "authenticated" && Boolean(user);

  const [meta, setMeta] = useState<MargenMeta | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [anchorsReady, setAnchorsReady] = useState(false);

  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [selectedSedes, setSelectedSedes] = useState<string[]>([]);
  const [dataCommitted, setDataCommitted] = useState(false);
  const [sedePickerOpen, setSedePickerOpen] = useState(false);
  const [pendingSedes, setPendingSedes] = useState<string[]>([]);
  const [catalogSedes] = useState<MargenSedePickerOption[]>(() =>
    listMargenSedeCatalogOptions(),
  );
  const [boardSedes, setBoardSedes] = useState<string[]>([]);

  const { startTour: startMargenesTour } = useProductTour({
    localStorageKey: TUTORIAL_LOCAL_STORAGE_KEYS.margenes,
    stateKey: TUTORIAL_STATE_KEYS.margenes,
    steps: MARGENES_TOUR_STEPS,
    theme: "producto",
    userId: user?.id,
    ready: boardReady,
    contentReady: anchorsReady && dataCommitted,
  });

  useEffect(() => {
    if (!boardReady) return;
    if (!hasSection("producto") || !hasSubsection("margenes")) {
      router.replace("/secciones");
    }
  }, [boardReady, hasSection, hasSubsection, router]);

  useEffect(() => {
    if (!boardReady) return;

    let cancelled = false;
    const load = async () => {
      setLoadingMeta(true);
      try {
        const response = await fetch("/api/margenes/meta", { cache: "no-store" });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        const payload = (await response.json()) as MargenMeta;
        if (!cancelled) {
          setMeta(payload);
          if (payload.minDate && payload.maxDate) {
            const range = defaultMargenDateRange(payload.minDate, payload.maxDate);
            if (range) {
              setDateStart(range.start);
              setDateEnd(range.end);
            }
          }
          if (payload.ready) {
            setSedePickerOpen(true);
          }
        }
      } catch {
        if (!cancelled) {
          setMeta({
            ready: false,
            table: "margen_final",
            rowCount: 0,
            minDate: null,
            maxDate: null,
            sedeCount: 0,
            error: "No se pudo consultar el estado de la tabla.",
          });
        }
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [boardReady, router]);

  const openSedePicker = useCallback(() => {
    setDataCommitted(false);
    setBoardSedes([]);
    setPendingSedes(selectedSedes);
    setSedePickerOpen(true);
  }, [selectedSedes]);

  const togglePendingSede = useCallback((value: string) => {
    setPendingSedes((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  }, []);

  const togglePendingEmpresa = useCallback((_empresa: string, values: string[]) => {
    setPendingSedes((current) => {
      const allSelected = values.every((value) => current.includes(value));
      if (allSelected) {
        return current.filter((value) => !values.includes(value));
      }
      return [...new Set([...current, ...values])];
    });
  }, []);

  const clearPendingSedes = useCallback(() => {
    setPendingSedes([]);
  }, []);

  const confirmSedeSelection = useCallback(() => {
    if (pendingSedes.length === 0) return;
    setSelectedSedes(pendingSedes);
    setBoardSedes(pendingSedes);
    setDataCommitted(true);
    setSedePickerOpen(false);
  }, [pendingSedes]);

  const handleSedeDrill = useCallback((sede: string) => {
    setBoardSedes([sede]);
    setSelectedSedes([sede]);
  }, []);

  useLayoutEffect(() => {
    if (!boardReady) {
      setAnchorsReady(false);
      return;
    }
    setAnchorsReady(Boolean(document.getElementById(MARGENES_TOUR_ANCHOR.intro)));
  }, [boardReady, loadingMeta, dataCommitted]);

  const rangeLabel =
    dateStart && dateEnd ? `${dateStart} → ${dateEnd}` : "Sin rango cargado";

  const selectedSedesLabel = useMemo(() => {
    if (boardSedes.length === 0) return null;
    const labels = boardSedes
      .map((value) => catalogSedes.find((option) => option.value === value)?.label ?? value)
      .filter(Boolean);
    if (labels.length === 1) return labels[0];
    return `${labels.length} sedes`;
  }, [boardSedes, catalogSedes]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0d0f18] text-[#dde3f0]">
      <AppTopBar
        backHref="/productividad"
        backLabel="Volver a productividad"
        onTourHelp={startMargenesTour}
      />
      {!boardReady ? (
        <div className="flex flex-1 items-center justify-center bg-[#0d0f18] text-[#dde3f0]">
          <Loader2 className="h-6 w-6 animate-spin text-[#4f8ef7]" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0d0f18] text-[13px] text-[#dde3f0]">
          <header
            id={MARGENES_TOUR_ANCHOR.intro}
            className="flex shrink-0 items-center gap-2.5 border-b border-[#2a2f47] bg-[#141720] px-4 py-2.5"
          >
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-linear-to-br from-[#4f8ef7] to-[#a78bfa]">
              <BarChart3 className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
            </div>
            <h1 className="text-sm font-bold">Análisis de Margen</h1>
            <span className="rounded-full border border-[#2a2f47] bg-[#232740] px-2.5 py-0.5 text-[11px] text-[#6b7590]">
              margen_final · dark
            </span>
            <button
              type="button"
              onClick={openSedePicker}
              disabled={!meta?.ready}
              className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-[#2a2f47] bg-[#1b1e2e] px-3 py-1.5 text-xs text-[#dde3f0] hover:border-[#4f8ef7]/60 disabled:opacity-50"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              Cambiar selección
            </button>
            {selectedSedesLabel ? (
              <span className="rounded-full border border-[#4f8ef7]/40 bg-[#4f8ef7]/10 px-2.5 py-0.5 text-[11px] text-[#4f8ef7]">
                {selectedSedesLabel}
              </span>
            ) : null}
            <span className="rounded-full border border-[#2a2f47] bg-[#232740] px-2.5 py-0.5 text-[11px] text-[#6b7590]">
              {rangeLabel}
            </span>
            <span className="ml-auto flex items-center gap-2">
              <PortalTourHelpButton
                onClick={startMargenesTour}
                className="border-[#2a2f47] bg-[#1b1e2e]/90 text-[#dde3f0] hover:border-[#4f8ef7]/60 hover:bg-[#232740] hover:text-[#dde3f0]"
              />
              <span className="whitespace-nowrap text-[11px] text-[#6b7590]">
                {loadingMeta
                  ? "Consultando tabla…"
                  : meta?.error
                    ? meta.error
                    : !meta?.ready
                      ? "Pendiente ETL"
                      : !dataCommitted
                        ? "Elige sede(s) para cargar"
                        : `${meta.rowCountIsEstimate ? "~" : ""}${meta.rowCount.toLocaleString("es-CO")} filas · ${meta.distinctDateCount ?? "?"} día(s)`}
              </span>
            </span>
          </header>

          <div
            id={MARGENES_TOUR_ANCHOR.filters}
            className="flex shrink-0 flex-wrap items-end gap-2.5 border-b border-[#2a2f47] bg-[#141720] px-4 py-2"
          >
            <div className="flex min-w-[120px] flex-col gap-0.5">
              <span className="text-[10px] tracking-wide text-[#6b7590] uppercase">Desde</span>
              <input
                type="date"
                value={dateStart}
                min={compactDateToIso(meta?.minDate ?? "") ?? undefined}
                max={dateEnd || compactDateToIso(meta?.maxDate ?? "") || undefined}
                onChange={(event) => setDateStart(event.target.value)}
                disabled={!dataCommitted}
                className="rounded-md border border-[#2a2f47] bg-[#1b1e2e] px-2.5 py-1.5 text-xs text-[#dde3f0] disabled:opacity-50"
              />
            </div>
            <div className="flex min-w-[120px] flex-col gap-0.5">
              <span className="text-[10px] tracking-wide text-[#6b7590] uppercase">Hasta</span>
              <input
                type="date"
                value={dateEnd}
                min={dateStart || compactDateToIso(meta?.minDate ?? "") || undefined}
                max={compactDateToIso(meta?.maxDate ?? "") ?? undefined}
                onChange={(event) => setDateEnd(event.target.value)}
                disabled={!dataCommitted}
                className="rounded-md border border-[#2a2f47] bg-[#1b1e2e] px-2.5 py-1.5 text-xs text-[#dde3f0] disabled:opacity-50"
              />
            </div>
          </div>

          <main
            id={MARGENES_TOUR_ANCHOR.main}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            {meta?.message ? (
              <p className="shrink-0 border-b border-[#2a2f47] bg-[#141720] px-4 py-2 text-xs text-[#fbbf24]">
                {meta.message}
                {meta.dates?.length ? (
                  <span className="mt-1 block text-[#6b7590]">
                    Fechas en BD:{" "}
                    {meta.dates
                      .map((entry) => formatDayLabel(entry.value).split(" ·")[0])
                      .join(", ")}
                  </span>
                ) : null}
              </p>
            ) : null}
            {loadingMeta ? (
              <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[#6b7590]">
                <Loader2 className="mr-2 h-5 w-5 animate-spin text-[#4f8ef7]" />
                Consultando disponibilidad de margen_final…
              </div>
            ) : meta?.error ? (
              <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[#f87171]">
                {meta.error}
              </div>
            ) : !meta?.ready ? (
              <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[#6b7590]">
                Tabla margen_final sin datos. Aplica la migración y carga el CSV/ETL.
              </div>
            ) : !dataCommitted ? (
              <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[#6b7590]">
                Elige una o más sedes y el rango de fechas en el modal. Los datos pesados
                solo se cargan después de pulsar «Cargar datos».
              </div>
            ) : (
              <MargenesBoard
                dateStart={dateStart}
                dateEnd={dateEnd}
                selectedSedes={boardSedes.length > 0 ? boardSedes : selectedSedes}
                dataCommitted={dataCommitted}
                onSedeDrill={handleSedeDrill}
              />
            )}
          </main>
        </div>
      )}
      <MargenesSedePickerModal
        open={Boolean(meta?.ready && sedePickerOpen)}
        rangeLabel={rangeLabel}
        dateStart={dateStart}
        dateEnd={dateEnd}
        minDate={compactDateToIso(meta?.minDate ?? "") ?? undefined}
        maxDate={compactDateToIso(meta?.maxDate ?? "") ?? undefined}
        onDateStartChange={setDateStart}
        onDateEndChange={setDateEnd}
        sedes={catalogSedes}
        selectedSedes={pendingSedes}
        loading={false}
        error={null}
        onToggleSede={togglePendingSede}
        onToggleEmpresa={togglePendingEmpresa}
        onClearAll={clearPendingSedes}
        onConfirm={confirmSedeSelection}
      />
    </div>
  );
}
