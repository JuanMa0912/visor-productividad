"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Building2,
  CalendarDays,
  ChevronDown,
  Download,
  Eraser,
  FileText,
  FilePlus,
  FolderOpen,
  ImageIcon,
  Pencil,
  Save,
  Users,
} from "lucide-react";
import { normalizePersonNameKey } from "@/lib/shared/normalize";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import {
  normalizeScheduleRowsForSave,
  normalizeScheduleTime,
} from "@/lib/horarios/schedule-time";
import {
  DEFAULT_LUNES_SCHEDULE_PRESETS,
  loadLunesPresetsFromStorage,
  saveLunesPresetsToStorage,
  presetsToByKey,
  isBuiltinLunesPresetKey,
  createCustomLunesPresetKey,
  type LunesSchedulePreset,
  type LunesSchedulePresetKey,
} from "@/lib/horarios/lunes-schedule-presets";
import {
  canUseLunesScheduleSync,
  canCreateLunesSchedulePresets,
} from "@/lib/shared/special-role-features";
import { toJpeg } from "html-to-image";
import { Stepper, StepperStep } from "@/components/ui/stepper";
import { PlanillaPreview } from "./planilla-preview";
import type {
  DayKey,
  DaySchedule,
  RowSchedule,
  ScheduleDraft,
} from "./types";
import {
  DAY_ORDER,
  MONTH_OPTIONS,
  LOCAL_DRAFT_VERSION,
  INITIAL_ROW_COUNT,
  COL_W_NUM,
  COL_W_NAME,
  COL_W_TIME,
  COL_W_SIGN,
  SCHEDULE_OUTER_BORDER_CLASS,
  SCHEDULE_CELL_BORDER_CLASS,
  TIME_SLOT_TH_CLASS,
  dayStartDividerClass,
  createEmptyRow,
  cloneDaySchedule,
  parseLunesIndependence,
  serializeLunesIndependence,
  normalizeText,
  matchesSede,
} from "./schedule-utils";
import {
  getCookieValue,
  readScheduleDraft,
  writeScheduleDraft,
  clearScheduleDraft,
  mergeLoadedPlanillaRows,
} from "./draft-storage";
import { RowScheduleRow } from "./row-schedule-row";


type HorariosOptionsResponse = {
  sedes?: Array<{ id: string; name: string }>;
  defaultSede?: string | null;
  employees?: Array<{ name: string; sede?: string }>;
  error?: string;
};

