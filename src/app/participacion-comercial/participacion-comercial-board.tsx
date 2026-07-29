"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ChevronUp, RotateCcw, Search, X } from "lucide-react";
import {
  formatMoney,
  formatSharePct,
  PARTICIPACION_LEVEL_NAMES,
} from "@/lib/participacion-comercial/format";
import type {
  ParticipacionDrillPayload,
  ParticipacionDrillStep,
  ParticipacionMatrixPayload,
  ParticipacionMeta,
  ParticipacionOrientation,
  ParticipacionRow,
} from "@/lib/participacion-comercial/types";

const ORIENTATION_KEY = "participacion-comercial:orientation:v1";

const shareBarClass = (pct: number) => {
  if (pct >= 25) return "bg-emerald-500";
  if (pct >= 10) return "bg-sky-500";
  if (pct >= 5) return "bg-amber-400";
  return "bg-slate-300";
};

const matrixCellStyle = (pct: number) => {
  if (!Number.isFinite(pct) || pct <= 0) {
    return { background: "#f1f5f9", color: "#94a3b8" };
  }
  const alpha = Math.min(0.85, (pct / 40) * 0.8 + 0.08);
  return {
    background: `rgba(14, 165, 233, ${alpha.toFixed(2)})`,
    color: alpha > 0.45 ? "#fff" : "#0c4a6e",
  };
};

const scrollToId = (id: string) => {
  const node = document.getElementById(id);
  if (!node) return;
  const top = node.getBoundingClientRect().top + window.scrollY - 88;
  window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
};

/** Prefijo con código de línea N1 cuando aplica (ej. "05 · Bebidas"). */
const formatLineaDisplay = (id: string, label: string) => {
  if (!id || id.startsWith("__")) return label;
  return `${id} · ${label}`;
};

