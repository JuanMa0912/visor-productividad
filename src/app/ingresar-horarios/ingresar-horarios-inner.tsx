"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { normalizePersonNameKey } from "@/lib/normalize";
import { canAccessPortalSection } from "@/lib/portal-sections";
import {
  normalizeScheduleRowsForSave,
  normalizeScheduleTime,
} from "@/lib/schedule-time";
import { canUseLunesScheduleSync } from "@/lib/special-role-features";
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

/**
 * Pantalla: <colgroup> en rem para que HE/HS no se compriman al 100% del viewport.
 * La tabla es mas ancha que la ventana → scroll horizontal (overflow-x-auto).
 * En PDF, @media print anula estos anchos y reparte al 100% del folio.
 */
const COL_W_NUM = "2.75rem";
const COL_W_NAME = "17rem";
const COL_W_TIME = "7rem";
const COL_W_SIGN = "18rem";

const SCHEDULE_TIME_INPUT_BASE =
  "schedule-time-input box-border w-full min-w-0 max-w-none rounded border border-slate-200 py-1.5 text-[12px] tabular-nums leading-none tracking-tight focus:border-sky-300 focus:outline-none focus:ring-1 focus:ring-sky-100 print:hidden";

const SCHEDULE_OUTER_BORDER_CLASS = "border-2 border-slate-950";
const SCHEDULE_CELL_BORDER_CLASS = "border-2 border-slate-900";

/** Widths come from <colgroup>; cells only need border/padding */
/** En print NO usar ancho fijo (p. ej. w-6): las horas desbordan y se ven sobre el borde de la celda siguiente. */
const TIME_SLOT_TD_CLASS =
  `${SCHEDULE_CELL_BORDER_CLASS} px-1.5 py-1 align-middle whitespace-nowrap print:whitespace-normal print:px-0.5 print:text-center print:align-middle`;
const TIME_SLOT_TH_CLASS =
  `${SCHEDULE_CELL_BORDER_CLASS} px-1 py-2 text-center align-middle uppercase print:px-0.5`;

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

const LOCAL_DRAFT_VERSION = 1;

const cloneDaySchedule = (d: DaySchedule): DaySchedule => ({
  he1: d.he1,
  hs1: d.hs1,
  he2: d.he2,
  hs2: d.hs2,
  conDescanso: d.conDescanso,
});

const parseLunesIndependence = (raw: unknown): Map<number, Set<DayKey>> => {
  const m = new Map<number, Set<DayKey>>();
  if (!raw || typeof raw !== "object") return m;
  for (const [k, days] of Object.entries(raw as Record<string, unknown>)) {
    const idx = Number(k);
    if (!Number.isInteger(idx) || idx < 0 || idx > 15) continue;
    if (!Array.isArray(days)) continue;
    const set = new Set<DayKey>();
    for (const d of days) {
      if (typeof d === "string" && DAY_ORDER.includes(d as DayKey)) {
        set.add(d as DayKey);
      }
    }
    if (set.size) m.set(idx, set);
  }
  return m;
};

const serializeLunesIndependence = (
  map: Map<number, Set<DayKey>>,
): Record<string, DayKey[]> => {
  const o: Record<string, DayKey[]> = {};
  map.forEach((set, row) => {
    if (set.size) o[String(row)] = Array.from(set);
  });
  return o;
};

const normalizeText = (value?: string) =>
  (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalizeSedeText = (value?: string) =>
  normalizeText(value).replace(/\bdesprese\b/g, "desposte");

const matchesSede = (employeeSede: string | undefined, selectedSede: string) => {
  if (!selectedSede) return true;
  const employeeKey = normalizeSedeText(employeeSede ?? "");
  const selectedKey = normalizeSedeText(selectedSede);
  if (!employeeKey || !selectedKey) return false;
  return (
    employeeKey === selectedKey ||
    employeeKey.includes(selectedKey) ||
    selectedKey.includes(employeeKey)
  );
};

/**
 * Mientras se escribe: solo digitos y ":"; horas 00-23, minutos 00-59.
 * No sustituye por 23/59: si un dígito deja el valor inválido, no se aplica (se queda el anterior).
 */
const sanitizeTimeTyping = (raw: string) => {
  const s = raw.replace(/[^\d:]/g, "");
  if (!s.includes(":")) {
    let d = s.replace(/\D/g, "").slice(0, 4);
    if (d.length >= 2) {
      const hh = Number(d.slice(0, 2));
      if (hh > 23) d = d.slice(0, 1);
    }
    if (d.length >= 4) {
      const mm = Number(d.slice(2, 4));
      if (mm > 59) d = d.slice(0, 3);
    }
    return d;
  }
  const idx = s.indexOf(":");
  if (idx === 0) {
    let right = s.slice(idx + 1).replace(/:/g, "").slice(0, 2);
    if (right.length >= 1 && Number(right[0] ?? 9) > 5) right = "";
    if (right.length === 2 && Number(right) > 59) right = right.slice(0, 1);
    return right ? `:${right}`.slice(0, 5) : ":";
  }

  let left = s.slice(0, idx).replace(/:/g, "").slice(0, 2);
  let right = s.slice(idx + 1).replace(/:/g, "").slice(0, 2);

  if (left.length === 2 && Number(left) > 23) {
    left = left.slice(0, 1);
  }

  if (right.length >= 1) {
    const d0 = right[0];
    if (d0 !== undefined && Number(d0) > 5) right = "";
  }
  if (right.length === 2 && Number(right) > 59) {
    right = right.slice(0, 1);
  }

  return `${left}:${right}`.slice(0, 5);
};

const formatTimeForDisplay = (value?: string) => {
  const t = (value ?? "").trim();
  if (!t) return "";
  const normalized = normalizeScheduleTime(t);
  if (normalized) return normalized;
  if (/^\d{2}:\d{2}$/.test(t)) return t;
  return t.length <= 5 ? t : t.slice(0, 5);
};

type ScheduleDraft = {
  version: number;
  sede: string;
  seccion: string;
  fechaInicial: string;
  fechaFinal: string;
  mes: string;
  rows: RowSchedule[];
  updatedAt: string;
  /** Replicar horarios del lunes al resto de dias (por fila) */
  syncLunesToRest?: boolean;
  /** Por fila, dias que el usuario edito aparte y no deben pisarse desde lunes */
  lunesIndependentByRow?: Record<string, DayKey[]>;
};

type RowScheduleRowProps = {
  row: RowSchedule;
  rowIndex: number;
  employeeListId: string;
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
    options?: { isBlur?: boolean },
  ) => void;
  onDescanso: (rowIndex: number, day: DayKey, checked: boolean) => void;
};

