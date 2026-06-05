"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock, Download, RefreshCw } from "lucide-react";
import type { Sede } from "@/lib/shared/constants";
import { loadExcelJs } from "@/components/hourly-analysis/hourly-formatters";
import {
  TIPOS_HORARIO_BUCKETS,
  TIPOS_HORARIO_DEFAULT_BUCKET,
  type TipoHorarioRow,
  type TiposHorarioResponse,
} from "@/lib/horarios/tipos-horario";

type TiposHorarioPanelProps = {
  availableSedes: Sede[];
};

type SedeGroup = {
  sede: string;
  departamentos: Array<{
    departamento: string;
    rows: TipoHorarioRow[];
    totalTurnos: number;
    totalDias: number;
  }>;
};

const formatHoras = (value: number) =>
  `${value.toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}h`;

const formatPct = (value: number) =>
  `${value.toLocaleString("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;

export function TiposHorarioPanel({ availableSedes }: TiposHorarioPanelProps) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sede, setSede] = useState("all");
  const [bucket, setBucket] = useState<number>(TIPOS_HORARIO_DEFAULT_BUCKET);
  const [departamentoFilter, setDepartamentoFilter] = useState("all");
  const [data, setData] = useState<TiposHorarioResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const rangeInitializedRef = useRef(false);

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
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchData({ start: startDate, end: endDate, sede, bucket }, controller.signal)
      .then((json) => {
        setData(json);
        // En la primera carga, sincroniza los inputs de fecha con el rango usado.
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
    // sede y bucket recargan en el acto; fechas via boton (reloadTick).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sede, bucket, reloadTick]);

  const groups = useMemo<SedeGroup[]>(() => {
    if (!data) return [];
    const metaByKey = new Map(
      data.grupos.map((g) => [`${g.sede}||${g.departamento}`, g]),
    );
    const visibleRows = data.rows.filter(
      (row) => departamentoFilter === "all" || row.departamento === departamentoFilter,
    );
    const sedeMap = new Map<string, SedeGroup>();
    for (const row of visibleRows) {
      let group = sedeMap.get(row.sede);
      if (!group) {
        group = { sede: row.sede, departamentos: [] };
        sedeMap.set(row.sede, group);
      }
      let dep = group.departamentos.find((d) => d.departamento === row.departamento);
      if (!dep) {
        const meta = metaByKey.get(`${row.sede}||${row.departamento}`);
        dep = {
          departamento: row.departamento,
          rows: [],
          totalTurnos: meta?.totalTurnos ?? 0,
          totalDias: meta?.totalDias ?? 0,
        };
        group.departamentos.push(dep);
      }
      dep.rows.push(row);
    }
    return Array.from(sedeMap.values());
  }, [data, departamentoFilter]);

  const totalRows = useMemo(
    () => groups.reduce((sum, g) => sum + g.departamentos.reduce((s, d) => s + d.rows.length, 0), 0),
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
      { header: "Turno", key: "turno", width: 16 },
      { header: "Nocturno", key: "nocturno", width: 10 },
      { header: "Jornada", key: "jornada", width: 10 },
      { header: "Dias-empleado", key: "dias", width: 14 },
      { header: "Empleados", key: "empleados", width: 12 },
      { header: "% dias", key: "pct", width: 10 },
      { header: "Horas prom.", key: "horas", width: 12 },
    ];
    const filtered = data.rows.filter(
      (row) => departamentoFilter === "all" || row.departamento === departamentoFilter,
    );
    for (const row of filtered) {
      sheet.addRow({
        sede: row.sede,
        departamento: row.departamento,
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
  }, [data, departamentoFilter]);

  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-slate-400 focus:outline-none";

  return (
    <section className="mt-5 rounded-3xl border border-slate-200/70 bg-white p-5 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-2xl bg-slate-900/90 p-2.5 text-white">
          <Clock className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Tipos de horario por sede y area
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Turnos reales segun marcaciones (entrada–salida redondeadas a {bucket} min). Es
            el horario de facto del rango, no el programado en planillas.
          </p>
        </div>
      </div>

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

      {!error && !loading && groups.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          No hay marcaciones con entrada y salida en el rango seleccionado.
        </div>
      )}

      <div className="space-y-6">
        {groups.map((group) => (
          <div key={group.sede}>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
              {group.sede}
            </h3>
            <div className="grid gap-4 lg:grid-cols-2">
              {group.departamentos.map((dep) => (
                <div
                  key={dep.departamento}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
                >
                  <div className="flex items-baseline justify-between border-b border-slate-100 bg-slate-50/60 px-3 py-2">
                    <span className="text-sm font-medium text-slate-800">
                      {dep.departamento}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      top {dep.rows.length} de {dep.totalTurnos} · {dep.totalDias} dias
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
    </section>
  );
}
