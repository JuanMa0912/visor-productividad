"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  Download,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import {
  DEFAULT_SEDES,
  SEDE_GROUPS,
  SEDE_ORDER,
  DEFAULT_LINES,
  Sede,
} from "@/lib/constants";
import { normalizeKeyCompact } from "@/lib/normalize";
import { formatCOP } from "@/lib/calc";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
} from "@/lib/portal-sections";

type DateRange = {
  start: string;
  end: string;
};

type MarginRow = {
  date: string;
  empresa: string;
  sede: string;
  lineaId: string;
  lineaName: string;
  ventaSinIva: number;
  iva: number;
  ventaConIva: number;
  costoTotal: number;
  utilidadBruta: number;
};

type LineOption = {
  id: string;
  name: string;
};

type ApiResponse = {
  rows: MarginRow[];
  sedes: Array<{ id: string; name: string }>;
  lineas: LineOption[];
  error?: string;
};

type Totals = {
  sales: number;
  cost: number;
  profit: number;
  iva: number;
  salesWithVat: number;
};

const percentFormatter = new Intl.NumberFormat("es-CO", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const EMPTY_TOTALS: Totals = {
  sales: 0,
  cost: 0,
  profit: 0,
  iva: 0,
  salesWithVat: 0,
};

const cloneTotals = (): Totals => ({ ...EMPTY_TOTALS });

const formatCurrency = (value: number) => formatCOP(value);

const formatMarginPct = (totals: Totals) =>
  percentFormatter.format(totals.sales === 0 ? 0 : totals.profit / totals.sales);

const getMarginRatio = (totals: Totals) =>
  totals.sales === 0 ? 0 : totals.profit / totals.sales;

const parseDateKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const toDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const normalizeSedeKey = normalizeKeyCompact;

const ALLOWED_LINE_SET = new Set(DEFAULT_LINES.map((line) => line.id));

const SEDE_ORDER_MAP = new Map(
  SEDE_ORDER.map((name, index) => [normalizeSedeKey(name), index]),
);

const sortSedesByOrder = (sedes: Sede[]) => {
  return [...sedes].sort((a, b) => {
    const aKey = normalizeSedeKey(a.id || a.name);
    const bKey = normalizeSedeKey(b.id || b.name);
    const aOrder = SEDE_ORDER_MAP.get(aKey) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = SEDE_ORDER_MAP.get(bKey) ?? Number.MAX_SAFE_INTEGER;

    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.name.localeCompare(b.name, "es");
  });
};

const buildCompanyOptions = (): Sede[] =>
  SEDE_GROUPS.filter((group) => group.id !== "all").map((group) => ({
    id: group.id,
    name: group.name,
  }));

const resolveSelectedSedeIds = (
  selectedSede: string,
  selectedCompanies: string[],
  availableSedes: Sede[],
) => {
  const availableByKey = new Map(
    availableSedes.map((sede) => [normalizeSedeKey(sede.id), sede.id]),
  );

  if (selectedCompanies.length > 0) {
    const resolved = new Set<string>();
    selectedCompanies.forEach((companyId) => {
      const group = SEDE_GROUPS.find((candidate) => candidate.id === companyId);
      if (!group) return;
      group.sedes.forEach((sedeId) => {
        const resolvedId = availableByKey.get(normalizeSedeKey(sedeId));
        if (resolvedId) resolved.add(resolvedId);
      });
    });
    return Array.from(resolved);
  }

  if (selectedSede) {
    const resolved = availableByKey.get(normalizeSedeKey(selectedSede));
    return resolved ? [resolved] : [];
  }

  return availableSedes.map((sede) => sede.id);
};

const addRowToTotals = (target: Totals, row: MarginRow) => {
  target.sales += row.ventaSinIva;
  target.cost += row.costoTotal;
  target.profit += row.utilidadBruta;
  target.iva += row.iva;
  target.salesWithVat += row.ventaConIva;
};

const addTotals = (target: Totals, input: Totals) => {
  target.sales += input.sales;
  target.cost += input.cost;
  target.profit += input.profit;
  target.iva += input.iva;
  target.salesWithVat += input.salesWithVat;
};

const toMonthBounds = (dateKey: string) => {
  const base = parseDateKey(dateKey);
  const start = toDateKey(new Date(base.getFullYear(), base.getMonth(), 1));
  const end = toDateKey(new Date(base.getFullYear(), base.getMonth() + 1, 0));
  return { start, end };
};

export default function MargenesPage() {
  const LINE_PAGE_SIZE = 25;
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [prefsReady, setPrefsReady] = useState(false);
  const [pendingSedeKey, setPendingSedeKey] = useState<string | null>(null);
  const [allowedLineIds, setAllowedLineIds] = useState<string[]>([]);
  const [appliedUserDefault, setAppliedUserDefault] = useState(false);
  const [rows, setRows] = useState<MarginRow[]>([]);
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [lineOptions, setLineOptions] = useState<LineOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSede, setSelectedSede] = useState("");
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [lineSortBy, setLineSortBy] = useState<"day" | "month">("day");
  const [lineSortOrder, setLineSortOrder] = useState<"desc" | "asc">("desc");
  const [linePage, setLinePage] = useState(1);
  const [showSedeTable, setShowSedeTable] = useState(false);
  const [showLineTable, setShowLineTable] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>({ start: "", end: "" });
  const [quickSearch, setQuickSearch] = useState("");

  const prefsKey = useMemo(
    () => `vp_margenes_prefs_${username ?? "default"}`,
    [username],
  );

  const resolveUsernameSedeKey = (value?: string | null) => {
    if (!value) return null;
    const normalized = value.trim().toLowerCase();
    if (!normalized.startsWith("sede_")) return null;
    const raw = normalized.replace(/^sede_/, "").replace(/_/g, " ");
    return normalizeSedeKey(raw);
  };

  const resolveAllowedLineIds = (value?: string[] | null) => {
    if (!Array.isArray(value) || value.length === 0) return [];
    return Array.from(
      new Set(
        value
          .map((line) => (typeof line === "string" ? line.trim().toLowerCase() : ""))
          .filter((line) => ALLOWED_LINE_SET.has(line)),
      ),
    );
  };

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
            allowedLines?: string[] | null;
            allowedDashboards?: string[] | null;
            allowedSubdashboards?: string[] | null;
          };
        };
        if (!isMounted) return;
        const isUserAdmin = payload.user?.role === "admin";
        if (
          !isUserAdmin &&
          (!canAccessPortalSection(payload.user?.allowedDashboards, "producto") ||
            !canAccessPortalSubsection(
              payload.user?.allowedSubdashboards,
              "margenes",
            ))
        ) {
          router.replace("/secciones");
          return;
        }
        setUsername(payload.user?.username ?? null);
        setPendingSedeKey(resolveUsernameSedeKey(payload.user?.username));
        setAllowedLineIds(resolveAllowedLineIds(payload.user?.allowedLines));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      } finally {
        if (isMounted) {
          setReady(true);
          setAuthLoaded(true);
        }
      }
    };

    void loadUser();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [router]);

  useEffect(() => {
    if (!ready) return;

    let isMounted = true;
    const controller = new AbortController();

    const loadData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/margenes", {
          signal: controller.signal,
        });
        const payload = (await response.json()) as ApiResponse;

        if (!isMounted) return;

        if (response.status === 401) {
          router.replace("/login");
          return;
        }

        const resolvedRows = payload.rows ?? [];
        const resolvedSedes =
          payload.sedes && payload.sedes.length > 0 ? payload.sedes : DEFAULT_SEDES;

        if (!response.ok) {
          setError(payload.error ?? "No se pudieron cargar los datos.");
          setRows(resolvedRows);
          setSedes(resolvedSedes);
          setLineOptions(payload.lineas ?? []);
          return;
        }

        setRows(resolvedRows);
        setSedes(resolvedSedes);
        setLineOptions(payload.lineas ?? []);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("No se pudieron cargar los datos.");
        setRows([]);
        setSedes([]);
        setLineOptions([]);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    void loadData();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [ready, router]);

  const orderedSedes = useMemo(() => {
    const hidden = new Set(
      [
        "adm",
        "cedicavasa",
        "panificadora",
        "planta desposte mixto",
        "planta desprese pollo",
      ].map(normalizeSedeKey),
    );
    const filtered = sedes.filter((sede) => {
      const idKey = normalizeSedeKey(sede.id);
      const nameKey = normalizeSedeKey(sede.name);
      return !hidden.has(idKey) && !hidden.has(nameKey);
    });
    return sortSedesByOrder(filtered);
  }, [sedes]);
  const companyOptions = useMemo(() => buildCompanyOptions(), []);

  const selectedSedeIds = useMemo(
    () => resolveSelectedSedeIds(selectedSede, selectedCompanies, orderedSedes),
    [orderedSedes, selectedCompanies, selectedSede],
  );

  const selectedSedeIdSet = useMemo(
    () => new Set(selectedSedeIds),
    [selectedSedeIds],
  );
  const allowedLineIdSet = useMemo(() => new Set(allowedLineIds), [allowedLineIds]);
  const scopedRows = useMemo(() => {
    if (allowedLineIdSet.size === 0) return rows;
    return rows.filter((row) => allowedLineIdSet.has(row.lineaId.toLowerCase()));
  }, [allowedLineIdSet, rows]);

  const filteredSedes = useMemo(() => {
    if (selectedSedeIds.length === 0) return orderedSedes;
    return orderedSedes.filter((sede) => selectedSedeIdSet.has(sede.id));
  }, [orderedSedes, selectedSedeIdSet, selectedSedeIds.length]);

  const availableDates = useMemo(
    () =>
      Array.from(new Set(scopedRows.map((item) => item.date))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [scopedRows],
  );

  useEffect(() => {
    if (availableDates.length === 0) return;

    const yesterday = new Date();
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = toDateKey(yesterday);

    setDateRange({
      start: yesterdayKey,
      end: yesterdayKey,
    });
  }, [availableDates]);

  useEffect(() => {
    if (!authLoaded) return;
    const rawPrefs = localStorage.getItem(prefsKey);
    if (rawPrefs) {
      try {
        const parsed = JSON.parse(rawPrefs) as {
          selectedSede?: string;
          selectedCompanies?: string[];
          selectedLineIds?: string[];
          dateRange?: DateRange;
        };
        if (Array.isArray(parsed.selectedCompanies)) {
          setSelectedCompanies(parsed.selectedCompanies.slice(0, 2));
        }
        if (Array.isArray(parsed.selectedLineIds)) {
          setSelectedLineIds(parsed.selectedLineIds);
        }
        if (typeof parsed.selectedSede === "string") {
          setSelectedSede(parsed.selectedSede);
        }
      } catch {
        // ignore malformed local storage content
      }
    }
    setPrefsReady(true);
  }, [authLoaded, prefsKey]);

  useEffect(() => {
    if (!prefsReady) return;
    localStorage.setItem(
      prefsKey,
      JSON.stringify({
        selectedSede,
        selectedCompanies,
        selectedLineIds,
        dateRange,
      }),
    );
  }, [dateRange, prefsKey, prefsReady, selectedCompanies, selectedLineIds, selectedSede]);

  useEffect(() => {
    if (!prefsReady || appliedUserDefault) return;
    if (!pendingSedeKey) {
      setAppliedUserDefault(true);
      return;
    }
    const match = orderedSedes.find((sede) => {
      const idKey = normalizeSedeKey(sede.id);
      const nameKey = normalizeSedeKey(sede.name);
      return idKey === pendingSedeKey || nameKey === pendingSedeKey;
    });
    if (match) {
      setSelectedCompanies([]);
      setSelectedSede(match.id);
    }
    setAppliedUserDefault(true);
  }, [appliedUserDefault, orderedSedes, pendingSedeKey, prefsReady]);

  const selectedDay = dateRange.end || dateRange.start;
  const selectedLineIdSet = useMemo(
    () => new Set(selectedLineIds),
    [selectedLineIds],
  );

  const marginsBySede = useMemo(() => {
    const dayMap = new Map<string, Totals>();
    const rangeMap = new Map<string, Totals>();
    const monthMap = new Map<string, Totals>();
    const totalDay = cloneTotals();
    const totalRange = cloneTotals();
    const totalMonth = cloneTotals();

    if (!selectedDay) {
      return { dayMap, rangeMap, monthMap, totalDay, totalRange, totalMonth };
    }

    const monthBounds = toMonthBounds(selectedDay);
    const withinRange = (date: string) =>
      dateRange.start && dateRange.end
        ? date >= dateRange.start && date <= dateRange.end
        : false;

    scopedRows.forEach((row) => {
      if (selectedSedeIdSet.size > 0 && !selectedSedeIdSet.has(row.sede)) return;
      if (selectedLineIdSet.size > 0 && !selectedLineIdSet.has(row.lineaId)) return;

      if (row.date === selectedDay) {
        const current = dayMap.get(row.sede) ?? cloneTotals();
        addRowToTotals(current, row);
        dayMap.set(row.sede, current);
        addRowToTotals(totalDay, row);
      }

      if (withinRange(row.date)) {
        const current = rangeMap.get(row.sede) ?? cloneTotals();
        addRowToTotals(current, row);
        rangeMap.set(row.sede, current);
        addRowToTotals(totalRange, row);
      }

      if (row.date >= monthBounds.start && row.date <= monthBounds.end) {
        const current = monthMap.get(row.sede) ?? cloneTotals();
        addRowToTotals(current, row);
        monthMap.set(row.sede, current);
        addRowToTotals(totalMonth, row);
      }
    });

    return { dayMap, rangeMap, monthMap, totalDay, totalRange, totalMonth };
  }, [dateRange.end, dateRange.start, scopedRows, selectedDay, selectedLineIdSet, selectedSedeIdSet]);

  const marginsByLine = useMemo(() => {
    const dayMap = new Map<string, Totals>();
    const rangeMap = new Map<string, Totals>();
    const monthMap = new Map<string, Totals>();

    if (!selectedDay) return { dayMap, rangeMap, monthMap };

    const monthBounds = toMonthBounds(selectedDay);
    const withinRange = (date: string) =>
      dateRange.start && dateRange.end
        ? date >= dateRange.start && date <= dateRange.end
        : false;

    scopedRows.forEach((row) => {
      if (selectedSedeIdSet.size > 0 && !selectedSedeIdSet.has(row.sede)) return;
      if (selectedLineIdSet.size > 0 && !selectedLineIdSet.has(row.lineaId)) return;

      if (row.date === selectedDay) {
        const current = dayMap.get(row.lineaId) ?? cloneTotals();
        addRowToTotals(current, row);
        dayMap.set(row.lineaId, current);
      }

      if (withinRange(row.date)) {
        const current = rangeMap.get(row.lineaId) ?? cloneTotals();
        addRowToTotals(current, row);
        rangeMap.set(row.lineaId, current);
      }

      if (row.date >= monthBounds.start && row.date <= monthBounds.end) {
        const current = monthMap.get(row.lineaId) ?? cloneTotals();
        addRowToTotals(current, row);
        monthMap.set(row.lineaId, current);
      }
    });

    return { dayMap, rangeMap, monthMap };
  }, [dateRange.end, dateRange.start, scopedRows, selectedDay, selectedLineIdSet, selectedSedeIdSet]);

  const rangeTotals = useMemo(() => {
    const totals = cloneTotals();
    marginsBySede.rangeMap.forEach((value) => addTotals(totals, value));
    return totals;
  }, [marginsBySede.rangeMap]);

  const orderedLineItems = useMemo(() => {
    const byId = new Map(
      lineOptions
        .filter((line) =>
          allowedLineIdSet.size > 0 ? allowedLineIdSet.has(line.id.toLowerCase()) : true,
        )
        .map((line) => [line.id, line.name]),
    );
    scopedRows.forEach((row) => {
      if (!byId.has(row.lineaId)) {
        byId.set(row.lineaId, row.lineaName || row.lineaId);
      }
    });
    return Array.from(byId.entries())
      .map(([id, name]) => ({
        id,
        name: (name || id).trim(),
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, "es", {
          numeric: true,
          sensitivity: "base",
        }) ||
        a.id.localeCompare(b.id, "es", { numeric: true, sensitivity: "base" }),
      );
  }, [allowedLineIdSet, lineOptions, scopedRows]);

  useEffect(() => {
    if (allowedLineIdSet.size === 0) return;
    setSelectedLineIds((prev) =>
      prev.filter((lineId) => allowedLineIdSet.has(lineId.toLowerCase())),
    );
  }, [allowedLineIdSet]);

  const visibleLineItems = useMemo(() => {
    if (selectedLineIds.length === 0) return orderedLineItems;
    const selectedSet = new Set(selectedLineIds);
    return orderedLineItems.filter((line) => selectedSet.has(line.id));
  }, [orderedLineItems, selectedLineIds]);

  const sortedVisibleLineItems = useMemo(() => {
    return [...visibleLineItems].sort((a, b) => {
      const aDayTotals = marginsByLine.dayMap.get(a.id) ?? EMPTY_TOTALS;
      const bDayTotals = marginsByLine.dayMap.get(b.id) ?? EMPTY_TOTALS;
      const aMonthTotals = marginsByLine.monthMap.get(a.id) ?? EMPTY_TOTALS;
      const bMonthTotals = marginsByLine.monthMap.get(b.id) ?? EMPTY_TOTALS;

      const aRatio =
        lineSortBy === "day" ? getMarginRatio(aDayTotals) : getMarginRatio(aMonthTotals);
      const bRatio =
        lineSortBy === "day" ? getMarginRatio(bDayTotals) : getMarginRatio(bMonthTotals);

      const ratioDiff = aRatio - bRatio;
      if (ratioDiff !== 0) {
        return lineSortOrder === "desc" ? -ratioDiff : ratioDiff;
      }

      return a.name.localeCompare(b.name, "es", {
        numeric: true,
        sensitivity: "base",
      });
    });
  }, [lineSortBy, lineSortOrder, marginsByLine.dayMap, marginsByLine.monthMap, visibleLineItems]);

  const quickSearchNeedle = quickSearch.trim().toLowerCase();
  const displayedSedes = useMemo(() => {
    if (!quickSearchNeedle) return filteredSedes;
    return filteredSedes.filter((sede) => sede.name.toLowerCase().includes(quickSearchNeedle));
  }, [filteredSedes, quickSearchNeedle]);
  const displayedLineItems = useMemo(() => {
    if (!quickSearchNeedle) return sortedVisibleLineItems;
    return sortedVisibleLineItems.filter((line) => {
      const lineName = line.name.toLowerCase();
      const lineId = line.id.toLowerCase();
      return lineName.includes(quickSearchNeedle) || lineId.includes(quickSearchNeedle);
    });
  }, [quickSearchNeedle, sortedVisibleLineItems]);
  const totalLinePages = Math.max(1, Math.ceil(displayedLineItems.length / LINE_PAGE_SIZE));
  const currentLinePage = Math.min(Math.max(1, linePage), totalLinePages);
  const linePageStart = (currentLinePage - 1) * LINE_PAGE_SIZE;
  const paginatedLineItems = useMemo(
    () => displayedLineItems.slice(linePageStart, linePageStart + LINE_PAGE_SIZE),
    [displayedLineItems, linePageStart],
  );
  const lineRangeFrom = displayedLineItems.length === 0 ? 0 : linePageStart + 1;
  const lineRangeTo = Math.min(linePageStart + LINE_PAGE_SIZE, displayedLineItems.length);

  useEffect(() => {
    setLinePage(1);
  }, [lineSortBy, lineSortOrder, quickSearchNeedle, selectedLineIds, selectedSede, selectedCompanies]);

  useEffect(() => {
    if (linePage > totalLinePages) setLinePage(totalLinePages);
  }, [linePage, totalLinePages]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-background px-4 py-10 text-foreground antialiased">
        <div className="mx-auto w-full max-w-md rounded-2xl border border-border/70 bg-card p-6 shadow-xs">
          <p className="text-sm text-muted-foreground">Cargando módulo...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between px-6 py-3 lg:px-8">
          <Link href="/portal" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-indigo-500 to-violet-500 shadow-elevated">
              <Sparkles className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Producto · UAID
              </span>
              <span className="font-display text-[15px] font-semibold leading-tight tracking-tight text-foreground">
                Márgenes
              </span>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => router.push("/secciones")}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground shadow-xs transition-all hover:border-foreground/20 hover:shadow-soft"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Volver a producto
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-8 lg:px-8 lg:py-10">
        <section className="overflow-hidden rounded-2xl border border-foreground/15 bg-card shadow-xs">
          <div className="h-[3px] w-full bg-foreground" />
          <div className="space-y-6 p-5 lg:p-6">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                  Módulo márgenes
                </span>
                <h1 className="font-display text-[34px] font-semibold leading-tight tracking-tight text-foreground">
                  Márgenes por sede y línea
                </h1>
                <p className="max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
                  Lectura operativa de venta, costo, utilidad y porcentaje de margen por ubicación y categoría comercial.
                </p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-2xl border border-border/70 bg-muted/20 p-2">
                <div className="rounded-xl border border-border/70 bg-card px-4 py-2 shadow-soft">
                  <Image
                    src="/logos/mercatodo.jpeg"
                    alt="Logo MercaTodo"
                    width={130}
                    height={40}
                    className="h-8 w-auto"
                    priority
                  />
                </div>
                <div className="rounded-xl border border-border/70 bg-card px-4 py-2 shadow-soft">
                  <Image
                    src="/logos/mercamio.jpeg"
                    alt="Logo MercaMio"
                    width={130}
                    height={40}
                    className="h-8 w-auto"
                    priority
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-4">
              <div className="grid gap-3 lg:grid-cols-[140px_140px_1fr_180px_180px_auto] lg:items-end">
                <label className="space-y-1.5">
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Desde
                  </span>
                  <div className="relative">
                    <input
                      type="date"
                      value={dateRange.start}
                      onChange={(e) =>
                        setDateRange((prev) => ({
                          start: e.target.value,
                          end: e.target.value > prev.end ? e.target.value : prev.end,
                        }))
                      }
                      className="h-10 w-full rounded-lg border border-input bg-card px-3 pr-9 font-mono text-[12px] font-semibold shadow-xs"
                    />
                    <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </label>
                <label className="space-y-1.5">
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Hasta
                  </span>
                  <div className="relative">
                    <input
                      type="date"
                      value={dateRange.end}
                      onChange={(e) =>
                        setDateRange((prev) => ({
                          start: e.target.value < prev.start ? e.target.value : prev.start,
                          end: e.target.value,
                        }))
                      }
                      className="h-10 w-full rounded-lg border border-input bg-card px-3 pr-9 font-mono text-[12px] font-semibold shadow-xs"
                    />
                    <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </label>

                <label className="space-y-1.5">
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Empresa
                  </span>
                  <div className="relative">
                    <select
                      value=""
                      onChange={(e) => {
                        const value = e.target.value;
                        if (!value) return;
                        setSelectedCompanies((prev) => {
                          const next = prev.includes(value) ? prev : [...prev, value];
                          return next.slice(0, 2);
                        });
                        setSelectedSede("");
                      }}
                      className="h-10 w-full appearance-none rounded-lg border border-input bg-card px-3 pr-9 text-[12px] shadow-xs"
                    >
                      <option value="">Seleccionar empresa</option>
                      {companyOptions.map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </label>

                <label className="space-y-1.5">
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Sede
                  </span>
                  <div className="relative">
                    <select
                      value={selectedSede}
                      onChange={(e) => {
                        setSelectedSede(e.target.value);
                        if (e.target.value) setSelectedCompanies([]);
                      }}
                      className="h-10 w-full appearance-none rounded-lg border border-input bg-card px-3 pr-9 text-[12px] shadow-xs"
                    >
                      <option value="">Todas las sedes</option>
                      {orderedSedes.map((sede) => (
                        <option key={sede.id} value={sede.id}>
                          {sede.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </label>

                <label className="space-y-1.5">
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Línea
                  </span>
                  <div className="relative">
                    <select
                      value=""
                      onChange={(e) => {
                        const value = e.target.value;
                        if (!value) return;
                        setSelectedLineIds((prev) =>
                          prev.includes(value) ? prev : [...prev, value],
                        );
                      }}
                      className="h-10 w-full appearance-none rounded-lg border border-input bg-card px-3 pr-9 text-[12px] shadow-xs"
                    >
                      <option value="">Todas las líneas</option>
                      {orderedLineItems.map((line) => (
                        <option key={line.id} value={line.id}>
                          {line.name} ({line.id})
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </label>

                <button
                  type="button"
                  onClick={() => router.refresh()}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-background shadow-elevated transition-all hover:-translate-y-0.5 hover:shadow-floating"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Actualizar
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="search"
                    value={quickSearch}
                    onChange={(e) => setQuickSearch(e.target.value)}
                    placeholder="Buscar sede o línea..."
                    className="h-10 w-full rounded-lg border border-input bg-card py-2 pl-9 pr-3 text-[12px] shadow-xs placeholder:text-muted-foreground"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => router.push("/secciones")}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-card px-3.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground shadow-xs transition-all hover:shadow-soft"
                >
                  Cambiar sección
                </button>
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-positive/30 bg-positive/10 px-3.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-positive shadow-xs transition-all hover:shadow-soft"
                >
                  <Download className="h-3.5 w-3.5" />
                  Exportar
                </button>
              </div>

              {(selectedCompanies.length > 0 || selectedLineIds.length > 0) && (
                <div className="flex flex-wrap gap-2">
                  {selectedCompanies.map((companyId) => {
                    const label =
                      companyOptions.find((company) => company.id === companyId)?.name ??
                      companyId;
                    return (
                      <button
                        key={companyId}
                        type="button"
                        onClick={() =>
                          setSelectedCompanies((prev) => prev.filter((id) => id !== companyId))
                        }
                        className="rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold text-foreground shadow-xs"
                      >
                        {label} ×
                      </button>
                    );
                  })}
                  {selectedLineIds.map((lineId) => {
                    const label =
                      orderedLineItems.find((line) => line.id === lineId)?.name ?? lineId;
                    return (
                      <button
                        key={lineId}
                        type="button"
                        onClick={() =>
                          setSelectedLineIds((prev) => prev.filter((id) => id !== lineId))
                        }
                        className="rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold text-foreground shadow-xs"
                      >
                        {label} ({lineId}) ×
                      </button>
                    );
                  })}
                  {selectedLineIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedLineIds([])}
                      className="rounded-full border border-border bg-muted px-3 py-1 text-[11px] font-semibold text-muted-foreground"
                    >
                      Limpiar líneas
                    </button>
                  )}
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {isLoading && (
              <p className="text-sm text-muted-foreground">Cargando datos...</p>
            )}

            {!isLoading && selectedDay && (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-border/70 bg-card p-4 shadow-xs">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Venta rango
                    </p>
                    <p className="mt-2 font-mono text-2xl font-semibold text-foreground">
                      {formatCurrency(rangeTotals.sales)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-card p-4 shadow-xs">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Costo rango
                    </p>
                    <p className="mt-2 font-mono text-2xl font-semibold text-foreground">
                      {formatCurrency(rangeTotals.cost)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-card p-4 shadow-xs">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Utilidad rango
                    </p>
                    <p className="mt-2 font-mono text-2xl font-semibold text-foreground">
                      {formatCurrency(rangeTotals.profit)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-card p-4 shadow-xs">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Margen rango
                    </p>
                    <p className="mt-2 font-mono text-2xl font-semibold text-foreground">
                      {formatMarginPct(rangeTotals)}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4">
                  <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-card px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Resultado por sede</p>
                        <p className="text-xs text-muted-foreground">Ranking por margen diario y mensual</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowSedeTable((prev) => !prev)}
                        className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground shadow-xs"
                      >
                        {showSedeTable ? "Ocultar" : "Ver tabla"}
                      </button>
                    </div>
                    {showSedeTable ? (
                      <div className="overflow-x-auto">
                        <table className="min-w-[820px] text-sm">
                          <thead className="sticky top-0 z-10 bg-card">
                            <tr className="border-b border-border/70 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                              <th className="px-4 py-3 text-left font-semibold">Sede</th>
                              <th className="px-4 py-3 text-right font-semibold">Venta</th>
                              <th className="px-4 py-3 text-right font-semibold">Costo</th>
                              <th className="px-4 py-3 text-right font-semibold">Utilidad</th>
                              <th className="px-4 py-3 text-right font-semibold">% día</th>
                              <th className="px-4 py-3 text-right font-semibold">% mes</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60">
                            {displayedSedes.map((sede) => {
                              const dayTotals = marginsBySede.dayMap.get(sede.id) ?? EMPTY_TOTALS;
                              const monthTotals = marginsBySede.monthMap.get(sede.id) ?? EMPTY_TOTALS;
                              return (
                                <tr key={sede.id} className="transition-colors hover:bg-muted/30">
                                  <td className="px-4 py-3 font-semibold text-foreground">{sede.name}</td>
                                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(dayTotals.sales)}</td>
                                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(dayTotals.cost)}</td>
                                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(dayTotals.profit)}</td>
                                  <td className="px-4 py-3 text-right font-mono text-primary">{formatMarginPct(dayTotals)}</td>
                                  <td className="bg-muted/40 px-4 py-3 text-right font-mono">{formatMarginPct(monthTotals)}</td>
                                </tr>
                              );
                            })}
                            <tr className="border-t border-border bg-muted/40">
                              <td className="px-4 py-3 font-semibold text-foreground">Total seleccionadas</td>
                              <td className="px-4 py-3 text-right font-mono">{formatCurrency(marginsBySede.totalDay.sales)}</td>
                              <td className="px-4 py-3 text-right font-mono">{formatCurrency(marginsBySede.totalDay.cost)}</td>
                              <td className="px-4 py-3 text-right font-mono">{formatCurrency(marginsBySede.totalDay.profit)}</td>
                              <td className="px-4 py-3 text-right font-mono text-primary">{formatMarginPct(marginsBySede.totalDay)}</td>
                              <td className="bg-muted/60 px-4 py-3 text-right font-mono">{formatMarginPct(marginsBySede.totalMonth)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="px-4 py-5 text-sm text-muted-foreground">
                        Presiona &quot;Ver tabla&quot; para mostrar los resultados por sede.
                      </p>
                    )}
                  </div>

                  <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-card px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Resultado por línea</p>
                        <p className="text-xs text-muted-foreground">Categorías ordenadas por rentabilidad</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          <select
                            value={lineSortBy}
                            onChange={(e) => setLineSortBy(e.target.value as "day" | "month")}
                            className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] font-semibold text-foreground shadow-xs"
                          >
                            <option value="day">% día</option>
                            <option value="month">% mes</option>
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={() => setLineSortOrder((prev) => (prev === "desc" ? "asc" : "desc"))}
                          className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground shadow-xs"
                        >
                          {lineSortOrder === "desc" ? "Mayor a menor" : "Menor a mayor"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowLineTable((prev) => !prev)}
                          className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground shadow-xs"
                        >
                          {showLineTable ? "Ocultar" : "Ver tabla"}
                        </button>
                      </div>
                    </div>
                    {showLineTable ? (
                      <>
                        <div className="overflow-x-auto">
                          <table className="min-w-[860px] text-sm">
                            <thead className="sticky top-0 z-10 bg-card">
                              <tr className="border-b border-border/70 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                                <th className="px-4 py-3 text-left font-semibold">Línea</th>
                                <th className="px-4 py-3 text-right font-semibold">Venta</th>
                                <th className="px-4 py-3 text-right font-semibold">Costo</th>
                                <th className="px-4 py-3 text-right font-semibold">Utilidad</th>
                                <th className="px-4 py-3 text-right font-semibold">% día</th>
                                <th className="px-4 py-3 text-right font-semibold">% mes</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60">
                              {displayedLineItems.length === 0 && (
                                <tr>
                                  <td className="px-4 py-5 text-center text-sm text-muted-foreground" colSpan={6}>
                                    No hay líneas para el filtro seleccionado.
                                  </td>
                                </tr>
                              )}
                              {paginatedLineItems.map((line) => {
                                const dayTotals = marginsByLine.dayMap.get(line.id) ?? EMPTY_TOTALS;
                                const monthTotals = marginsByLine.monthMap.get(line.id) ?? EMPTY_TOTALS;
                                return (
                                  <tr key={line.id} className="transition-colors hover:bg-muted/30">
                                    <td className="px-4 py-3 font-semibold text-foreground">
                                      <div className="flex flex-col">
                                        <span>{line.name}</span>
                                        <span className="font-mono text-xs text-muted-foreground">{line.id}</span>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(dayTotals.sales)}</td>
                                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(dayTotals.cost)}</td>
                                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(dayTotals.profit)}</td>
                                    <td className="px-4 py-3 text-right font-mono text-primary">{formatMarginPct(dayTotals)}</td>
                                    <td className="bg-muted/40 px-4 py-3 text-right font-mono">{formatMarginPct(monthTotals)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {displayedLineItems.length > 0 && (
                          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            <span>
                              Mostrando {lineRangeFrom}-{lineRangeTo} de {displayedLineItems.length}
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setLinePage((prev) => Math.max(1, prev - 1))}
                                disabled={currentLinePage <= 1}
                                className="rounded-lg border border-border bg-muted px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Anterior
                              </button>
                              <span>
                                Página {currentLinePage} de {totalLinePages}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setLinePage((prev) => Math.min(totalLinePages, prev + 1))
                                }
                                disabled={currentLinePage >= totalLinePages}
                                className="rounded-lg border border-border bg-card px-3 py-1.5 shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Siguiente
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="px-4 py-5 text-sm text-muted-foreground">
                        Presiona &quot;Ver tabla&quot; para mostrar los resultados por línea.
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}

            {!isLoading && !selectedDay && (
              <p className="text-sm text-muted-foreground">No hay datos disponibles.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