const RowScheduleRow = memo(
  ({
    row,
    rowIndex,
    employeeListId,
    onRowField,
    onRowDayField,
    onDescanso,
  }: RowScheduleRowProps) => (
    <tr className="odd:bg-white even:bg-slate-50/40">
      <td className={`${SCHEDULE_CELL_BORDER_CLASS} px-2 py-1 text-center text-slate-600`}>
        {rowIndex + 1}
      </td>
      <td className={`${SCHEDULE_CELL_BORDER_CLASS} px-2 py-1`}>
        <input
          type="text"
          list={employeeListId}
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
              className={`${SCHEDULE_CELL_BORDER_CLASS} bg-amber-50/60 px-1 py-1 text-center`}
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
          <td key={`${rowIndex}-${day}-${field}`} className={TIME_SLOT_TD_CLASS}>
            {field === "he1" ? (
              <div className="relative min-w-0 print:static">
                <input
                  type="checkbox"
                  checked={dayData.conDescanso}
                  onChange={(e) => onDescanso(rowIndex, day, e.target.checked)}
                  title="Marcar este dia como descanso para este empleado"
                  className="absolute left-0 top-1/2 z-[1] h-3.5 w-3.5 -translate-y-1/2 rounded border-slate-300 text-sky-600 focus:ring-sky-200 print:hidden"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="HH:mm"
                  title="24 h: horas 00 a 23, minutos 00 a 59. Ej: 08:30, 21:30 o 1430"
                  maxLength={5}
                  value={(dayData[field] as string | undefined) ?? ""}
                  onChange={(e) =>
                    onRowDayField(
                      rowIndex,
                      day,
                      field,
                      sanitizeTimeTyping(e.target.value),
                    )
                  }
                  onBlur={(e) =>
                    onRowDayField(
                      rowIndex,
                      day,
                      field,
                      normalizeScheduleTime(e.target.value),
                      { isBlur: true },
                    )
                  }
                  className={`${SCHEDULE_TIME_INPUT_BASE} pl-5 pr-1.5`}
                />
                <span className="hidden w-full pl-5 text-center text-[8px] leading-none text-slate-900 print:block print:w-full print:px-0.5 print:pl-0.5 tabular-nums">
                  {formatTimeForDisplay(dayData[field])}
                </span>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="HH:mm"
                  title="24 h: horas 00 a 23, minutos 00 a 59. Ej: 08:30, 21:30 o 1430"
                  maxLength={5}
                  value={(dayData[field] as string | undefined) ?? ""}
                  onChange={(e) =>
                    onRowDayField(
                      rowIndex,
                      day,
                      field,
                      sanitizeTimeTyping(e.target.value),
                    )
                  }
                  onBlur={(e) =>
                    onRowDayField(
                      rowIndex,
                      day,
                      field,
                      normalizeScheduleTime(e.target.value),
                      { isBlur: true },
                    )
                  }
                  className={`${SCHEDULE_TIME_INPUT_BASE} px-1.5`}
                />
                <span className="hidden w-full text-center text-[8px] leading-none text-slate-900 print:block print:tabular-nums">
                  {formatTimeForDisplay(dayData[field])}
                </span>
              </>
            )}
          </td>
        ));
      })}
      <td className={`h-16 ${SCHEDULE_CELL_BORDER_CLASS} px-2 py-1 align-top`}>
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

