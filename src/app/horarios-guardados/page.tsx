"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Files,
  Filter,
  Loader2,
  Pencil,
  PenLine,
  Printer,
  RotateCcw,
  Trash2,
  Users,
} from "lucide-react";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import { AppTopBar } from "@/components/portal/app-top-bar";

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
  /** Indice de fila en la planilla (1-16) cuando viene del API */
  rowIndex?: number;
};

type SavedScheduleFormSummary = {
  id: number;
  sede: string;
  seccion: string;
  fechaInicial: string;
  fechaFinal: string;
  mes: string;
  createdByUsername: string;
  createdAt: string;
  employeeCount: number;
  detailCount: number;
};

type SavedScheduleFormDetail = {
  id: number;
  sede: string;
  seccion: string;
  fechaInicial: string;
  fechaFinal: string;
  mes: string;
  createdByUsername: string;
  createdAt: string;
  rows: RowSchedule[];
};

type EmployeeSummary = {
  name: string;
  recordCount: number;
  formCount: number;
  firstWorkedDate: string;
  lastWorkedDate: string;
};

type EmployeeRecord = {
  planillaId: number;
  sede: string;
  seccion: string;
  mes: string;
  fechaInicial: string;
  fechaFinal: string;
  workedDate: string;
  dayKey: string;
  he1: string;
  hs1: string;
  he2: string;
  hs2: string;
  conDescanso: boolean;
  createdByUsername: string;
  createdAt: string;
};

type ViewMode = "plantillas" | "personas";

const DAY_ORDER: DayKey[] = [
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
];

const EMPLOYEES_PER_PAGE = 5;

const FIRST_DAY_KEY = DAY_ORDER[0];

function dayStartDividerClass(day: DayKey): string {
  return day === FIRST_DAY_KEY ? "" : "day-group-start";
}

