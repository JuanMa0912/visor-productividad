"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { canAccessPortalSection } from "@/lib/portal-sections";

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
  const [selectedEmployeeName, setSelectedEmployeeName] = useState<string | null>(null);
  const [loadingEmployeeName, setLoadingEmployeeName] = useState<string | null>(null);
  const [deletingPlanillaId, setDeletingPlanillaId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [employeeRecordsByName, setEmployeeRecordsByName] = useState<
    Record<string, EmployeeRecord[]>
  >({});

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
      setSelectedEmployeeName(employeeName);
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
    let isMounted = true;
    const controller = new AbortController();

    const loadPage = async () => {
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
  }, [loadForms, loadPeople, router]);

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

  const selectedFormDayNumbers = useMemo(
    () =>
      selectedForm
        ? buildDayNumbersByKey(selectedForm.fechaInicial, selectedForm.fechaFinal)
        : {},
    [selectedForm],
  );

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
    <div className="min-h-screen bg-slate-100 px-4 py-12 text-foreground">
      <div className="mx-auto w-full max-w-384 rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_28px_70px_-45px_rgba(15,23,42,0.4)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
              Horario
            </p>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">
              Horarios guardados
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Consulta las plantillas registradas o revisa el historial diario por empleado.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push("/ingresar-horarios")}
              className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-700 transition-all hover:border-sky-300 hover:bg-sky-100/70"
            >
              Volver a registro
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

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setViewMode("plantillas")}
            className={`inline-flex items-center rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition-all ${
              viewMode === "plantillas"
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200/70 bg-slate-100 text-slate-700 hover:border-slate-300 hover:bg-slate-200/70"
            }`}
          >
            Plantillas guardadas
          </button>
          <button
            type="button"
            onClick={() => setViewMode("personas")}
            className={`inline-flex items-center rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition-all ${
              viewMode === "personas"
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200/70 bg-slate-100 text-slate-700 hover:border-slate-300 hover:bg-slate-200/70"
            }`}
          >
            Listado por persona
          </button>
        </div>

        {(actionError || actionMessage) && (
          <div className="mt-4">
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
          <div className="mt-6 grid gap-4 xl:grid-cols-[360px_1fr]">
            <section className="rounded-3xl border border-slate-200/70 bg-slate-50/80 p-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
                  Plantillas
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Selecciona una planilla para ver su contenido completo.
                </p>
              </div>
              {formsError ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
                  {formsError}
                </div>
              ) : null}
              {forms.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">Aun no hay plantillas guardadas.</p>
              ) : (
                <div className="mt-4 space-y-2">
                  {forms.map((form) => {
                    const isActive = selectedFormId === form.id;
                    return (
                      <button
                        key={form.id}
                        type="button"
                        onClick={() => void handleViewForm(form.id)}
                        className={`w-full rounded-2xl border px-4 py-3 text-left transition-all ${
                          isActive
                            ? "border-sky-300 bg-sky-50"
                            : "border-slate-200/70 bg-white hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <p className="text-sm font-semibold text-slate-900">
                          #{form.id} · {form.sede} · {form.seccion}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatDateLabel(form.fechaInicial)} a {formatDateLabel(form.fechaFinal)} ·{" "}
                          {form.mes || "Sin mes"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {form.employeeCount} empleado(s) · {form.detailCount} registro(s)
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-slate-200/70 bg-white p-4 shadow-[0_18px_40px_-35px_rgba(15,23,42,0.4)]">
              {selectedForm === null ? (
                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                  {loadingFormId !== null
                    ? "Cargando plantilla..."
                    : "Selecciona una plantilla guardada para verla."}
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
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
                    <div className="text-right text-xs text-slate-500">
                      <p>Guardada por {selectedForm.createdByUsername || "--"}</p>
                      <p>{formatDateTimeLabel(selectedForm.createdAt)}</p>
                      <button
                        type="button"
                        onClick={() => void handleDeleteForm(selectedForm.id)}
                        disabled={deletingPlanillaId !== null}
                        className="mt-3 inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-700 transition-all hover:border-rose-300 hover:bg-rose-100/70 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingPlanillaId === selectedForm.id
                          ? "Eliminando..."
                          : "Eliminar planilla"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200/80">
                    <table className="min-w-425 w-full border-collapse text-[12px]">
                      <thead>
                        <tr className="bg-slate-100 text-slate-700">
                          <th className="w-10 border border-slate-200 px-2 py-2 text-center">#</th>
                          <th className="w-80 border border-slate-200 px-2 py-2 text-left">
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
                                  {selectedFormDayNumbers[day] ?? "--"}
                                </span>
                              </div>
                            </th>
                          ))}
                          <th className="w-72 border border-slate-200 px-2 py-2 text-left">
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
                                className="w-16 border border-slate-200 px-2 py-2 text-center uppercase"
                              >
                                {field === "he1" || field === "he2" ? "HE" : "HS"}
                              </th>
                            )),
                          )}
                          <th className="border border-slate-200 px-2 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {selectedForm.rows.map((row, rowIndex) => (
                          <tr key={`preview-row-${rowIndex}`} className="odd:bg-white even:bg-slate-50/40">
                            <td className="border border-slate-200 px-2 py-1 text-center text-slate-600">
                              {rowIndex + 1}
                            </td>
                            <td className="border border-slate-200 px-2 py-1 text-slate-900">
                              {row.nombre || "--"}
                            </td>
                            {DAY_ORDER.flatMap((day) => {
                              const dayData = row.days[day];
                              if (dayData.conDescanso) {
                                return [
                                  <td
                                    key={`${rowIndex}-${day}-descanso`}
                                    colSpan={4}
                                    className="border border-slate-200 bg-amber-50/60 px-2 py-1 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-700"
                                  >
                                    Descanso
                                  </td>,
                                ];
                              }

                              return (["he1", "hs1", "he2", "hs2"] as const).map((field) => (
                                <td
                                  key={`${rowIndex}-${day}-${field}`}
                                  className="border border-slate-200 px-2 py-1 text-center text-slate-700"
                                >
                                  {renderTimeValue(dayData[field])}
                                </td>
                              ));
                            })}
                            <td className="border border-slate-200 px-2 py-1 text-slate-700">
                              {row.firma || "--"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 xl:grid-cols-[320px_1fr]">
            <section className="rounded-3xl border border-slate-200/70 bg-slate-50/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
                Empleados
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Filtra el nombre y revisa los horarios registrados por fecha.
              </p>
              <input
                type="text"
                value={employeeSearch}
                onChange={(e) => setEmployeeSearch(e.target.value)}
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
                <div className="mt-4 space-y-2">
                  {filteredPeople.map((person) => {
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
              )}
            </section>

            <section className="rounded-3xl border border-slate-200/70 bg-white p-4 shadow-[0_18px_40px_-35px_rgba(15,23,42,0.4)]">
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
                        {selectedEmployeeRecords.length} registro(s) diario(s) guardados.
                      </p>
                    </div>
                    {loadingEmployeeName === selectedEmployeeName ? (
                      <span className="text-sm text-slate-500">Cargando detalle...</span>
                    ) : null}
                  </div>

                  {selectedEmployeeRecords.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                      No hay registros diarios para este empleado.
                    </div>
                  ) : (
                    <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200/80">
                      <table className="min-w-[980px] w-full border-collapse text-[12px]">
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
                          {selectedEmployeeRecords.map((record, index) => (
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
  );
}