const getCookieValue = (name: string) => {
  if (typeof document === "undefined") return null;
  const value = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`));
  if (!value) return null;
  return decodeURIComponent(value.split("=").slice(1).join("="));
};

const getDraftStorageKey = (username: string) =>
  `vp:ingresar-horarios:draft:${username}`;

const createSafeDraftRows = (rows: unknown) => {
  if (!Array.isArray(rows)) {
    return Array.from({ length: 16 }, () => createEmptyRow());
  }

  return Array.from({ length: 16 }, (_, index) => {
    const sourceRow = rows[index] as
      | {
          nombre?: string;
          firma?: string;
          days?: Partial<Record<DayKey, Partial<DaySchedule>>>;
        }
      | undefined;

    if (!sourceRow) return createEmptyRow();

    const nextRow = createEmptyRow();
    nextRow.nombre = typeof sourceRow.nombre === "string" ? sourceRow.nombre : "";
    nextRow.firma = typeof sourceRow.firma === "string" ? sourceRow.firma : "";

    for (const dayKey of DAY_ORDER) {
      const sourceDay = sourceRow.days?.[dayKey];
      nextRow.days[dayKey] = {
        he1:
          typeof sourceDay?.he1 === "string"
            ? normalizeScheduleTime(sourceDay.he1)
            : "",
        hs1:
          typeof sourceDay?.hs1 === "string"
            ? normalizeScheduleTime(sourceDay.hs1)
            : "",
        he2:
          typeof sourceDay?.he2 === "string"
            ? normalizeScheduleTime(sourceDay.he2)
            : "",
        hs2:
          typeof sourceDay?.hs2 === "string"
            ? normalizeScheduleTime(sourceDay.hs2)
            : "",
        conDescanso: Boolean(sourceDay?.conDescanso),
      };
    }

    return nextRow;
  });
};

const readScheduleDraft = (username: string) => {
  if (typeof window === "undefined") return null;
  try {
    const rawValue = window.localStorage.getItem(getDraftStorageKey(username));
    if (!rawValue) return null;
    const parsed = JSON.parse(rawValue) as Partial<ScheduleDraft> | null;
    if (!parsed || parsed.version !== LOCAL_DRAFT_VERSION) return null;

    return {
      sede: typeof parsed.sede === "string" ? parsed.sede : "",
      seccion: typeof parsed.seccion === "string" ? parsed.seccion : "Cajas",
      fechaInicial:
        typeof parsed.fechaInicial === "string" ? parsed.fechaInicial : "",
      fechaFinal: typeof parsed.fechaFinal === "string" ? parsed.fechaFinal : "",
      mes: typeof parsed.mes === "string" ? parsed.mes : "",
      rows: createSafeDraftRows(parsed.rows),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      syncLunesToRest:
        typeof parsed.syncLunesToRest === "boolean"
          ? parsed.syncLunesToRest
          : false,
      lunesIndependentByRow: parsed.lunesIndependentByRow,
    };
  } catch {
    return null;
  }
};

const writeScheduleDraft = (username: string, draft: ScheduleDraft) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getDraftStorageKey(username), JSON.stringify(draft));
};

const clearScheduleDraft = (username: string) => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(getDraftStorageKey(username));
};

function mergeLoadedPlanillaRows(
  apiRows: Array<{
    rowIndex?: number;
    nombre?: string;
    firma?: string;
    days?: RowSchedule["days"];
  }>,
): RowSchedule[] {
  const base = Array.from({ length: 16 }, () => createEmptyRow());
  apiRows.forEach((r, i) => {
    const idx =
      typeof r.rowIndex === "number" && r.rowIndex >= 0 && r.rowIndex < 16
        ? r.rowIndex
        : i < 16
          ? i
          : -1;
    if (idx < 0) return;
    const empty = createEmptyRow();
    base[idx] = {
      nombre: typeof r.nombre === "string" ? r.nombre : "",
      firma: typeof r.firma === "string" ? r.firma : "",
      days: { ...empty.days },
    };
    for (const dk of DAY_ORDER) {
      const src = r.days?.[dk];
      base[idx].days[dk] = {
        he1:
          typeof src?.he1 === "string"
            ? normalizeScheduleTime(src.he1)
            : "",
        hs1:
          typeof src?.hs1 === "string"
            ? normalizeScheduleTime(src.hs1)
            : "",
        he2:
          typeof src?.he2 === "string"
            ? normalizeScheduleTime(src.he2)
            : "",
        hs2:
          typeof src?.hs2 === "string"
            ? normalizeScheduleTime(src.hs2)
            : "",
        conDescanso: Boolean(src?.conDescanso),
      };
    }
  });
  return base;
}

export function IngresarHorariosInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planillaQueryIdRaw = searchParams.get("planilla");
  const [ready, setReady] = useState(false);
  const [currentUsername, setCurrentUsername] = useState("");
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
  const [savingForm, setSavingForm] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [employeeDuplicateError, setEmployeeDuplicateError] = useState<
    string | null
  >(null);
  const [rows, setRows] = useState<RowSchedule[]>(
    Array.from({ length: 16 }, () => createEmptyRow()),
  );
  /** Si no es null, Guardar hace PATCH y actualiza esta planilla */
  const [editingPlanillaId, setEditingPlanillaId] = useState<number | null>(null);
  const [loadingPlanillaEdit, setLoadingPlanillaEdit] = useState(false);
  const planillaRef = useRef<HTMLDivElement | null>(null);
  const jpgExportRef = useRef<HTMLDivElement | null>(null);
  const draftSaveTimeoutRef = useRef<number | null>(null);
  const lunesIndependenceRef = useRef<Map<number, Set<DayKey>>>(new Map());
  const [syncLunesToRest, setSyncLunesToRest] = useState(false);
  /** Rol especial "Replicar lunes" (ver special-role-features) */
  const [canLunesScheduleSync, setCanLunesScheduleSync] = useState(false);
  /** Solo para disparar guardado de borrador al cambiar el mapa de independencia */
  const [lunesIndVersion, setLunesIndVersion] = useState(0);

  const lunesSyncActive = canLunesScheduleSync && syncLunesToRest;

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
          user?: {
            role?: string;
            username?: string;
            allowedDashboards?: string[] | null;
            specialRoles?: string[] | null;
          };
        };
        const isAdmin = payload.user?.role === "admin";
        const canSync = canUseLunesScheduleSync(
          payload.user?.specialRoles,
          isAdmin,
        );
        setCanLunesScheduleSync(canSync);
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
        const username = payload.user?.username?.trim() || "anon";
        const draft = readScheduleDraft(username);
        const planillaIdFromUrl = Number(planillaQueryIdRaw);
        const skipDraftForPlanilla =
          Number.isInteger(planillaIdFromUrl) && planillaIdFromUrl > 0;

        setCurrentUsername(username);
        setSedesOptions(nextSedes);
        setEmployeeOptions(optionsPayload.employees ?? []);
        if (draft && !skipDraftForPlanilla) {
          setSede(draft.sede);
          setSeccion(draft.seccion);
          setFechaInicial(draft.fechaInicial);
          setFechaFinal(draft.fechaFinal);
          setMes(draft.mes);
          setRows(draft.rows);
          setSyncLunesToRest(canSync && (draft.syncLunesToRest ?? false));
          lunesIndependenceRef.current = parseLunesIndependence(
            draft.lunesIndependentByRow,
          );
          setLunesIndVersion((n) => n + 1);
        } else if (!skipDraftForPlanilla) {
          if (optionsPayload.defaultSede) {
            setSede(optionsPayload.defaultSede);
          } else if (nextSedes.length > 0) {
            setSede(nextSedes[0].name);
          }
        }
        setDraftHydrated(true);
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
  }, [router, planillaQueryIdRaw]);

  useEffect(() => {
    const normalizedSede = normalizeText(sede);
    if (
      normalizedSede.includes("panificadora") ||
      normalizedSede.includes("planta desposte mixto") ||
      normalizedSede.includes("planta desposte pollo") ||
      normalizedSede.includes("planta desprese pollo")
    ) {
      setSeccion("Planta");
      return;
    }
    setSeccion("Cajas");
  }, [sede]);

  useEffect(() => {
    if (!canLunesScheduleSync && syncLunesToRest) {
      setSyncLunesToRest(false);
    }
  }, [canLunesScheduleSync, syncLunesToRest]);

  useEffect(() => {
    if (
      !draftHydrated ||
      !currentUsername ||
      editingPlanillaId !== null
    ) {
      return;
    }

    draftSaveTimeoutRef.current = window.setTimeout(() => {
      writeScheduleDraft(currentUsername, {
        version: LOCAL_DRAFT_VERSION,
        sede,
        seccion,
        fechaInicial,
        fechaFinal,
        mes,
        rows,
        syncLunesToRest: lunesSyncActive,
        lunesIndependentByRow: serializeLunesIndependence(
          lunesIndependenceRef.current,
        ),
        updatedAt: new Date().toISOString(),
      });
    }, 250);

    return () => {
      if (draftSaveTimeoutRef.current !== null) {
        window.clearTimeout(draftSaveTimeoutRef.current);
        draftSaveTimeoutRef.current = null;
      }
    };
  }, [
    currentUsername,
    draftHydrated,
    fechaFinal,
    fechaInicial,
    lunesIndVersion,
    mes,
    rows,
    sede,
    seccion,
    lunesSyncActive,
    editingPlanillaId,
  ]);

  useEffect(() => {
    const id = Number(planillaQueryIdRaw);
    if (!Number.isInteger(id) || id <= 0) {
      setEditingPlanillaId(null);
      setLoadingPlanillaEdit(false);
      return;
    }

    let cancelled = false;
    setLoadingPlanillaEdit(true);
    setSaveError(null);

    const load = async () => {
      try {
        const res = await fetch(`/api/ingresar-horarios/forms/${id}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as {
          form?: {
            sede: string;
            seccion: string;
            fechaInicial: string;
            fechaFinal: string;
            mes: string;
            rows: Array<{
              rowIndex?: number;
              nombre?: string;
              firma?: string;
              days?: RowSchedule["days"];
            }>;
          };
          error?: string;
        };
        if (!res.ok || !data.form) {
          if (!cancelled) {
            setSaveError(data.error ?? "No se pudo cargar la planilla para editar.");
            setLoadingPlanillaEdit(false);
          }
          return;
        }
        if (cancelled) return;

        const f = data.form;
        setEditingPlanillaId(id);
        setSede(f.sede);
        setSeccion(f.seccion);
        setFechaInicial(f.fechaInicial ?? "");
        setFechaFinal(f.fechaFinal ?? "");
        setMes(f.mes ?? "");
        setRows(mergeLoadedPlanillaRows(f.rows ?? []));
        lunesIndependenceRef.current.clear();
        setSyncLunesToRest(false);
        setLunesIndVersion((n) => n + 1);
        setEmployeeDuplicateError(null);

        const u = currentUsername;
        if (u) {
          clearScheduleDraft(u);
        }
      } catch {
        if (!cancelled) {
          setSaveError("No se pudo cargar la planilla para editar.");
        }
      } finally {
        if (!cancelled) setLoadingPlanillaEdit(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [planillaQueryIdRaw, currentUsername]);

  const updateRowField = useCallback((
    rowIndex: number,
    field: keyof Pick<RowSchedule, "nombre" | "firma">,
    value: string,
  ) => {
    if (field === "nombre") {
      const key = normalizePersonNameKey(value);
      if (key) {
        const duplicate = rows.some(
          (r, i) =>
            i !== rowIndex && normalizePersonNameKey(r.nombre) === key,
        );
        if (duplicate) {
          setEmployeeDuplicateError(
            "Este empleado ya esta en otra fila. Quita el nombre en la otra fila o elige otro.",
          );
          return;
        }
      }
      setEmployeeDuplicateError(null);
    }
    setRows((prev) =>
      prev.map((row, idx) =>
        idx === rowIndex ? { ...row, [field]: value } : row,
      ),
    );
  }, [rows]);

  const updateRowDayField = useCallback(
    (
      rowIndex: number,
      day: DayKey,
      field: keyof DaySchedule,
      value: string,
      options?: { isBlur?: boolean },
    ) => {
      /* Solo marcar dia independiente al editar (onChange), no al blur: solo pasar
       * por el campo o normalizar hora no debe excluir ese dia del sync desde lunes. */
      if (lunesSyncActive && day !== "lunes" && !options?.isBlur) {
        let set = lunesIndependenceRef.current.get(rowIndex);
        if (!set) {
          set = new Set<DayKey>();
          lunesIndependenceRef.current.set(rowIndex, set);
        }
        if (!set.has(day)) {
          set.add(day);
          setLunesIndVersion((n) => n + 1);
        }
      }

      setRows((prev) =>
        prev.map((row, idx) => {
          if (idx !== rowIndex) return row;
          const nextDay = { ...row.days[day], [field]: value };
          let days: RowSchedule["days"] = { ...row.days, [day]: nextDay };
          if (lunesSyncActive && day === "lunes") {
            const indep =
              lunesIndependenceRef.current.get(rowIndex) ?? new Set<DayKey>();
            const snap = cloneDaySchedule(days.lunes);
            for (const dk of DAY_ORDER) {
              if (dk === "lunes") continue;
              if (indep.has(dk)) continue;
              days = { ...days, [dk]: cloneDaySchedule(snap) };
            }
          }
          return { ...row, days };
        }),
      );
    },
    [lunesSyncActive],
  );

  const updateDescanso = useCallback(
    (rowIndex: number, day: DayKey, checked: boolean) => {
      if (lunesSyncActive && day !== "lunes") {
        let set = lunesIndependenceRef.current.get(rowIndex);
        if (!set) {
          set = new Set<DayKey>();
          lunesIndependenceRef.current.set(rowIndex, set);
        }
        if (!set.has(day)) {
          set.add(day);
          setLunesIndVersion((n) => n + 1);
        }
      }

      setRows((prev) =>
        prev.map((row, idx) => {
          if (idx !== rowIndex) return row;
          const base = {
            ...row.days[day],
            conDescanso: checked,
            he1: checked ? "" : row.days[day].he1,
            hs1: checked ? "" : row.days[day].hs1,
            he2: checked ? "" : row.days[day].he2,
            hs2: checked ? "" : row.days[day].hs2,
          };
          let days: RowSchedule["days"] = { ...row.days, [day]: base };
          if (lunesSyncActive && day === "lunes") {
            const indep =
              lunesIndependenceRef.current.get(rowIndex) ?? new Set<DayKey>();
            const snap = cloneDaySchedule(days.lunes);
            for (const dk of DAY_ORDER) {
              if (dk === "lunes") continue;
              if (indep.has(dk)) continue;
              days = { ...days, [dk]: cloneDaySchedule(snap) };
            }
          }
          return { ...row, days };
        }),
      );
    },
    [lunesSyncActive],
  );

  const filteredEmployeeNames = useMemo(
    () =>
      Array.from(
        new Set(
          employeeOptions
            .filter(
              (employee) =>
                matchesSede(employee.sede, sede),
            )
            .map((employee) => employee.name)
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b, "es")),
    [employeeOptions, sede],
  );

  const employeeNamesPerRow = useMemo(
    () =>
      rows.map((_, rowIndex) => {
        const takenKeys = new Set(
          rows
            .map((r, i) =>
              i !== rowIndex ? normalizePersonNameKey(r.nombre) : "",
            )
            .filter(Boolean),
        );
        const names = filteredEmployeeNames.filter((name) => {
          const key = normalizePersonNameKey(name);
          return Boolean(key) && !takenKeys.has(key);
        });
        const current = rows[rowIndex]?.nombre?.trim() ?? "";
        if (current) {
          const curKey = normalizePersonNameKey(current);
          if (
            curKey &&
            !names.some((n) => normalizePersonNameKey(n) === curKey)
          ) {
            names.push(current);
          }
        }
        return names;
      }),
    [rows, filteredEmployeeNames],
  );

  const handleSaveForm = useCallback(async () => {
    if (savingForm) return;
    const csrfToken = getCookieValue("vp_csrf");
    if (!csrfToken) {
      setSaveError("No se pudo validar la sesion. Recarga la pagina.");
      setSaveSuccess(null);
      return;
    }

    setSavingForm(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const bodyPayload = {
        sede,
        seccion,
        fechaInicial,
        fechaFinal,
        mes,
        rows: normalizeScheduleRowsForSave(rows),
      };
      const updatingId = editingPlanillaId;
      const response = await fetch(
        updatingId !== null
          ? `/api/ingresar-horarios/forms/${updatingId}`
          : "/api/ingresar-horarios/forms",
        {
          method: updatingId !== null ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify(bodyPayload),
        },
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        planillaId?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "No se pudo guardar la planilla.");
      }
      const pid = payload.planillaId;
      setSaveSuccess(
        updatingId !== null
          ? `Planilla #${pid ?? updatingId} actualizada en Horarios guardados.`
          : `Planilla guardada correctamente${pid ? ` (#${pid})` : ""}. Ahora puedes verla en Horarios guardados.`,
      );

      setEditingPlanillaId(null);
      setRows(Array.from({ length: 16 }, () => createEmptyRow()));
      setFechaInicial("");
      setFechaFinal("");
      setMes("");
      setSyncLunesToRest(false);
      lunesIndependenceRef.current.clear();
      setLunesIndVersion((n) => n + 1);
      setEmployeeDuplicateError(null);
      if (currentUsername) {
        clearScheduleDraft(currentUsername);
      }
      router.replace("/ingresar-horarios");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Error desconocido al guardar.");
      setSaveSuccess(null);
    } finally {
      setSavingForm(false);
    }
  }, [
    currentUsername,
    editingPlanillaId,
    fechaFinal,
    fechaInicial,
    mes,
    router,
    rows,
    savingForm,
    sede,
    seccion,
  ]);

  const handleExportPdf = () => {
    window.print();
  };

  const handleClearDraft = useCallback(() => {
    if (!currentUsername) return;
    if (draftSaveTimeoutRef.current !== null) {
      window.clearTimeout(draftSaveTimeoutRef.current);
      draftSaveTimeoutRef.current = null;
    }
    clearScheduleDraft(currentUsername);
    lunesIndependenceRef.current.clear();
    setSyncLunesToRest(false);
    setLunesIndVersion((n) => n + 1);
    setEmployeeDuplicateError(null);
    setEditingPlanillaId(null);
    router.replace("/ingresar-horarios");
    setDraftMessage("Borrador local eliminado.");
  }, [currentUsername, router]);

  const handleExportJpg = useCallback(async () => {
    if (!jpgExportRef.current) return;
    setExportingJpg(true);
    try {
      const exportNode = jpgExportRef.current;
      const dataUrl = await toJpeg(exportNode, {
        quality: 0.95,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        cacheBust: true,
        width: exportNode.scrollWidth,
        height: exportNode.scrollHeight,
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
        <div className="pointer-events-none fixed -left-[100000px] top-0 opacity-0">
          <div
            ref={jpgExportRef}
            className="inline-block bg-white p-1 text-slate-900"
          >
            <div className={`${SCHEDULE_OUTER_BORDER_CLASS} px-2 py-1`}>
              <div className="grid grid-cols-[1fr_1fr_1fr] items-center border-b-2 border-slate-900 pb-1">
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
              <div className="mt-1 grid grid-cols-5 gap-2 text-[10px] leading-tight">
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

            <div className={`mt-1 rounded-none ${SCHEDULE_OUTER_BORDER_CLASS}`}>
              <table className="w-[88rem] table-fixed border-collapse text-[9px] leading-tight">
                <thead>
                  <tr className="bg-slate-100 text-slate-700">
                    <th className={`w-8 ${SCHEDULE_CELL_BORDER_CLASS} px-1 py-1.5 text-center`}>
                      #
                    </th>
                    <th className={`w-44 ${SCHEDULE_CELL_BORDER_CLASS} px-1 py-1.5 text-left`}>
                      Nombre
                    </th>
                    {DAY_ORDER.map((day) => (
                      <th
                        key={`jpg-${day}`}
                        colSpan={4}
                        className={`${SCHEDULE_CELL_BORDER_CLASS} px-1 py-1.5 text-center uppercase`}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>{day}</span>
                          <span className="rounded-md bg-white px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">
                            {dayNumbersByKey[day] ?? "--"}
                          </span>
                        </div>
                      </th>
                    ))}
                    <th className={`w-40 ${SCHEDULE_CELL_BORDER_CLASS} px-1 py-1.5 text-left`}>
                      Firma empleado
                    </th>
                  </tr>
                  <tr className="bg-white text-[9px] font-semibold text-slate-500">
                    <th className={`${SCHEDULE_CELL_BORDER_CLASS} px-1 py-1`} />
                    <th className={`${SCHEDULE_CELL_BORDER_CLASS} px-1 py-1`} />
                    {DAY_ORDER.flatMap((day) =>
                      (["he1", "hs1", "he2", "hs2"] as const).map((field) => (
                        <th
                          key={`jpg-${day}-${field}`}
                          className={`w-12 ${SCHEDULE_CELL_BORDER_CLASS} px-0.5 py-1 text-center uppercase`}
                        >
                          {field === "he1" || field === "he2" ? "HE" : "HS"}
                        </th>
                      )),
                    )}
                    <th className={`${SCHEDULE_CELL_BORDER_CLASS} px-1 py-1`} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr
                      key={`jpg-row-${rowIndex}`}
                      className="odd:bg-white even:bg-slate-50/40"
                    >
                      <td className={`${SCHEDULE_CELL_BORDER_CLASS} px-1 py-1 text-center align-top text-slate-600`}>
                        {rowIndex + 1}
                      </td>
                      <td className={`${SCHEDULE_CELL_BORDER_CLASS} px-1 py-1 align-top text-slate-900 break-words`}>
                        {row.nombre || "--"}
                      </td>
                      {DAY_ORDER.flatMap((day) => {
                        const dayData = row.days[day];
                        if (dayData.conDescanso) {
                          return [
                            <td
                              key={`jpg-${rowIndex}-${day}-descanso`}
                              colSpan={4}
                              className={`${SCHEDULE_CELL_BORDER_CLASS} bg-amber-50/60 px-1 py-1 text-center text-[9px] font-semibold uppercase tracking-[0.06em] text-slate-700`}
                            >
                              Descanso
                            </td>,
                          ];
                        }

                        return (["he1", "hs1", "he2", "hs2"] as const).map((field) => (
                          <td
                            key={`jpg-${rowIndex}-${day}-${field}`}
                            className={`w-12 ${SCHEDULE_CELL_BORDER_CLASS} px-0.5 py-1 text-center text-slate-700`}
                          >
                            {formatTimeForDisplay(dayData[field]) || "--"}
                          </td>
                        ));
                      })}
                      <td className={`${SCHEDULE_CELL_BORDER_CLASS} px-1 py-1 align-top text-slate-700 break-words`}>
                        {row.firma || "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

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
            {loadingPlanillaEdit ? (
              <p className="mt-2 text-sm font-medium text-sky-700">
                Cargando planilla para editar...
              </p>
            ) : null}
            {editingPlanillaId !== null && !loadingPlanillaEdit ? (
              <p className="mt-2 max-w-xl rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-950">
                Editando planilla{" "}
                <span className="font-mono font-semibold">#{editingPlanillaId}</span>.
                Al guardar se actualiza este registro (no se crea otro). Despues
                el formulario se vacia para cargar una planilla nueva; para volver
                a editar esta, entra en Horarios guardados y usa Editar.
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSaveForm()}
              disabled={savingForm || loadingPlanillaEdit}
              className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-700 transition-all hover:border-sky-300 hover:bg-sky-100/70 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingForm ? "Guardando..." : "Guardar"}
            </button>
            <button
              type="button"
              onClick={handleClearDraft}
              className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700 transition-all hover:border-amber-300 hover:bg-amber-100/70"
            >
              Limpiar borrador
            </button>
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
              onClick={() => router.push("/horarios-guardados")}
              className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-700 transition-all hover:border-sky-300 hover:bg-sky-100/70"
            >
              Ver guardados
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

        {canLunesScheduleSync ? (
          <div className="mt-3 print:hidden">
            <label
              className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-200/90 bg-slate-50/90 px-2.5 py-1.5 text-[12px] text-slate-600 transition-colors hover:bg-slate-50"
              title="Por fila: lo del lunes se copia al resto de los dias. Si editas otro dia, ese queda aparte. Desactivar no borra datos."
            >
              <input
                type="checkbox"
                checked={syncLunesToRest}
                onChange={(e) => setSyncLunesToRest(e.target.checked)}
                className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-slate-600 focus:ring-slate-300"
              />
              <span className="select-none">Mismo horario que lunes</span>
            </label>
          </div>
        ) : null}

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

        {(saveError ||
          saveSuccess ||
          draftMessage ||
          employeeDuplicateError) && (
          <div className="mt-4 print:hidden">
            {saveError ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
                {saveError}
              </div>
            ) : null}
            {saveSuccess ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                {saveSuccess}
              </div>
            ) : null}
            {draftMessage ? (
              <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-700">
                {draftMessage}
              </div>
            ) : null}
            {employeeDuplicateError ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
                {employeeDuplicateError}
              </div>
            ) : null}
          </div>
        )}

        <div className={`mt-5 hidden ${SCHEDULE_OUTER_BORDER_CLASS} px-3 py-2 print:block`}>
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

        <div className={`mt-5 overflow-x-auto overflow-y-visible rounded-2xl ${SCHEDULE_OUTER_BORDER_CLASS} print:overflow-visible print:rounded-none`}>
          <table className="planilla-print-table table-fixed w-max max-w-none border-collapse text-[12px] print:min-w-0 print:w-full print:max-w-none print:text-[8px]">
            <colgroup>
              <col style={{ width: COL_W_NUM }} />
              <col style={{ width: COL_W_NAME }} />
              {DAY_ORDER.flatMap((day) =>
                (["he1", "hs1", "he2", "hs2"] as const).map((field) => (
                  <col
                    key={`col-${day}-${field}`}
                    style={{ width: COL_W_TIME }}
                  />
                )),
              )}
              <col style={{ width: COL_W_SIGN }} />
            </colgroup>
            <thead>
              <tr className="bg-slate-100 text-slate-700">
                <th className={`${SCHEDULE_CELL_BORDER_CLASS} px-2 py-2 text-center`}>
                  #
                </th>
                <th className={`${SCHEDULE_CELL_BORDER_CLASS} px-2 py-2 text-left print:w-35`}>
                  Nombre
                </th>
                {DAY_ORDER.map((day) => (
                  <th
                    key={day}
                    colSpan={4}
                    className={`${SCHEDULE_CELL_BORDER_CLASS} px-2 py-2 text-center uppercase`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <span>{day}</span>
                      <span className="rounded-md bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                        {dayNumbersByKey[day] ?? "--"}
                      </span>
                    </div>
                  </th>
                ))}
                <th className={`${SCHEDULE_CELL_BORDER_CLASS} px-2 py-2 text-left print:w-35`}>
                  Firma empleado
                </th>
              </tr>
              <tr className="bg-white text-[11px] font-semibold text-slate-500">
                <th className={`${SCHEDULE_CELL_BORDER_CLASS} px-2 py-2`} />
                <th className={`${SCHEDULE_CELL_BORDER_CLASS} px-2 py-2`} />
                {DAY_ORDER.flatMap((day) =>
                  (["he1", "hs1", "he2", "hs2"] as const).map((field) => (
                    <th
                      key={`${day}-${field}`}
                      className={TIME_SLOT_TH_CLASS}
                    >
                      {field === "he1" || field === "he2" ? "HE" : "HS"}
                    </th>
                  )),
                )}
                <th className={`${SCHEDULE_CELL_BORDER_CLASS} px-2 py-2`} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <RowScheduleRow
                  key={`row-${rowIndex}`}
                  row={row}
                  rowIndex={rowIndex}
                  employeeListId={`ingresar-horarios-emp-${rowIndex}`}
                  onRowField={updateRowField}
                  onRowDayField={updateRowDayField}
                  onDescanso={updateDescanso}
                />
              ))}
            </tbody>
          </table>
          {rows.map((_, rowIndex) => (
            <datalist key={`dl-${rowIndex}`} id={`ingresar-horarios-emp-${rowIndex}`}>
              {(employeeNamesPerRow[rowIndex] ?? []).map((employeeName) => (
                <option
                  key={`${rowIndex}-${employeeName}`}
                  value={employeeName}
                />
              ))}
            </datalist>
          ))}
        </div>

        <div className="mt-4 space-y-1 text-xs text-slate-500 print:hidden">
          <p className="font-medium text-slate-600">
            Desplaza horizontalmente la tabla si no ves todos los dias a la vez.
          </p>
          <p>
            HE: hora entrada | HS: hora salida | HE: reingreso | HS: salida
            final. Horas 00-23 y minutos 00-59; puedes escribir a mano (ej.{" "}
            <span className="tabular-nums">08:30</span>,{" "}
            <span className="tabular-nums">8:30</span> o{" "}
            <span className="tabular-nums">1430</span>).
          </p>
          <p>
            Marca el check junto al primer HE para dejar el dia completo en
            descanso (DESC) para ese empleado.
          </p>
          <p>
            Cada empleado solo puede aparecer en una fila: al elegirlo en la
            lista, deja de mostrarse en las demas hasta que borres ese nombre.
          </p>
        </div>
        <style jsx global>{`
          @media print {
            @page {
              size: A4 landscape;
              margin: 6mm;
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
            #planilla-print,
            #planilla-print * {
              visibility: visible;
            }
            /* absolute + inset recortaba la tabla al alto/ancho de una sola página */
            #planilla-print {
              position: static !important;
              inset: auto !important;
              width: 100% !important;
              max-width: 100% !important;
              height: auto !important;
              overflow: visible !important;
            }
            #planilla-print .overflow-x-auto {
              overflow: visible !important;
              max-width: 100% !important;
            }
            .planilla-print-table {
              table-layout: fixed !important;
              width: 100% !important;
              max-width: 100% !important;
              min-width: 0 !important;
              font-size: 7px !important;
            }
            /* Anchos fijos en rem obligan un ancho mínimo enorme y se corta en PDF */
            .planilla-print-table colgroup col {
              width: auto !important;
              min-width: 0 !important;
            }
            input[type="checkbox"] {
              display: none !important;
            }
          }
        `}</style>
      </div>
    </div>
  );
}
