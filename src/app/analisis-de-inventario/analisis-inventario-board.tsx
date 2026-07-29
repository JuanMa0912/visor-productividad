"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DI_BAND_LABELS,
  diHeatmapStyle,
  diPillClassName,
  formatDiDays,
  type DiBand,
} from "@/lib/analisis-inventario/di";
import { ANALISIS_INVENTARIO_LEVEL_NAMES } from "@/lib/analisis-inventario/drill-path";
import type {
  AnalisisInventarioDrillPayload,
  AnalisisInventarioDrillStep,
  AnalisisInventarioHeatmapPayload,
  AnalisisInventarioMeta,
  AnalisisInventarioMetric,
} from "@/lib/analisis-inventario/types";

type BoardProps = {
  username: string;
};

const LEGEND_BANDS: DiBand[] = [
  "alta",
  "normal",
  "revisar",
  "sobrestock",
  "sin-venta",
];

const money = (value: number) =>
  value.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });

const units = (value: number) =>
  value.toLocaleString("es-CO", { maximumFractionDigits: 1 });

export function AnalisisInventarioBoard(_props: BoardProps) {
  const [meta, setMeta] = useState<AnalisisInventarioMeta | null>(null);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [metric, setMetric] = useState<AnalisisInventarioMetric>("units");
  const [path, setPath] = useState<AnalisisInventarioDrillStep[]>([]);
  const [heatmapPath, setHeatmapPath] = useState<AnalisisInventarioDrillStep[]>(
    [],
  );
  const [drill, setDrill] = useState<AnalisisInventarioDrillPayload | null>(
    null,
  );
  const [heatmap, setHeatmap] =
    useState<AnalisisInventarioHeatmapPayload | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** Evita refetch al hidratar fechas desde la primera respuesta board. */
  const skipNextFetchRef = useRef(false);
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 45_000);

    const loadBoard = async () => {
      setLoadingBoard(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("mode", "board");
        // Primera carga: sin fechas → API usa mes móvil (periodo_std).
        if (dateStart) params.set("dateStart", dateStart);
        if (dateEnd) params.set("dateEnd", dateEnd);
        if (path.length > 0) params.set("drillPath", JSON.stringify(path));
        if (heatmapPath.length > 0) {
          params.set("heatmapPath", JSON.stringify(heatmapPath));
        }
        const response = await fetch(
          `/api/analisis-de-inventario?${params.toString()}`,
          {
            cache: "no-store",
            credentials: "include",
            signal: controller.signal,
          },
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error ?? "No se pudo cargar el tablero.");
        }
        const nextMeta = payload.meta as AnalisisInventarioMeta | undefined;
        if (nextMeta) {
          setMeta(nextMeta);
          if (!bootstrappedRef.current) {
            bootstrappedRef.current = true;
            const nextStart =
              nextMeta.selectedDateStart || nextMeta.defaultDateStart || "";
            const nextEnd =
              nextMeta.selectedDateEnd || nextMeta.defaultDateEnd || "";
            if (nextStart && nextEnd) {
              skipNextFetchRef.current = true;
              setDateStart(nextStart);
              setDateEnd(nextEnd);
            }
          }
        }
        setDrill(payload.drill as AnalisisInventarioDrillPayload);
        setHeatmap(payload.heatmap as AnalisisInventarioHeatmapPayload);
        if (typeof payload.message === "string") setMessage(payload.message);
      } catch (err) {
        if (controller.signal.aborted) {
          if (timedOut) {
            setError(
              "La consulta superó el tiempo de espera. Recarga o acota el periodo.",
            );
          }
          return;
        }
        setError(err instanceof Error ? err.message : "Error de carga.");
      } finally {
        window.clearTimeout(timeoutId);
        setLoadingBoard(false);
      }
    };

    void loadBoard();
    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [dateStart, dateEnd, path, heatmapPath]);

  const cellByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const cell of heatmap?.cells ?? []) {
      const di = metric === "units" ? cell.diUnits : cell.diValue;
      map.set(`${cell.rowId}::${cell.sedeKey}`, di);
    }
    return map;
  }, [heatmap, metric]);

  const openDrillRow = (step: AnalisisInventarioDrillStep) => {
    if (step.type === "item") return;
    setPath((prev) => [...prev, step]);
  };

  const openHeatmapRow = (step: AnalisisInventarioDrillStep) => {
    if (step.type === "item") return;
    setHeatmapPath((prev) => {
      const withoutSame = prev.filter((entry) => entry.type !== step.type);
      return [...withoutSame, step];
    });
  };

  const openHeatmapCell = (
    sede: { key: string; label: string; empresa: string; sedeId: string },
    rowStep: AnalisisInventarioDrillStep,
  ) => {
    const sedeStep: AnalisisInventarioDrillStep = {
      type: "sede",
      id: sede.key,
      label: sede.label,
      empresa: sede.empresa,
      sedeId: sede.sedeId,
    };
    setPath([sedeStep, ...heatmapPath.filter((s) => s.type !== "sede"), rowStep].filter(
      (step, index, arr) =>
        arr.findIndex((other) => other.type === step.type && other.id === step.id) ===
        index,
    ));
  };

  const levelTitle =
    ANALISIS_INVENTARIO_LEVEL_NAMES[
      path.length >= ANALISIS_INVENTARIO_LEVEL_NAMES.length
        ? ANALISIS_INVENTARIO_LEVEL_NAMES.length - 1
        : path.length
    ] ?? "Sede";

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.28)] sm:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-slate-600">
            Desde
            <input
              type="date"
              value={dateStart}
              min={meta?.availableDateStart || undefined}
              max={meta?.availableDateEnd || undefined}
              onChange={(event) => setDateStart(event.target.value)}
              className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Hasta
            <input
              type="date"
              value={dateEnd}
              min={meta?.availableDateStart || undefined}
              max={meta?.availableDateEnd || undefined}
              onChange={(event) => setDateEnd(event.target.value)}
              className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <div className="flex rounded-lg border border-slate-200 p-1">
            <button
              type="button"
              onClick={() => setMetric("units")}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                metric === "units"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              DI unidades
            </button>
            <button
              type="button"
              onClick={() => setMetric("value")}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                metric === "value"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              DI valor
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              if (meta?.defaultDateStart && meta.defaultDateEnd) {
                setDateStart(meta.defaultDateStart);
                setDateEnd(meta.defaultDateEnd);
              }
            }}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Mes móvil
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Periodo por defecto: 1 mes móvil hasta el último corte (igual que
          Rotación). DI unidades = inventario × días / unidades vendidas. DI
          valor = inventario $ × días / costo de venta. Alcance limitado a tus
          sedes.
          {meta?.fastPath ? " · Lectura rápida (snapshot del periodo)." : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {LEGEND_BANDS.map((band) => (
            <span
              key={band}
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${diPillClassName(
                band === "alta"
                  ? 10
                  : band === "normal"
                    ? 25
                    : band === "revisar"
                      ? 45
                      : band === "sobrestock"
                        ? 80
                        : 999999,
              )}`}
            >
              {DI_BAND_LABELS[band]}
            </span>
          ))}
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {message}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_34px_-28px_rgba(15,23,42,0.28)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Mapa de calor · sedes ×{" "}
              {heatmap?.rowLevel === "categoria"
                ? "categorías"
                : heatmap?.rowLevel === "linea"
                  ? "líneas"
                  : heatmap?.rowLevel === "sublinea"
                    ? "sublíneas"
                    : "ítems"}
            </h2>
            <p className="text-xs text-slate-500">
              Clic en fila para bajar de nivel; clic en celda para abrir el drill
              de esa sede.
            </p>
          </div>
          {heatmapPath.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setHeatmapPath([])}
                className="text-xs font-semibold text-blue-700 hover:underline"
              >
                Raíz
              </button>
              {heatmapPath.map((step, index) => (
                <button
                  key={`${step.type}-${step.id}`}
                  type="button"
                  onClick={() => setHeatmapPath(heatmapPath.slice(0, index + 1))}
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700"
                >
                  {step.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          {loadingBoard ? (
            <p className="px-4 py-8 text-sm text-slate-500">
              Cargando mapa de calor…
            </p>
          ) : !heatmap || heatmap.rows.length === 0 ? (
            <p className="px-4 py-8 text-sm text-slate-500">
              Sin datos para el periodo / sedes actuales.
            </p>
          ) : (
            <table className="min-w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-left text-slate-600">
                  <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 font-semibold">
                    Dimensión
                  </th>
                  {heatmap.columns.map((col) => (
                    <th
                      key={col.key}
                      className="px-2 py-2 text-center font-semibold whitespace-nowrap"
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmap.rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-semibold text-slate-800">
                      <button
                        type="button"
                        onClick={() => openHeatmapRow(row.drillStep)}
                        className="text-left hover:text-blue-700 hover:underline"
                        disabled={row.level === "item"}
                      >
                        {row.label}
                      </button>
                    </th>
                    {heatmap.columns.map((col) => {
                      const di =
                        cellByKey.get(`${row.id}::${col.key}`) ?? Number.NaN;
                      const style = Number.isFinite(di)
                        ? diHeatmapStyle(di)
                        : diHeatmapStyle(999999);
                      return (
                        <td key={col.key} className="p-1">
                          <button
                            type="button"
                            onClick={() =>
                              openHeatmapCell(col, row.drillStep)
                            }
                            className="block w-full rounded-md px-2 py-2 text-center font-semibold tabular-nums"
                            style={style}
                            title={`${row.label} · ${col.label}: ${formatDiDays(di)}`}
                          >
                            {Number.isFinite(di) ? formatDiDays(di) : "—"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_34px_-28px_rgba(15,23,42,0.28)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Drill · {levelTitle}
            </h2>
            <p className="text-xs text-slate-500">
              Sede → categoría → línea → sublínea → ítem
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPath([])}
              className="text-xs font-semibold text-blue-700 hover:underline"
            >
              Sedes
            </button>
            {path.map((step, index) => (
              <button
                key={`${step.type}-${step.id}-${index}`}
                type="button"
                onClick={() => setPath(path.slice(0, index + 1))}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700"
              >
                {step.label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          {loadingBoard ? (
            <p className="px-4 py-8 text-sm text-slate-500">Cargando drill…</p>
          ) : !drill || drill.rows.length === 0 ? (
            <p className="px-4 py-8 text-sm text-slate-500">
              Sin filas en este nivel.
            </p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Nombre</th>
                  <th className="px-3 py-3 text-right font-semibold">DI und.</th>
                  <th className="px-3 py-3 text-right font-semibold">DI valor</th>
                  <th className="px-3 py-3 text-right font-semibold">Inv. und.</th>
                  <th className="px-3 py-3 text-right font-semibold">Inv. $</th>
                  <th className="px-3 py-3 text-right font-semibold">Venta und.</th>
                  <th className="px-4 py-3 text-right font-semibold">Hijos</th>
                </tr>
              </thead>
              <tbody>
                {drill.rows.map((row) => {
                  const diPrimary =
                    metric === "units" ? row.diUnits : row.diValue;
                  return (
                    <tr
                      key={`${row.level}-${row.id}`}
                      className="border-t border-slate-100 hover:bg-slate-50/80"
                    >
                      <td className="px-4 py-2.5">
                        {row.level === "item" ? (
                          <div>
                            <div className="font-semibold text-slate-900">
                              {row.label}
                            </div>
                            <div className="text-xs text-slate-500">
                              {row.id}
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openDrillRow(row.drillStep)}
                            className="text-left font-semibold text-blue-700 hover:underline"
                          >
                            {row.label}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${diPillClassName(row.diUnits)}`}
                        >
                          {formatDiDays(row.diUnits)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${diPillClassName(row.diValue)}`}
                        >
                          {formatDiDays(row.diValue)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        {units(row.inventoryUnits)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        {money(row.inventoryValue)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        {units(row.soldUnits)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                        <span
                          className={`mr-2 inline-block h-2 w-2 rounded-full ${diPillClassName(diPrimary)}`}
                          aria-hidden
                        />
                        {row.childCount}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
