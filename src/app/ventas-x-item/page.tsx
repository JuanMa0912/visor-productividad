"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  Database,
  Download,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  Info,
  Loader2,
  RefreshCcw,
} from "lucide-react";
import { LineChart } from "@mui/x-charts/LineChart";
import { BarChart } from "@mui/x-charts/BarChart";
import * as ExcelJS from "exceljs";
import { toJpeg } from "html-to-image";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import {
  buildDailyTableAllRange,
  buildNumericPivotRange,
  getItemLabel,
  itemsDisplayList,
  prepareDataframe,
  type DailyTableRow,
  type VentasXItemPreparedRow,
  type VentasXItemRawRow,
} from "@/lib/ventas/x-item";
import { AppTopBar } from "@/components/portal/app-top-bar";
import { useProductTour } from "@/lib/ui/product-tour/use-product-tour";
import { TUTORIAL_LOCAL_STORAGE_KEYS, TUTORIAL_STATE_KEYS } from "@/lib/ui/tutorial-keys";
import { VENTAS_X_ITEM_TOUR_ANCHOR } from "@/lib/ui/portal-tours/ventas-x-item-tour-anchors";
import { VENTAS_X_ITEM_TOUR_STEPS } from "@/lib/ui/portal-tours/ventas-x-item-tour-steps";
import "driver.js/dist/driver.css";
import "@/lib/ui/product-tour/product-tour.css";

const EMPRESA_LABELS: Record<string, string> = {
  mercamio: "MERCAMIO",
  mtodo: "MERCATODO",
  bogota: "BOGOTA",
};

const HEATMAP_COLORS = [
  "#f8fafc",
  "#fee2e2",
  "#fecaca",
  "#fca5a5",
  "#f87171",
  "#ef4444",
];

const ITEM_DROPDOWN_NO_SEARCH_LIMIT = 120;
const ITEM_DROPDOWN_SEARCH_LIMIT = 250;
const USE_V2_API = process.env.NEXT_PUBLIC_VENTAS_X_ITEM_USE_V2 === "1";
const VENTAS_X_ITEM_API_BASE = USE_V2_API ? "/api/ventas-x-item/v2" : "/api/ventas-x-item";
const LOAD_EMPRESA_OPTIONS = Object.keys(EMPRESA_LABELS).sort();

const toDateKey = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Rango por defecto = mes corrido del ultimo dia con datos (`max`):
 * - end = `max`
 * - start = primer dia del mes de `max`
 *
 * Cuando `max` es el dia 1 de un mes, retrocedemos al ultimo dia del mes anterior
 * para no mostrar un rango de un solo dia (ej: `max = 2026-06-01` -> `2026-05-31` a `2026-06-01`).
 *
 * `start` nunca baja de `min` (la primera fecha con datos en la BD).
 */
const defaultRollingDaysRange = (
  min: string,
  max: string,
): { start: string; end: string } | null => {
  if (!max || !/^\d{4}-\d{2}-\d{2}$/.test(max)) return null;
  const endAtNoon = new Date(`${max}T12:00:00`);
  if (Number.isNaN(endAtNoon.getTime())) return null;

  const formatYMD = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const monthStart = new Date(endAtNoon);
  monthStart.setDate(1);
  let start = formatYMD(monthStart);

  if (start === max) {
    const prev = new Date(endAtNoon);
    prev.setDate(prev.getDate() - 1);
    start = formatYMD(prev);
  }

  if (min && /^\d{4}-\d{2}-\d{2}$/.test(min) && start < min) start = min;
  return { start, end: max };
};

