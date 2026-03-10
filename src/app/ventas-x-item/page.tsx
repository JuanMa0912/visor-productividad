"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LineChart } from "@mui/x-charts/LineChart";
import { BarChart } from "@mui/x-charts/BarChart";
import * as ExcelJS from "exceljs";
import {
  buildDailyTableAllRange,
  buildNumericPivotRange,
  itemsDisplayList,
  prepareDataframe,
  type DailyTableRow,
  type VentasXItemPreparedRow,
  type VentasXItemRawRow,
} from "@/lib/ventas-x-item";

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
type ComparisonMode = "day" | "week" | "month";

const getIsoWeekKey = (date: Date) => {
  const utc = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

const getMonthKey = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

const formatDateShort = (date: Date) =>
  new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);

const getWeekLabel = (date: Date) => {
  const base = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = base.getUTCDay() || 7;
  const monday = new Date(base);
  monday.setUTCDate(base.getUTCDate() - (day - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return `${getIsoWeekKey(base)} (${formatDateShort(monday)} - ${formatDateShort(sunday)})`;
};

const getComparisonKey = (date: Date, mode: ComparisonMode) => {
  if (mode === "day") return toDateKey(date);
  if (mode === "week") return getIsoWeekKey(date);
  return getMonthKey(date);
};

const getComparisonLabel = (date: Date, mode: ComparisonMode) => {
  if (mode === "day") return formatDateShort(date);
  if (mode === "week") return getWeekLabel(date);
  return `${getMonthKey(date)} (${new Intl.DateTimeFormat("es-CO", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)})`;
};

const firstWordsFromOption = (option: string) => {
  const desc = (option.includes(" - ") ? option.split(" - ", 2)[1] : option)
    .trim()
    .replace(/[^A-Za-z0-9ÁÉÍÓÚáéíóúÑñ/ ]+/g, "");
  if (!desc) return "";
  return desc.split(/\s+/).slice(0, 2).join(" ");
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
  const [ready, setReady] = useState(false);
  const [loadingDb, setLoadingDb] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<VentasXItemPreparedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [dbMinDate, setDbMinDate] = useState("");
  const [dbMaxDate, setDbMaxDate] = useState("");
  const [empresasCargaSel, setEmpresasCargaSel] = useState<string[]>([]);
  const [empresasSel, setEmpresasSel] = useState<string[]>([]);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [itemLimit, setItemLimit] = useState(10);
  const [itemsSel, setItemsSel] = useState<string[]>([]);
  const [itemsOrder, setItemsOrder] = useState<string[]>([]);
  const [itemSearch, setItemSearch] = useState("");
  const [itemsDropdownOpen, setItemsDropdownOpen] = useState(false);
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>("day");
  const [comparisonA, setComparisonA] = useState("");
  const [comparisonB, setComparisonB] = useState("");
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [parityLoading, setParityLoading] = useState(false);
  const [parityResult, setParityResult] = useState<ParityCheckResult | null>(null);
  const itemsDropdownRef = useRef<HTMLDivElement | null>(null);

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
          Array.isArray(payload.user?.allowedDashboards) &&
          !payload.user?.allowedDashboards.includes("ventas-x-item")
        ) {
          router.replace("/tableros");
          return;
        }

        if (isMounted) setReady(true);
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
  }, [validRows]);
  const maxDateKey = useMemo(() => {
    if (dbMaxDate) return dbMaxDate;
    if (validRows.length === 0) return "";
    return toDateKey(
      validRows.reduce(
        (max, row) => (row.fecha!.getTime() > max.getTime() ? row.fecha! : max),
        validRows[0].fecha!,
      ),
    );
  }, [validRows]);

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

  const rowsEmpresaFecha = useMemo(
    () =>
      rowsEmpresa.filter((row) => {
        if (!row.fecha || !dateStart || !dateEnd) return false;
        const key = toDateKey(row.fecha);
        return key >= dateStart && key <= dateEnd;
      }),
    [dateEnd, dateStart, rowsEmpresa],
  );

  const itemOptions = useMemo(() => {
    const source = rowsEmpresaFecha.length > 0 ? rowsEmpresaFecha : rowsEmpresa;
    return itemsDisplayList(source);
  }, [rowsEmpresa, rowsEmpresaFecha]);
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
    const words = itemsOrder.map(firstWordsFromOption).filter(Boolean);
    return `Tabla diaria consolidada - ${words.join(" | ")} (unidades)`;
  }, [itemsOrder]);

  const itemFilterMatcher = useMemo(() => {
    if (itemsSel.length === 0) {
      return (_row: VentasXItemPreparedRow) => false;
    }
    const ids = new Set<string>();
    const descNeedles: string[] = [];

    itemsSel.forEach((item) => {
      const raw = String(item);
      if (raw.includes(" - ")) {
        ids.add(raw.split(" - ", 2)[0].trim());
      } else if (/^\d+$/.test(raw.trim())) {
        ids.add(raw.trim());
      } else {
        descNeedles.push(raw.toLowerCase().trim());
      }
    });

    return (row: VentasXItemPreparedRow) => {
      const byId = ids.size > 0 && ids.has(String(row.id_item));
      const desc = row.descripcion.toLowerCase();
      const byDesc =
        descNeedles.length > 0 && descNeedles.some((needle) => desc.includes(needle));
      return byId || byDesc;
    };
  }, [itemsSel]);

  const rowsFilteredByItemsAllDates = useMemo(
    () => rowsEmpresa.filter(itemFilterMatcher),
    [itemFilterMatcher, rowsEmpresa],
  );

  const rowsFilteredByItems = useMemo(
    () => rowsEmpresaFecha.filter(itemFilterMatcher),
    [itemFilterMatcher, rowsEmpresaFecha],
  );

  const comparisonOptions = useMemo(() => {
    const optionMap = new Map<string, string>();
    rowsFilteredByItemsAllDates.forEach((row) => {
      if (!row.fecha) return;
      const key = getComparisonKey(row.fecha, comparisonMode);
      if (!optionMap.has(key)) {
        optionMap.set(key, getComparisonLabel(row.fecha, comparisonMode));
      }
    });
    return Array.from(optionMap.entries())
      .sort((a, b) => (a[0] > b[0] ? -1 : 1))
      .map(([value, label]) => ({ value, label }));
  }, [comparisonMode, rowsFilteredByItemsAllDates]);

  useEffect(() => {
    if (comparisonOptions.length === 0) {
      setComparisonA("");
      setComparisonB("");
      return;
    }

    if (!comparisonA || !comparisonOptions.some((opt) => opt.value === comparisonA)) {
      setComparisonA(comparisonOptions[0].value);
    }
    if (!comparisonB || !comparisonOptions.some((opt) => opt.value === comparisonB)) {
      setComparisonB(comparisonOptions[1]?.value ?? comparisonOptions[0].value);
    }
  }, [comparisonA, comparisonB, comparisonOptions]);

  const comparisonTotals = useMemo(() => {
    const getTotals = (targetKey: string) => {
      if (!targetKey) {
        return { units: 0, sales: 0 };
      }
      return rowsFilteredByItemsAllDates.reduce(
        (acc, row) => {
          if (!row.fecha) return acc;
          if (getComparisonKey(row.fecha, comparisonMode) !== targetKey) return acc;
          return {
            units: acc.units + (row.und_dia ?? 0),
            sales: acc.sales + (row.venta_sin_impuesto_dia ?? 0),
          };
        },
        { units: 0, sales: 0 },
      );
    };

    const current = getTotals(comparisonA);
    const previous = getTotals(comparisonB);
    return {
      current,
      previous,
      unitsDiff: current.units - previous.units,
      salesDiff: current.sales - previous.sales,
      unitsPct:
        previous.units === 0 ? null : ((current.units - previous.units) / previous.units) * 100,
      salesPct:
        previous.sales === 0 ? null : ((current.sales - previous.sales) / previous.sales) * 100,
    };
  }, [comparisonA, comparisonB, comparisonMode, rowsFilteredByItemsAllDates]);

  const comparisonDetails = useMemo(() => {
    const getPeriodStats = (targetKey: string) => {
      const daySet = new Set<string>();
      const sedeSet = new Set<string>();
      const itemSet = new Set<string>();
      const bySede = new Map<string, { units: number; sales: number }>();

      let units = 0;
      let sales = 0;

      rowsFilteredByItemsAllDates.forEach((row) => {
        if (!row.fecha) return;
        if (!targetKey || getComparisonKey(row.fecha, comparisonMode) !== targetKey) return;
        const day = toDateKey(row.fecha);
        daySet.add(day);
        sedeSet.add(row.sede);
        itemSet.add(String(row.id_item));
        units += row.und_dia ?? 0;
        sales += row.venta_sin_impuesto_dia ?? 0;
        const current = bySede.get(row.sede) ?? { units: 0, sales: 0 };
        current.units += row.und_dia ?? 0;
        current.sales += row.venta_sin_impuesto_dia ?? 0;
        bySede.set(row.sede, current);
      });

      const topSede = Array.from(bySede.entries())
        .map(([sede, values]) => ({ sede, ...values }))
        .sort((a, b) => b.units - a.units)[0] ?? null;

      return {
        units,
        sales,
        daysCount: daySet.size,
        sedeCount: sedeSet.size,
        itemCount: itemSet.size,
        avgUnitsPerDay: daySet.size > 0 ? units / daySet.size : 0,
        avgSalesPerDay: daySet.size > 0 ? sales / daySet.size : 0,
        salesPerUnit: units > 0 ? sales / units : null,
        bySede,
        topSede,
      };
    };

    const current = getPeriodStats(comparisonA);
    const previous = getPeriodStats(comparisonB);

    const allSedes = new Set<string>([
      ...Array.from(current.bySede.keys()),
      ...Array.from(previous.bySede.keys()),
    ]);

    const sedeDiffRows = Array.from(allSedes)
      .map((sede) => {
        const c = current.bySede.get(sede) ?? { units: 0, sales: 0 };
        const p = previous.bySede.get(sede) ?? { units: 0, sales: 0 };
        return {
          sede,
          unitsA: c.units,
          unitsB: p.units,
          unitsDiff: c.units - p.units,
          salesA: c.sales,
          salesB: p.sales,
          salesDiff: c.sales - p.sales,
        };
      })
      .sort((a, b) => Math.abs(b.unitsDiff) - Math.abs(a.unitsDiff))
      .slice(0, 6);

    return {
      current,
      previous,
      daysDiff: current.daysCount - previous.daysCount,
      avgUnitsDiff: current.avgUnitsPerDay - previous.avgUnitsPerDay,
      avgSalesDiff: current.avgSalesPerDay - previous.avgSalesPerDay,
      salesPerUnitDiff:
        current.salesPerUnit === null || previous.salesPerUnit === null
          ? null
          : current.salesPerUnit - previous.salesPerUnit,
      sedeDiffRows,
    };
  }, [comparisonA, comparisonB, comparisonMode, rowsFilteredByItemsAllDates]);


  const tableRows = useMemo<DailyTableRow[]>(() => {
    if (!dateStart || !dateEnd) return [];
    const start = new Date(`${dateStart}T00:00:00Z`);
    const end = new Date(`${dateEnd}T00:00:00Z`);
    return buildDailyTableAllRange(rowsFilteredByItems, start, end);
  }, [dateEnd, dateStart, rowsFilteredByItems]);
  const tableColumns = useMemo(() => {
    if (tableRows.length === 0) return [] as string[];
    return Object.keys(tableRows[0]);
  }, [tableRows]);

  const pivot = useMemo(() => {
    if (!dateStart || !dateEnd) return null;
    const start = new Date(`${dateStart}T00:00:00Z`);
    const end = new Date(`${dateEnd}T00:00:00Z`);
    return buildNumericPivotRange(rowsFilteredByItems, start, end);
  }, [dateEnd, dateStart, rowsFilteredByItems]);

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

  const onLoadMeta = async () => {
    setLoadingMeta(true);
    setError(null);
    try {
      const response = await fetch(`${VENTAS_X_ITEM_API_BASE}?mode=meta`, {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMeta(false);
    }
  };

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
    setLoadingDb(true);
    try {
      const params = new URLSearchParams({
        start: dateStart,
        end: dateEnd,
        maxRows: "300000",
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
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "No se pudo cargar datos desde base de datos.");
      }
      const prepared = prepareDataframe(payload.rows ?? []);
      const hasValidDates = prepared.some((row) => row.fecha !== null);
      if (!hasValidDates) throw new Error("La base de datos no tiene fechas válidas.");
      const empresas = Array.from(new Set(prepared.map((row) => row.empresa_norm))).sort();
      setRows(prepared);
      const selectedEmpresasLoaded = empresasCargaSel.filter((empresa) =>
        empresas.includes(empresa),
      );
      const empresaLabel = selectedEmpresasLoaded
        .map((empresa) => EMPRESA_LABELS[empresa] ?? empresa.toUpperCase())
        .join(" + ");
      setFileName(`DB: ventas_item_diario (${dateStart} a ${dateEnd}) | ${empresaLabel}`);
      setEmpresasSel(
        selectedEmpresasLoaded.length > 0 ? selectedEmpresasLoaded : empresas,
      );
      setItemsSel([]);
      setItemsOrder([]);
      setItemSearch("");
      setItemsDropdownOpen(false);
      setLastLoadedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDb(false);
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
      const v1Response = await fetch(
        `/api/ventas-x-item?start=${encodeURIComponent(dateStart)}&end=${encodeURIComponent(dateEnd)}&maxRows=300000`,
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
    if (!ready || loadingMeta || dbMinDate || dbMaxDate) return;
    void onLoadMeta();
  }, [ready, loadingMeta, dbMinDate, dbMaxDate]);

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
            cell.numFmt = "#,##0.##";
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

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-4xl rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <p className="text-sm text-slate-600">Cargando tablero...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-12 text-foreground">
      <div className="mx-auto w-full max-w-7xl rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_28px_70px_-45px_rgba(15,23,42,0.4)]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
              Ventas X item
            </p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">Ventas por ítem(s) x sedes</h1>
          </div>
          <Link
            href="/tableros"
            className="inline-flex items-center rounded-full border border-slate-200/70 bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-200/70"
          >
            Volver a tableros
          </Link>
        </div>

        <div className="rounded-2xl border border-slate-200/70 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">Carga manual desde base de datos</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
              Fecha inicio
              <input
                type="date"
                value={dateStart}
                min={minDateKey || undefined}
                max={maxDateKey || undefined}
                onChange={(e) => setDateStart(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
              Fecha fin
              <input
                type="date"
                value={dateEnd}
                min={minDateKey || undefined}
                max={maxDateKey || undefined}
                onChange={(e) => setDateEnd(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
            </label>
          </div>
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
              Empresa(s) a cargar
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
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
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                      selected
                        ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                        : "border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    {EMPRESA_LABELS[empresa] ?? empresa.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-3">
            <button
              type="button"
              onClick={() => void onLoadFromDb()}
              disabled={loadingDb || !dateStart || !dateEnd || empresasCargaSel.length === 0}
              className="inline-flex items-center rounded-full border border-emerald-300/80 bg-emerald-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800 transition-all hover:border-emerald-400 hover:bg-emerald-200/80 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingDb ? "Cargando BD..." : "Cargar rango desde BD"}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {fileName
              ? `Fuente actual: ${fileName}`
              : "Selecciona fecha y una o varias empresas, luego carga desde BD."}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            API activa: {USE_V2_API ? "v2 (controlada por flag)" : "v1 (estable)"}
          </p>
          {lastLoadedAt && (
            <p className="mt-1 text-[11px] text-slate-500">
              Ultima actualizacion:{" "}
              {new Intl.DateTimeFormat("es-CO", {
                dateStyle: "short",
                timeStyle: "short",
              }).format(new Date(lastLoadedAt))}
            </p>
          )}
          {USE_V2_API && rows.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void onCheckParity()}
                disabled={parityLoading || loadingDb}
                className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 disabled:opacity-50"
              >
                {parityLoading ? "Validando..." : "Validar paridad con v1"}
              </button>
              {parityResult && (
                <p
                  className={`text-[11px] ${
                    parityResult.ok ? "text-emerald-700" : "text-amber-700"
                  }`}
                >
                  {parityResult.ok
                    ? `Paridad OK | filas ${parityResult.v2Rows}/${parityResult.v1Rows}`
                    : `Paridad con diferencias | filas ${parityResult.v2Rows}/${parityResult.v1Rows}`}
                </p>
              )}
            </div>
          )}
          {USE_V2_API && parityResult && (
            <p className="mt-1 text-[11px] text-slate-500">
              v2 unidades: {parityResult.v2Units.toFixed(1)} | v1 unidades:{" "}
              {parityResult.v1Units.toFixed(1)} | v2 venta: {parityResult.v2Sales.toFixed(0)} | v1
              venta: {parityResult.v1Sales.toFixed(0)}
              {parityResult.message ? ` | detalle: ${parityResult.message}` : ""}
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
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                Descargas
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadCsv}
                    disabled={tableRows.length === 0}
                    className="rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                  >
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadXlsx()}
                    disabled={tableRows.length === 0 || exportingXlsx}
                    className="rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                  >
                    {exportingXlsx ? "Generando..." : "XLSX"}
                  </button>
                </div>
                <p className="mt-1 text-[11px] normal-case tracking-normal text-slate-500">
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
              <div>
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

            <div className="mt-4 rounded-2xl border border-slate-200/70 bg-white p-4">
              <h2 className="text-base font-bold text-slate-900">
                Comparacion de periodos
              </h2>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                  Modo
                  <select
                    value={comparisonMode}
                    onChange={(e) =>
                      setComparisonMode(e.target.value as ComparisonMode)
                    }
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="day">Dia vs dia</option>
                    <option value="week">Semana vs semana</option>
                    <option value="month">Mes vs mes</option>
                  </select>
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                  Periodo A
                  <select
                    value={comparisonA}
                    onChange={(e) => setComparisonA(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    {comparisonOptions.map((opt) => (
                      <option key={`A-${opt.value}`} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                  Periodo B
                  <select
                    value={comparisonB}
                    onChange={(e) => setComparisonB(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    {comparisonOptions.map((opt) => (
                      <option key={`B-${opt.value}`} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Unidades
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    A:{" "}
                    <span className="font-bold text-slate-900">
                      {comparisonTotals.current.units.toLocaleString("es-CO", {
                        maximumFractionDigits: 1,
                      })}
                    </span>{" "}
                    | B:{" "}
                    <span className="font-bold text-slate-900">
                      {comparisonTotals.previous.units.toLocaleString("es-CO", {
                        maximumFractionDigits: 1,
                      })}
                    </span>
                  </p>
                  <p
                    className={`mt-1 text-sm font-semibold ${
                      comparisonTotals.unitsDiff >= 0
                        ? "text-emerald-700"
                        : "text-red-700"
                    }`}
                  >
                    Delta:{" "}
                    {comparisonTotals.unitsDiff.toLocaleString("es-CO", {
                      maximumFractionDigits: 1,
                    })}
                    {comparisonTotals.unitsPct === null
                      ? " | %: N/A"
                      : ` | %: ${comparisonTotals.unitsPct.toFixed(1)}%`}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Venta sin impuesto
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    A:{" "}
                    <span className="font-bold text-slate-900">
                      {comparisonTotals.current.sales.toLocaleString("es-CO", {
                        maximumFractionDigits: 0,
                      })}
                    </span>{" "}
                    | B:{" "}
                    <span className="font-bold text-slate-900">
                      {comparisonTotals.previous.sales.toLocaleString("es-CO", {
                        maximumFractionDigits: 0,
                      })}
                    </span>
                  </p>
                  <p
                    className={`mt-1 text-sm font-semibold ${
                      comparisonTotals.salesDiff >= 0
                        ? "text-emerald-700"
                        : "text-red-700"
                    }`}
                  >
                    Delta:{" "}
                    {comparisonTotals.salesDiff.toLocaleString("es-CO", {
                      maximumFractionDigits: 0,
                    })}
                    {comparisonTotals.salesPct === null
                      ? " | %: N/A"
                      : ` | %: ${comparisonTotals.salesPct.toFixed(1)}%`}
                  </p>
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Dias con datos
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    A: <span className="font-bold text-slate-900">{comparisonDetails.current.daysCount}</span> | B:{" "}
                    <span className="font-bold text-slate-900">{comparisonDetails.previous.daysCount}</span>
                  </p>
                  <p
                    className={`mt-1 text-sm font-semibold ${
                      comparisonDetails.daysDiff >= 0 ? "text-emerald-700" : "text-red-700"
                    }`}
                  >
                    Delta: {comparisonDetails.daysDiff}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Promedio diario unidades
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    A:{" "}
                    <span className="font-bold text-slate-900">
                      {comparisonDetails.current.avgUnitsPerDay.toLocaleString("es-CO", {
                        maximumFractionDigits: 1,
                      })}
                    </span>{" "}
                    | B:{" "}
                    <span className="font-bold text-slate-900">
                      {comparisonDetails.previous.avgUnitsPerDay.toLocaleString("es-CO", {
                        maximumFractionDigits: 1,
                      })}
                    </span>
                  </p>
                  <p
                    className={`mt-1 text-sm font-semibold ${
                      comparisonDetails.avgUnitsDiff >= 0 ? "text-emerald-700" : "text-red-700"
                    }`}
                  >
                    Delta:{" "}
                    {comparisonDetails.avgUnitsDiff.toLocaleString("es-CO", {
                      maximumFractionDigits: 1,
                    })}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Promedio diario venta
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    A:{" "}
                    <span className="font-bold text-slate-900">
                      {comparisonDetails.current.avgSalesPerDay.toLocaleString("es-CO", {
                        maximumFractionDigits: 0,
                      })}
                    </span>{" "}
                    | B:{" "}
                    <span className="font-bold text-slate-900">
                      {comparisonDetails.previous.avgSalesPerDay.toLocaleString("es-CO", {
                        maximumFractionDigits: 0,
                      })}
                    </span>
                  </p>
                  <p
                    className={`mt-1 text-sm font-semibold ${
                      comparisonDetails.avgSalesDiff >= 0 ? "text-emerald-700" : "text-red-700"
                    }`}
                  >
                    Delta:{" "}
                    {comparisonDetails.avgSalesDiff.toLocaleString("es-CO", {
                      maximumFractionDigits: 0,
                    })}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Cobertura (sedes / items)
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    A:{" "}
                    <span className="font-bold text-slate-900">
                      {comparisonDetails.current.sedeCount}
                    </span>
                    {" / "}
                    <span className="font-bold text-slate-900">
                      {comparisonDetails.current.itemCount}
                    </span>
                  </p>
                  <p className="text-sm text-slate-700">
                    B:{" "}
                    <span className="font-bold text-slate-900">
                      {comparisonDetails.previous.sedeCount}
                    </span>
                    {" / "}
                    <span className="font-bold text-slate-900">
                      {comparisonDetails.previous.itemCount}
                    </span>
                  </p>
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Ticket por unidad (venta / unidades)
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    A:{" "}
                    <span className="font-bold text-slate-900">
                      {comparisonDetails.current.salesPerUnit === null
                        ? "N/A"
                        : comparisonDetails.current.salesPerUnit.toLocaleString("es-CO", {
                            maximumFractionDigits: 2,
                          })}
                    </span>{" "}
                    | B:{" "}
                    <span className="font-bold text-slate-900">
                      {comparisonDetails.previous.salesPerUnit === null
                        ? "N/A"
                        : comparisonDetails.previous.salesPerUnit.toLocaleString("es-CO", {
                            maximumFractionDigits: 2,
                          })}
                    </span>
                  </p>
                  <p
                    className={`mt-1 text-sm font-semibold ${
                      (comparisonDetails.salesPerUnitDiff ?? 0) >= 0
                        ? "text-emerald-700"
                        : "text-red-700"
                    }`}
                  >
                    Delta:{" "}
                    {comparisonDetails.salesPerUnitDiff === null
                      ? "N/A"
                      : comparisonDetails.salesPerUnitDiff.toLocaleString("es-CO", {
                          maximumFractionDigits: 2,
                        })}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Sede lider (unidades)
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    A:{" "}
                    <span className="font-bold text-slate-900">
                      {comparisonDetails.current.topSede
                        ? `${comparisonDetails.current.topSede.sede} (${comparisonDetails.current.topSede.units.toLocaleString(
                            "es-CO",
                            { maximumFractionDigits: 1 },
                          )})`
                        : "N/A"}
                    </span>
                  </p>
                  <p className="text-sm text-slate-700">
                    B:{" "}
                    <span className="font-bold text-slate-900">
                      {comparisonDetails.previous.topSede
                        ? `${comparisonDetails.previous.topSede.sede} (${comparisonDetails.previous.topSede.units.toLocaleString(
                            "es-CO",
                            { maximumFractionDigits: 1 },
                          )})`
                        : "N/A"}
                    </span>
                  </p>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                  Sedes con mayor variacion (unidades)
                </p>
                {comparisonDetails.sedeDiffRows.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">Sin datos para comparar.</p>
                ) : (
                  <div className="mt-2 overflow-auto">
                    <table className="min-w-full text-xs text-slate-700">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="px-2 py-2 text-left">Sede</th>
                          <th className="px-2 py-2 text-right">Unid. A</th>
                          <th className="px-2 py-2 text-right">Unid. B</th>
                          <th className="px-2 py-2 text-right">Delta Unid.</th>
                          <th className="px-2 py-2 text-right">Delta Venta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparisonDetails.sedeDiffRows.map((row) => (
                          <tr key={row.sede} className="border-b border-slate-100">
                            <td className="px-2 py-1.5 font-semibold">{row.sede}</td>
                            <td className="px-2 py-1.5 text-right">
                              {row.unitsA.toLocaleString("es-CO", { maximumFractionDigits: 1 })}
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              {row.unitsB.toLocaleString("es-CO", { maximumFractionDigits: 1 })}
                            </td>
                            <td
                              className={`px-2 py-1.5 text-right font-semibold ${
                                row.unitsDiff >= 0 ? "text-emerald-700" : "text-red-700"
                              }`}
                            >
                              {row.unitsDiff.toLocaleString("es-CO", {
                                maximumFractionDigits: 1,
                              })}
                            </td>
                            <td
                              className={`px-2 py-1.5 text-right font-semibold ${
                                row.salesDiff >= 0 ? "text-emerald-700" : "text-red-700"
                              }`}
                            >
                              {row.salesDiff.toLocaleString("es-CO", {
                                maximumFractionDigits: 0,
                              })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200/70 bg-white p-4">
              <h2 className="text-base font-bold text-slate-900">{title}</h2>
              {tableRows.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">
                  Selecciona al menos un ítem y un rango válido para ver resultados.
                </p>
              ) : (
                <div className="mt-3 overflow-auto rounded-xl border border-slate-200">
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
              )}
            </div>

            {pivot && (
              <div className="mt-4 rounded-2xl border border-slate-200/70 bg-white p-4">
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
          </>
        )}
      </div>
    </div>
  );
}

