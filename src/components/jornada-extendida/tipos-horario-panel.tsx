"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import type { Sede } from "@/lib/shared/constants";
import { loadExcelJs } from "@/components/hourly-analysis/hourly-formatters";
import {
  TIPOS_HORARIO_BUCKETS,
  TIPOS_HORARIO_DEFAULT_BUCKET,
  type TipoHorarioRow,
  type TiposHorarioResponse,
} from "@/lib/horarios/tipos-horario";

type TiposHorarioPanelProps = {
  open: boolean;
  onClose: () => void;
  availableSedes: Sede[];
};

type DepGroup = {
  departamento: string;
  tipoContrato: string;
  rows: TipoHorarioRow[];
  totalTurnos: number;
  totalDias: number;
};

type SedeGroup = {
  sede: string;
  departamentos: DepGroup[];
};

const formatHoras = (value: number) =>
  `${value.toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}h`;

const formatPct = (value: number) =>
  `${value.toLocaleString("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;

export function TiposHorarioPanel({ open, onClose, availableSedes }: TiposHorarioPanelProps) {
  const [activated, setActivated] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sede, setSede] = useState("all");
  const [bucket, setBucket] = useState<number>(TIPOS_HORARIO_DEFAULT_BUCKET);
  const [departamentoFilter, setDepartamentoFilter] = useState("all");
  const [contratoFilter, setContratoFilter] = useState("all");
  const [minDias, setMinDias] = useState(1);
  const [data, setData] = useState<TiposHorarioResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const rangeInitializedRef = useRef(false);

  // Primera apertura -> activa la carga; luego se mantiene montado y conserva datos.
  useEffect(() => {
    if (open) setActivated(true);
  }, [open]);

  // Cierre con tecla Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const fetchData = useCallback(
    async (
      params: { start: string; end: string; sede: string; bucket: number },
      signal: AbortSignal,
    ) => {
      const query = new URLSearchParams();
      if (params.start && params.end) {
        query.set("start", params.start);
        query.set("end", params.end);
      }
      if (params.sede && params.sede !== "all") query.set("sede", params.sede);
      query.set("bucket", String(params.bucket));
      const res = await fetch(
        `/api/jornada-extendida/tipos-horario?${query.toString()}`,
        { cache: "no-store", signal },
      );
      const json = (await res.json()) as TiposHorarioResponse;
      if (!res.ok) {
        throw new Error(json.error ?? "No se pudo cargar el analisis.");
      }
      return json;
    },
    [],
  );

  useEffect(() => {
    if (!activated) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchData({ start: startDate, end: endDate, sede, bucket }, controller.signal)
      .then((json) => {
        setData(json);
        if (!rangeInitializedRef.current && json.usedRange) {
          setStartDate(json.usedRange.start);
          setEndDate(json.usedRange.end);
          rangeInitializedRef.current = true;
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Error desconocido");
        setData(null);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
    // sede/bucket recargan en el acto; fechas via boton (reloadTick).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activated, sede, bucket, reloadTick]);

  const groups = useMemo<SedeGroup[]>(() => {
    if (!data) return [];
    const metaByKey = new Map(
      data.grupos.map((g) => [
        `${g.sede}||${g.departamento}||${g.tipoContrato}`,
        g,
      ]),
    );
    const visibleRows = data.rows.filter(
      (row) =>
        (departamentoFilter === "all" || row.departamento === departamentoFilter) &&
        (contratoFilter === "all" || row.tipoContrato === contratoFilter) &&
        row.diasEmpleado >= minDias,
    );
    const sedeMap = new Map<string, SedeGroup>();
    for (const row of visibleRows) {
      let group = sedeMap.get(row.sede);
      if (!group) {
        group = { sede: row.sede, departamentos: [] };
        sedeMap.set(row.sede, group);
      }
      let dep = group.departamentos.find(
        (d) =>
          d.departamento === row.departamento &&
          d.tipoContrato === row.tipoContrato,
      );
      if (!dep) {
        const meta = metaByKey.get(
          `${row.sede}||${row.departamento}||${row.tipoContrato}`,
        );
        dep = {
          departamento: row.departamento,
          tipoContrato: row.tipoContrato,
          rows: [],
          totalTurnos: meta?.totalTurnos ?? 0,
          totalDias: meta?.totalDias ?? 0,
        };
        group.departamentos.push(dep);
      }
      dep.rows.push(row);
    }
    return Array.from(sedeMap.values());
  }, [data, departamentoFilter, contratoFilter, minDias]);

  const totalRows = useMemo(
    () =>
      groups.reduce(
        (sum, g) => sum + g.departamentos.reduce((s, d) => s + d.rows.length, 0),
        0,
      ),
    [groups],
  );

  const handleExport = useCallback(async () => {
    if (!data || data.rows.length === 0) return;
    const ExcelJS = await loadExcelJs();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Tipos de horario");
    sheet.columns = [
      { header: "Sede", key: "sede", width: 18 },
      { header: "Area (departamento)", key: "departamento", width: 26 },
      { header: "Contrato", key: "contrato", width: 16 },
      { header: "Turno", key: "turno", width: 16 },
      { header: "Nocturno", key: "nocturno", width: 10 },
      { header: "Jornada", key: "jornada", width: 10 },
      { header: "Dias-empleado", key: "dias", width: 14 },
      { header: "Empleados", key: "empleados", width: 12 },
      { header: "% dias", key: "pct", width: 10 },
      { header: "Horas prom.", key: "horas", width: 12 },
    ];
    const filtered = data.rows.filter(
      (row) =>
        (departamentoFilter === "all" || row.departamento === departamentoFilter) &&
        (contratoFilter === "all" || row.tipoContrato === contratoFilter) &&
        row.diasEmpleado >= minDias,
    );
    for (const row of filtered) {
      sheet.addRow({
        sede: row.sede,
        departamento: row.departamento,
        contrato: row.tipoContrato,
        turno: row.turno,
        nocturno: row.cruzaMedianoche ? "Si" : "",
        jornada: row.jornada,
        dias: row.diasEmpleado,
        empleados: row.empleadosDistintos,
        pct: row.pctDias / 100,
        horas: Math.round(row.horasPromedio * 100) / 100,
      });
    }
    sheet.getRow(1).font = { bold: true };
    sheet.getColumn("pct").numFmt = "0.0%";
    const rango = data.usedRange ? `${data.usedRange.start}_${data.usedRange.end}` : "rango";
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tipos-horario-${rango}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  }, [data, departamentoFilter, contratoFilter, minDias]);

  if (!open) return null;

  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-slate-400 focus:outline-none";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative my-8 w-full max-w-5xl rounded-3xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Tipos de horario por sede y area
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Turnos reales segun marcaciones (entrada–salida redondeadas a {bucket} min). Es
              el horario de facto del rango, no el programado en planillas.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 pb-5 pt-4">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              Desde
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              Hasta
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              Sede
              <select value={sede} onChange={(e) => setSede(e.target.value)} className={inputClass}>
                <option value="all">Todas</option>
                {availableSedes.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              Granularidad
              <select
                value={bucket}
                onChange={(e) => setBucket(Number(e.target.value))}
                className={inputClass}
              >
                {TIPOS_HORARIO_BUCKETS.map((b) => (
                  <option key={b} value={b}>
                    {b} min
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              Area
              <select
                value={departamentoFilter}
                onChange={(e) => setDepartamentoFilter(e.target.value)}
                className={inputClass}
              >
                <option value="all">Todas</option>
                {(data?.departamentos ?? []).map((dep) => (
                  <option key={dep} value={dep}>
                    {dep}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              Contrato
              <select
                value={contratoFilter}
                onChange={(e) => setContratoFilter(e.target.value)}
                className={inputClass}
              >
                <option value="all">Todos</option>
                {(data?.contratos ?? []).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              Min. dias
              <input
                type="number"
                min={1}
                value={minDias}
                onChange={(e) => setMinDias(Math.max(1, Number(e.target.value) || 1))}
                className={`${inputClass} w-20`}
              />
            </label>
            <button
              type="button"
              onClick={() => setReloadTick((t) => t + 1)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Cargando..." : "Aplicar rango"}
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={loading || !data || data.rows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Excel
            </button>
          </div>

          {data?.usedRange && (
            <p className="mb-3 text-xs text-slate-400">
              Rango analizado: {data.usedRange.start} a {data.usedRange.end}
              {totalRows > 0 ? ` · ${totalRows} turnos mostrados` : ""}
            </p>
          )}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          {loading && !data && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              Calculando turnos del rango...
            </div>
          )}

          {!error && !loading && groups.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              No hay marcaciones con entrada y salida en el rango seleccionado.
            </div>
          )}

          <div className="max-h-[60vh] space-y-6 overflow-y-auto">
            {groups.map((group) => (
              <div key={group.sede}>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
                  {group.sede}
                </h3>
                <div className="grid gap-4 lg:grid-cols-2">
                  {group.departamentos.map((dep) => (
                    <div
                      key={`${dep.departamento}||${dep.tipoContrato}`}
                      className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
                    >
                      <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-3 py-2">
                        <span className="flex items-baseline gap-2 text-sm font-medium text-slate-800">
                          {dep.departamento}
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                            {dep.tipoContrato}
                          </span>
                        </span>
                        <span className="shrink-0 text-[11px] text-slate-400">
                          {dep.rows.length} de {dep.totalTurnos} turnos · {dep.totalDias} dias
                        </span>
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                            <th className="px-3 py-1.5 font-medium">Turno</th>
                            <th className="px-2 py-1.5 font-medium">Jornada</th>
                            <th className="px-2 py-1.5 text-right font-medium">Dias</th>
                            <th className="px-2 py-1.5 text-right font-medium">Pers.</th>
                            <th className="px-2 py-1.5 text-right font-medium">% dias</th>
                            <th className="px-3 py-1.5 text-right font-medium">Horas</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dep.rows.map((row, idx) => (
                            <tr
                              key={`${row.turno}-${idx}`}
                              className={`border-t border-slate-100 ${idx === 0 ? "bg-amber-50/50" : ""}`}
                            >
                              <td className="px-3 py-1.5 font-medium text-slate-800">
                                {row.turno}
                                {row.cruzaMedianoche && (
                                  <span className="ml-1 text-[10px] text-indigo-500">nocturno</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-slate-500">{row.jornada}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">
                                {row.diasEmpleado}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">
                                {row.empleadosDistintos}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">
                                {formatPct(row.pctDias)}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                                {formatHoras(row.horasPromedio)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