const escapeCsv = (value: string | number) => {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

type ParityCheckResult = {
  ok: boolean;
  v2Rows: number;
  v1Rows: number;
  v2Units: number;
  v1Units: number;
  v2Sales: number;
  v1Sales: number;
  checkedAt: string;
  message?: string;
};

export default function VentasXItemPage() {
  const router = useRouter();
  const { status: authStatus, user } = useRequireAuth();
  const { hasSection, hasSubsection } = usePermissions();
  const ready = authStatus === "authenticated";
  const [loadingDb, setLoadingDb] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<VentasXItemPreparedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [dbMinDate, setDbMinDate] = useState("");
  const [dbMaxDate, setDbMaxDate] = useState("");
  const [empresasCargaSel, setEmpresasCargaSel] = useState<string[]>(
    () => [...LOAD_EMPRESA_OPTIONS],
  );
  const [empresasSel, setEmpresasSel] = useState<string[]>([]);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [loadedDateStart, setLoadedDateStart] = useState("");
  const [loadedDateEnd, setLoadedDateEnd] = useState("");
  const [itemLimit, setItemLimit] = useState(10);
  const [itemsSel, setItemsSel] = useState<string[]>([]);
  const [itemsOrder, setItemsOrder] = useState<string[]>([]);
  const [itemSearch, setItemSearch] = useState("");
  const [itemsDropdownOpen, setItemsDropdownOpen] = useState(false);
  const [summaryRows, setSummaryRows] = useState<VentasXItemPreparedRow[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [exportingJpg, setExportingJpg] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  /** Nodo oculto fuera de pantalla que renderiza la versión "bonita" de la
   * tabla; lo capturamos con html-to-image para que el JPG salga con look
   * Excel sin alterar la tabla visible de la app. */
  const jpgStageRef = useRef<HTMLDivElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [parityLoading, setParityLoading] = useState(false);
  const [parityResult, setParityResult] = useState<ParityCheckResult | null>(null);
  const itemsDropdownRef = useRef<HTMLDivElement | null>(null);
  /** Evita solapar dos cargas desde BD (botón + carga automática). */
  const dbLoadInflightRef = useRef(false);
  const pendingDeepLinkItemRef = useRef<string | null>(null);
  const deepLinkInitRef = useRef(false);
  /** Garantiza que `onLoadMeta` se llame una sola vez por montaje (min/max globales son estables). */
  const metaLoadedRef = useRef(false);

  const { startTour: startVentasXItemTour } = useProductTour({
    localStorageKey: TUTORIAL_LOCAL_STORAGE_KEYS.ventasXItem,
    stateKey: TUTORIAL_STATE_KEYS.ventasXItem,
    steps: VENTAS_X_ITEM_TOUR_STEPS,
    theme: "venta",
    userId: user?.id,
    ready,
    contentReady: Boolean(dbMinDate || dbMaxDate || !loadingDb),
  });

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    if (!hasSection("venta") || !hasSubsection("ventas-x-item")) {
      router.replace("/secciones");
    }
  }, [authStatus, hasSection, hasSubsection, router]);

  useEffect(() => {
    if (deepLinkInitRef.current) return;
    deepLinkInitRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const start = params.get("start")?.trim();
    const end = params.get("end")?.trim();
    const item = params.get("item")?.trim();
    if (start) setDateStart(start);
    if (end) setDateEnd(end);
    if (item) pendingDeepLinkItemRef.current = item;
  }, []);

  useEffect(() => {
    if (!itemsDropdownOpen) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (itemsDropdownRef.current?.contains(target)) return;
      setItemsDropdownOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setItemsDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [itemsDropdownOpen]);

  // Cierra el menú "Exportar" al hacer click afuera o al presionar Esc.
  useEffect(() => {
    if (!exportMenuOpen) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (exportMenuRef.current?.contains(target)) return;
      setExportMenuOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExportMenuOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [exportMenuOpen]);

  const validRows = useMemo(
    () => rows.filter((row) => row.fecha !== null),
    [rows],
  );
  const minDateKey = useMemo(() => {
    if (dbMinDate) return dbMinDate;
    if (validRows.length === 0) return "";
    return toDateKey(
      validRows.reduce(
        (min, row) => (row.fecha!.getTime() < min.getTime() ? row.fecha! : min),
        validRows[0].fecha!,
      ),
    );
  }, [dbMinDate, validRows]);
  const maxDateKey = useMemo(() => {
    if (dbMaxDate) return dbMaxDate;
    if (validRows.length === 0) return "";
    return toDateKey(
      validRows.reduce(
        (max, row) => (row.fecha!.getTime() > max.getTime() ? row.fecha! : max),
        validRows[0].fecha!,
      ),
    );
  }, [dbMaxDate, validRows]);

  const empresasDisponibles = useMemo(
    () => Array.from(new Set(rows.map((row) => row.empresa_norm))).sort(),
    [rows],
  );
  const singleEmpresaLoaded = empresasDisponibles.length === 1;
  const empresasVisibles = empresasSel.length > 0 ? empresasSel : empresasDisponibles;

  const rowsEmpresa = useMemo(
    () => rows.filter((row) => empresasVisibles.includes(row.empresa_norm)),
    [empresasVisibles, rows],
  );

  const activeRangeStart = loadedDateStart || dateStart;
  const activeRangeEnd = loadedDateEnd || dateEnd;

  const rowsEmpresaFecha = useMemo(
    () =>
      rowsEmpresa.filter((row) => {
        if (!row.fecha || !activeRangeStart || !activeRangeEnd) return false;
        const key = toDateKey(row.fecha);
        return key >= activeRangeStart && key <= activeRangeEnd;
      }),
    [activeRangeEnd, activeRangeStart, rowsEmpresa],
  );

  const itemOptions = useMemo(() => {
    const source = rowsEmpresaFecha.length > 0 ? rowsEmpresaFecha : rowsEmpresa;
    return itemsDisplayList(source);
  }, [rowsEmpresa, rowsEmpresaFecha]);

  useEffect(() => {
    const itemId = pendingDeepLinkItemRef.current;
    if (!itemId || rows.length === 0) return;
    const normalized = itemId.trim();
    const match = itemOptions.find(
      (opt) =>
        opt.startsWith(`${normalized} - `) ||
        opt.split(" - ", 2)[0]?.trim() === normalized,
    );
    const selection = match ?? normalized;
    setItemsSel([selection]);
    setItemsOrder([selection]);
    pendingDeepLinkItemRef.current = null;
  }, [itemOptions, rows.length]);

  const deferredItemSearch = useDeferredValue(itemSearch);
  const selectedItemSet = useMemo(() => new Set(itemsSel), [itemsSel]);

  const itemDropdownState = useMemo(() => {
    const term = deferredItemSearch.trim().toLowerCase();
    if (!term) {
      const selected = itemOptions.filter((item) => selectedItemSet.has(item));
      const others = itemOptions.filter((item) => !selectedItemSet.has(item));
      const limited = others.slice(0, ITEM_DROPDOWN_NO_SEARCH_LIMIT);
      return {
        totalMatches: itemOptions.length,
        visibleItems: [...selected, ...limited],
        truncated: others.length > ITEM_DROPDOWN_NO_SEARCH_LIMIT,
      };
    }

    const matched = itemOptions.filter((item) => item.toLowerCase().includes(term));
    const selectedMatched = matched.filter((item) => selectedItemSet.has(item));
    const othersMatched = matched
      .filter((item) => !selectedItemSet.has(item))
      .slice(0, ITEM_DROPDOWN_SEARCH_LIMIT);

    return {
      totalMatches: matched.length,
      visibleItems: [...selectedMatched, ...othersMatched],
      truncated: matched.length - selectedMatched.length > ITEM_DROPDOWN_SEARCH_LIMIT,
    };
  }, [deferredItemSearch, itemOptions, selectedItemSet]);

  useEffect(() => {
    setItemsSel((prev) => prev.filter((item) => itemOptions.includes(item)));
    setItemsOrder((prev) => prev.filter((item) => itemOptions.includes(item)));
  }, [itemOptions]);

  const title = useMemo(() => {
    if (itemsOrder.length === 0) return "Tabla diaria consolidada (unidades)";
    return `Tabla diaria consolidada - ${itemsOrder.join(" | ")} (unidades)`;
  }, [itemsOrder]);

  const itemFilterMatcher = useMemo(() => {
    if (itemsSel.length === 0) {
      return () => false;
    }
    const ids = new Set<string>();
    const exactLabels = new Set<string>();
    const descNeedles: string[] = [];

    itemsSel.forEach((item) => {
      const raw = String(item);
      if (raw.includes(" - ")) {
        exactLabels.add(raw.trim());
      } else if (/^\d+$/.test(raw.trim())) {
        ids.add(raw.trim());
      } else {
        descNeedles.push(raw.toLowerCase().trim());
      }
    });

    return (row: VentasXItemPreparedRow) => {
      const label = getItemLabel(row.id_item, row.descripcion);
      const byExactLabel = exactLabels.size > 0 && exactLabels.has(label);
      const byId = ids.size > 0 && ids.has(String(row.id_item));
      const desc = row.descripcion.toLowerCase();
      const byDesc =
        descNeedles.length > 0 && descNeedles.some((needle) => desc.includes(needle));
      return byExactLabel || byId || byDesc;
    };
  }, [itemsSel]);

  const rowsFilteredByItems = useMemo(
    () => rowsEmpresaFecha.filter(itemFilterMatcher),
    [itemFilterMatcher, rowsEmpresaFecha],
  );
  const analysisRows = itemsSel.length > 0 ? summaryRows : rowsFilteredByItems;

  useEffect(() => {
    if (itemsSel.length === 0 || !activeRangeStart || !activeRangeEnd) {
      setSummaryRows([]);
      setSummaryLoading(false);
      return;
    }

    const itemIds = Array.from(
      new Set(
        itemsSel
          .map((item) => String(item).split(" - ", 2)[0]?.trim() ?? "")
          .filter(Boolean),
      ),
    );
    if (itemIds.length === 0) {
      setSummaryRows([]);
      setSummaryLoading(false);
      return;
    }

    const controller = new AbortController();
    setSummaryLoading(true);

    const loadSummary = async () => {
      try {
        const params = new URLSearchParams({
          mode: "summary",
          start: activeRangeStart,
          end: activeRangeEnd,
        });
        params.set("empresa", empresasVisibles.join(","));
        params.set("itemIds", itemIds.join(","));

        const response = await fetch(`${VENTAS_X_ITEM_API_BASE}?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          rows?: VentasXItemRawRow[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "No se pudo cargar el resumen del ítem.");
        }
        setSummaryRows(prepareDataframe(payload.rows ?? []));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSummaryLoading(false);
      }
    };

    void loadSummary();

    return () => controller.abort();
  }, [activeRangeEnd, activeRangeStart, empresasVisibles, itemsSel]);


  const tableRows = useMemo<DailyTableRow[]>(() => {
    if (!activeRangeStart || !activeRangeEnd) return [];
    const start = new Date(`${activeRangeStart}T00:00:00Z`);
    const end = new Date(`${activeRangeEnd}T00:00:00Z`);
    return buildDailyTableAllRange(analysisRows, start, end);
  }, [activeRangeEnd, activeRangeStart, analysisRows]);
  const tableColumns = useMemo(() => {
    if (tableRows.length === 0) return [] as string[];
    return Object.keys(tableRows[0]);
  }, [tableRows]);

  const pivot = useMemo(() => {
    if (!activeRangeStart || !activeRangeEnd) return null;
    const start = new Date(`${activeRangeStart}T00:00:00Z`);
    const end = new Date(`${activeRangeEnd}T00:00:00Z`);
    return buildNumericPivotRange(analysisRows, start, end);
  }, [activeRangeEnd, activeRangeStart, analysisRows]);

  const lineLabels = useMemo(
    () => (pivot ? pivot.rows.map((row) => toDateKey(row.fecha).slice(5)) : []),
    [pivot],
  );
  const lineData = useMemo(
    () => (pivot ? pivot.rows.map((row) => row.values["T. Dia"] ?? 0) : []),
    [pivot],
  );
  const sedeSeries = useMemo(() => {
    if (!pivot) return [] as Array<{ label: string; data: number[] }>;
    const sedes = pivot.columns.filter((column) => column !== "T. Dia");
    return sedes.map((sede) => ({
      label: sede,
      data: pivot.rows.map((row) => row.values[sede] ?? 0),
    }));
  }, [pivot]);
  const acumuladoSede = useMemo(() => {
    if (!pivot) return [] as Array<{ sede: string; unidades: number }>;
    return pivot.columns
      .filter((column) => column !== "T. Dia")
      .map((sede) => ({
        sede,
        unidades: pivot.rows.reduce((sum, row) => sum + (row.values[sede] ?? 0), 0),
      }))
      .sort((a, b) => b.unidades - a.unidades);
  }, [pivot]);
  const heatMax = useMemo(
    () => Math.max(1, ...sedeSeries.flatMap((series) => series.data)),
    [sedeSeries],
  );


  const toggleItem = (item: string) => {
    setItemsSel((prev) => {
      const exists = prev.includes(item);
      if (exists) return prev.filter((v) => v !== item);
      if (prev.length >= itemLimit) return prev;
      return [...prev, item];
    });
    setItemsOrder((prev) => {
      if (prev.includes(item)) return prev.filter((v) => v !== item);
      if (itemsSel.length >= itemLimit) return prev;
      return [...prev, item];
    });
  };

  const sumPreparedRows = (inputRows: VentasXItemPreparedRow[]) =>
    inputRows.reduce(
      (acc, row) => ({
        units: acc.units + (row.und_dia ?? 0),
        sales: acc.sales + (row.venta_sin_impuesto_dia ?? 0),
      }),
      { units: 0, sales: 0 },
    );

  const onLoadMeta = useCallback(async (empresasObjetivo: string[] = empresasCargaSel) => {
    setError(null);
    try {
      const params = new URLSearchParams({ mode: "meta" });
      if (empresasObjetivo.length > 0) {
        params.set("empresa", empresasObjetivo.join(","));
      }
      const response = await fetch(`${VENTAS_X_ITEM_API_BASE}?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        minDate?: string | null;
        maxDate?: string | null;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "No se pudo cargar metadatos de fechas.");
      }
      const min = payload.minDate ?? "";
      const max = payload.maxDate ?? "";
      setDbMinDate(min);
      setDbMaxDate(max);
      setDateStart((prev) => {
        if (!prev) {
          const rolling = defaultRollingDaysRange(min, max);
          if (rolling) return rolling.start;
          return min;
        }
        if (min && prev < min) return min;
        if (max && prev > max) return max;
        return prev;
      });
      setDateEnd((prev) => {
        if (!prev) {
          const rolling = defaultRollingDaysRange(min, max);
          if (rolling) return rolling.end;
          return max;
        }
        if (min && prev < min) return min;
        if (max && prev > max) return max;
        return prev;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [empresasCargaSel]);

  const onLoadFromDb = async () => {
    setError(null);
    setParityResult(null);
    if (!dateStart || !dateEnd) {
      setError("Debes seleccionar un rango de fechas antes de cargar.");
      return;
    }
    if (empresasCargaSel.length === 0) {
      setError("Debes seleccionar al menos una empresa antes de cargar.");
      return;
    }
    if (dateStart > dateEnd) {
      setError("La fecha inicio no puede ser mayor que la fecha fin.");
      return;
    }
    if ((dbMinDate && dateStart < dbMinDate) || (dbMaxDate && dateEnd > dbMaxDate)) {
      setError(
        `El rango debe estar entre ${dbMinDate || "la fecha minima disponible"} y ${dbMaxDate || "la fecha maxima disponible"}.`,
      );
      return;
    }
    if (dbLoadInflightRef.current) {
      return;
    }
    dbLoadInflightRef.current = true;
    setLoadingDb(true);
    try {
      let loadedStart = dateStart;
      let loadedEnd = dateEnd;

      // Carga agregada (mode=summary): el backend ya agrega por (empresa, fecha, id_co, id_item),
      // por lo que el payload es 5-20x menor que el de filas crudas y no requiere paginacion.
      const params = new URLSearchParams({
        mode: "summary",
        start: dateStart,
        end: dateEnd,
      });
      params.set("empresa", empresasCargaSel.join(","));
      const response = await fetch(
        `${VENTAS_X_ITEM_API_BASE}?${params.toString()}`,
        {
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as {
        rows?: VentasXItemRawRow[];
        range?: { start?: string; end?: string };
        error?: string;
        code?: string;
        requestedStart?: string;
        requestedEnd?: string;
        availableStart?: string | null;
        availableEnd?: string | null;
        missingBoundary?: string;
      };
      if (!response.ok) {
        if (payload.code === "DATE_NOT_FOUND") {
          const availableRange =
            payload.availableStart && payload.availableEnd
              ? ` Rango disponible: ${payload.availableStart} a ${payload.availableEnd}.`
              : "";
          throw new Error(
            `${payload.error ?? "La fecha solicitada no existe en la base de datos."}${availableRange}`,
          );
        }
        throw new Error(payload.error ?? "No se pudo cargar datos desde base de datos.");
      }

      loadedStart = payload.range?.start ?? loadedStart;
      loadedEnd = payload.range?.end ?? loadedEnd;

      const prepared = prepareDataframe(payload.rows ?? []);
      const hasValidDates = prepared.some((row) => row.fecha !== null);
      if (!hasValidDates) throw new Error("La base de datos no tiene fechas válidas.");
      const empresas = Array.from(new Set(prepared.map((row) => row.empresa_norm))).sort();
      setRows(prepared);
      setLoadedDateStart(loadedStart);
      setLoadedDateEnd(loadedEnd);
      const selectedEmpresasLoaded = empresasCargaSel.filter((empresa) =>
        empresas.includes(empresa),
      );
      const empresaLabel = selectedEmpresasLoaded
        .map((empresa) => EMPRESA_LABELS[empresa] ?? empresa.toUpperCase())
        .join(" + ");
      setFileName(`DB: ventas_item_diario (${loadedStart} a ${loadedEnd}) | ${empresaLabel}`);
      setEmpresasSel(
        selectedEmpresasLoaded.length > 0 ? selectedEmpresasLoaded : empresas,
      );
      setSummaryRows([]);
      setSummaryLoading(false);
      setItemsSel([]);
      setItemsOrder([]);
      setItemSearch("");
      setItemsDropdownOpen(false);
      setLastLoadedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDb(false);
      dbLoadInflightRef.current = false;
    }
  };

  const onCheckParity = async () => {
    if (!USE_V2_API) return;
    if (!dateStart || !dateEnd) {
      setError("Carga un rango antes de validar paridad.");
      return;
    }

    setParityLoading(true);
    setError(null);
    try {
      // Comparamos summary v1 vs summary v2 para ser consistentes con la nueva carga (mismo nivel de agregacion).
      const v1Response = await fetch(
        `/api/ventas-x-item?mode=summary&start=${encodeURIComponent(dateStart)}&end=${encodeURIComponent(dateEnd)}&empresa=${encodeURIComponent(empresasCargaSel.join(","))}`,
        { cache: "no-store" },
      );
      const v1Payload = (await v1Response.json()) as {
        rows?: VentasXItemRawRow[];
        error?: string;
      };
      if (!v1Response.ok) {
        throw new Error(v1Payload.error ?? "No se pudo cargar referencia v1.");
      }

      const v1Prepared = prepareDataframe(v1Payload.rows ?? []);
      const v2Totals = sumPreparedRows(rows);
      const v1Totals = sumPreparedRows(v1Prepared);
      const unitsDiff = Math.abs(v2Totals.units - v1Totals.units);
      const salesDiff = Math.abs(v2Totals.sales - v1Totals.sales);
      const v2Rows = rows.length;
      const v1Rows = v1Prepared.length;

      setParityResult({
        ok: v2Rows === v1Rows && unitsDiff < 0.01 && salesDiff < 0.01,
        v2Rows,
        v1Rows,
        v2Units: v2Totals.units,
        v1Units: v1Totals.units,
        v2Sales: v2Totals.sales,
        v1Sales: v1Totals.sales,
        checkedAt: new Date().toISOString(),
      });
    } catch (err) {
      const v2Totals = sumPreparedRows(rows);
      setParityResult({
        ok: false,
        v2Rows: rows.length,
        v1Rows: 0,
        v2Units: v2Totals.units,
        v1Units: 0,
        v2Sales: v2Totals.sales,
        v1Sales: 0,
        checkedAt: new Date().toISOString(),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setParityLoading(false);
    }
  };

  useEffect(() => {
    if (!ready) return;
    if (metaLoadedRef.current) return;
    metaLoadedRef.current = true;
    // min/max globales de la tabla no cambian al ajustar empresasCargaSel,
    // asi que evitamos re-fetch cada vez que el usuario toca chips.
    void onLoadMeta(empresasCargaSel);
  }, [ready, empresasCargaSel, onLoadMeta]);

  /** Cuando el rango y las empresas a cargar están listos, dispara la carga (debounce para no duplicar al cambiar varios filtros seguidos). */
  useEffect(() => {
    if (!ready) return;
    if (!dateStart || !dateEnd || empresasCargaSel.length === 0) return;
    if (dateStart > dateEnd) return;
    if ((dbMinDate && dateStart < dbMinDate) || (dbMaxDate && dateEnd > dbMaxDate)) {
      return;
    }

    const timer = window.setTimeout(() => {
      void onLoadFromDb();
    }, 550);

    return () => window.clearTimeout(timer);
    // onLoadFromDb usa el estado actual; no lo listamos para no re-ejecutar en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, dateStart, dateEnd, empresasCargaSel, dbMinDate, dbMaxDate]);

  const handleDownloadCsv = () => {
    if (tableRows.length === 0 || tableColumns.length === 0) return;
    const lines = [
      tableColumns.map((col) => escapeCsv(col)).join(","),
      ...tableRows.map((row) =>
        tableColumns.map((col) => escapeCsv(row[col] as string | number)).join(","),
      ),
    ];
    const content = "\ufeff" + lines.join("\n");
    downloadBlob(new Blob([content], { type: "text/csv;charset=utf-8;" }), "ventas-x-item.csv");
  };

  const handleDownloadXlsx = async () => {
    if (tableRows.length === 0 || tableColumns.length === 0) return;
    setExportingXlsx(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Tabla Consolidada");
      sheet.views = [{ showGridLines: false }];

      const START_ROW = 6;
      const START_COL = 7; // Columna G
      const totalCols = tableColumns.length;
      const headerRow = START_ROW;
      const dataStartRow = START_ROW + 1;
      const totalRowNumber = dataStartRow + tableRows.length - 1;
      const lastCol = START_COL + totalCols - 1;
      const monthYear = new Intl.DateTimeFormat("es-CO", {
        month: "long",
        year: "numeric",
      })
        .format(new Date())
        .toUpperCase();
      const titleBase = title
        .replace("Tabla diaria consolidada - ", "")
        .replace("(unidades)", "")
        .trim()
        .toUpperCase();
      const titleText = `${monthYear}  VTA POR DIA Y ACUMULADA DE ${titleBase}`;

      sheet.mergeCells(headerRow - 2, START_COL, headerRow - 2, lastCol);
      const titleCell = sheet.getCell(headerRow - 2, START_COL);
      titleCell.value = titleText;
      titleCell.font = { bold: true, color: { argb: "FFFF0000" }, size: 12 };
      titleCell.alignment = { horizontal: "center", vertical: "middle" };

      tableColumns.forEach((column, index) => {
        const cell = sheet.getCell(headerRow, START_COL + index);
        cell.value = column;
        cell.font = { bold: true };
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
        cell.alignment = { horizontal: "center", vertical: "middle" };
      });

      const tDiaIdx = tableColumns.findIndex((col) => col === "T. Dia");
      for (let rowIndex = 0; rowIndex < tableRows.length; rowIndex += 1) {
        const row = tableRows[rowIndex];
        const excelRow = dataStartRow + rowIndex;
        const isTotal = rowIndex === tableRows.length - 1;
        const isSunday =
          !isTotal &&
          typeof row["Fecha"] === "string" &&
          row["Fecha"].includes("/dom");

        tableColumns.forEach((column, columnIndex) => {
          const cell = sheet.getCell(excelRow, START_COL + columnIndex);
          const value = row[column];
          const isFechaCol = columnIndex === 0;
          const isTDiaCol = tDiaIdx >= 0 && columnIndex === tDiaIdx;
          const isNumber = typeof value === "number";

          if (isNumber) {
            cell.value = value;
            // `#,##0.##` siempre dibuja el separador decimal aunque no haya
            // decimales (en es-CO eso pinta la coma colgante "45,"). Para los
            // casos típicos de unidades enteras usamos `#,##0`; sólo dejamos
            // decimales cuando el valor realmente los tiene (ventas por peso).
            cell.numFmt = Number.isInteger(value) ? "#,##0" : "#,##0.##";
          } else {
            cell.value = String(value ?? "");
          }

          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
          };
          cell.alignment = { horizontal: "center", vertical: "middle" };

          if (isTotal) {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFE6F2FF" },
            };
            cell.font = { bold: true };
            return;
          }

          if (isSunday) {
            cell.font = { bold: true, color: { argb: "FFFF0000" } };
          } else if (isTDiaCol) {
            cell.font = { bold: true };
          } else if (isFechaCol) {
            cell.font = {};
          }
        });
      }

      tableColumns.forEach((column, index) => {
        const values = tableRows.map((row) => String(row[column] ?? ""));
        const maxLen = values.reduce(
          (max, val) => (val.length > max ? val.length : max),
          column.length,
        );
        const colWidth = Math.min(40, Math.max(10, maxLen + 2));
        sheet.getColumn(START_COL + index).width = colWidth;
      });

      sheet.getRow(headerRow - 2).height = 20;
      sheet.getRow(headerRow).height = 18;
      for (let row = dataStartRow; row <= totalRowNumber; row += 1) {
        sheet.getRow(row).height = 17;
      }

      const buffer = await workbook.xlsx.writeBuffer();
      downloadBlob(
        new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        "ventas-x-item.xlsx",
      );
    } finally {
      setExportingXlsx(false);
    }
  };

  /**
   * Slug seguro para nombres de archivo derivados del título de la tabla:
   * primer item seleccionado (o "todos") en minúscula, sin tildes ni símbolos.
   */
  const exportFileSlug = useMemo(() => {
    const base = itemsOrder[0] ?? "todos";
    return base
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "ventas";
  }, [itemsOrder]);

  const handleDownloadJpg = useCallback(async () => {
    if (!jpgStageRef.current || tableRows.length === 0) return;
    setExportingJpg(true);
    try {
      // Cuatro frames para asegurar layout completo del stage off-screen.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const node = jpgStageRef.current;
      if (!node) return;
      // Combinamos varias mediciones (cada una mide algo distinto) y sumamos un
      // buffer de seguridad para evitar el recorte de las últimas filas que
      // ocurre cuando html-to-image redondea o cuando hay sub-pixel rendering.
      const rect = node.getBoundingClientRect();
      const width = Math.ceil(
        Math.max(node.scrollWidth, node.offsetWidth, rect.width),
      );
      const height = Math.ceil(
        Math.max(node.scrollHeight, node.offsetHeight, rect.height) + 32,
      );
      const dataUrl = await toJpeg(node, {
        quality: 0.95,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        cacheBust: true,
        width,
        height,
        style: {
          width: `${width}px`,
          height: `${height}px`,
          maxWidth: "none",
          overflow: "visible",
          // Anulamos el offset del stage para que la imagen no quede vacía.
          left: "0",
          top: "0",
          position: "static",
        },
      });

      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `ventas-x-item-${exportFileSlug}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setExportingJpg(false);
    }
  }, [exportFileSlug, tableRows.length]);

  const handleDownloadPdf = useCallback(() => {
    if (tableRows.length === 0 || tableColumns.length === 0) return;
    setExportingPdf(true);

    try {
      const doc = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const itemsLabel = itemsOrder.length === 0 ? "Todos" : itemsOrder.join(" | ");
      const rangeLabel =
        loadedDateStart && loadedDateEnd
          ? loadedDateStart === loadedDateEnd
            ? loadedDateStart
            : `${loadedDateStart} a ${loadedDateEnd}`
          : "";
      const empresasLabel = empresasSel.length === 0
        ? "Todas"
        : empresasSel.map((e) => EMPRESA_LABELS[e] ?? e.toUpperCase()).join(", ");

      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageWidth, 18, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text("Ventas x item - Consolidado diario", 14, 11.5);

      doc.setTextColor(51, 65, 85);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.text(`Ítems: ${itemsLabel}`, 14, 25);
      doc.text(`Empresas: ${empresasLabel}`, 14, 30.5);
      if (rangeLabel) doc.text(`Rango: ${rangeLabel}`, 14, 36);
      doc.text(
        `Generado: ${new Intl.DateTimeFormat("es-CO", {
          dateStyle: "short",
          timeStyle: "short",
        }).format(new Date())}`,
        14,
        41.5,
      );

      const tDiaIdx = tableColumns.findIndex((col) => col === "T. Dia");

      const head = [tableColumns.map((c) => c)];
      // La última fila de tableRows es el acumulado del rango: la pongo en `foot`.
      const dataRows = tableRows.slice(0, Math.max(0, tableRows.length - 1));
      const totalRow = tableRows[tableRows.length - 1];

      const body = dataRows.map((row) =>
        tableColumns.map((col) => {
          const val = row[col];
          return typeof val === "number" ? val.toLocaleString("es-CO") : String(val ?? "");
        }),
      );
      const foot = totalRow
        ? [
            tableColumns.map((col) => {
              const val = totalRow[col];
              return typeof val === "number"
                ? val.toLocaleString("es-CO")
                : String(val ?? "");
            }),
          ]
        : undefined;

      const pdfFontSize = Math.max(
        5.5,
        Math.min(8, 8 - Math.max(0, tableColumns.length - 8) * 0.2),
      );

      autoTable(doc, {
        startY: 46,
        head,
        body,
        foot,
        theme: "grid",
        margin: { left: 10, right: 10, top: 10, bottom: 12 },
        styles: {
          fontSize: pdfFontSize,
          cellPadding: 1.4,
          lineColor: [203, 213, 225],
          lineWidth: 0.1,
          valign: "middle",
          halign: "center",
        },
        headStyles: {
          fillColor: [219, 234, 254],
          textColor: [15, 23, 42],
          fontStyle: "bold",
          halign: "center",
        },
        bodyStyles: {
          textColor: [51, 65, 85],
          halign: "right",
        },
        footStyles: {
          fillColor: [219, 234, 254],
          textColor: [15, 23, 42],
          fontStyle: "bold",
          halign: "right",
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        columnStyles: {
          0: { halign: "left", fontStyle: "bold", cellWidth: 22 },
        },
        didParseCell: (data) => {
          const col = data.column.index;

          // T. Dia en negrita en todo el cuerpo.
          if (data.section === "body" && tDiaIdx >= 0 && col === tDiaIdx) {
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.textColor = [15, 23, 42];
          }

          // Filas con "/dom" en la columna Fecha => toda la fila en rojo y bold.
          if (data.section === "body" && col === 0) {
            const text = String(data.cell.raw ?? "");
            if (text.includes("/dom")) {
              data.cell.styles.textColor = [185, 28, 28];
              data.cell.styles.fontStyle = "bold";
            }
          }
          if (data.section === "body" && col > 0) {
            // `data.row.raw` puede ser RowInput o HTMLTableRowElement; aquí solo
            // pasamos arrays homogéneos (string[]), así que el acceso por índice
            // es seguro tras este cast.
            const rawRow = data.row.raw as unknown as unknown[];
            const fechaCell = String(rawRow[0] ?? "");
            if (fechaCell.includes("/dom")) {
              data.cell.styles.textColor = [185, 28, 28];
              data.cell.styles.fontStyle = "bold";
            }
          }
        },
        showHead: "everyPage",
        horizontalPageBreak: true,
        horizontalPageBreakRepeat: 0,
        didDrawPage: () => {
          const pageHeight = doc.internal.pageSize.getHeight();
          doc.setFontSize(8);
          doc.setTextColor(100, 116, 139);
          doc.text(
            "Visor de Productividad | Ventas x item",
            pageWidth - 14,
            pageHeight - 6,
            { align: "right" },
          );
        },
      });

      doc.save(`ventas-x-item-${exportFileSlug}.pdf`);
    } finally {
      setExportingPdf(false);
    }
  }, [
    empresasSel,
    exportFileSlug,
    itemsOrder,
    loadedDateEnd,
    loadedDateStart,
    tableColumns,
    tableRows,
  ]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-4xl rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <p className="text-sm text-slate-600">Cargando seccion...</p>
        </div>
      </div>
    );
  }

  const rangeLabel = dateStart && dateEnd ? `${dateStart} — ${dateEnd}` : "Sin rango";
  const availableRangeLabel =
    minDateKey && maxDateKey ? `${minDateKey} a ${maxDateKey}` : "no disponible";
  const dataLoadedChip = rows.length > 0;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.12),transparent_55%),linear-gradient(180deg,#f8fafc,#eef4ff)] text-foreground">
      <AppTopBar
        backHref="/venta"
        backLabel="Volver a venta"
        onTourHelp={startVentasXItemTour}
      />
      <div className="px-4 py-8 lg:px-6">
      <div className="mx-auto w-full max-w-7xl">
        <div className="rounded-[30px] border border-slate-200/70 bg-white p-6 shadow-[0_28px_70px_-45px_rgba(15,23,42,0.4)]">
        <div className="relative overflow-hidden rounded-3xl border border-blue-200/70 bg-linear-to-br from-blue-100 via-blue-50/40 to-white p-6 shadow-[0_18px_35px_-30px_rgba(37,99,235,0.28)] before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-blue-500">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_130%_100%_at_10%_-20%,rgba(59,130,246,0.32),transparent_60%)]"
          />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl" id={VENTAS_X_ITEM_TOUR_ANCHOR.intro}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-blue-600">
                Venta
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
                Ventas por ítem(s) x sedes
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Consulta el comportamiento diario por empresa, sede e ítem con el mismo estilo visual del portal.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200/80 bg-blue-50/80 px-3 py-1 text-xs font-semibold text-blue-700">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Rango: {rangeLabel}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200/80 bg-violet-50/80 px-3 py-1 text-xs font-semibold text-violet-700">
                  <Building2 className="h-3.5 w-3.5" />
                  Empresas: {empresasCargaSel.length} cargadas
                </span>
                {dataLoadedChip ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    <Check className="h-3.5 w-3.5" />
                    Datos cargados
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                    <Loader2
                      className={`h-3.5 w-3.5 ${loadingDb ? "animate-spin text-blue-600 motion-reduce:animate-none" : "text-slate-400"}`}
                      aria-hidden
                    />
                    {loadingDb ? "Cargando..." : "Sin datos"}
                  </span>
                )}
              </div>
            </div>

          </div>
        </div>

        <div
          id={VENTAS_X_ITEM_TOUR_ANCHOR.loadDb}
          className="mt-6 rounded-2xl border border-slate-200/70 bg-white px-4 py-4 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.18)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
              <Database className="h-3.5 w-3.5 text-blue-500" aria-hidden />
              Carga desde base de datos
              <span
                className="inline-flex items-center text-slate-400"
                title="Al entrar se eligen todas las empresas y el rango por defecto es el mes corrido. La carga arranca sola; ajusta y repite con Recargar si lo necesitas."
              >
                <Info className="h-3.5 w-3.5" aria-hidden />
              </span>
            </p>
            <p className="text-[11px] font-medium text-slate-500">
              Rango disponible: <span className="font-semibold text-slate-700">{availableRangeLabel}</span>
            </p>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_2fr]">
            <label className="block">
              <span className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <CalendarDays className="h-3 w-3 text-blue-500" />
                Fecha inicio
              </span>
              <input
                type="date"
                value={dateStart}
                min={minDateKey || undefined}
                max={maxDateKey || undefined}
                onChange={(e) => setDateStart(e.target.value)}
                disabled={loadingDb}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
            <label className="block">
              <span className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <CalendarDays className="h-3 w-3 text-blue-500" />
                Fecha fin
              </span>
              <input
                type="date"
                value={dateEnd}
                min={minDateKey || undefined}
                max={maxDateKey || undefined}
                onChange={(e) => setDateEnd(e.target.value)}
                disabled={loadingDb}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
            <div className="block">
              <span className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <Building2 className="h-3 w-3 text-blue-500" />
                Empresa(s) a cargar
              </span>
              <div className="flex h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1">
                {LOAD_EMPRESA_OPTIONS.map((empresa) => {
                  const selected = empresasCargaSel.includes(empresa);
                  return (
                    <button
                      key={empresa}
                      type="button"
                      onClick={() =>
                        setEmpresasCargaSel((prev) =>
                          selected
                            ? prev.filter((value) => value !== empresa)
                            : [...prev, empresa],
                        )
                      }
                      disabled={loadingDb}
                      className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        selected
                          ? "border-blue-300 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      {EMPRESA_LABELS[empresa] ?? empresa.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => void onLoadFromDb()}
              disabled={loadingDb || !dateStart || !dateEnd || empresasCargaSel.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCcw className={`h-3.5 w-3.5 ${loadingDb ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
              {loadingDb ? "Cargando BD..." : "Recargar datos"}
            </button>
            <p className="text-[11px] text-slate-500">
              {fileName
                ? `Fuente actual: ${fileName}`
                : "Ajusta fecha o empresas si quieres otro rango. La carga arranca sola al tener un rango válido."}
            </p>
          </div>

          {(lastLoadedAt || (USE_V2_API && rows.length > 0)) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
              {lastLoadedAt && (
                <span>
                  Última actualización:{" "}
                  {new Intl.DateTimeFormat("es-CO", {
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(new Date(lastLoadedAt))}
                </span>
              )}
              {USE_V2_API && rows.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => void onCheckParity()}
                    disabled={parityLoading || loadingDb}
                    className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {parityLoading ? "Validando..." : "Validar paridad con v1"}
                  </button>
                  {parityResult && (
                    <span className={parityResult.ok ? "text-emerald-700" : "text-amber-700"}>
                      {parityResult.ok
                        ? `Paridad OK · filas ${parityResult.v2Rows}/${parityResult.v1Rows}`
                        : `Paridad con diferencias · filas ${parityResult.v2Rows}/${parityResult.v1Rows}`}
                    </span>
                  )}
                </>
              )}
            </div>
          )}

          {USE_V2_API && parityResult && (
            <p className="mt-1 text-[11px] text-slate-500">
              v2 unidades: {parityResult.v2Units.toFixed(1)} · v1 unidades:{" "}
              {parityResult.v1Units.toFixed(1)} · v2 venta: {parityResult.v2Sales.toFixed(0)} · v1
              venta: {parityResult.v1Sales.toFixed(0)}
              {parityResult.message ? ` · detalle: ${parityResult.message}` : ""}
            </p>
          )}
          {error && (
            <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
        {rows.length > 0 && (
          <>
            <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200/70 bg-slate-50 p-4 md:grid-cols-2">
              <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                Limite de items
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={itemLimit}
                  onChange={(e) =>
                    setItemLimit(Math.max(1, Math.min(10, Number(e.target.value) || 1)))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                />
              </label>
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                  Descargas
                </span>
                <div ref={exportMenuRef} id={VENTAS_X_ITEM_TOUR_ANCHOR.export} className="relative self-start">
                  <button
                    type="button"
                    onClick={() => setExportMenuOpen((open) => !open)}
                    disabled={
                      tableRows.length === 0 ||
                      exportingXlsx ||
                      exportingJpg ||
                      exportingPdf
                    }
                    aria-haspopup="menu"
                    aria-expanded={exportMenuOpen}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden />
                    <span>
                      {exportingXlsx
                        ? "Generando XLSX..."
                        : exportingJpg
                          ? "Generando JPG..."
                          : exportingPdf
                            ? "Generando PDF..."
                            : "Exportar"}
                    </span>
                    <ChevronDown
                      className={`h-3 w-3 transition-transform ${
                        exportMenuOpen ? "rotate-180" : ""
                      }`}
                      aria-hidden
                    />
                  </button>
                  {exportMenuOpen && (
                    <div
                      role="menu"
                      className="absolute left-0 top-full z-30 mt-2 min-w-52 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setExportMenuOpen(false);
                          handleDownloadCsv();
                        }}
                        disabled={tableRows.length === 0}
                        className="group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 transition-colors hover:bg-blue-50 hover:text-blue-700 focus:bg-blue-50 focus:text-blue-700 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-slate-700"
                      >
                        <FileType className="h-4 w-4 text-slate-400 group-hover:text-blue-600 group-focus:text-blue-600" aria-hidden />
                        <span>CSV</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setExportMenuOpen(false);
                          void handleDownloadXlsx();
                        }}
                        disabled={tableRows.length === 0 || exportingXlsx}
                        className="group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 transition-colors hover:bg-blue-50 hover:text-blue-700 focus:bg-blue-50 focus:text-blue-700 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-slate-700"
                      >
                        <FileSpreadsheet className="h-4 w-4 text-slate-400 group-hover:text-blue-600 group-focus:text-blue-600" aria-hidden />
                        <span>Excel (XLSX)</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setExportMenuOpen(false);
                          void handleDownloadJpg();
                        }}
                        disabled={tableRows.length === 0 || exportingJpg}
                        className="group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 transition-colors hover:bg-blue-50 hover:text-blue-700 focus:bg-blue-50 focus:text-blue-700 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-slate-700"
                      >
                        <FileImage className="h-4 w-4 text-slate-400 group-hover:text-blue-600 group-focus:text-blue-600" aria-hidden />
                        <span>Imagen (JPG)</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setExportMenuOpen(false);
                          handleDownloadPdf();
                        }}
                        disabled={tableRows.length === 0 || exportingPdf}
                        className="group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 transition-colors hover:bg-blue-50 hover:text-blue-700 focus:bg-blue-50 focus:text-blue-700 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-slate-700"
                      >
                        <FileText className="h-4 w-4 text-slate-400 group-hover:text-blue-600 group-focus:text-blue-600" aria-hidden />
                        <span>PDF</span>
                      </button>
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">
                  Cambia el rango arriba y luego carga desde BD.
                </p>
              </div>
            </div>

            <div className="mt-3 grid gap-3 rounded-2xl border border-slate-200/70 bg-slate-50 p-4 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                  Empresas
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {empresasDisponibles.map((empresa) => {
                    const checked = empresasSel.includes(empresa);
                    return (
                      <button
                        key={empresa}
                        type="button"
                        onClick={() =>
                          setEmpresasSel((prev) =>
                            checked
                              ? prev.filter((v) => v !== empresa)
                              : [...prev, empresa],
                          )
                        }
                        disabled={singleEmpresaLoaded}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                          checked
                            ? "border-blue-300 bg-blue-100 text-blue-800"
                            : "border-slate-300 bg-white text-slate-700"
                        } ${singleEmpresaLoaded ? "cursor-not-allowed opacity-75" : ""}`}
                      >
                        {EMPRESA_LABELS[empresa] ?? empresa.toUpperCase()}
                      </button>
                    );
                  })}
                </div>
                {singleEmpresaLoaded && (
                  <p className="mt-2 text-[11px] text-slate-500">
                    Solo lectura: el rango se cargo para una unica empresa.
                  </p>
                )}
              </div>
              <div id={VENTAS_X_ITEM_TOUR_ANCHOR.items}>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                  Ítems ({itemsSel.length}/{itemLimit})
                </p>
                <div ref={itemsDropdownRef} className="relative mt-2">
                  <button
                    type="button"
                    onClick={() => setItemsDropdownOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-800"
                  >
                    <span className="truncate">
                      {itemsSel.length === 0
                        ? "Selecciona items..."
                        : `${itemsSel.length} item(s) seleccionado(s)`}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      {itemsDropdownOpen ? "▲" : "▼"}
                    </span>
                  </button>
                  {itemsDropdownOpen && (
                    <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 shadow-lg">
                      <input
                        type="text"
                        value={itemSearch}
                        onChange={(e) => setItemSearch(e.target.value)}
                        placeholder="Buscar por ID o descripcion..."
                        className="mb-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-800"
                      />
                      <div className="mb-2 flex items-center justify-between text-[11px] text-slate-500">
                        <span>
                          {itemDropdownState.visibleItems.length} de {itemDropdownState.totalMatches} resultados
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setItemsSel([]);
                            setItemsOrder([]);
                          }}
                          className="font-semibold text-blue-700"
                        >
                          Limpiar
                        </button>
                      </div>
                      {itemDropdownState.truncated && (
                        <p className="mb-2 px-1 text-[11px] text-amber-700">
                          Mostrando una parte de resultados. Escribe mas para acotar.
                        </p>
                      )}
                      <div className="max-h-56 overflow-auto rounded-lg border border-slate-200 p-1">
                        {itemDropdownState.visibleItems.map((item) => {
                          const checked = itemsSel.includes(item);
                          const disabled = !checked && itemsSel.length >= itemLimit;
                          return (
                            <label
                              key={item}
                              className={`flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-xs ${
                                disabled ? "opacity-50" : "hover:bg-slate-50"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={disabled}
                                onChange={() => toggleItem(item)}
                                className="mt-0.5"
                              />
                              <span className="leading-4 text-slate-700">{item}</span>
                            </label>
                          );
                        })}
                        {itemDropdownState.totalMatches === 0 && (
                          <p className="px-2 py-2 text-xs text-slate-500">
                            Sin resultados para esa busqueda.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div
              id={VENTAS_X_ITEM_TOUR_ANCHOR.results}
              className="relative mt-4 rounded-2xl border border-slate-200/70 bg-white p-4"
            >
              <h2 className="text-base font-bold text-slate-900">{title}</h2>
              <div
                className={`relative mt-3 ${
                  itemsSel.length > 0 && summaryLoading ? "min-h-56 sm:min-h-72" : ""
                }`}
              >
                <div
                  className={
                    itemsSel.length > 0 &&
                    summaryLoading &&
                    tableRows.length > 0
                      ? "pointer-events-none blur-[2px] opacity-[0.38] transition-[filter,opacity] duration-200"
                      : ""
                  }
                >
                  {tableRows.length === 0 && !(itemsSel.length > 0 && summaryLoading) ? (
                    <p className="text-sm text-slate-600">
                      Selecciona al menos un ítem y un rango válido para ver resultados.
                    </p>
                  ) : null}
                  {tableRows.length > 0 ? (
                    <div className="overflow-auto rounded-xl border border-slate-200">
                      <table className="min-w-full text-xs text-slate-700">
                        <thead className="bg-slate-100">
                          <tr>
                            {tableColumns.map((column) => (
                              <th key={column} className="border-b border-slate-200 px-2 py-2 text-left font-bold">
                                {column}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {tableRows.map((row, index) => {
                            const isTotal = index === tableRows.length - 1;
                            const isSunday =
                              typeof row["Fecha"] === "string" &&
                              row["Fecha"].includes("/dom") &&
                              !isTotal;
                            return (
                              <tr
                                key={`${String(row["Fecha"])}-${index}`}
                                className={isTotal ? "bg-blue-50 font-bold" : ""}
                              >
                                {tableColumns.map((column) => {
                                  const value = row[column];
                                  const tDia = column === "T. Dia";
                                  return (
                                    <td
                                      key={column}
                                      className={`border-b border-slate-100 px-2 py-1.5 ${
                                        isSunday ? "font-bold text-red-600" : ""
                                      } ${tDia ? "font-bold" : ""}`}
                                    >
                                      {String(value)}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>

                {itemsSel.length > 0 && summaryLoading ? (
                  <div
                    className="absolute inset-0 z-10 flex cursor-wait items-center justify-center rounded-xl border border-slate-200/60 bg-slate-50/70 shadow-inner backdrop-blur-md"
                    aria-live="polite"
                    aria-busy="true"
                  >
                    <div className="mx-4 flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-blue-200/80 bg-white/95 px-10 py-8 text-center shadow-[0_20px_50px_-24px_rgba(30,58,138,0.45)]">
                      <Loader2
                        className="h-12 w-12 shrink-0 animate-spin text-blue-600 drop-shadow-sm"
                        aria-hidden
                      />
                      <div>
                        <p className="text-base font-bold text-slate-900">Cargando tabla</p>
                        <p className="mt-1 text-sm text-slate-600">
                          Obteniendo ventas por ítem para el rango seleccionado…
                        </p>
                        <p className="mt-2 text-[11px] leading-snug text-slate-500">
                          Si cambiaste ítems o fechas, la tabla difuminada puede mostrar la
                          selección anterior hasta completar la carga.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {pivot && !summaryLoading && (
              <div
                id={VENTAS_X_ITEM_TOUR_ANCHOR.charts}
                className="mt-4 rounded-2xl border border-slate-200/70 bg-white p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-base font-bold text-slate-900">Gráficas</h3>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="mb-2 text-sm font-semibold text-slate-800">Total por día (T. Dia)</p>
                    <LineChart
                      xAxis={[{ data: lineLabels, scaleType: "point" }]}
                      series={[{ data: lineData, label: "T. Dia" }]}
                      height={280}
                    />
                  </div>

                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="mb-2 text-sm font-semibold text-slate-800">Unidades por sede por día (apilado)</p>
                    <BarChart
                      xAxis={[{ data: lineLabels, scaleType: "band" }]}
                      series={sedeSeries.map((serie) => ({
                        data: serie.data,
                        label: serie.label,
                        stack: "total",
                      }))}
                      height={320}
                    />
                  </div>

                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="mb-2 text-sm font-semibold text-slate-800">Mapa de calor</p>
                    <div className="overflow-auto">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr>
                            <th className="px-2 py-1 text-left">Sede</th>
                            {lineLabels.map((label) => (
                              <th key={label} className="px-1 py-1 text-center">{label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sedeSeries.map((serie) => (
                            <tr key={serie.label}>
                              <td className="whitespace-nowrap px-2 py-1 font-semibold text-slate-700">
                                {serie.label}
                              </td>
                              {serie.data.map((value, idx) => {
                                const bucket = Math.min(
                                  HEATMAP_COLORS.length - 1,
                                  Math.floor((value / heatMax) * (HEATMAP_COLORS.length - 1)),
                                );
                                return (
                                  <td
                                    key={`${serie.label}-${idx}`}
                                    className="px-1 py-1 text-center text-[10px]"
                                    style={{ backgroundColor: HEATMAP_COLORS[bucket] }}
                                    title={`${serie.label} ${lineLabels[idx]}: ${value}`}
                                  >
                                    {value === 0 ? "-" : value.toFixed(1)}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="mb-2 text-sm font-semibold text-slate-800">Acumulado del rango por sede</p>
                    <BarChart
                      xAxis={[{ data: acumuladoSede.map((v) => v.sede), scaleType: "band" }]}
                      series={[{ data: acumuladoSede.map((v) => v.unidades), label: "Unidades" }]}
                      height={280}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Stage oculto FUERA de pantalla con la versión "look Excel" de
                la tabla, exclusivo para la captura JPG. Mantiene layout real
                (html-to-image lo necesita) pero no afecta la UI visible.
                `display: inline-block` hace que el fondo blanco y el padding
                se ajusten al ancho de la tabla en vez de extenderse. */}
            {tableRows.length > 0 && (
              <div
                ref={jpgStageRef}
                aria-hidden
                style={{
                  position: "absolute",
                  left: "-10000px",
                  top: 0,
                  pointerEvents: "none",
                  width: "max-content",
                }}
                className="bg-white p-4"
              >
                <table className="border-collapse text-[11px] text-slate-800">
                  <thead>
                    {/* Título + metadatos como una fila de cabecera (colSpan
                        = total de columnas). Esto evita los problemas de
                        medición de <caption> y queda anclado al ancho real de
                        la tabla, wrappeando texto si es necesario. */}
                    <tr>
                      <th
                        colSpan={tableColumns.length}
                        className="border-x border-t-2 border-slate-400 bg-white px-2 pt-2 pb-1.5 text-center"
                      >
                        {/* `max-w` fuerza el wrap del título en varias líneas
                            para que NO sea él quien determine el ancho de la
                            tabla (sólo lo deben hacer las columnas). */}
                        <span className="mx-auto block max-w-[520px] text-[11px] font-bold leading-tight text-red-600">
                          {title.toUpperCase()}
                        </span>
                        {(loadedDateStart || empresasSel.length > 0) && (
                          <span className="mx-auto mt-1 block max-w-[520px] text-[9px] font-medium leading-snug text-slate-600">
                            {loadedDateStart && loadedDateEnd
                              ? loadedDateStart === loadedDateEnd
                                ? `Rango: ${loadedDateStart}`
                                : `Rango: ${loadedDateStart} a ${loadedDateEnd}`
                              : ""}
                            {loadedDateStart && empresasSel.length > 0
                              ? "  ·  "
                              : ""}
                            {empresasSel.length > 0
                              ? `Empresas: ${empresasSel
                                  .map((e) => EMPRESA_LABELS[e] ?? e.toUpperCase())
                                  .join(", ")}`
                              : ""}
                          </span>
                        )}
                      </th>
                    </tr>
                    <tr className="bg-slate-100">
                      {tableColumns.map((column, idx) => {
                        const isFecha = idx === 0;
                        const isTDia = column === "T. Dia";
                        return (
                          <th
                            key={column}
                            className={`border border-slate-400 py-1 text-[10px] font-bold uppercase tracking-tight leading-tight ${
                              isFecha ? "px-1.5 text-left" : "px-1 text-center"
                            } ${
                              isTDia
                                ? "bg-slate-200 text-slate-900"
                                : "text-slate-700"
                            }`}
                          >
                            {column}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row, index) => {
                      const isTotal = index === tableRows.length - 1;
                      const isSunday =
                        typeof row["Fecha"] === "string" &&
                        row["Fecha"].includes("/dom") &&
                        !isTotal;
                      const rowBase = isTotal
                        ? "bg-blue-50 font-bold text-slate-900"
                        : index % 2 === 1
                          ? "bg-slate-50"
                          : "bg-white";
                      return (
                        <tr
                          key={`jpg-${String(row["Fecha"])}-${index}`}
                          className={rowBase}
                        >
                          {tableColumns.map((column, colIdx) => {
                            const value = row[column];
                            const tDia = column === "T. Dia";
                            const isFecha = colIdx === 0;
                            return (
                              <td
                                key={column}
                                className={`border border-slate-300 py-0.5 text-[11px] leading-snug tabular-nums ${
                                  isFecha ? "px-1.5 text-left" : "px-1 text-center"
                                } ${
                                  isSunday ? "font-bold text-red-600" : ""
                                } ${
                                  tDia && !isTotal
                                    ? "bg-slate-50 font-bold text-slate-900"
                                    : ""
                                } ${
                                  isTotal && tDia ? "bg-blue-100 font-bold" : ""
                                } ${isTotal ? "border-t-2 border-t-blue-400" : ""}`}
                              >
                                {String(value)}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        </div>
      </div>
      </div>
    </div>
  );
}