export function ParticipacionComercialBoard() {
  const [meta, setMeta] = useState<ParticipacionMeta | null>(null);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [orientation, setOrientation] =
    useState<ParticipacionOrientation>("sede");
  const [path, setPath] = useState<ParticipacionDrillStep[]>([]);
  const [drill, setDrill] = useState<ParticipacionDrillPayload | null>(null);
  const [matrix, setMatrix] = useState<ParticipacionMatrixPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showBackToTop, setShowBackToTop] = useState(false);
  /** null = total de todas las sedes; string = sedeKey de la columna. */
  const [matrixSortKey, setMatrixSortKey] = useState<string | null>(null);
  const [matrixSortDir, setMatrixSortDir] = useState<"asc" | "desc">("desc");

  const skipNextFetchRef = useRef(false);
  const bootstrappedRef = useRef(false);
  const pendingScrollDrillRef = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ORIENTATION_KEY);
      if (raw === "sede" || raw === "linea") setOrientation(raw);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(ORIENTATION_KEY, orientation);
    } catch {
      // ignore
    }
  }, [orientation]);

  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 420);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 45_000);

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("mode", "board");
        params.set("orientation", orientation);
        if (dateStart) params.set("dateStart", dateStart);
        if (dateEnd) params.set("dateEnd", dateEnd);
        if (path.length > 0) params.set("drillPath", JSON.stringify(path));
        const response = await fetch(
          `/api/participacion-comercial?${params.toString()}`,
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
        const nextMeta = payload.meta as ParticipacionMeta | undefined;
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
        setDrill(payload.drill as ParticipacionDrillPayload);
        setMatrix(payload.matrix as ParticipacionMatrixPayload);
        setQuery("");
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Error de carga.");
      } finally {
        window.clearTimeout(timeoutId);
        setLoading(false);
      }
    };

    void load();
    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [dateStart, dateEnd, orientation, path]);

  useEffect(() => {
    if (!pendingScrollDrillRef.current || loading) return;
    pendingScrollDrillRef.current = false;
    scrollToId("pc-drill");
  }, [loading, drill]);

  const cellByKey = useMemo(() => {
    const map = new Map<string, { sales: number; shareOfSedePct: number }>();
    for (const cell of matrix?.cells ?? []) {
      map.set(`${cell.rowId}::${cell.sedeKey}`, {
        sales: cell.sales,
        shareOfSedePct: cell.shareOfSedePct,
      });
    }
    return map;
  }, [matrix]);

  const rowSalesTotal = useMemo(() => {
    const map = new Map<string, number>();
    for (const cell of matrix?.cells ?? []) {
      map.set(cell.rowId, (map.get(cell.rowId) ?? 0) + cell.sales);
    }
    return map;
  }, [matrix]);

  const sortedMatrixRows = useMemo(() => {
    if (!matrix) return [];
    const residual = matrix.rows.filter((row) => row.residual);
    const normal = matrix.rows.filter((row) => !row.residual);
    const dir = matrixSortDir === "asc" ? 1 : -1;
    const score = (rowId: string) => {
      if (matrixSortKey) {
        return cellByKey.get(`${rowId}::${matrixSortKey}`)?.sales ?? 0;
      }
      return rowSalesTotal.get(rowId) ?? 0;
    };
    const sorted = [...normal].sort((a, b) => {
      const diff = (score(a.id) - score(b.id)) * dir;
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id, "es", { numeric: true });
    });
    return [...sorted, ...residual];
  }, [matrix, matrixSortDir, matrixSortKey, cellByKey, rowSalesTotal]);

  const toggleMatrixSort = (key: string | null) => {
    if (matrixSortKey === key) {
      setMatrixSortDir((prev) => (prev === "desc" ? "asc" : "desc"));
      return;
    }
    setMatrixSortKey(key);
    setMatrixSortDir("desc");
  };

  const matrixSortHint = (key: string | null) => {
    if (matrixSortKey !== key) return "";
    return matrixSortDir === "asc" ? " ↑" : " ↓";
  };

  const filteredRows = useMemo(() => {
    const rows = drill?.rows ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.label.toLowerCase().includes(q) ||
        row.id.toLowerCase().includes(q) ||
        (row.description ?? "").toLowerCase().includes(q),
    );
  }, [drill, query]);

  const openRow = (step: ParticipacionDrillStep) => {
    if (step.type === "item") return;
    setPath((prev) => [...prev, step]);
  };

  const openMatrixLine = (step: ParticipacionDrillStep) => {
    pendingScrollDrillRef.current = true;
    setOrientation("linea");
    setPath([step]);
  };

  const openMatrixCell = (
    sede: { key: string; label: string; empresa: string; sedeId: string },
    lineStep: ParticipacionDrillStep,
  ) => {
    pendingScrollDrillRef.current = true;
    setOrientation("linea");
    setPath([
      lineStep,
      {
        type: "sede",
        id: sede.key,
        label: sede.label,
        empresa: sede.empresa,
        sedeId: sede.sedeId,
      },
    ]);
  };

  const changeOrientation = (next: ParticipacionOrientation) => {
    setOrientation(next);
    setPath([]);
  };

  const levelTitle = drill
    ? PARTICIPACION_LEVEL_NAMES[drill.level]
    : orientation === "sede"
      ? "Sede"
      : "Línea";

  return (
    <div className="space-y-6">
      <section
        id="pc-filters"
        className="sticky top-2 z-30 rounded-2xl border border-slate-200/90 bg-white/95 p-4 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.28)] backdrop-blur sm:p-5"
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-slate-600">
            Desde
            <input
              type="date"
              value={dateStart}
              min={meta?.availableDateStart || undefined}
              max={meta?.availableDateEnd || undefined}
              onChange={(e) => setDateStart(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Hasta
            <input
              type="date"
              value={dateEnd}
              min={meta?.availableDateStart || undefined}
              max={meta?.availableDateEnd || undefined}
              onChange={(e) => setDateEnd(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <div className="flex rounded-lg border border-slate-200 p-1">
            <button
              type="button"
              onClick={() => changeOrientation("sede")}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                orientation === "sede"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              Por sede
            </button>
            <button
              type="button"
              onClick={() => changeOrientation("linea")}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                orientation === "linea"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              Por línea
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
          <button
            type="button"
            onClick={() => {
              setPath([]);
              scrollToId("pc-filters");
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Reiniciar
          </button>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => scrollToId("pc-matrix")}
              className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200"
            >
              Ir a matriz
            </button>
            <button
              type="button"
              onClick={() => scrollToId("pc-drill")}
              className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200"
            >
              Ir al drill
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {orientation === "sede"
            ? "Empieza por sede → almacén → categoría → línea → sublínea → ítem. El % es la participación de venta dentro del nivel padre."
            : "Empieza por línea → sede → almacén → sublínea → ítem. El % es la participación de venta dentro del nivel padre."}
          {meta?.fastPath ? " · Lectura rápida (snapshot)." : ""}
        </p>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <section
        id="pc-matrix"
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_34px_-28px_rgba(15,23,42,0.28)]"
      >
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-bold text-slate-900">
            Matriz · línea × sede (% dentro de cada sede)
          </h2>
          <p className="text-xs text-slate-500">
            Cada columna suma 100%: top líneas + “Otras líneas”. Clic en “Línea” o en
            una sede para ordenar mayor↔menor. Color = participación en la sede.
          </p>
        </div>
        <div className="max-h-[min(60vh,560px)] overflow-auto">
          {loading ? (
            <p className="px-4 py-8 text-sm text-slate-500">Cargando matriz…</p>
          ) : !matrix || matrix.rows.length === 0 ? (
            <p className="px-4 py-8 text-sm text-slate-500">Sin datos.</p>
          ) : (
            <table className="min-w-full border-collapse text-xs">
              <thead className="sticky top-0 z-20">
                <tr className="bg-slate-50 text-slate-600 shadow-sm">
                  <th className="sticky left-0 z-30 bg-slate-50 px-3 py-2 text-left font-semibold">
                    <button
                      type="button"
                      onClick={() => toggleMatrixSort(null)}
                      className="hover:text-slate-900"
                      title="Ordenar por venta total (todas las sedes)"
                    >
                      Línea{matrixSortHint(null)}
                    </button>
                  </th>
                  {matrix.columns.map((col) => (
                    <th
                      key={col.key}
                      className="px-2 py-2 text-center font-semibold whitespace-nowrap"
                    >
                      <button
                        type="button"
                        onClick={() => toggleMatrixSort(col.key)}
                        className="hover:text-slate-900"
                        title={`Ordenar por venta en ${col.label}`}
                      >
                        {col.label}
                        {matrixSortHint(col.key)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedMatrixRows.map((row) => {
                  const lineLabel = row.residual
                    ? row.label
                    : formatLineaDisplay(row.id, row.label);
                  return (
                    <tr
                      key={row.id}
                      className={`border-t border-slate-100 ${row.residual ? "bg-slate-50/80" : ""}`}
                    >
                      <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-semibold">
                        {row.residual ? (
                          <span className="text-slate-600">{lineLabel}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openMatrixLine(row.drillStep)}
                            className="text-left text-blue-700 hover:underline"
                          >
                            <span className="tabular-nums text-slate-500">
                              {row.id}
                            </span>
                            <span className="text-slate-400"> · </span>
                            {row.label}
                          </button>
                        )}
                      </th>
                      {matrix.columns.map((col) => {
                        const cell = cellByKey.get(`${row.id}::${col.key}`);
                        const pct = cell?.shareOfSedePct ?? 0;
                        const style = matrixCellStyle(pct);
                        return (
                          <td key={col.key} className="p-1">
                            {row.residual ? (
                              <div
                                className="rounded-md px-2 py-2 text-center font-semibold tabular-nums"
                                style={style}
                                title={`${lineLabel} · ${col.label}: ${formatSharePct(pct)} · ${formatMoney(cell?.sales ?? 0)}`}
                              >
                                {cell ? formatSharePct(pct) : "—"}
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openMatrixCell(col, row.drillStep)}
                                className="block w-full rounded-md px-2 py-2 text-center font-semibold tabular-nums"
                                style={style}
                                title={`${lineLabel} · ${col.label}: ${formatSharePct(pct)} · ${formatMoney(cell?.sales ?? 0)}`}
                              >
                                {cell ? formatSharePct(pct) : "—"}
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                  <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left text-slate-800">
                    Total sede
                  </th>
                  {matrix.columns.map((col) => {
                    const sedeTotal =
                      matrix.sedeTotals?.find((entry) => entry.sedeKey === col.key)
                        ?.sales ?? 0;
                    return (
                      <td
                        key={col.key}
                        className="px-2 py-2 text-center text-xs tabular-nums text-slate-800"
                        title={formatMoney(sedeTotal)}
                      >
                        100%
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section
        id="pc-drill"
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_34px_-28px_rgba(15,23,42,0.28)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Drill · {levelTitle}
            </h2>
            <p className="text-xs text-slate-500">
              Total nivel:{" "}
              {formatMoney(drill?.parentTotalSales ?? 0)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPath([])}
              className="text-xs font-semibold text-blue-700 hover:underline"
            >
              Inicio
            </button>
            {path.map((step, index) => (
              <button
                key={`${step.type}-${step.id}-${index}`}
                type="button"
                onClick={() => setPath(path.slice(0, index + 1))}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700"
              >
                {step.type === "linea"
                  ? formatLineaDisplay(step.id, step.label)
                  : step.label}
              </button>
            ))}
            {path.length > 0 ? (
              <button
                type="button"
                onClick={() => setPath((prev) => prev.slice(0, -1))}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                Regresar
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
          <div className="relative min-w-55 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar en este nivel…"
              className="w-full rounded-lg border border-slate-200 py-2 pr-8 pl-8 text-sm"
              autoComplete="off"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <p className="text-xs text-slate-500">
            {filteredRows.length}
            {drill?.rows ? ` / ${drill.rows.length}` : ""} filas
          </p>
        </div>

        <div className="max-h-[min(70vh,720px)] overflow-auto">
          {loading ? (
            <p className="px-4 py-8 text-sm text-slate-500">Cargando drill…</p>
          ) : filteredRows.length === 0 ? (
            <p className="px-4 py-8 text-sm text-slate-500">Sin filas.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 shadow-sm">
                <tr>
                  <th className="px-4 py-3 font-semibold">Nombre</th>
                  <th className="px-3 py-3 text-right font-semibold">Venta $</th>
                  <th className="px-3 py-3 text-right font-semibold">Participación</th>
                  <th className="px-4 py-3 text-right font-semibold">Hijos</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row: ParticipacionRow) => (
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
                          <div className="text-xs text-slate-500">{row.id}</div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openRow(row.drillStep)}
                          className="text-left font-semibold text-blue-700 hover:underline"
                        >
                          {row.level === "linea"
                            ? formatLineaDisplay(row.id, row.label)
                            : row.label}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                      {formatMoney(row.sales)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${shareBarClass(row.sharePct)}`}
                            style={{
                              width: `${Math.min(100, Math.max(0, row.sharePct))}%`,
                            }}
                          />
                        </div>
                        <span className="w-14 text-right text-xs font-semibold tabular-nums text-slate-700">
                          {formatSharePct(row.sharePct)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                      {row.childCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {showBackToTop ? (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed right-4 bottom-5 z-40 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 shadow-lg hover:bg-slate-50 sm:right-6"
          aria-label="Volver arriba"
        >
          <ArrowUp className="h-4 w-4" aria-hidden />
          Arriba
        </button>
      ) : null}
    </div>
  );
}
