"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { HourlyAnalysis } from "@/components/HourlyAnalysis";
import { DEFAULT_SEDES } from "@/lib/constants";
import type { Sede } from "@/lib/constants";

type ApiResponse = {
  dates?: string[];
  sedes?: Sede[];
  defaultSede?: string | null;
  canSeeAlexReport?: boolean;
  error?: string;
};

type AlexReportRow = {
  sede: string;
  moreThan72With2: number;
  moreThan92: number;
  oddMarks: number;
  absences: number;
};

type AlexReportResponse = {
  usedRange?: { start: string; end: string } | null;
  rows?: AlexReportRow[];
  totals?: {
    moreThan72With2: number;
    moreThan92: number;
    oddMarks: number;
    absences: number;
  };
  error?: string;
};

const normalizeSedeKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ");

const canonicalizeSedeKey = (value: string) => {
  const normalized = normalizeSedeKey(value);
  const compact = normalized.replace(/\s+/g, "");
  if (
    normalized === "calle 5a" ||
    normalized === "la 5a" ||
    normalized === "calle 5" ||
    compact === "calle5a" ||
    compact === "la5a" ||
    compact === "calle5"
  ) {
    return normalizeSedeKey("Calle 5ta");
  }
  return normalized;
};

const OVERTIME_EXTRA_SEDES: Sede[] = [
  { id: "Panificadora", name: "Panificadora" },
  { id: "Planta Desposte Mixto", name: "Planta Desposte Mixto" },
  { id: "Planta Desprese Pollo", name: "Planta Desprese Pollo" },
];