const normalizeText = (value?: string) =>
  (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const formatDateLabel = (value?: string) => {
  const normalized = (value ?? "").trim();
  if (!normalized) return "--";
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) return normalized;
  return date.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const formatDateTimeLabel = (value?: string) => {
  const normalized = (value ?? "").trim();
  if (!normalized) return "--";
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return normalized;
  return date.toLocaleString("es-CO");
};

const buildDayNumbersByKey = (start: string, end: string) => {
  const result: Partial<Record<DayKey, string>> = {};
  if (!start || !end) return result;

  const cursor = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(endDate.getTime()) || cursor > endDate) {
    return result;
  }

  while (cursor <= endDate) {
    const dayKey = DAY_ORDER[cursor.getDay()];
    result[dayKey] = String(cursor.getDate()).padStart(2, "0");
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
};

const renderTimeValue = (value: string) => value || "--";

const getCookieValue = (name: string) => {
  if (typeof document === "undefined") return null;
  const value = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`));
  if (!value) return null;
  return decodeURIComponent(value.split("=").slice(1).join("="));
};

export default function HorariosGuardadosPage() {
  const router = useRouter();
  const { status: authStatus } = useRequireAuth();
  const { hasSection } = usePermissions();
  const [ready, setReady] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("plantillas");
  const [forms, setForms] = useState<SavedScheduleFormSummary[]>([]);
  const [formsError, setFormsError] = useState<string | null>(null);
  const [selectedFormId, setSelectedFormId] = useState<number | null>(null);
  const [loadingFormId, setLoadingFormId] = useState<number | null>(null);
  const [formDetailsById, setFormDetailsById] = useState<
    Record<number, SavedScheduleFormDetail>
  >({});
  const [people, setPeople] = useState<EmployeeSummary[]>([]);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeePage, setEmployeePage] = useState(1);
  const [selectedEmployeeName, setSelectedEmployeeName] = useState<string | null>(null);
  const [loadingEmployeeName, setLoadingEmployeeName] = useState<string | null>(null);
  const [deletingPlanillaId, setDeletingPlanillaId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [employeeRecordsByName, setEmployeeRecordsByName] = useState<
    Record<string, EmployeeRecord[]>
  >({});
  // Filtros para el historial "Por persona". Se resetean al cambiar de empleado
  // para no arrastrar rangos que pertenecen a otro periodo.
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterDayKey, setFilterDayKey] = useState<"" | DayKey>("");
  const [filterSede, setFilterSede] = useState("");

  const selectedForm = selectedFormId !== null ? formDetailsById[selectedFormId] ?? null : null;
  const selectedEmployeeRecords =
    selectedEmployeeName !== null ? employeeRecordsByName[selectedEmployeeName] ?? [] : [];

  const loadForms = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/ingresar-horarios/forms", {
      signal,
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      forms?: SavedScheduleFormSummary[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error ?? "No se pudieron cargar las plantillas guardadas.");
    }
    setForms(payload.forms ?? []);
    setFormsError(null);
  }, []);

  const loadPeople = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/ingresar-horarios/people", {
      signal,
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      people?: EmployeeSummary[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error ?? "No se pudo cargar el listado por persona.");
    }
    setPeople(payload.people ?? []);
    setPeopleError(null);
  }, []);

  const handleViewForm = useCallback(
    async (formId: number) => {
      setSelectedFormId(formId);
      if (formDetailsById[formId]) return;

      setLoadingFormId(formId);
      try {
        const response = await fetch(`/api/ingresar-horarios/forms/${formId}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          form?: SavedScheduleFormDetail;
          error?: string;
        };
        if (!response.ok || !payload.form) {
          throw new Error(payload.error ?? "No se pudo cargar la plantilla.");
        }
        setFormDetailsById((prev) => ({
          ...prev,
          [formId]: payload.form as SavedScheduleFormDetail,
        }));
        setFormsError(null);
      } catch (err) {
        setFormsError(err instanceof Error ? err.message : "Error desconocido al cargar.");
      } finally {
        setLoadingFormId(null);
      }
    },
    [formDetailsById],
  );

  const handleViewEmployee = useCallback(
    async (employeeName: string) => {
      setSelectedEmployeeName((prev) => {
        if (prev !== employeeName) {
          setFilterDateFrom("");
          setFilterDateTo("");
          setFilterDayKey("");
          setFilterSede("");
        }
        return employeeName;
      });
      if (employeeRecordsByName[employeeName]) return;

      setLoadingEmployeeName(employeeName);
      try {
        const response = await fetch(
          `/api/ingresar-horarios/people?employee=${encodeURIComponent(employeeName)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as {
          records?: EmployeeRecord[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "No se pudo cargar el detalle del empleado.");
        }
        setEmployeeRecordsByName((prev) => ({
          ...prev,
          [employeeName]: payload.records ?? [],
        }));
        setPeopleError(null);
      } catch (err) {
        setPeopleError(err instanceof Error ? err.message : "Error desconocido al cargar.");
      } finally {
        setLoadingEmployeeName(null);
      }
    },
    [employeeRecordsByName],
  );

  const handleDeleteForm = useCallback(
    async (planillaId: number) => {
      if (deletingPlanillaId !== null) return;
      const confirmed = window.confirm(
        `Se eliminara la planilla #${planillaId} y todos sus horarios registrados. Esta accion no se puede deshacer.`,
      );
      if (!confirmed) return;

      const csrfToken = getCookieValue("vp_csrf");
      if (!csrfToken) {
        setActionError("No se pudo validar la sesion. Recarga la pagina.");
        setActionMessage(null);
        return;
      }

      setDeletingPlanillaId(planillaId);
      setActionError(null);
      setActionMessage(null);

      try {
        const response = await fetch(`/api/ingresar-horarios/forms/${planillaId}`, {
          method: "DELETE",
          headers: {
            "x-csrf-token": csrfToken,
          },
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "No se pudo eliminar la planilla.");
        }

        setForms((prev) => prev.filter((form) => form.id !== planillaId));
        setFormDetailsById((prev) => {
          const next = { ...prev };
          delete next[planillaId];
          return next;
        });
        setEmployeeRecordsByName((prev) =>
          Object.fromEntries(
            Object.entries(prev).map(([employeeName, records]) => [
              employeeName,
              records.filter((record) => record.planillaId !== planillaId),
            ]),
          ),
        );

        setSelectedFormId((prev) => (prev === planillaId ? null : prev));

        await loadForms();
        await loadPeople();
        if (selectedEmployeeName) {
          setEmployeeRecordsByName((prev) => {
            const next = { ...prev };
            delete next[selectedEmployeeName];
            return next;
          });
          void handleViewEmployee(selectedEmployeeName);
        }

        setActionMessage(`Planilla #${planillaId} eliminada correctamente.`);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Error desconocido al eliminar.");
        setActionMessage(null);
      } finally {
        setDeletingPlanillaId(null);
      }
    },
    [
      deletingPlanillaId,
      handleViewEmployee,
      loadForms,
      loadPeople,
      selectedEmployeeName,
    ],
  );

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    if (!hasSection("operacion")) {
      router.replace("/secciones");
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    const loadPage = async () => {
      try {
        await Promise.all([
          loadForms(controller.signal).catch((err) => {
            if (!(err instanceof DOMException && err.name === "AbortError")) {
              setFormsError(
                err instanceof Error ? err.message : "No se pudieron cargar las plantillas.",
              );
            }
          }),
          loadPeople(controller.signal).catch((err) => {
            if (!(err instanceof DOMException && err.name === "AbortError")) {
              setPeopleError(
                err instanceof Error ? err.message : "No se pudo cargar el listado por persona.",
              );
            }
          }),
        ]);

        if (isMounted) setReady(true);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    };

    void loadPage();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [authStatus, hasSection, loadForms, loadPeople, router]);

  useEffect(() => {
    if (forms.length > 0 && selectedFormId === null) {
      void handleViewForm(forms[0].id);
    }
  }, [forms, handleViewForm, selectedFormId]);

  useEffect(() => {
    if (people.length > 0 && selectedEmployeeName === null) {
      void handleViewEmployee(people[0].name);
    }
  }, [handleViewEmployee, people, selectedEmployeeName]);

  const filteredPeople = useMemo(() => {
    const search = normalizeText(employeeSearch);
    if (!search) return people;
    return people.filter((person) => normalizeText(person.name).includes(search));
  }, [employeeSearch, people]);

  const employeeTotalPages = Math.max(
    1,
    Math.ceil(filteredPeople.length / EMPLOYEES_PER_PAGE),
  );

  // Mantener la pagina dentro del rango valido cuando cambia la lista filtrada
  // (busqueda o eliminacion de empleados puede reducir el total de paginas).
  useEffect(() => {
    if (employeePage > employeeTotalPages) {
      setEmployeePage(employeeTotalPages);
    }
  }, [employeePage, employeeTotalPages]);

  const paginatedPeople = useMemo(() => {
    const start = (employeePage - 1) * EMPLOYEES_PER_PAGE;
    return filteredPeople.slice(start, start + EMPLOYEES_PER_PAGE);
  }, [employeePage, filteredPeople]);

  const employeeRangeStart =
    filteredPeople.length === 0
      ? 0
      : (employeePage - 1) * EMPLOYEES_PER_PAGE + 1;
  const employeeRangeEnd = Math.min(
    employeePage * EMPLOYEES_PER_PAGE,
    filteredPeople.length,
  );

  const availableSedesForEmployee = useMemo(() => {
    const set = new Set<string>();
    for (const record of selectedEmployeeRecords) {
      const sede = (record.sede ?? "").trim();
      if (sede) set.add(sede);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [selectedEmployeeRecords]);

  const employeeDateBounds = useMemo(() => {
    if (selectedEmployeeRecords.length === 0) return { min: "", max: "" };
    let min = selectedEmployeeRecords[0].workedDate;
    let max = selectedEmployeeRecords[0].workedDate;
    for (const record of selectedEmployeeRecords) {
      if (!record.workedDate) continue;
      if (record.workedDate < min) min = record.workedDate;
      if (record.workedDate > max) max = record.workedDate;
    }
    return { min, max };
  }, [selectedEmployeeRecords]);

  const filteredEmployeeRecords = useMemo(() => {
    return selectedEmployeeRecords.filter((record) => {
      const workedDate = (record.workedDate ?? "").trim();
      if (filterDateFrom && (!workedDate || workedDate < filterDateFrom)) {
        return false;
      }
      if (filterDateTo && (!workedDate || workedDate > filterDateTo)) {
        return false;
      }
      if (filterDayKey && record.dayKey !== filterDayKey) {
        return false;
      }
      if (filterSede && record.sede !== filterSede) {
        return false;
      }
      return true;
    });
  }, [
    selectedEmployeeRecords,
    filterDateFrom,
    filterDateTo,
    filterDayKey,
    filterSede,
  ]);

  const employeeFiltersActive = Boolean(
    filterDateFrom || filterDateTo || filterDayKey || filterSede,
  );

  const clearEmployeeFilters = useCallback(() => {
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterDayKey("");
    setFilterSede("");
  }, []);

  const selectedFormDayNumbers = useMemo(
    () =>
      selectedForm
        ? buildDayNumbersByKey(selectedForm.fechaInicial, selectedForm.fechaFinal)
        : {},
    [selectedForm],
  );

  // Para cada dia, indica si alguna fila usa break (hs1 o he2 con dato real).
  // Si un dia no tiene break alguno, ocultamos esas dos columnas intermedias
  // en la impresion para que las columnas restantes se vean mas grandes.
  const dayHasBreaks = useMemo(() => {
    const result: Record<DayKey, boolean> = {
      domingo: false,
      lunes: false,
      martes: false,
      miercoles: false,
      jueves: false,
      viernes: false,
      sabado: false,
    };
    if (!selectedForm) return result;
    const hasContent = (value: string | undefined | null) =>
      Boolean(value && value.trim() && value.trim() !== "--");
    for (const row of selectedForm.rows) {
      for (const day of DAY_ORDER) {
        const dayData = row.days[day];
        if (!dayData || dayData.conDescanso) continue;
        if (hasContent(dayData.hs1) || hasContent(dayData.he2)) {
          result[day] = true;
        }
      }
    }
    return result;
  }, [selectedForm]);

  // Indica si el dia esta integramente compuesto por Descanso (entre las filas
  // con algun dato). En esos dias el bloque se reduce a una sola columna
  // estrecha para liberar ancho a los dias con horario real.
  const dayAllDescanso = useMemo(() => {
    const result: Record<DayKey, boolean> = {
      domingo: false,
      lunes: false,
      martes: false,
      miercoles: false,
      jueves: false,
      viernes: false,
      sabado: false,
    };
    if (!selectedForm) return result;
    const hasTimeData = (value: string | undefined | null) =>
      Boolean(value && value.trim() && value.trim() !== "--");
    const populatedRows = selectedForm.rows.filter((row) => {
      if (row.nombre && row.nombre.trim()) return true;
      if (row.firma && row.firma.trim()) return true;
      return DAY_ORDER.some((d) => {
        const dd = row.days[d];
        if (!dd) return false;
        return (
          dd.conDescanso ||
          hasTimeData(dd.he1) ||
          hasTimeData(dd.hs1) ||
          hasTimeData(dd.he2) ||
          hasTimeData(dd.hs2)
        );
      });
    });
    if (populatedRows.length === 0) return result;
    for (const day of DAY_ORDER) {
      result[day] = populatedRows.every(
        (row) => row.days[day]?.conDescanso === true,
      );
    }
    return result;
  }, [selectedForm]);

  // Numero efectivo de columnas que ocupa cada dia en impresion (1, 2 o 4).
  const dayColSpan = (day: DayKey) =>
    dayAllDescanso[day] ? 1 : dayHasBreaks[day] ? 4 : 2;

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <p className="text-sm text-slate-600">Cargando horarios guardados...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-100 text-foreground print:overflow-visible print:bg-white print:p-0">
      <AppTopBar backHref="/ingresar-horarios" backLabel="Volver a ingresar" />
      <div className="mx-auto w-full max-w-[min(100%,96rem)] px-4 py-10 print:max-w-none print:p-0">
        <div className="relative mb-5 overflow-hidden rounded-3xl border border-rose-200/70 bg-linear-to-br from-rose-100 via-rose-50/40 to-white p-7 shadow-[0_18px_35px_-30px_rgba(244,63,94,0.32)] before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-rose-500 print:hidden">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_130%_100%_at_10%_-20%,rgba(244,63,94,0.32),transparent_60%)]"
          />
          <div className="relative flex flex-wrap items-start gap-x-6 gap-y-5">
            <div className="min-w-0 flex-1 basis-md">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-rose-600">
                Operacion
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
                Horarios guardados
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                Consulta las plantillas registradas o revisa el historial
                diario por empleado.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200/80 bg-rose-50/80 px-3 py-1 text-xs font-semibold text-rose-700">
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  Modulo: Horarios
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200/80 bg-sky-50/80 px-3 py-1 text-xs font-semibold text-sky-700">
                  {viewMode === "plantillas" ? (
                    <Files className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <Users className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Vista: {viewMode === "plantillas" ? "Plantillas" : "Por persona"}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                  {viewMode === "plantillas"
                    ? `${forms.length} ${forms.length === 1 ? "plantilla" : "plantillas"}`
                    : `${people.length} ${people.length === 1 ? "persona" : "personas"}`}
                </span>
              </div>
            </div>

            <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => router.push("/ingresar-horarios")}
                title="Regresar al editor de planillas"
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                Volver a ingresar
              </button>
              <button
                type="button"
                onClick={() => router.push("/ingresar-horarios")}
                title="Ir al editor para crear o modificar una planilla"
                className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-5 py-2 text-xs font-semibold text-white shadow-[0_8px_20px_-12px_rgba(244,63,94,0.6)] transition-all hover:bg-rose-700"
              >
                <PenLine className="h-3.5 w-3.5" aria-hidden />
                Registrar planilla
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_28px_70px_-45px_rgba(15,23,42,0.4)] print:rounded-none print:border-0 print:p-0 print:shadow-none">

        <div
          role="tablist"
          aria-label="Vista de horarios guardados"
          className="mt-6 inline-flex w-fit rounded-full border border-slate-200 bg-slate-50/80 p-1 print:hidden"
        >
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "plantillas"}
            onClick={() => setViewMode("plantillas")}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-all ${
              viewMode === "plantillas"
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Files className="h-3.5 w-3.5" aria-hidden />
            Plantillas
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "personas"}
            onClick={() => setViewMode("personas")}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-all ${
              viewMode === "personas"
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Users className="h-3.5 w-3.5" aria-hidden />
            Por persona
          </button>
        </div>

        {(actionError || actionMessage) && (
          <div className="mt-4 print:hidden">
            {actionError ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
                {actionError}
              </div>
            ) : null}
            {actionMessage ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                {actionMessage}
              </div>
            ) : null}
          </div>
        )}

        {viewMode === "plantillas" ? (
          <div className="mt-6 grid min-w-0 gap-4 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)] print:mt-0 print:block">
            <section className="min-w-0 rounded-3xl border border-slate-200/70 bg-slate-50/80 p-4 print:hidden">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
                    Plantillas
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Selecciona una para ver su contenido.
                  </p>
                </div>
                {forms.length > 0 ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">
                    <Files className="h-3 w-3" aria-hidden />
                    {forms.length}
                  </span>
                ) : null}
              </div>
              {formsError ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
                  {formsError}
                </div>
              ) : null}
              {forms.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center">
                  <Files className="mx-auto h-6 w-6 text-slate-400" aria-hidden />
                  <p className="mt-2 text-sm font-semibold text-slate-700">
                    Aun no hay plantillas
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Crea una nueva desde &quot;Registrar planilla&quot;.
                  </p>
                </div>
              ) : (
                <ul className="mt-4 space-y-2" role="list">
                  {forms.map((form) => {
                    const isActive = selectedFormId === form.id;
                    const isLoading = loadingFormId === form.id;
                    return (
                      <li key={form.id}>
                        <button
                          type="button"
                          onClick={() => void handleViewForm(form.id)}
                          aria-pressed={isActive}
                          className={`group relative w-full overflow-hidden rounded-2xl border px-4 py-3 text-left transition-all ${
                            isActive
                              ? "border-sky-300 bg-sky-50 shadow-[0_8px_24px_-18px_rgba(14,165,233,0.55)]"
                              : "border-slate-200/70 bg-white hover:border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          {/* Acento lateral cuando esta activa */}
                          {isActive ? (
                            <span
                              className="absolute inset-y-0 left-0 w-1 bg-sky-500"
                              aria-hidden
                            />
                          ) : null}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="inline-flex items-center rounded-md bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
                                  #{form.id}
                                </span>
                                {form.mes ? (
                                  <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                    {form.mes}
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-1.5 truncate text-sm font-semibold text-slate-900">
                                {form.sede}
                              </p>
                              <p className="truncate text-xs text-slate-500">
                                {form.seccion}
                              </p>
                            </div>
                            {isActive ? (
                              <span
                                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white"
                                aria-label="Plantilla seleccionada"
                              >
                                {isLoading ? (
                                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                                ) : (
                                  <Check className="h-3 w-3" aria-hidden />
                                )}
                              </span>
                            ) : isLoading ? (
                              <Loader2
                                className="h-4 w-4 shrink-0 animate-spin text-slate-400"
                                aria-hidden
                              />
                            ) : null}
                          </div>
                          <div className="mt-2 flex flex-col gap-1 text-[11px] text-slate-500">
                            <span className="inline-flex items-center gap-1.5">
                              <CalendarDays
                                className="h-3 w-3 text-slate-400"
                                aria-hidden
                              />
                              <span className="tabular-nums">
                                {formatDateLabel(form.fechaInicial)}
                              </span>
                              <span className="text-slate-400">&rarr;</span>
                              <span className="tabular-nums">
                                {formatDateLabel(form.fechaFinal)}
                              </span>
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Users
                                className="h-3 w-3 text-slate-400"
                                aria-hidden
                              />
                              <span className="font-semibold tabular-nums text-slate-700">
                                {form.employeeCount}
                              </span>
                              <span>
                                {form.employeeCount === 1
                                  ? "empleado"
                                  : "empleados"}
                              </span>
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="min-w-0 rounded-3xl border border-slate-200/70 bg-white p-4 shadow-[0_18px_40px_-35px_rgba(15,23,42,0.4)] print:rounded-none print:border-0 print:p-0 print:shadow-none">
              {selectedForm === null ? (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                  {loadingFormId !== null
                    ? "Cargando plantilla..."
                    : "Selecciona una plantilla guardada para verla."}
                </div>
              ) : (
                <div id="horarios-guardados-print">
                  {/* Encabezado solo de impresion: aparece arriba centrado en
                      cada hoja gracias a position:fixed dentro del area de
                      impresion. Sustituye al titulo/fecha/URL que el navegador
                      colocaba por defecto en los margenes. */}
                  <div className="planilla-print-portal-header" aria-hidden="true">
                    <svg
                      className="planilla-print-portal-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
                      <path d="M20 3v4" />
                      <path d="M22 5h-4" />
                      <path d="M4 17v2" />
                      <path d="M5 18H3" />
                    </svg>
                    <span className="planilla-print-portal-name">Portal UAID</span>
                  </div>
                  <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
                        Plantilla #{selectedForm.id}
                      </p>
                      <h2 className="mt-1 text-lg font-bold text-slate-900">
                        {selectedForm.sede} · {selectedForm.seccion}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {formatDateLabel(selectedForm.fechaInicial)} a{" "}
                        {formatDateLabel(selectedForm.fechaFinal)} · {selectedForm.mes || "Sin mes"}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2 text-right text-xs text-slate-500">
                      <div>
                        <p>Guardada por {selectedForm.createdByUsername || "--"}</p>
                        <p>{formatDateTimeLabel(selectedForm.createdAt)}</p>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {/* Accion primaria */}
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              `/ingresar-horarios?planilla=${selectedForm.id}`,
                            )
                          }
                          title="Abrir esta planilla en el editor para modificarla"
                          className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white shadow-[0_8px_20px_-12px_rgba(15,23,42,0.6)] transition-all hover:bg-slate-800 active:translate-y-px"
                        >
                          <Pencil className="h-3 w-3" aria-hidden />
                          Editar
                        </button>

                        {/* Grupo de acciones secundarias (segmentado) */}
                        <div className="inline-flex overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm">
                          <button
                            type="button"
                            onClick={() =>
                              router.push(
                                `/ingresar-horarios?duplicar=${selectedForm.id}`,
                              )
                            }
                            title="Crear una planilla nueva con los mismos empleados y horarios (la original no se modifica)"
                            className="inline-flex items-center gap-1.5 border-r border-slate-200 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 transition-colors hover:bg-violet-50 hover:text-violet-700"
                          >
                            <Copy className="h-3 w-3" aria-hidden />
                            Duplicar
                          </button>
                          <button
                            type="button"
                            onClick={() => window.print()}
                            title="Imprimir o guardar como PDF"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800"
                          >
                            <Printer className="h-3 w-3" aria-hidden />
                            Imprimir
                          </button>
                        </div>

                        {/* Separador visual */}
                        <span
                          className="hidden h-5 w-px bg-slate-200 sm:inline-block"
                          aria-hidden
                        />

                        {/* Accion destructiva */}
                        <button
                          type="button"
                          onClick={() => void handleDeleteForm(selectedForm.id)}
                          disabled={deletingPlanillaId !== null}
                          title="Eliminar definitivamente esta planilla y todos sus registros"
                          className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-700 transition-all hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden />
                          {deletingPlanillaId === selectedForm.id
                            ? "Eliminando..."
                            : "Eliminar"}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 border border-slate-300 px-3 py-2 print:mt-0 print:border-slate-900">
                    <div className="grid grid-cols-[1fr_1fr_1fr] items-center border-b-2 border-slate-900 pb-2">
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
                    <div className="mt-2 grid grid-cols-2 gap-3 text-[11px] sm:grid-cols-5">
                      <div>
                        <span className="font-semibold">SEDE:</span>{" "}
                        {selectedForm.sede || "-"}
                      </div>
                      <div>
                        <span className="font-semibold">SECCION:</span>{" "}
                        {selectedForm.seccion || "-"}
                      </div>
                      <div>
                        <span className="font-semibold">FECHA INICIAL:</span>{" "}
                        {selectedForm.fechaInicial || "-"}
                      </div>
                      <div>
                        <span className="font-semibold">FECHA FINAL:</span>{" "}
                        {selectedForm.fechaFinal || "-"}
                      </div>
                      <div>
                        <span className="font-semibold">MES:</span>{" "}
                        {selectedForm.mes || "-"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 max-w-full min-w-0 overflow-x-auto overscroll-x-contain rounded-none border border-slate-300 [-webkit-overflow-scrolling:touch] print:mt-2 print:overflow-visible print:border-slate-900">
                    <table className="planilla-print-table w-full table-fixed border-collapse text-[9px] leading-tight print:min-w-0 print:w-full print:max-w-none print:table-fixed print:text-[8px]">
                      <thead>
                        <tr className="bg-slate-100 text-slate-700">
                          <th className="planilla-col-index border border-slate-300 px-1 py-1 text-center print:border-slate-900">#</th>
                          <th className="planilla-col-nombre border border-slate-300 px-1 py-1 text-left print:border-slate-900">
                            Nombre
                          </th>
                          {DAY_ORDER.map((day) => (
                            <th
                              key={day}
                              colSpan={dayColSpan(day)}
                              className={`border border-slate-300 px-1 py-1 text-center uppercase print:border-slate-900 ${dayStartDividerClass(day)}`}
                            >
                              <div
                                className={`flex items-center justify-center gap-0.5 ${dayAllDescanso[day] ? "flex-col gap-0" : ""}`}
                              >
                                <span className="planilla-day-name whitespace-nowrap">
                                  {day}
                                </span>
                                <span className="planilla-day-number rounded-md bg-white px-1 py-0 text-[8px] font-semibold text-slate-600 print:px-1 print:text-[8px]">
                                  {selectedFormDayNumbers[day] ?? "--"}
                                </span>
                              </div>
                            </th>
                          ))}
                          <th className="planilla-col-firma border border-slate-300 px-1 py-1 text-left print:border-slate-900">
                            Firma empleado
                          </th>
                        </tr>
                        <tr className="bg-white text-[8px] font-semibold text-slate-500">
                          <th className="border border-slate-300 px-1 py-1 print:border-slate-900" />
                          <th className="border border-slate-300 px-1 py-1 print:border-slate-900" />
                          {DAY_ORDER.flatMap((day) => {
                            if (dayAllDescanso[day]) {
                              return [
                                <th
                                  key={`${day}-empty`}
                                  className={`border border-slate-300 px-1 py-1 text-center uppercase print:border-slate-900 ${dayStartDividerClass(day)}`}
                                />,
                              ];
                            }
                            const fields = (
                              dayHasBreaks[day]
                                ? (["he1", "hs1", "he2", "hs2"] as const)
                                : (["he1", "hs2"] as const)
                            );
                            return fields.map((field) => (
                              <th
                                key={`${day}-${field}`}
                                className={`border border-slate-300 px-1 py-1 text-center uppercase print:border-slate-900 ${field === "he1" ? dayStartDividerClass(day) : ""}`}
                              >
                                {field === "he1" || field === "he2" ? "HE" : "HS"}
                              </th>
                            ));
                          })}
                          <th className="border border-slate-300 px-1 py-1 print:border-slate-900" />
                        </tr>
                      </thead>
                      <tbody>
                        {selectedForm.rows.map((row, rowIndex) => (
                          <tr key={`preview-row-${row.rowIndex ?? rowIndex}`} className="odd:bg-white even:bg-slate-50/40">
                            <td className="border border-slate-300 px-1 py-0.5 text-center text-slate-600 print:border-slate-900">
                              {(typeof row.rowIndex === "number" ? row.rowIndex : rowIndex) + 1}
                            </td>
                            <td className="planilla-cell-nombre border border-slate-300 px-1 py-0.5 text-slate-900 print:border-slate-900">
                              {row.nombre || "--"}
                            </td>
                            {DAY_ORDER.flatMap((day) => {
                              const dayData = row.days[day];
                              const cols = dayColSpan(day);
                              if (dayData.conDescanso) {
                                return [
                                  <td
                                    key={`${rowIndex}-${day}-descanso`}
                                    colSpan={cols}
                                    className={`border border-slate-300 px-0.5 py-0.5 text-center text-[8px] font-semibold uppercase tracking-normal text-slate-700 print:border-slate-900 print:bg-white print:px-0.5 print:text-[7px] ${dayStartDividerClass(day)}`}
                                  >
                                    Descanso
                                  </td>,
                                ];
                              }

                              const fields = (
                                dayHasBreaks[day]
                                  ? (["he1", "hs1", "he2", "hs2"] as const)
                                  : (["he1", "hs2"] as const)
                              );
                              return fields.map((field) => (
                                <td
                                  key={`${rowIndex}-${day}-${field}`}
                                  className={`border border-slate-300 px-0.5 py-0.5 text-center text-slate-700 print:border-slate-900 ${field === "he1" ? dayStartDividerClass(day) : ""}`}
                                >
                                  {renderTimeValue(dayData[field])}
                                </td>
                              ));
                            })}
                            <td className="border border-slate-300 px-1 py-0.5 text-slate-700 print:border-slate-900">
                              {row.firma || "--"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Bloque de firmas (solo impresion): JEFE DE AREA y V.B. ADMINISTRADOR. */}
                  <div className="planilla-print-signatures hidden break-inside-avoid print:mt-5 print:block">
                    <div className="flex justify-start gap-8 pl-2">
                      <div className="flex w-44 flex-col items-center">
                        <div className="h-8 w-full border-b border-slate-900" />
                        <div className="mt-0.5 text-center text-[8px] font-bold uppercase tracking-wide text-slate-900">
                          Jefe de Área
                        </div>
                      </div>
                      <div className="flex w-44 flex-col items-center">
                        <div className="h-8 w-full border-b border-slate-900" />
                        <div className="mt-0.5 text-center text-[8px] font-bold uppercase tracking-wide text-slate-900">
                          V.B. Administrador
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="mt-6 grid min-w-0 gap-4 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <section className="min-w-0 rounded-3xl border border-slate-200/70 bg-slate-50/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
                Empleados
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Filtra el nombre y revisa los horarios registrados por fecha.
              </p>
              <input
                type="text"
                value={employeeSearch}
                onChange={(e) => {
                  setEmployeeSearch(e.target.value);
                  setEmployeePage(1);
                }}
                placeholder="Buscar empleado"
                className="mt-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-100"
              />
              {peopleError ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
                  {peopleError}
                </div>
              ) : null}
              {filteredPeople.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">No hay empleados para mostrar.</p>
              ) : (
                <>
                  <div className="mt-4 space-y-2">
                    {paginatedPeople.map((person) => {
                      const isActive = selectedEmployeeName === person.name;
                      return (
                        <button
                          key={person.name}
                          type="button"
                          onClick={() => void handleViewEmployee(person.name)}
                          className={`w-full rounded-2xl border px-4 py-3 text-left transition-all ${
                            isActive
                              ? "border-sky-300 bg-sky-50"
                              : "border-slate-200/70 bg-white hover:border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          <p className="text-sm font-semibold text-slate-900">{person.name}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {person.recordCount} dia(s) · {person.formCount} planilla(s)
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {formatDateLabel(person.firstWorkedDate)} a{" "}
                            {formatDateLabel(person.lastWorkedDate)}
                          </p>
                        </button>
                      );
                    })}
                  </div>

                  {employeeTotalPages > 1 ? (
                    <div className="mt-4 flex items-center justify-between gap-2 rounded-2xl border border-slate-200/70 bg-white px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setEmployeePage((p) => Math.max(1, p - 1))}
                        disabled={employeePage === 1}
                        title="Pagina anterior"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
                      >
                        <ChevronLeft className="h-4 w-4" aria-hidden />
                        <span className="sr-only">Anterior</span>
                      </button>
                      <div className="flex flex-col items-center text-[11px] leading-tight text-slate-600">
                        <span className="font-semibold tabular-nums text-slate-900">
                          Pagina {employeePage} de {employeeTotalPages}
                        </span>
                        <span className="text-slate-500 tabular-nums">
                          {employeeRangeStart}-{employeeRangeEnd} de {filteredPeople.length}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setEmployeePage((p) => Math.min(employeeTotalPages, p + 1))
                        }
                        disabled={employeePage === employeeTotalPages}
                        title="Pagina siguiente"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
                      >
                        <ChevronRight className="h-4 w-4" aria-hidden />
                        <span className="sr-only">Siguiente</span>
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </section>

            <section className="min-w-0 rounded-3xl border border-slate-200/70 bg-white p-4 shadow-[0_18px_40px_-35px_rgba(15,23,42,0.4)]">
              {selectedEmployeeName === null ? (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                  Selecciona un empleado para ver su historial.
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
                        Historial por persona
                      </p>
                      <h2 className="mt-1 text-lg font-bold text-slate-900">
                        {selectedEmployeeName}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {employeeFiltersActive
                          ? `${filteredEmployeeRecords.length} de ${selectedEmployeeRecords.length} registro(s) (filtro activo).`
                          : `${selectedEmployeeRecords.length} registro(s) diario(s) guardados.`}
                      </p>
                    </div>
                    {loadingEmployeeName === selectedEmployeeName ? (
                      <span className="text-sm text-slate-500">Cargando detalle...</span>
                    ) : null}
                  </div>

                  {selectedEmployeeRecords.length > 0 ? (
                    <div className="mt-4 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-3">
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="flex items-center gap-1.5 self-center text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
                          <Filter className="h-3.5 w-3.5" aria-hidden />
                          Filtros
                        </div>

                        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                          Desde
                          <input
                            type="date"
                            value={filterDateFrom}
                            min={employeeDateBounds.min || undefined}
                            max={employeeDateBounds.max || undefined}
                            onChange={(e) => setFilterDateFrom(e.target.value)}
                            className="w-[150px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium normal-case tracking-normal text-slate-900 focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-100"
                          />
                        </label>

                        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                          Hasta
                          <input
                            type="date"
                            value={filterDateTo}
                            min={filterDateFrom || employeeDateBounds.min || undefined}
                            max={employeeDateBounds.max || undefined}
                            onChange={(e) => setFilterDateTo(e.target.value)}
                            className="w-[150px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium normal-case tracking-normal text-slate-900 focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-100"
                          />
                        </label>

                        <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                          Dia
                          <select
                            value={filterDayKey}
                            onChange={(e) =>
                              setFilterDayKey(e.target.value as "" | DayKey)
                            }
                            className="w-[140px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium tracking-normal capitalize text-slate-900 focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-100"
                          >
                            <option value="">Todos</option>
                            {DAY_ORDER.map((day) => (
                              <option key={day} value={day} className="capitalize">
                                {day}
                              </option>
                            ))}
                          </select>
                        </label>

                        {availableSedesForEmployee.length > 1 ? (
                          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                            Sede
                            <select
                              value={filterSede}
                              onChange={(e) => setFilterSede(e.target.value)}
                              className="w-[180px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium normal-case tracking-normal text-slate-900 focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-100"
                            >
                              <option value="">Todas</option>
                              {availableSedesForEmployee.map((sede) => (
                                <option key={sede} value={sede}>
                                  {sede}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}

                        {employeeFiltersActive ? (
                          <button
                            type="button"
                            onClick={clearEmployeeFilters}
                            title="Quitar todos los filtros aplicados"
                            className="inline-flex items-center gap-1.5 self-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-100 hover:text-slate-800"
                          >
                            <RotateCcw className="h-3 w-3" aria-hidden />
                            Limpiar
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {selectedEmployeeRecords.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                      No hay registros diarios para este empleado.
                    </div>
                  ) : filteredEmployeeRecords.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                      Ningun registro coincide con los filtros aplicados.
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={clearEmployeeFilters}
                          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-100 hover:text-slate-800"
                        >
                          <RotateCcw className="h-3 w-3" aria-hidden />
                          Limpiar filtros
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 max-w-full min-w-0 overflow-x-auto overscroll-x-contain rounded-2xl border border-slate-200/80 [-webkit-overflow-scrolling:touch]">
                      <table className="w-full min-w-[980px] border-collapse text-[12px]">
                        <thead className="bg-slate-100 text-slate-700">
                          <tr>
                            <th className="border border-slate-200 px-2 py-2 text-left">Fecha</th>
                            <th className="border border-slate-200 px-2 py-2 text-left">Dia</th>
                            <th className="border border-slate-200 px-2 py-2 text-left">Sede</th>
                            <th className="border border-slate-200 px-2 py-2 text-left">Seccion</th>
                            <th className="border border-slate-200 px-2 py-2 text-center">HE</th>
                            <th className="border border-slate-200 px-2 py-2 text-center">HS</th>
                            <th className="border border-slate-200 px-2 py-2 text-center">HE</th>
                            <th className="border border-slate-200 px-2 py-2 text-center">HS</th>
                            <th className="border border-slate-200 px-2 py-2 text-center">Desc.</th>
                            <th className="border border-slate-200 px-2 py-2 text-center">Planilla</th>
                            <th className="border border-slate-200 px-2 py-2 text-center">Accion</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredEmployeeRecords.map((record, index) => (
                            <tr key={`${record.planillaId}-${record.workedDate}-${index}`} className="odd:bg-white even:bg-slate-50/40">
                              <td className="border border-slate-200 px-2 py-1 text-slate-700">
                                {formatDateLabel(record.workedDate)}
                              </td>
                              <td className="border border-slate-200 px-2 py-1 text-slate-700 capitalize">
                                {record.dayKey || "--"}
                              </td>
                              <td className="border border-slate-200 px-2 py-1 text-slate-700">
                                {record.sede || "--"}
                              </td>
                              <td className="border border-slate-200 px-2 py-1 text-slate-700">
                                {record.seccion || "--"}
                              </td>
                              <td className="border border-slate-200 px-2 py-1 text-center text-slate-700">
                                {renderTimeValue(record.he1)}
                              </td>
                              <td className="border border-slate-200 px-2 py-1 text-center text-slate-700">
                                {renderTimeValue(record.hs1)}
                              </td>
                              <td className="border border-slate-200 px-2 py-1 text-center text-slate-700">
                                {renderTimeValue(record.he2)}
                              </td>
                              <td className="border border-slate-200 px-2 py-1 text-center text-slate-700">
                                {renderTimeValue(record.hs2)}
                              </td>
                              <td className="border border-slate-200 px-2 py-1 text-center text-slate-700">
                                {record.conDescanso ? "Si" : "--"}
                              </td>
                              <td className="border border-slate-200 px-2 py-1 text-center text-slate-700">
                                #{record.planillaId}
                              </td>
                              <td className="border border-slate-200 px-2 py-1 text-center">
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteForm(record.planillaId)}
                                  disabled={deletingPlanillaId !== null}
                                  className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-700 transition-all hover:border-rose-300 hover:bg-rose-100/70 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {deletingPlanillaId === record.planillaId
                                    ? "Eliminando..."
                                    : "Eliminar"}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        )}
        </div>
      </div>
      <style jsx global>{`
        #horarios-guardados-print table th.day-group-start,
        #horarios-guardados-print table td.day-group-start {
          border-left-width: 2px;
          border-left-color: rgb(30 41 59);
        }
        /* El encabezado de impresion solo se muestra al imprimir. */
        .planilla-print-portal-header {
          display: none;
        }
        /* Anchos en pantalla para la preview (table-layout: fixed). Replican
           las mismas proporciones que se usan al imprimir para que lo que
           ves en pantalla sea identico al PDF. */
        .planilla-print-table .planilla-col-index {
          width: 2.25rem;
        }
        .planilla-print-table .planilla-col-nombre {
          width: 9rem;
        }
        .planilla-print-table .planilla-col-firma {
          width: 9.5rem;
        }
        .planilla-print-table .planilla-cell-nombre {
          white-space: normal;
          word-break: break-word;
          overflow-wrap: anywhere;
        }
        @media print {
          /* Eliminamos los encabezados/pies por defecto del navegador
             (titulo, fecha/hora, URL/IP) anulando los margenes superior y
             laterales. Reservamos un margen inferior compacto y declaramos
             explicitamente las cajas @bottom-* para colocar nuestro contador
             "Pagina X de Y" en la esquina inferior derecha y bloquear que el
             navegador inserte algo en bottom-left/bottom-center.
             Mantenemos los margenes muy pequeños para no robarle altura
             vertical a la tabla y evitar que la ultima fila quede cortada. */
          @page {
            size: A4 landscape;
            /* Top margin reservado para el encabezado "Portal UAID" que va
               dentro de @top-center; asi se repite automaticamente en cada
               hoja sin pisar contenido (como pasaba con position: fixed). */
            margin: 9mm 0 4mm 0;
            /* Anulamos explicitamente los encabezados por defecto del
               navegador (fecha/hora a la izquierda, titulo arriba, URL a
               la derecha). Sin estas reglas algunos navegadores los pintan
               aunque el margen sea pequeño. */
            @top-left {
              content: "";
            }
            @top-center {
              content: "✨ Portal UAID";
              font-family: "Helvetica Neue", Arial, sans-serif;
              font-size: 12pt;
              font-weight: 800;
              letter-spacing: 0.5px;
              color: #0f172a;
              vertical-align: bottom;
              padding-bottom: 1.5mm;
            }
            @top-right {
              content: "";
            }
            @bottom-left {
              content: "";
            }
            @bottom-center {
              content: "";
            }
            @bottom-right {
              content: "Pagina " counter(page) " de " counter(pages);
              font-family: "Helvetica Neue", Arial, sans-serif;
              font-size: 7pt;
              color: #64748b;
              padding: 0 4mm 1mm 0;
              vertical-align: bottom;
            }
          }
          html,
          body {
            overflow: visible !important;
            height: auto !important;
            width: 100% !important;
            background: white !important;
          }
          body * {
            visibility: hidden;
          }
          #horarios-guardados-print,
          #horarios-guardados-print * {
            visibility: visible;
          }
          #horarios-guardados-print {
            position: static !important;
            inset: auto !important;
            width: 100% !important;
            max-width: 100% !important;
            height: auto !important;
            overflow: visible !important;
            /* El espacio para el encabezado "Portal UAID" ahora lo aporta
               el margin-top del @page (9mm), asi se repite limpio en cada
               hoja y no pisa filas en las paginas 2 y siguientes. */
            padding: 0 5mm 0 5mm !important;
            margin: 0 !important;
            background: white !important;
            box-shadow: none !important;
            border: 0 !important;
            box-sizing: border-box !important;
          }
          /* El header en pantalla se manten\u00eda con position:fixed para repetirse
             en cada hoja, pero generaba overlap en las paginas siguientes a la
             primera. Ahora el encabezado vive en @page @top-center (margin box)
             y este div solo existe como fallback visual; lo ocultamos en print. */
          .planilla-print-portal-header {
            display: none !important;
          }
          #horarios-guardados-print .overflow-x-auto {
            overflow: visible !important;
            max-width: 100% !important;
          }
          .planilla-print-table {
            table-layout: fixed !important;
            width: 100% !important;
            max-width: 100% !important;
            min-width: 0 !important;
            font-size: 9px !important;
            color: #0f172a !important;
          }
          .planilla-print-table tbody td {
            font-size: 9px !important;
            line-height: 1.15 !important;
          }
          .planilla-print-table thead th {
            font-size: 9px !important;
          }
          /* Nombre del dia en el header (DOMINGO, LUNES, ...) y numero del
             dia (17, 18, ...) a mayor tamaño para que se lean comodos. La
             columna estrecha de Descanso usa flex-col arriba para apilarlos
             en 2 lineas y aun asi caber. */
          .planilla-print-table thead th .planilla-day-name {
            font-size: 11px !important;
            font-weight: 700 !important;
            white-space: nowrap !important;
            letter-spacing: 0 !important;
          }
          .planilla-print-table thead th .planilla-day-number {
            font-size: 11px !important;
            font-weight: 700 !important;
            white-space: nowrap !important;
          }
          .planilla-print-table th,
          .planilla-print-table td {
            color: #0f172a !important;
            border-color: #0f172a !important;
            background: #ffffff !important;
            min-width: 0 !important;
            max-width: none !important;
            width: auto !important;
            padding: 1px 2px !important;
            overflow: hidden !important;
            word-break: break-word !important;
          }
          /* Anchos fijos en pantalla (rem) del primer th (# / Nombre / Firma)
             deben colapsar a px concretos para que en A4 horizontal queden
             chicos y el resto de columnas (HE/HS) reciban el ancho restante
             distribuido equitativamente por table-layout: fixed.
             La columna de Firma se deja mas ancha para que el empleado tenga
             suficiente espacio para firmar al imprimir la planilla. */
          .planilla-print-table thead tr:first-child th:first-child {
            width: 22px !important;
          }
          .planilla-print-table thead tr:first-child th:nth-child(2) {
            width: 120px !important;
          }
          .planilla-print-table thead tr:first-child th:last-child {
            width: 130px !important;
          }
          /* La columna Nombre lleva tipografia mas grande que el resto del
             body para que los nombres largos se lean comodos sin afectar
             las columnas de horas ni la firma. */
          .planilla-print-table tbody td.planilla-cell-nombre,
          .planilla-print-table thead tr:first-child th:nth-child(2) {
            font-size: 11px !important;
            font-weight: 600 !important;
            line-height: 1.1 !important;
            text-align: left !important;
          }
          /* Separador vertical entre dias (mas grueso y oscuro que HE/HS internos) */
          #horarios-guardados-print table th.day-group-start,
          #horarios-guardados-print table td.day-group-start {
            border-left-width: 3px !important;
            border-left-color: #020617 !important;
          }
        }
      `}</style>
    </div>
  );
}
