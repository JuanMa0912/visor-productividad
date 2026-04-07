"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { canAccessPortalSection } from "@/lib/portal-sections";
import { toJpeg } from "html-to-image";

type DayKey =
  | "domingo"
  | "lunes"
  | "martes"
  | "miercoles"
  | "jueves"
  | "viernes"
  | "sabado";

type DaySchedule = {
  he1: string;
  hs1: string;
  he2: string;
  hs2: string;
  conDescanso: boolean;
};

type RowSchedule = {
  nombre: string;
  firma: string;
  days: Record<DayKey, DaySchedule>;
};

const DAY_ORDER: DayKey[] = [
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
];

const EMPTY_DAY: DaySchedule = {
  he1: "",
  hs1: "",
  he2: "",
  hs2: "",
  conDescanso: false,
};

const createEmptyRow = (): RowSchedule => ({
  nombre: "",
  firma: "",
  days: {
    domingo: { ...EMPTY_DAY },
    lunes: { ...EMPTY_DAY },
    martes: { ...EMPTY_DAY },
    miercoles: { ...EMPTY_DAY },
    jueves: { ...EMPTY_DAY },
    viernes: { ...EMPTY_DAY },
    sabado: { ...EMPTY_DAY },
  },
});

const MONTH_OPTIONS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const normalizeText = (value?: string) =>
  (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const formatTimeForPrint = (value?: string) => {
  const normalized = (value ?? "").trim();
  if (!normalized) return "";
  const [rawHours, rawMinutes] = normalized.split(":");
  const hours = Number(rawHours);
  const minutes = Number(rawMinutes ?? "0");
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return normalized.length >= 5 ? normalized.slice(0, 5) : normalized;
  }
  const period = hours >= 12 ? "pm" : "am";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(hour12).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${period}`;
};

type RowScheduleRowProps = {
  row: RowSchedule;
  rowIndex: number;
  onRowField: (
    rowIndex: number,
    field: keyof Pick<RowSchedule, "nombre" | "firma">,
    value: string,
  ) => void;
  onRowDayField: (
    rowIndex: number,
    day: DayKey,
    field: keyof DaySchedule,
    value: string,
  ) => void;
  onDescanso: (rowIndex: number, day: DayKey, checked: boolean) => void;
};

const RowScheduleRow = memo(
  ({ row, rowIndex, onRowField, onRowDayField, onDescanso }: RowScheduleRowProps) => (
    <tr className="odd:bg-white even:bg-slate-50/40">
      <td className="border border-slate-200 px-2 py-1 text-center text-slate-600">
        {rowIndex + 1}
      </td>
      <td className="border border-slate-200 px-2 py-1">
        <input
          type="text"
          list="employees-cajas-options"
          value={row.nombre}
          onChange={(e) => onRowField(rowIndex, "nombre", e.target.value.trimStart())}
          placeholder="Escribir o seleccionar empleado"
          className="w-full min-w-70 rounded border border-slate-200 px-2 py-1 text-[12px] focus:border-sky-300 focus:outline-none focus:ring-1 focus:ring-sky-100 print:hidden"
        />
        <span className="hidden text-[8px] leading-tight text-slate-900 print:block">
          {row.nombre}
        </span>
      </td>
      {DAY_ORDER.flatMap((day) => {
        const dayData = row.days[day];
        if (dayData.conDescanso) {
          return [
            <td
              key={`${rowIndex}-${day}-descanso`}
              colSpan={4}
              className="border border-slate-200 bg-amber-50/60 px-1 py-1 text-center"
            >
              <label className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-700">
                <input
                  type="checkbox"
                  checked={dayData.conDescanso}
                  onChange={(e) => onDescanso(rowIndex, day, e.target.checked)}
                  title="Marcar este dia como descanso para este empleado"
                  className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-200 print:hidden"
                />
                <span>Descanso</span>
              </label>
            </td>,
          ];
        }

        return (["he1", "hs1", "he2", "hs2"] as const).map((field) => (
          <td
            key={`${rowIndex}-${day}-${field}`}
            className="border border-slate-200 px-1 py-1 print:px-0.5 print:text-center"
          >
            {field === "he1" ? (
              <div className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={dayData.conDescanso}
                  onChange={(e) => onDescanso(rowIndex, day, e.target.checked)}
                  title="Marcar este dia como descanso para este empleado"
                  className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-200 print:hidden"
                />
                <input
                  type="time"
                  step={60}
                  value={(dayData[field] as string | undefined) ?? ""}
                  onClick={(e) => {
                    const input = e.currentTarget as HTMLInputElement & {
                      showPicker?: () => void;
                    };
                    if (typeof input.showPicker === "function") input.showPicker();
                  }}
                  onChange={(e) => onRowDayField(rowIndex, day, field, e.target.value)}
                  className="schedule-time-input w-full rounded border border-slate-200 px-1 py-1 text-[11px] focus:border-sky-300 focus:outline-none focus:ring-1 focus:ring-sky-100 print:hidden"
                />
                <span className="hidden w-full text-center text-[8px] leading-none text-slate-900 print:block">
                  {formatTimeForPrint(dayData[field])}
                </span>
              </div>
            ) : (
              <>
                <input
                  type="time"
                  step={60}
                  value={(dayData[field] as string | undefined) ?? ""}
                  onClick={(e) => {
                    const input = e.currentTarget as HTMLInputElement & {
                      showPicker?: () => void;
                    };
                    if (typeof input.showPicker === "function") input.showPicker();
                  }}
                  onChange={(e) => onRowDayField(rowIndex, day, field, e.target.value)}
                  className="schedule-time-input w-full rounded border border-slate-200 px-1 py-1 text-[11px] focus:border-sky-300 focus:outline-none focus:ring-1 focus:ring-sky-100 print:hidden"
                />
                <span className="hidden w-full text-center text-[8px] leading-none text-slate-900 print:block">
                  {formatTimeForPrint(dayData[field])}
                </span>
              </>
            )}
          </td>
        ));
      })}
      <td className="h-16 border border-slate-200 px-2 py-1 align-top">
        <textarea
          value={row.firma}
          onChange={(e) => onRowField(rowIndex, "firma", e.target.value)}
          rows={2}
          className="h-full min-h-14 w-full resize-none rounded border border-slate-200 px-2 py-1 text-[12px] focus:border-sky-300 focus:outline-none focus:ring-1 focus:ring-sky-100 print:hidden"
        />
        <span className="hidden text-[8px] leading-tight text-slate-900 print:block">
          {row.firma}
        </span>
      </td>
    </tr>
  ),
);

RowScheduleRow.displayName = "RowScheduleRow";

type HorariosOptionsResponse = {
  sedes?: Array<{ id: string; name: string }>;
  defaultSede?: string | null;
  employees?: Array<{ name: string; sede?: string }>;
  error?: string;
};

export default function IngresarHorariosPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [sede, setSede] = useState("");
  const [seccion, setSeccion] = useState("Cajas");
  const [fechaInicial, setFechaInicial] = useState("");
  const [fechaFinal, setFechaFinal] = useState("");
  const [mes, setMes] = useState("");
  const [sedesOptions, setSedesOptions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [employeeOptions, setEmployeeOptions] = useState<
    Array<{ name: string; sede?: string }>
  >([]);
  const [exportingJpg, setExportingJpg] = useState(false);
  const [rows, setRows] = useState<RowSchedule[]>(
    Array.from({ length: 16 }, () => createEmptyRow()),
  );
  const planillaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const loadUser = async () => {
      try {
        const response = await fetch("/api/auth/me", {
          signal: controller.signal,
        });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) return;
        const payload = (await response.json()) as {
          user?: { role?: string; allowedDashboards?: string[] | null };
        };
        const isAdmin = payload.user?.role === "admin";
        if (
          !isAdmin &&
          !canAccessPortalSection(payload.user?.allowedDashboards, "operacion")
        ) {
          router.replace("/secciones");
          return;
        }
        const optionsResponse = await fetch("/api/ingresar-horarios/options", {
          signal: controller.signal,
        });
        if (!optionsResponse.ok) {
          const optionsPayload =
            (await optionsResponse.json()) as HorariosOptionsResponse;
          throw new Error(
            optionsPayload.error ?? "No se pudieron cargar opciones",
          );
        }
        const optionsPayload =
          (await optionsResponse.json()) as HorariosOptionsResponse;
        if (!isMounted) return;
        const nextSedes = optionsPayload.sedes ?? [];
        setSedesOptions(nextSedes);
        setEmployeeOptions(optionsPayload.employees ?? []);
        if (optionsPayload.defaultSede) {
          setSede(optionsPayload.defaultSede);
        } else if (nextSedes.length > 0) {
          setSede(nextSedes[0].name);
        }
        setReady(true);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    };

    void loadUser();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [router]);

  const updateRowField = useCallback((
    rowIndex: number,
    field: keyof Pick<RowSchedule, "nombre" | "firma">,
    value: string,
  ) => {
    setRows((prev) =>
      prev.map((row, idx) =>
        idx === rowIndex ? { ...row, [field]: value } : row,
      ),
    );
  }, []);

  const updateRowDayField = useCallback((
    rowIndex: number,
    day: DayKey,
    field: keyof DaySchedule,
    value: string,
  ) => {
    setRows((prev) =>
      prev.map((row, idx) =>
        idx === rowIndex
          ? {
              ...row,
              days: {
                ...row.days,
                [day]: {
                  ...row.days[day],
                  [field]: value,
                },
              },
            }
          : row,
      ),
    );
  }, []);

  const updateDescanso = useCallback((
    rowIndex: number,
    day: DayKey,
    checked: boolean,
  ) => {
    setRows((prev) =>
      prev.map((row, idx) =>
        idx === rowIndex
          ? {
              ...row,
              days: {
                ...row.days,
                [day]: {
                  ...row.days[day],
                  conDescanso: checked,
                  he1: checked ? "" : row.days[day].he1,
                  hs1: checked ? "" : row.days[day].hs1,
                  he2: checked ? "" : row.days[day].he2,
                  hs2: checked ? "" : row.days[day].hs2,
                },
              },
            }
          : row,
      ),
    );
  }, []);

  const filteredEmployeeNames = useMemo(
    () =>
      Array.from(
        new Set(
          employeeOptions
            .filter(
              (employee) =>
                !sede ||
                normalizeText(employee.sede ?? "") === normalizeText(sede),
            )
            .map((employee) => employee.name)
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b, "es")),
    [employeeOptions, sede],
  );

  const handleExportPdf = () => {
    window.print();
  };
  const handleExportJpg = useCallback(async () => {
    if (!planillaRef.current) return;
    setExportingJpg(true);
    try {
      const dataUrl = await toJpeg(planillaRef.current, {
        quality: 0.95,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        cacheBust: true,
      });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `planilla-horarios-${sede || "sede"}-${mes || "mes"}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setExportingJpg(false);
    }
  }, [mes, sede]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <p className="text-sm text-slate-600">Cargando modulo...</p>
        </div>
      </div>
    );
  }

  const dayNumbersByKey: Partial<Record<DayKey, string>> = {};
  if (fechaInicial && fechaFinal) {
    const start = new Date(`${fechaInicial}T00:00:00`);
    const end = new Date(`${fechaFinal}T00:00:00`);
    if (
      !Number.isNaN(start.getTime()) &&
      !Number.isNaN(end.getTime()) &&
      start <= end
    ) {
      const cursor = new Date(start);
      while (cursor <= end) {
        const dayIdx = cursor.getDay();
        const dayKey = DAY_ORDER[dayIdx];
        dayNumbersByKey[dayKey] = String(cursor.getDate()).padStart(2, "0");
        cursor.setDate(cursor.getDate() + 1);
      }
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-12 text-foreground print:bg-white print:p-0">
      <div
        id="planilla-print"
        ref={planillaRef}
        className="mx-auto w-full max-w-384 rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_28px_70px_-45px_rgba(15,23,42,0.4)] print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
              Horario
            </p>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">
              Ingresar horarios
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Planilla de programacion semanal de horarios.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportPdf}
              className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 transition-all hover:border-emerald-300 hover:bg-emerald-100/70"
            >
              Exportar PDF
            </button>
            <button
              type="button"
              onClick={() => void handleExportJpg()}
              disabled={exportingJpg}
              className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 transition-all hover:border-emerald-300 hover:bg-emerald-100/70 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exportingJpg ? "Generando JPG..." : "Exportar JPG"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/horario")}
              className="inline-flex items-center rounded-full border border-slate-200/70 bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-200/70"
            >
              Volver a Horario
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-5 print:hidden">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
              Sede
            </span>
            <select
              value={sede}
              onChange={(e) => setSede(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-100"
            >
              {sedesOptions.map((option) => (
                <option key={option.id} value={option.name}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
              Seccion
            </span>
            <input
              type="text"
              value={seccion}
              onChange={(e) => setSeccion(e.target.value)}
              disabled
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-100"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
              Fecha inicial
            </span>
            <input
              type="date"
              value={fechaInicial}
              onChange={(e) => setFechaInicial(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-100"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
              Fecha final
            </span>
            <input
              type="date"
              value={fechaFinal}
              onChange={(e) => setFechaFinal(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-100"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
              Mes
            </span>
            <select
              value={mes}
              onChange={(e) => setMes(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-100"
            >
              <option value="">Selecciona mes</option>
              {MONTH_OPTIONS.map((month) => (
                <option key={month} value={month}>
                  {month}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 hidden border border-slate-900 px-3 py-2 print:block">
          <div className="grid grid-cols-[1fr_1fr_1fr] items-center border-b border-slate-900 pb-2">
            <div className="text-left text-xs font-bold tracking-wide text-slate-900">
              MercaTodo
            </div>
            <div className="text-center text-xs font-bold tracking-wide text-slate-900">
              MERCAMIO S.A.
            </div>
            <div className="text-right text-xs font-bold uppercase tracking-wide text-slate-900">
              Planilla De Programacion Semanal De Horarios
            </div>
          </div>
          <div className="mt-2 grid grid-cols-5 gap-3 text-[11px]">
            <div>
              <span className="font-semibold">SEDE:</span> {sede || "-"}
            </div>
            <div>
              <span className="font-semibold">SECCION:</span> {seccion || "-"}
            </div>
            <div>
              <span className="font-semibold">FECHA INICIAL:</span>{" "}
              {fechaInicial || "-"}
            </div>
            <div>
              <span className="font-semibold">FECHA FINAL:</span>{" "}
              {fechaFinal || "-"}
            </div>
            <div>
              <span className="font-semibold">MES:</span> {mes || "-"}
            </div>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200/80 print:overflow-visible print:rounded-none print:border-slate-900">
          <table className="planilla-print-table min-w-425 w-full border-collapse text-[12px] print:min-w-0 print:text-[8px]">
            <thead>
              <tr className="bg-slate-100 text-slate-700">
                <th className="w-10 border border-slate-200 px-2 py-2 text-center">
                  #
                </th>
                <th className="w-80 border border-slate-200 px-2 py-2 text-left print:w-35">
                  Nombre
                </th>
                {DAY_ORDER.map((day) => (
                  <th
                    key={day}
                    colSpan={4}
                    className="border border-slate-200 px-2 py-2 text-center uppercase"
                  >
                    <div className="flex items-center justify-center gap-2">
                      <span>{day}</span>
                      <span className="rounded-md bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                        {dayNumbersByKey[day] ?? "--"}
                      </span>
                    </div>
                  </th>
                ))}
                <th className="w-96 border border-slate-200 px-2 py-2 text-left print:w-35">
                  Firma empleado
                </th>
              </tr>
              <tr className="bg-white text-[11px] font-semibold text-slate-500">
                <th className="border border-slate-200 px-2 py-2" />
                <th className="border border-slate-200 px-2 py-2" />
                {DAY_ORDER.flatMap((day) =>
                  (["he1", "hs1", "he2", "hs2"] as const).map((field) => (
                    <th
                      key={`${day}-${field}`}
                      className="w-16 border border-slate-200 px-2 py-2 text-center uppercase print:w-6 print:px-0.5"
                    >
                      {field === "he1" || field === "he2" ? "HE" : "HS"}
                    </th>
                  )),
                )}
                <th className="border border-slate-200 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <RowScheduleRow
                  key={`row-${rowIndex}`}
                  row={row}
                  rowIndex={rowIndex}
                  onRowField={updateRowField}
                  onRowDayField={updateRowDayField}
                  onDescanso={updateDescanso}
                />
              ))}
            </tbody>
          </table>
          <datalist id="employees-cajas-options">
            {filteredEmployeeNames.map((employeeName) => (
              <option key={employeeName} value={employeeName} />
            ))}
          </datalist>
        </div>

        <div className="mt-4 space-y-1 text-xs text-slate-500 print:hidden">
          <p>
            HE: hora entrada | HS: hora salida | HE: reingreso | HS: salida
            final.
          </p>
          <p>
            Marca el check junto al primer HE para dejar el dia completo en
            descanso (DESC) para ese empleado.
          </p>
        </div>
        <style jsx global>{`
          @media print {
            @page {
              size: landscape;
              margin: 8mm;
            }
            body {
              background: white !important;
            }
            body * {
              visibility: hidden;
            }
            #planilla-print,
            #planilla-print * {
              visibility: visible;
            }
            #planilla-print {
              position: absolute;
              inset: 0;
              width: 100%;
            }
            .planilla-print-table {
              table-layout: fixed;
              width: 100%;
            }
            input[type="checkbox"] {
              display: none !important;
            }
          }
          .schedule-time-input::-webkit-calendar-picker-indicator {
            opacity: 0;
            width: 0;
            margin: 0;
          }
          .schedule-time-input::-webkit-datetime-edit-ampm-field {
            display: none;
          }
        `}</style>
      </div>
    </div>
  );
}