export function IngresarHorariosInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planillaQueryIdRaw = searchParams.get("planilla");
  const duplicarQueryIdRaw = searchParams.get("duplicar");
  const { user: authUser, status: authStatus } = useRequireAuth();
  const { isAdmin: authIsAdmin, hasSection, hasSubsection } = usePermissions();
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
    { rowIndex: number; message: string } | null
  >(null);
  const [rows, setRows] = useState<RowSchedule[]>(
    Array.from({ length: INITIAL_ROW_COUNT }, () => createEmptyRow()),
  );
  /** Si no es null, Guardar hace PATCH y actualiza esta planilla */
  const [editingPlanillaId, setEditingPlanillaId] = useState<number | null>(
    null,
  );
  const [loadingPlanillaEdit, setLoadingPlanillaEdit] = useState(false);
  const planillaRef = useRef<HTMLDivElement | null>(null);
  const jpgExportRef = useRef<HTMLDivElement | null>(null);
  const draftSaveTimeoutRef = useRef<number | null>(null);
  const lunesIndependenceRef = useRef<Map<number, Set<DayKey>>>(new Map());
  const [syncLunesToRest, setSyncLunesToRest] = useState(false);
  /** Rol especial "Replicar lunes" (ver special-role-features) */
  const [canLunesScheduleSync, setCanLunesScheduleSync] = useState(false);
  /**
   * Rol especial "Crear horario predeterminado". Activa el boton "+" para
   * agregar presets adicionales y la opcion de eliminar los presets creados.
   */
  const [canCreateSchedulePresets, setCanCreateSchedulePresets] =
    useState(false);
  /** Solo para disparar guardado de borrador al cambiar el mapa de independencia */
  const [lunesIndVersion, setLunesIndVersion] = useState(0);
  /** Etiqueta mostrada en el selector de plantilla por fila (solo UI). */
  const [lunesPresetChoiceByRow, setLunesPresetChoiceByRow] = useState<
    Record<number, LunesSchedulePresetKey>
  >({});
  const [lunesPresetDefinitions, setLunesPresetDefinitions] = useState<
    LunesSchedulePreset[]
  >(() => [...DEFAULT_LUNES_SCHEDULE_PRESETS]);
  const [lunesPresetsModalOpen, setLunesPresetsModalOpen] = useState(false);
  const lunesModalRef = useRef<HTMLDivElement | null>(null);
  const lunesModalPreviousFocusRef = useRef<HTMLElement | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const [openSteps, setOpenSteps] = useState<{
    config: boolean;
    detalle: boolean;
  }>({ config: true, detalle: true });
  const theadRow1Ref = useRef<HTMLTableRowElement | null>(null);
  const [theadRow1Height, setTheadRow1Height] = useState(38);

  useEffect(() => {
    const el = theadRow1Ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const h = el.offsetHeight;
      if (h > 0) setTheadRow1Height(h);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const toggleStep = useCallback(
    (key: "config" | "detalle") =>
      setOpenSteps((prev) => ({ ...prev, [key]: !prev[key] })),
    [],
  );

  useEffect(() => {
    if (!exportMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!exportMenuRef.current) return;
      if (!exportMenuRef.current.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [exportMenuOpen]);

  useEffect(() => {
    if (editingPlanillaId === null) return;
    setOpenSteps({ config: false, detalle: true });
  }, [editingPlanillaId]);

  useEffect(() => {
    if (!saveSuccess) return;
    const timeout = window.setTimeout(() => setSaveSuccess(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [saveSuccess]);

  useEffect(() => {
    if (!draftMessage) return;
    const timeout = window.setTimeout(() => setDraftMessage(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [draftMessage]);

  const lunesSyncActive = canLunesScheduleSync && syncLunesToRest;

  const lunesPresetByKeyLive = useMemo(
    () => presetsToByKey(lunesPresetDefinitions),
    [lunesPresetDefinitions],
  );

  const lunesPresetColumnStyle = useMemo((): CSSProperties => {
    const labelLens = lunesPresetDefinitions.map((p) => p.label.length);
    const longestLabel = Math.max(
      ...labelLens,
      "Horario…".length,
      "Activa lunes".length,
      10,
    );
    const ch = longestLabel + 10;
    return { minWidth: `${ch}ch`, width: `${ch}ch` };
  }, [lunesPresetDefinitions]);

  useEffect(() => {
    const loaded = loadLunesPresetsFromStorage();
    if (loaded) {
      setLunesPresetDefinitions(loaded);
    }
  }, []);

  useEffect(() => {
    if (!canLunesScheduleSync) return;
    saveLunesPresetsToStorage(lunesPresetDefinitions);
  }, [canLunesScheduleSync, lunesPresetDefinitions]);

  const updateLunesPresetField = useCallback(
    (key: LunesSchedulePresetKey, field: "label" | "he1" | "hs2", raw: string) => {
      setLunesPresetDefinitions((prev) =>
        prev.map((p) => {
          if (p.key !== key) return p;
          if (field === "label") {
            const def = DEFAULT_LUNES_SCHEDULE_PRESETS.find(
              (d) => d.key === key,
            );
            // Para presets originales caemos al nombre por defecto si quedan
            // vacios; para los creados conservamos el ultimo valor mostrado.
            const label = raw.trim() || (def ? def.label : p.label);
            return { ...p, label };
          }
          const t = normalizeScheduleTime(raw);
          return { ...p, [field]: t || p[field] };
        }),
      );
    },
    [],
  );

  /** Solo presets fijos no se pueden borrar; los creados con "+" si. */
  const addCustomLunesPreset = useCallback(() => {
    if (!canCreateSchedulePresets) return;
    setLunesPresetDefinitions((prev) => {
      const newPreset: LunesSchedulePreset = {
        key: createCustomLunesPresetKey(),
        label: `Horario ${prev.length + 1}`,
        he1: "08:00",
        hs2: "17:00",
      };
      return [...prev, newPreset];
    });
  }, [canCreateSchedulePresets]);

  const removeLunesPreset = useCallback(
    (key: LunesSchedulePresetKey) => {
      if (!canCreateSchedulePresets) return;
      if (isBuiltinLunesPresetKey(key)) return;
      setLunesPresetDefinitions((prev) => prev.filter((p) => p.key !== key));
      // Limpia la seleccion de filas que apuntaban al preset borrado.
      setLunesPresetChoiceByRow((prev) => {
        const next = { ...prev };
        for (const [rowIdx, presetKey] of Object.entries(prev)) {
          if (presetKey === key) delete next[Number(rowIdx)];
        }
        return next;
      });
    },
    [canCreateSchedulePresets],
  );

  useEffect(() => {
    if (!lunesPresetsModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setLunesPresetsModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lunesPresetsModalOpen]);

  useEffect(() => {
    if (!lunesPresetsModalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [lunesPresetsModalOpen]);

  useEffect(() => {
    if (!canLunesScheduleSync) {
      setLunesPresetsModalOpen(false);
    }
  }, [canLunesScheduleSync]);

  useEffect(() => {
    if (authStatus !== "authenticated" || !authUser) return;
    if (
      !hasSection("operacion") ||
      !hasSubsection("registro-de-horarios")
    ) {
      router.replace("/secciones");
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    const canSync = canUseLunesScheduleSync(authUser.specialRoles, authIsAdmin);
    setCanLunesScheduleSync(canSync);
    setCanCreateSchedulePresets(
      canCreateLunesSchedulePresets(authUser.specialRoles, authIsAdmin),
    );

    const loadOptions = async () => {
      try {
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
        const username = authUser.username?.trim() || "anon";
        const draft = readScheduleDraft(username);
        const planillaIdFromUrl = Number(planillaQueryIdRaw);
        const duplicarIdFromUrl = Number(duplicarQueryIdRaw);
        const skipDraftForPlanilla =
          (Number.isInteger(planillaIdFromUrl) && planillaIdFromUrl > 0) ||
          (Number.isInteger(duplicarIdFromUrl) && duplicarIdFromUrl > 0);

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

    void loadOptions();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [
    authStatus,
    authUser,
    authIsAdmin,
    hasSection,
    hasSubsection,
    router,
    planillaQueryIdRaw,
    duplicarQueryIdRaw,
  ]);

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
    if (!lunesSyncActive) {
      setLunesPresetChoiceByRow({});
    }
  }, [lunesSyncActive]);

  const clearLunesPresetChoiceForRow = useCallback((rowIndex: number) => {
    setLunesPresetChoiceByRow((prev) => {
      const next = { ...prev };
      delete next[rowIndex];
      return next;
    });
  }, []);

  useEffect(() => {
    if (!draftHydrated || !currentUsername || editingPlanillaId !== null) {
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
    const editId = Number(planillaQueryIdRaw);
    const duplicateId = Number(duplicarQueryIdRaw);
    const isEdit = Number.isInteger(editId) && editId > 0;
    const isDuplicate =
      !isEdit && Number.isInteger(duplicateId) && duplicateId > 0;
    if (!isEdit && !isDuplicate) {
      setEditingPlanillaId(null);
      setLoadingPlanillaEdit(false);
      return;
    }

    const sourceId = isEdit ? editId : duplicateId;
    let cancelled = false;
    setLoadingPlanillaEdit(true);
    setSaveError(null);

    const load = async () => {
      try {
        const res = await fetch(`/api/ingresar-horarios/forms/${sourceId}`, {
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
            setSaveError(
              data.error ??
                (isDuplicate
                  ? "No se pudo cargar la planilla para duplicar."
                  : "No se pudo cargar la planilla para editar."),
            );
            setLoadingPlanillaEdit(false);
          }
          return;
        }
        if (cancelled) return;

        const f = data.form;
        // En duplicar: NO seteamos editingPlanillaId, asi Guardar crea una
        // planilla nueva (POST) sin sobreescribir la original. Limpiamos las
        // fechas para forzar a elegir el nuevo rango.
        setEditingPlanillaId(isDuplicate ? null : sourceId);
        setSede(f.sede);
        setSeccion(f.seccion);
        setFechaInicial(isDuplicate ? "" : (f.fechaInicial ?? ""));
        setFechaFinal(isDuplicate ? "" : (f.fechaFinal ?? ""));
        setMes(isDuplicate ? "" : (f.mes ?? ""));
        setRows(mergeLoadedPlanillaRows(f.rows ?? []));
        setLunesPresetChoiceByRow({});
        lunesIndependenceRef.current.clear();
        setSyncLunesToRest(false);
        setLunesIndVersion((n) => n + 1);
        setEmployeeDuplicateError(null);
        if (isDuplicate) {
          setDraftMessage(
            `Duplicado de planilla #${sourceId}. Elige las fechas y guarda para crear una planilla nueva (la original no se modifica).`,
          );
        }

        const u = currentUsername;
        if (u) {
          clearScheduleDraft(u);
        }
      } catch {
        if (!cancelled) {
          setSaveError(
            isDuplicate
              ? "No se pudo cargar la planilla para duplicar."
              : "No se pudo cargar la planilla para editar.",
          );
        }
      } finally {
        if (!cancelled) setLoadingPlanillaEdit(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [planillaQueryIdRaw, duplicarQueryIdRaw, currentUsername]);

  const updateRowField = useCallback(
    (
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
            setEmployeeDuplicateError({
              rowIndex,
              message:
                "Este empleado ya esta en otra fila. Quita el nombre en la otra fila o elige otro.",
            });
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
    },
    [rows],
  );

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

  const applyLunesPresetToRow = useCallback(
    (rowIndex: number, presetKey: LunesSchedulePresetKey) => {
      const preset = lunesPresetByKeyLive[presetKey];
      if (!preset || !lunesSyncActive) return;
      setRows((prev) =>
        prev.map((row, idx) => {
          if (idx !== rowIndex) return row;
          const lunesDay: DaySchedule = {
            he1: preset.he1,
            hs1: "",
            he2: "",
            hs2: preset.hs2,
            conDescanso: false,
          };
          let days: RowSchedule["days"] = { ...row.days, lunes: lunesDay };
          const indep = new Set<DayKey>();
          lunesIndependenceRef.current.set(rowIndex, indep);
          for (const dk of DAY_ORDER) {
            if (dk === "lunes") continue;
            days = { ...days, [dk]: cloneDaySchedule(lunesDay) };
          }
          return { ...row, days };
        }),
      );
      setLunesPresetChoiceByRow((prev) => ({
        ...prev,
        [rowIndex]: presetKey,
      }));
      setLunesIndVersion((n) => n + 1);
    },
    [lunesSyncActive, lunesPresetByKeyLive],
  );

  const filteredEmployeeNames = useMemo(
    () =>
      Array.from(
        new Set(
          employeeOptions
            .filter((employee) => matchesSede(employee.sede, sede))
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
      setRows(
        Array.from({ length: INITIAL_ROW_COUNT }, () => createEmptyRow()),
      );
      setFechaInicial("");
      setFechaFinal("");
      setMes("");
      setSyncLunesToRest(false);
      lunesIndependenceRef.current.clear();
      setLunesIndVersion((n) => n + 1);
      setEmployeeDuplicateError(null);
      setLunesPresetChoiceByRow({});
      if (currentUsername) {
        clearScheduleDraft(currentUsername);
      }
      router.replace("/ingresar-horarios");
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Error desconocido al guardar.",
      );
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

  const handleAddRows = useCallback(() => {
    setRows((prev) => {
      return [...prev, createEmptyRow()];
    });
  }, []);

  const handleRemoveLastRow = useCallback(() => {
    setRows((prev) => {
      // Permitimos quitar hasta dejar solo 1 fila (incluso por debajo de las
      // 16 iniciales) para planillas con pocos empleados.
      if (prev.length <= 1) return prev;
      const lastIndex = prev.length - 1;
      const last = prev[lastIndex];
      const hasContent =
        (last.nombre && last.nombre.trim()) ||
        (last.firma && last.firma.trim()) ||
        DAY_ORDER.some((d) => {
          const day = last.days[d];
          if (!day) return false;
          return (
            day.conDescanso ||
            (day.he1 && day.he1.trim()) ||
            (day.hs1 && day.hs1.trim()) ||
            (day.he2 && day.he2.trim()) ||
            (day.hs2 && day.hs2.trim())
          );
        });
      if (
        hasContent &&
        typeof window !== "undefined" &&
        !window.confirm(
          `La fila ${lastIndex + 1} contiene datos. ¿Seguro que quieres eliminarla?`,
        )
      ) {
        return prev;
      }
      // Limpiar estado asociado al indice removido para que no quede
      // referenciado al volver a agregar otra fila.
      setLunesPresetChoiceByRow((choices) => {
        if (!(lastIndex in choices)) return choices;
        const next = { ...choices };
        delete next[lastIndex];
        return next;
      });
      lunesIndependenceRef.current.delete(lastIndex);
      return prev.slice(0, lastIndex);
    });
  }, []);

  const canRemoveLastRow = rows.length > 1;

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
    setLunesPresetChoiceByRow({});
    setEmployeeDuplicateError(null);
    setEditingPlanillaId(null);
    router.replace("/ingresar-horarios");
    setDraftMessage("Borrador local eliminado.");
  }, [currentUsername, router]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!savingForm && !loadingPlanillaEdit) {
          void handleSaveForm();
        }
        return;
      }
      if (e.key === "Escape") {
        if (lunesPresetsModalOpen) {
          setLunesPresetsModalOpen(false);
          return;
        }
        if (exportMenuOpen) {
          setExportMenuOpen(false);
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    handleSaveForm,
    savingForm,
    loadingPlanillaEdit,
    lunesPresetsModalOpen,
    exportMenuOpen,
  ]);

  useEffect(() => {
    if (!lunesPresetsModalOpen) return;
    lunesModalPreviousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const root = lunesModalRef.current;
    if (!root) return;
    const focusables = root.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    );
    const first = focusables[0];
    first?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (focusables.length === 0) return;
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("keydown", onKeyDown);
      lunesModalPreviousFocusRef.current?.focus();
    };
  }, [lunesPresetsModalOpen]);

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
        {/* Encabezado solo de impresion (Portal UAID + icono) que se posiciona
            fijo en la parte superior central de cada hoja al imprimir. Sustituye
            al titulo/fecha que el navegador colocaba en su encabezado por defecto. */}
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
        <div className="pointer-events-none fixed -left-[100000px] top-0 opacity-0">
          <PlanillaPreview
            containerRef={jpgExportRef}
            rows={rows}
            sede={sede}
            seccion={seccion}
            fechaInicial={fechaInicial}
            fechaFinal={fechaFinal}
            mes={mes}
            dayNumbersByKey={dayNumbersByKey}
            mode="jpg"
          />
        </div>

        {(() => {
          const sedeNombre = sedesOptions.find((s) => s.id === sede)?.name ?? sede;
          const empleadosCargados = rows.filter((r) => r.nombre.trim().length > 0).length;
          const isEditing = editingPlanillaId !== null;
          return (
            <div className="relative overflow-hidden rounded-3xl border border-rose-200/70 bg-linear-to-br from-rose-100 via-rose-50/40 to-white p-7 shadow-[0_18px_35px_-30px_rgba(244,63,94,0.32)] before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-rose-500 print:hidden">
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
                    Ingresar horarios
                  </h1>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                    Planilla de programacion semanal de horarios por sede y
                    seccion.
                  </p>
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    {isEditing ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/80 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                        Editando planilla #{editingPlanillaId}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200/80 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                        <FilePlus className="h-3.5 w-3.5" aria-hidden />
                        Nueva planilla
                      </span>
                    )}
                    {sedeNombre ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200/80 bg-rose-50/80 px-3 py-1 text-xs font-semibold text-rose-700">
                        <Building2 className="h-3.5 w-3.5" aria-hidden />
                        {sedeNombre}
                        {seccion ? ` · ${seccion}` : ""}
                      </span>
                    ) : null}
                    {fechaInicial && fechaFinal ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200/80 bg-violet-50/80 px-3 py-1 text-xs font-semibold text-violet-700">
                        <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                        {fechaInicial} — {fechaFinal}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                      <Users className="h-3.5 w-3.5" aria-hidden />
                      {empleadosCargados} empleado{empleadosCargados === 1 ? "" : "s"}
                    </span>
                    {loadingPlanillaEdit ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200/80 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                        Cargando planilla...
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => router.push("/horarios-guardados")}
                    title="Ver planillas guardadas anteriormente"
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50"
                  >
                    <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                    Ver guardados
                  </button>
                  <button
                    type="button"
                    onClick={handleClearDraft}
                    title="Vaciar el formulario y descartar el borrador local"
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-all hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700"
                  >
                    <Eraser className="h-3.5 w-3.5" aria-hidden />
                    Limpiar
                  </button>
                  <div ref={exportMenuRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setExportMenuOpen((prev) => !prev)}
                      aria-haspopup="menu"
                      aria-expanded={exportMenuOpen}
                      disabled={exportingJpg}
                      title="Exportar planilla"
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden />
                      {exportingJpg ? "Exportando..." : "Exportar"}
                      <ChevronDown
                        className={`h-3 w-3 transition-transform ${exportMenuOpen ? "rotate-180" : ""}`}
                        aria-hidden
                      />
                    </button>
                    {exportMenuOpen ? (
                      <div
                        role="menu"
                        className="absolute right-0 top-full z-30 mt-1 min-w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setExportMenuOpen(false);
                            handleExportPdf();
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <FileText className="h-3.5 w-3.5 text-rose-500" aria-hidden />
                          PDF (imprimir)
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setExportMenuOpen(false);
                            void handleExportJpg();
                          }}
                          disabled={exportingJpg}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <ImageIcon className="h-3.5 w-3.5 text-rose-500" aria-hidden />
                          JPG (imagen)
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSaveForm()}
                    disabled={savingForm || loadingPlanillaEdit}
                    title={
                      isEditing
                        ? `Actualizar planilla #${editingPlanillaId}`
                        : "Guardar como planilla nueva"
                    }
                    className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-5 py-2 text-xs font-semibold text-white shadow-[0_8px_20px_-12px_rgba(244,63,94,0.6)] transition-all hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
                  >
                    <Save className="h-3.5 w-3.5" aria-hidden />
                    {savingForm ? "Guardando..." : "Guardar"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        <Stepper className="mt-5 print:hidden">
          <StepperStep
            index={1}
            title="Configuracion"
            description="Sede, seccion y periodo"
            isCompleted={Boolean(sede && fechaInicial && fechaFinal && mes)}
            isOpen={openSteps.config}
            onToggle={() => toggleStep("config")}
            summary={
              <span>
                {sede || "Sin sede"} · {seccion || "Sin seccion"}
                {fechaInicial && fechaFinal
                  ? ` · ${fechaInicial} → ${fechaFinal}`
                  : ""}
                {mes ? ` · ${mes}` : ""}
              </span>
            }
          >
            <div className="grid gap-3 md:grid-cols-5">
              <div className="block">
                <label
                  htmlFor="ih-sede"
                  className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600"
                >
                  Sede
                </label>
                <select
                  id="ih-sede"
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
              </div>
              <div className="block">
                <label
                  htmlFor="ih-seccion"
                  className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600"
                >
                  Seccion
                </label>
                <input
                  id="ih-seccion"
                  type="text"
                  value={seccion}
                  onChange={(e) => setSeccion(e.target.value)}
                  disabled
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-100"
                />
              </div>
              <div className="block">
                <label
                  htmlFor="ih-fecha-inicial"
                  className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600"
                >
                  Fecha inicial
                </label>
                <input
                  id="ih-fecha-inicial"
                  type="date"
                  value={fechaInicial}
                  onChange={(e) => setFechaInicial(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-100"
                />
              </div>
              <div className="block">
                <label
                  htmlFor="ih-fecha-final"
                  className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600"
                >
                  Fecha final
                </label>
                <input
                  id="ih-fecha-final"
                  type="date"
                  value={fechaFinal}
                  onChange={(e) => setFechaFinal(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-100"
                />
              </div>
              <div className="block">
                <label
                  htmlFor="ih-mes"
                  className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600"
                >
                  Mes
                </label>
                <select
                  id="ih-mes"
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
              </div>
            </div>

            {canLunesScheduleSync ? (
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
                <label
                  className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-slate-200/90 bg-slate-50/90 px-2.5 py-1.5 text-[12px] text-slate-600 transition-colors hover:bg-slate-50"
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
                <button
                  type="button"
                  onClick={() => setLunesPresetsModalOpen(true)}
                  className="rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-[12px] font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
                >
                  Horarios predeterminados
                </button>
                <p className="basis-full text-[11px] text-slate-500">
                  Usa la casilla <span className="font-semibold">Horario</span>{" "}
                  en cada fila para aplicar un predeterminado solo a ese
                  empleado.
                </p>
              </div>
            ) : null}
          </StepperStep>
        </Stepper>

        {canLunesScheduleSync ? (
          <>
            {lunesPresetsModalOpen ? (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:hidden"
                role="presentation"
                onClick={() => setLunesPresetsModalOpen(false)}
              >
                <div
                  ref={lunesModalRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="lunes-presets-modal-title"
                  className="max-h-[min(90vh,40rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
                    <h2
                      id="lunes-presets-modal-title"
                      className="pr-2 text-base font-bold text-slate-900"
                    >
                      Horarios predeterminados
                    </h2>
                    <button
                      type="button"
                      onClick={() => setLunesPresetsModalOpen(false)}
                      className="shrink-0 rounded-md px-2 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                      aria-label="Cerrar"
                    >
                      Cerrar
                    </button>
                  </div>
                  <p className="mt-3 text-[11px] leading-snug text-slate-600">
                    {canCreateSchedulePresets
                      ? "Los 3 horarios originales no se pueden eliminar; puedes editar su nombre y horas. Usa el boton + para agregar mas y la × para eliminar los que crees. Se guardan en este navegador."
                      : `${lunesPresetDefinitions.length} horarios disponibles. Puedes cambiar nombre y horas; se guardan en este navegador.`}
                  </p>
                  <div className="mt-3 space-y-2">
                    {lunesPresetDefinitions.map((p) => {
                      const isBuiltin = isBuiltinLunesPresetKey(p.key);
                      return (
                        <div
                          key={p.key}
                          className="flex flex-wrap items-end gap-2 border-b border-slate-200/70 pb-2 last:border-0 last:pb-0 sm:gap-3"
                        >
                          <label className="min-w-40 flex-1">
                            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              Nombre
                            </span>
                            <input
                              type="text"
                              value={p.label}
                              onChange={(e) =>
                                updateLunesPresetField(
                                  p.key,
                                  "label",
                                  e.target.value,
                                )
                              }
                              className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-900"
                            />
                          </label>
                          <label>
                            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              Entrada (1.ª HE)
                            </span>
                            <input
                              type="time"
                              value={p.he1}
                              step={60}
                              onChange={(e) =>
                                updateLunesPresetField(
                                  p.key,
                                  "he1",
                                  e.target.value,
                                )
                              }
                              className="w-29 rounded border border-slate-200 bg-white px-2 py-1 text-[12px] tabular-nums"
                            />
                          </label>
                          <label>
                            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              Salida (2.ª HS)
                            </span>
                            <input
                              type="time"
                              value={p.hs2}
                              step={60}
                              onChange={(e) =>
                                updateLunesPresetField(
                                  p.key,
                                  "hs2",
                                  e.target.value,
                                )
                              }
                              className="w-29 rounded border border-slate-200 bg-white px-2 py-1 text-[12px] tabular-nums"
                            />
                          </label>
                          {canCreateSchedulePresets && !isBuiltin ? (
                            <button
                              type="button"
                              onClick={() => removeLunesPreset(p.key)}
                              aria-label={`Eliminar horario ${p.label}`}
                              title="Eliminar este horario"
                              className="flex h-8 w-8 shrink-0 items-center justify-center self-end rounded-md border border-red-200 bg-white text-red-600 transition hover:bg-red-50"
                            >
                              ×
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  {canCreateSchedulePresets ? (
                    <div className="mt-3 flex justify-start">
                      <button
                        type="button"
                        onClick={addCustomLunesPreset}
                        className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-[12px] font-semibold text-sky-800 transition hover:bg-sky-100"
                        aria-label="Agregar nuevo horario predeterminado"
                      >
                        <span aria-hidden className="text-base leading-none">
                          +
                        </span>
                        Agregar horario
                      </button>
                    </div>
                  ) : null}
                  <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      onClick={() => setLunesPresetsModalOpen(false)}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-[12px] font-semibold text-slate-800 hover:bg-slate-100"
                    >
                      Listo
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {(() => {
          const toast: {
            tone: "error" | "warning" | "success" | "info";
            message: string;
            onDismiss: () => void;
          } | null = saveError
            ? {
                tone: "error",
                message: saveError,
                onDismiss: () => setSaveError(null),
              }
            : employeeDuplicateError
              ? {
                  tone: "warning",
                  message: `Fila ${employeeDuplicateError.rowIndex + 1}: ${employeeDuplicateError.message}`,
                  onDismiss: () => setEmployeeDuplicateError(null),
                }
              : saveSuccess
                ? {
                    tone: "success",
                    message: saveSuccess,
                    onDismiss: () => setSaveSuccess(null),
                  }
                : draftMessage
                  ? {
                      tone: "info",
                      message: draftMessage,
                      onDismiss: () => setDraftMessage(null),
                    }
                  : null;
          if (!toast) return null;
          const toneClasses: Record<typeof toast.tone, string> = {
            error: "border-rose-200 bg-rose-50 text-rose-800",
            warning: "border-amber-200 bg-amber-50 text-amber-900",
            success: "border-emerald-200 bg-emerald-50 text-emerald-800",
            info: "border-sky-200 bg-sky-50 text-sky-800",
          };
          return (
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none fixed inset-x-4 bottom-4 z-40 flex justify-end sm:inset-x-auto sm:right-6 print:hidden"
            >
              <div
                className={`pointer-events-auto flex max-w-md items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-medium shadow-[0_18px_40px_-20px_rgba(15,23,42,0.35)] ${toneClasses[toast.tone]}`}
              >
                <p className="flex-1 leading-snug">{toast.message}</p>
                <button
                  type="button"
                  onClick={toast.onDismiss}
                  aria-label="Cerrar notificacion"
                  className="-mt-0.5 -mr-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-current/70 transition-colors hover:bg-black/5"
                >
                  <span aria-hidden className="text-base leading-none">
                    ×
                  </span>
                </button>
              </div>
            </div>
          );
        })()}

        <Stepper className="mt-5">
        <StepperStep
          index={2}
          title="Detalle"
          description="Empleados y horarios por dia"
          isCompleted={rows.some((r) => r.nombre.trim().length > 0)}
          isOpen={openSteps.detalle}
          onToggle={() => toggleStep("detalle")}
          summary={
            <span>
              {rows.filter((r) => r.nombre.trim().length > 0).length} empleado
              {rows.filter((r) => r.nombre.trim().length > 0).length === 1
                ? ""
                : "s"}{" "}
              cargado(s)
            </span>
          }
        >
        <div className="hidden print:block">
          <PlanillaPreview
            rows={rows}
            sede={sede}
            seccion={seccion}
            fechaInicial={fechaInicial}
            fechaFinal={fechaFinal}
            mes={mes}
            dayNumbersByKey={dayNumbersByKey}
            mode="print"
          />
        </div>

        <div
          className={`mt-5 max-h-[calc(100vh-200px)] overflow-auto rounded-2xl ${SCHEDULE_OUTER_BORDER_CLASS} print:hidden`}
        >
          <table className="planilla-print-table table-fixed w-max max-w-none border-collapse text-[12px] print:min-w-0 print:w-full print:max-w-none print:text-[8px]">
            <colgroup>
              <col style={{ width: COL_W_NUM }} />
              <col style={{ width: COL_W_NAME }} />
              {canLunesScheduleSync ? (
                <col style={lunesPresetColumnStyle} />
              ) : null}
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
              <tr ref={theadRow1Ref} className="bg-slate-100 text-slate-700">
                <th
                  className={`${SCHEDULE_CELL_BORDER_CLASS} sticky left-0 top-0 z-30 bg-slate-100 px-2 py-2 text-center print:static print:bg-slate-100`}
                >
                  #
                </th>
                <th
                  className={`${SCHEDULE_CELL_BORDER_CLASS} sticky left-11 top-0 z-30 bg-slate-100 px-2 py-2 text-left print:static print:bg-slate-100 print:w-35`}
                >
                  Nombre
                </th>
                {canLunesScheduleSync ? (
                  <th
                    className={`${SCHEDULE_CELL_BORDER_CLASS} sticky top-0 z-20 bg-slate-100 px-2 py-2 text-left whitespace-nowrap print:static print:hidden`}
                    style={lunesPresetColumnStyle}
                  >
                    Horario
                  </th>
                ) : null}
                {DAY_ORDER.map((day) => (
                  <th
                    key={day}
                    colSpan={4}
                    className={`${SCHEDULE_CELL_BORDER_CLASS} sticky top-0 z-20 bg-slate-100 px-2 py-2 text-center uppercase print:static ${dayStartDividerClass(day)}`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <span>{day}</span>
                      <span className="rounded-md bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                        {dayNumbersByKey[day] ?? "--"}
                      </span>
                    </div>
                  </th>
                ))}
                <th
                  className={`${SCHEDULE_CELL_BORDER_CLASS} sticky top-0 z-20 bg-slate-100 px-2 py-2 text-left print:static print:w-35`}
                >
                  Firma empleado
                </th>
              </tr>
              <tr className="bg-white text-[11px] font-semibold text-slate-500">
                <th
                  style={{ top: theadRow1Height - 1 }}
                  className={`${SCHEDULE_CELL_BORDER_CLASS} sticky left-0 z-30 bg-white px-2 py-2 print:static`}
                />
                <th
                  style={{ top: theadRow1Height - 1 }}
                  className={`${SCHEDULE_CELL_BORDER_CLASS} sticky left-11 z-30 bg-white px-2 py-2 print:static`}
                />
                {canLunesScheduleSync ? (
                  <th
                    style={{
                      ...lunesPresetColumnStyle,
                      top: theadRow1Height - 1,
                    }}
                    className={`${SCHEDULE_CELL_BORDER_CLASS} sticky z-20 bg-white px-2 py-2 print:static print:hidden`}
                  />
                ) : null}
                {DAY_ORDER.flatMap((day) =>
                  (["he1", "hs1", "he2", "hs2"] as const).map((field) => (
                    <th
                      key={`${day}-${field}`}
                      style={{ top: theadRow1Height - 1 }}
                      className={[
                        TIME_SLOT_TH_CLASS,
                        "sticky z-20 bg-white print:static",
                        field === "he1" ? dayStartDividerClass(day) : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {field === "he1" || field === "he2" ? "HE" : "HS"}
                    </th>
                  )),
                )}
                <th
                  style={{ top: theadRow1Height - 1 }}
                  className={`${SCHEDULE_CELL_BORDER_CLASS} sticky z-20 bg-white px-2 py-2 print:static`}
                />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <RowScheduleRow
                  key={`row-${rowIndex}`}
                  row={row}
                  rowIndex={rowIndex}
                  employeeListId={`ingresar-horarios-emp-${rowIndex}`}
                  canLunesPresetPerRow={canLunesScheduleSync}
                  lunesSyncActive={lunesSyncActive}
                  duplicateMessage={
                    employeeDuplicateError?.rowIndex === rowIndex
                      ? employeeDuplicateError.message
                      : null
                  }
                  onRowField={updateRowField}
                  onRowDayField={updateRowDayField}
                  onDescanso={updateDescanso}
                  onApplyLunesPreset={applyLunesPresetToRow}
                  selectedLunesPreset={
                    lunesPresetChoiceByRow[rowIndex] ?? ""
                  }
                  onClearLunesPresetChoice={clearLunesPresetChoiceForRow}
                  schedulePresets={lunesPresetDefinitions}
                  presetSelectColStyle={lunesPresetColumnStyle}
                />
              ))}
            </tbody>
          </table>
          {rows.map((_, rowIndex) => (
            <datalist
              key={`dl-${rowIndex}`}
              id={`ingresar-horarios-emp-${rowIndex}`}
            >
              {(employeeNamesPerRow[rowIndex] ?? []).map((employeeName) => (
                <option
                  key={`${rowIndex}-${employeeName}`}
                  value={employeeName}
                />
              ))}
            </datalist>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-center gap-2 print:hidden">
          <button
            type="button"
            onClick={handleRemoveLastRow}
            disabled={!canRemoveLastRow}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-rose-300 bg-rose-50 text-lg font-bold leading-none text-rose-700 transition-all hover:border-rose-400 hover:bg-rose-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:hover:border-slate-200 disabled:hover:bg-slate-50"
            title={
              canRemoveLastRow
                ? `Quitar fila ${rows.length}`
                : "Debe quedar al menos 1 fila"
            }
            aria-label="Quitar la ultima fila agregada"
          >
            −
          </button>
          <button
            type="button"
            onClick={handleAddRows}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-violet-300 bg-violet-50 text-lg font-bold leading-none text-violet-700 transition-all hover:border-violet-400 hover:bg-violet-100"
            title="Agregar 1 fila"
            aria-label="Agregar 1 fila"
          >
            +
          </button>
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
        </StepperStep>
        </Stepper>
        <style jsx global>{`
          #planilla-print table th.day-group-start,
          #planilla-print table td.day-group-start {
            border-left-width: 2px;
            border-left-color: rgb(30 41 59);
          }
          /* El encabezado de impresion solo se muestra al imprimir. */
          .planilla-print-portal-header {
            display: none;
          }
          @media print {
            /* Eliminamos los encabezados/pies por defecto del navegador
               (titulo, fecha/hora, URL/IP) anulando los margenes superior
               y laterales. Reservamos un margen inferior pequeño y
               declaramos las cajas @bottom-* para colocar nuestro contador
               "Pagina X de Y" en la esquina inferior derecha y bloquear que
               el navegador inserte algo en bottom-left/bottom-center. */
            @page {
              size: A4 landscape;
              margin: 0 0 10mm 0;
              @bottom-left {
                content: "";
              }
              @bottom-center {
                content: "";
              }
              @bottom-right {
                content: "Pagina " counter(page) " de " counter(pages);
                font-family: "Helvetica Neue", Arial, sans-serif;
                font-size: 8pt;
                color: #475569;
                padding: 0 6mm 3mm 0;
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
              /* padding-top mas amplio para dejar libre la franja superior
                 donde se ubica el encabezado fijo "Portal UAID". */
              padding: 12mm 6mm 4mm 6mm !important;
              box-sizing: border-box !important;
            }
            /* Encabezado de impresion: posicion fija sobre la hoja para que
               se repita en cada pagina (comportamiento estandar de
               position: fixed al imprimir). Va dentro de #planilla-print
               para conservar visibility:visible bajo el filtro de impresion. */
            .planilla-print-portal-header {
              display: flex !important;
              position: fixed !important;
              top: 0 !important;
              left: 0 !important;
              right: 0 !important;
              align-items: center !important;
              justify-content: center !important;
              gap: 2mm !important;
              height: 10mm !important;
              color: #0f172a !important;
              background: white !important;
              z-index: 9999 !important;
            }
            .planilla-print-portal-icon {
              width: 5mm !important;
              height: 5mm !important;
              color: #6d28d9 !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            .planilla-print-portal-name {
              font-family: "Helvetica Neue", Arial, sans-serif !important;
              font-size: 11pt !important;
              font-weight: 700 !important;
              letter-spacing: 0.4px !important;
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
              color: #0f172a !important;
            }
            .planilla-print-table th,
            .planilla-print-table td {
              color: #0f172a !important;
              border-color: #0f172a !important;
              background: #ffffff !important;
            }
            /* Separador vertical entre dias (mas grueso y oscuro que HE/HS internos) */
            #planilla-print table th.day-group-start,
            #planilla-print table td.day-group-start {
              border-left-width: 3px !important;
              border-left-color: #020617 !important;
            }
            /* Anchos fijos en rem obligan un ancho mínimo enorme y se corta en PDF */
            .planilla-print-table colgroup col {
              width: auto !important;
              min-width: 0 !important;
            }
            input[type="checkbox"] {
              display: none !important;
            }
            #planilla-print .schedule-print-time {
              font-weight: 700 !important;
            }
          }
        `}</style>
      </div>
    </div>
  );
}