export default function JornadaExtendidaPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [availableSedes, setAvailableSedes] = useState<Sede[]>([]);
  const [defaultSede, setDefaultSede] = useState<string | undefined>(undefined);
  const [canSeeAlexReport, setCanSeeAlexReport] = useState(false);
  const [alexStartDate, setAlexStartDate] = useState("");
  const [alexEndDate, setAlexEndDate] = useState("");
  const [alexRows, setAlexRows] = useState<AlexReportRow[]>([]);
  const [alexTotals, setAlexTotals] = useState({
    moreThan72With2: 0,
    moreThan92: 0,
    oddMarks: 0,
    absences: 0,
  });
  const [alexLoading, setAlexLoading] = useState(false);
  const [alexError, setAlexError] = useState<string | null>(null);
  const [exportingAlexPng, setExportingAlexPng] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const loadData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/jornada-extendida/meta", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (response.status === 403) {
          router.replace("/tableros");
          return;
        }

        const payload = (await response.json()) as ApiResponse;
        if (!response.ok) {
          throw new Error(payload.error ?? "No se pudo cargar la informacion");
        }

        if (!isMounted) return;

        const dates = Array.from(new Set(payload.dates ?? [])).sort();
        const resolvedSedes =
          payload.sedes && payload.sedes.length > 0 ? payload.sedes : DEFAULT_SEDES;
        const forcedSedeKey = payload.defaultSede
          ? canonicalizeSedeKey(payload.defaultSede)
          : null;
        const forcedSede = forcedSedeKey
          ? resolvedSedes.find((sede) => {
              const idKey = canonicalizeSedeKey(sede.id || sede.name);
              const nameKey = canonicalizeSedeKey(sede.name);
              return idKey === forcedSedeKey || nameKey === forcedSedeKey;
            })
          : null;
        const visibleSedes = forcedSede
          ? [forcedSede]
          : Array.from(
              new Map(
                [...resolvedSedes, ...OVERTIME_EXTRA_SEDES].map((sede) => [
                  canonicalizeSedeKey(sede.name || sede.id),
                  sede,
                ]),
              ).values(),
            );

        setAvailableDates(dates);
        setAvailableSedes(visibleSedes);
        setDefaultSede(forcedSede?.name);
        setCanSeeAlexReport(Boolean(payload.canSeeAlexReport));
        const latest = dates[dates.length - 1] ?? "";
        setAlexStartDate(latest);
        setAlexEndDate(latest);
        setReady(true);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadData();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [router]);

  const defaultDate = useMemo(
    () => (availableDates.length > 0 ? availableDates[availableDates.length - 1] : ""),
    [availableDates],
  );
  const alexRangeLabel = useMemo(() => {
    if (!alexStartDate || !alexEndDate) return "";
    const fmt = (value: string) => {
      const dt = new Date(`${value}T00:00:00`);
      if (Number.isNaN(dt.getTime())) return value;
      const month = new Intl.DateTimeFormat("es-CO", { month: "long" }).format(dt);
      const day = String(dt.getDate()).padStart(2, "0");
      const year = dt.getFullYear();
      return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${day} de ${year}`;
    };
    if (alexStartDate === alexEndDate) return fmt(alexStartDate);
    return `${fmt(alexStartDate)} a ${fmt(alexEndDate)}`;
  }, [alexEndDate, alexStartDate]);

  const handleExportAlexTablePng = async () => {
    if (alexRows.length === 0) return;
    setExportingAlexPng(true);
    try {
      const headers = [
        "Sede",
        "Mas de 7:20h con 2 marcaciones",
        "Mas de 9:20h",
        "Marcaciones impares",
        "Inasistencias",
      ];
      const rows = alexRows.map((row) => [
        row.sede,
        row.moreThan72With2 === 0 ? "-" : String(row.moreThan72With2),
        row.moreThan92 === 0 ? "-" : String(row.moreThan92),
        row.oddMarks === 0 ? "-" : String(row.oddMarks),
        row.absences === 0 ? "-" : String(row.absences),
      ]);
      rows.push([
        "TOTAL",
        String(alexTotals.moreThan72With2),
        String(alexTotals.moreThan92),
        String(alexTotals.oddMarks),
        String(alexTotals.absences),
      ]);

      const colWidths = [220, 280, 180, 220, 160];
      const tableWidth = colWidths.reduce((sum, width) => sum + width, 0);
      const rowHeight = 34;
      const headerHeight = 40;
      const paddingX = 24;
      const paddingY = 24;
      const title = "Reporte Alex";
      const subtitle =
        "Laboraron mas de 7:20h con 2 marcaciones, mas de 9:20h, marcaciones impares e inasistencias";
      const range = alexRangeLabel || `${alexStartDate} a ${alexEndDate}`;
      const maxTextWidth = tableWidth - 16;
      const measureCanvas = document.createElement("canvas");
      const measureCtx = measureCanvas.getContext("2d");
      if (!measureCtx) return;
      const wrapText = (ctx: CanvasRenderingContext2D, text: string, width: number) => {
        const words = text.split(/\s+/).filter(Boolean);
        const lines: string[] = [];
        let line = "";
        for (const word of words) {
          const test = line ? `${line} ${word}` : word;
          if (ctx.measureText(test).width <= width) {
            line = test;
          } else {
            if (line) lines.push(line);
            line = word;
          }
        }
        if (line) lines.push(line);
        return lines.length > 0 ? lines : [text];
      };
      measureCtx.font = "600 18px Arial";
      const subtitleLines = wrapText(measureCtx, subtitle, maxTextWidth);
      const titleHeight = 34 + subtitleLines.length * 22 + 28;
      const tableTop = paddingY + titleHeight + 8;
      const tableHeight = headerHeight + rows.length * rowHeight;
      const canvas = document.createElement("canvas");
      canvas.width = tableWidth + paddingX * 2;
      canvas.height = tableTop + tableHeight + paddingY;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#0f172a";
      ctx.font = "700 26px Arial";
      ctx.fillText(title, paddingX, paddingY + 26);
      ctx.font = "600 18px Arial";
      let textY = paddingY + 52;
      for (const line of subtitleLines) {
        ctx.fillText(line, paddingX, textY);
        textY += 22;
      }
      ctx.fillStyle = "#b91c1c";
      ctx.font = "700 18px Arial";
      ctx.fillText(range, paddingX, textY);

      ctx.fillStyle = "#f1f5f9";
      ctx.fillRect(paddingX, tableTop, tableWidth, headerHeight);

      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1;
      ctx.strokeRect(paddingX, tableTop, tableWidth, tableHeight);

      let x = paddingX;
      for (let i = 0; i < colWidths.length; i += 1) {
        const width = colWidths[i];
        ctx.strokeStyle = "#cbd5e1";
        ctx.beginPath();
        ctx.moveTo(x, tableTop);
        ctx.lineTo(x, tableTop + tableHeight);
        ctx.stroke();

        ctx.fillStyle = "#0f172a";
        ctx.font = "700 18px Arial";
        if (i === 0) {
          ctx.textAlign = "left";
          ctx.fillText(headers[i], x + 12, tableTop + 26);
        } else {
          ctx.textAlign = "right";
          ctx.fillText(headers[i], x + width - 12, tableTop + 26);
        }
        x += width;
      }
      ctx.beginPath();
      ctx.moveTo(paddingX + tableWidth, tableTop);
      ctx.lineTo(paddingX + tableWidth, tableTop + tableHeight);
      ctx.stroke();

      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const y = tableTop + headerHeight + rowIndex * rowHeight;
        const isTotal = rowIndex === rows.length - 1;
        if (isTotal) {
          ctx.fillStyle = "#f8fafc";
          ctx.fillRect(paddingX, y, tableWidth, rowHeight);
        }

        ctx.strokeStyle = "#e2e8f0";
        ctx.beginPath();
        ctx.moveTo(paddingX, y);
        ctx.lineTo(paddingX + tableWidth, y);
        ctx.stroke();

        let cellX = paddingX;
        for (let col = 0; col < colWidths.length; col += 1) {
          const width = colWidths[col];
          ctx.fillStyle = "#0f172a";
          ctx.font = isTotal ? "700 18px Arial" : "500 18px Arial";
          if (col === 0) {
            ctx.textAlign = "left";
            ctx.fillText(rows[rowIndex][col], cellX + 12, y + 23);
          } else {
            ctx.textAlign = "right";
            ctx.fillText(rows[rowIndex][col], cellX + width - 12, y + 23);
          }
          cellX += width;
        }
      }

      ctx.beginPath();
      ctx.moveTo(paddingX, tableTop + tableHeight);
      ctx.lineTo(paddingX + tableWidth, tableTop + tableHeight);
      ctx.stroke();

      const url = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = url;
      link.download = `reporte-alex-${alexStartDate || "inicio"}-${alexEndDate || "fin"}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setExportingAlexPng(false);
    }
  };

  useEffect(() => {
    if (!canSeeAlexReport) return;
    if (!alexStartDate || !alexEndDate) return;
    if (alexStartDate > alexEndDate) return;
    let isMounted = true;
    const controller = new AbortController();

    const loadAlexReport = async () => {
      setAlexLoading(true);
      setAlexError(null);
      try {
        const response = await fetch(
          `/api/jornada-extendida/alex-report?start=${encodeURIComponent(alexStartDate)}&end=${encodeURIComponent(alexEndDate)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const payload = (await response.json()) as AlexReportResponse;
        if (!response.ok) {
          throw new Error(payload.error ?? "No se pudo cargar el reporte Alex.");
        }
        if (!isMounted) return;
        setAlexRows(payload.rows ?? []);
        setAlexTotals(
          payload.totals ?? {
            moreThan72With2: 0,
            moreThan92: 0,
            oddMarks: 0,
            absences: 0,
          },
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!isMounted) return;
        setAlexError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        if (isMounted) {
          setAlexLoading(false);
        }
      }
    };

    void loadAlexReport();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [alexEndDate, alexStartDate, canSeeAlexReport]);

  if (!ready || isLoading) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-5xl rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <p className="text-sm text-slate-600">Cargando tablero...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-5 flex flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white p-5 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)] md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
              Tablero
            </p>
            <h1 className="mt-1 text-xl font-bold text-slate-900">Horario</h1>
          </div>
          <div className="flex flex-col gap-3 md:items-end">
            <Link
              href="/tableros"
              className="inline-flex items-center rounded-full border border-slate-200/70 bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-200/70"
            >
              Cambiar tablero
            </Link>
            <div className="rounded-2xl border border-slate-200/70 bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-3">
                <Image
                  src="/logos/mercamio.jpeg"
                  alt="Logo Mercamio"
                  width={164}
                  height={52}
                  className="h-12 w-auto rounded-lg bg-white object-cover shadow-sm"
                />
                <Image
                  src="/logos/mercatodo.jpeg"
                  alt="Logo Mercatodo"
                  width={164}
                  height={52}
                  className="h-12 w-auto rounded-lg bg-white object-cover shadow-sm"
                />
              </div>
            </div>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        ) : (
          <>
            {canSeeAlexReport && (
              <div className="mb-5 rounded-3xl border border-slate-200/70 bg-white p-5 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div className="max-w-3xl">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
                      Reporte Alex
                    </p>
                    <h2 className="mt-1 text-lg font-bold leading-tight text-slate-900 sm:text-[1.6rem]">
                      Laboraron mas de 7:20h con 2 marcaciones, mas de 9:20h, marcaciones impares e inasistencias
                    </h2>
                    {alexRangeLabel && (
                      <p className="mt-1 text-base font-bold text-red-700">{alexRangeLabel}</p>
                    )}
                  </div>
                  <div className="w-full xl:max-w-2xl">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                        Fecha inicio
                        <input
                          type="date"
                          value={alexStartDate}
                        onChange={(e) => setAlexStartDate(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm"
                        min={availableDates[0]}
                        max={availableDates[availableDates.length - 1]}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                        Fecha fin
                        <input
                          type="date"
                          value={alexEndDate}
                        onChange={(e) => setAlexEndDate(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm"
                        min={availableDates[0]}
                        max={availableDates[availableDates.length - 1]}
                        />
                      </label>
                    </div>
                    <div className="mt-3 flex justify-start sm:justify-end">
                      <button
                        type="button"
                        onClick={() => void handleExportAlexTablePng()}
                        disabled={alexLoading || alexRows.length === 0 || exportingAlexPng}
                        className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-emerald-200/70 bg-emerald-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700 transition-all hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                      >
                        {exportingAlexPng ? "Generando PNG..." : "PNG tabla"}
                      </button>
                    </div>
                  </div>
                </div>
                {alexStartDate > alexEndDate && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                    La fecha inicio no puede ser mayor que la fecha fin.
                  </div>
                )}

                {alexError ? (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {alexError}
                  </div>
                ) : alexLoading ? (
                  <p className="mt-3 text-sm text-slate-600">Cargando reporte Alex...</p>
                ) : (
                  <div className="mt-3 overflow-auto rounded-xl border border-slate-200">
                    <table className="min-w-[820px] w-full text-sm">
                      <thead className="bg-slate-100 text-slate-800">
                        <tr>
                          <th className="border-b border-slate-200 px-3 py-2 text-left font-bold">
                            Sede
                          </th>
                          <th className="border-b border-slate-200 px-3 py-2 text-right font-bold">
                            Más de 7:20h con 2 marcaciones
                          </th>
                          <th className="border-b border-slate-200 px-3 py-2 text-right font-bold">
                            Más de 9:20h
                          </th>
                          <th className="border-b border-slate-200 px-3 py-2 text-right font-bold">
                            Marcaciones impares
                          </th>
                          <th className="border-b border-slate-200 px-3 py-2 text-right font-bold">
                            Inasistencias
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {alexRows.map((row) => (
                          <tr key={row.sede} className="border-b border-slate-100">
                            <td className="px-3 py-2 font-semibold text-slate-900">{row.sede}</td>
                            <td className="px-3 py-2 text-right text-slate-800">
                              {row.moreThan72With2 === 0 ? "-" : row.moreThan72With2}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-800">
                              {row.moreThan92 === 0 ? "-" : row.moreThan92}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-800">
                              {row.oddMarks === 0 ? "-" : row.oddMarks}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-800">
                              {row.absences === 0 ? "-" : row.absences}
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-slate-50 font-bold text-slate-900">
                          <td className="px-3 py-2">TOTAL</td>
                          <td className="px-3 py-2 text-right">{alexTotals.moreThan72With2}</td>
                          <td className="px-3 py-2 text-right">{alexTotals.moreThan92}</td>
                          <td className="px-3 py-2 text-right">{alexTotals.oddMarks}</td>
                          <td className="px-3 py-2 text-right">{alexTotals.absences}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <HourlyAnalysis
              availableDates={availableDates}
              availableSedes={availableSedes}
              defaultDate={defaultDate}
              defaultSede={defaultSede}
              sections={["overtime"]}
              defaultSection="overtime"
              showTimeFilters={false}
              showTopDateFilter={false}
              showTopLineFilter={false}
              showSedeFilters={false}
              showDepartmentFilterInOvertime
              enableOvertimeDateRange
              alexConsistencyMode={canSeeAlexReport}
              dashboardContext="jornada-extendida"
            />
          </>
        )}
      </div>
    </div>
  );
}


