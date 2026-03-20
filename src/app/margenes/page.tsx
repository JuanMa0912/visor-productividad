"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  DEFAULT_SEDES,
  SEDE_GROUPS,
  SEDE_ORDER,
  DEFAULT_LINES,
  Sede,
} from "@/lib/constants";
import { formatCOP } from "@/lib/calc";
import { canAccessPortalSection } from "@/lib/portal-sections";

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

const getMarginToneClass = (ratio: number) => {
  if (ratio >= 0.22) return "text-emerald-700";
  if (ratio >= 0.16) return "text-teal-700";
  if (ratio >= 0.1) return "text-sky-700";
  return "text-slate-600";
};

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

const normalizeSedeKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, "");

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
  const [dateRange, setDateRange] = useState<DateRange>({ start: "", end: "" });

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
          };
        };
        if (!isMounted) return;
        const isUserAdmin = payload.user?.role === "admin";
        if (
          !isUserAdmin &&
          !canAccessPortalSection(payload.user?.allowedDashboards, "producto")
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

  if (!ready) {
    return (
      <div className="min-h-screen bg-background px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-md rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <p className="text-sm text-slate-600">Cargando modulo...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(148,163,184,0.18),transparent_55%),linear-gradient(180deg,#f8fafc,#eef2f7)] px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-7xl rounded-[30px] border border-slate-200/70 bg-white p-8 shadow-[0_30px_80px_-55px_rgba(15,23,42,0.45)]">
        <div className="rounded-3xl border border-slate-200/70 bg-slate-50/70 p-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-500">
                Modulo margenes
              </p>
              <h1 className="mt-2 bg-linear-to-r from-blue-700 via-indigo-700 to-amber-700 bg-clip-text text-2xl font-semibold text-transparent">
                Margenes por sede y linea
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Datos reales de venta, costo, utilidad y porcentaje de margen.
              </p>
            </div>

            <div className="w-full max-w-md rounded-2xl border border-blue-100/80 bg-linear-to-r from-blue-50/65 via-white to-sky-50/65 px-4 py-3 shadow-[0_16px_34px_-28px_rgba(37,99,235,0.35)]">
              <div className="flex items-center justify-center gap-4 sm:gap-5">
                <Image
                  src="/logos/mercamio.jpeg"
                  alt="Logo MercaMio"
                  width={220}
                  height={70}
                  className="h-12 w-auto sm:h-14"
                  priority
                />
                <Image
                  src="/logos/mercatodo.jpeg"
                  alt="Logo MercaTodo"
                  width={220}
                  height={70}
                  className="h-12 w-auto sm:h-14"
                  priority
                />
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200/70 bg-white px-4 py-3 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.35)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-500">
                Rango de fechas
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <label className="text-xs font-semibold text-slate-600">
                  Desde
                  <input
                    type="date"
                    value={dateRange.start}
                    onChange={(e) =>
                      setDateRange((prev) => ({
                        start: e.target.value,
                        end: e.target.value > prev.end ? e.target.value : prev.end,
                      }))
                    }
                    className="ml-2 rounded-full border border-slate-200/70 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Hasta
                  <input
                    type="date"
                    value={dateRange.end}
                    onChange={(e) =>
                      setDateRange((prev) => ({
                        start: e.target.value < prev.start ? e.target.value : prev.start,
                        end: e.target.value,
                      }))
                    }
                    className="ml-2 rounded-full border border-slate-200/70 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                </label>
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push("/secciones")}
              className="inline-flex h-fit items-center justify-center rounded-full border border-slate-200/70 bg-white px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-100"
            >
              Cambiar seccion
            </button>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/70 bg-white px-4 py-3 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.25)]">
            <label className="text-xs font-semibold text-slate-600">
              Empresa (max 2)
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
                className="ml-2 rounded-full border border-slate-200/70 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
              >
                <option value="">Seleccionar empresa</option>
                {companyOptions.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </label>

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
                      setSelectedCompanies((prev) =>
                        prev.filter((id) => id !== companyId),
                      )
                    }
                    className="rounded-full border border-slate-200/70 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 transition-all hover:border-slate-300"
                  >
                    {label} x
                  </button>
                );
              })}
            </div>

            <label className="text-xs font-semibold text-slate-600">
              Sede
              <select
                value={selectedSede}
                onChange={(e) => {
                  setSelectedSede(e.target.value);
                  if (e.target.value) setSelectedCompanies([]);
                }}
                className="ml-2 rounded-full border border-slate-200/70 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
              >
                <option value="">Todas las sedes</option>
                {orderedSedes.map((sede) => (
                  <option key={sede.id} value={sede.id}>
                    {sede.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-semibold text-slate-600">
              Linea
              <select
                value=""
                onChange={(e) => {
                  const value = e.target.value;
                  if (!value) return;
                  setSelectedLineIds((prev) =>
                    prev.includes(value) ? prev : [...prev, value],
                  );
                }}
                className="ml-2 rounded-full border border-slate-200/70 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
              >
                <option value="">Todas las lineas</option>
                {orderedLineItems.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.name} ({line.id})
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap gap-2">
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
                    className="rounded-full border border-sky-200/80 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800 transition-all hover:border-sky-300"
                  >
                    {label} ({lineId}) x
                  </button>
                );
              })}
              {selectedLineIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedLineIds([])}
                  className="rounded-full border border-slate-200/70 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition-all hover:border-slate-300"
                >
                  Limpiar lineas
                </button>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-amber-200/70 bg-amber-50 px-4 py-2 text-sm text-amber-700">
            {error}
          </div>
        )}

        {isLoading && (
          <p className="mt-6 text-sm text-slate-600">Cargando datos...</p>
        )}

        {!isLoading && selectedDay && (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Venta rango
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-900">
                  {formatCurrency(rangeTotals.sales)}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Costo rango
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-900">
                  {formatCurrency(rangeTotals.cost)}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Utilidad rango
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-900">
                  {formatCurrency(rangeTotals.profit)}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Margen rango
                </p>
                <p
                  className={`mt-2 text-lg font-semibold ${getMarginToneClass(getMarginRatio(rangeTotals))}`}
                >
                  {formatMarginPct(rangeTotals)}
                </p>
              </div>
            </div>

            <div className="mt-8 overflow-x-auto rounded-2xl border border-slate-200/70 bg-white shadow-[0_18px_40px_-34px_rgba(15,23,42,0.25)]">
              <table className="min-w-full text-sm text-slate-700">
                <thead className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Sede</th>
                    <th className="px-4 py-3 text-right font-semibold">% dia</th>
                    <th className="px-4 py-3 text-right font-semibold">% mes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSedes.map((sede, index) => {
                    const dayTotals = marginsBySede.dayMap.get(sede.id) ?? EMPTY_TOTALS;
                    const monthTotals = marginsBySede.monthMap.get(sede.id) ?? EMPTY_TOTALS;
                    return (
                      <tr
                        key={sede.id}
                        className={index % 2 === 0 ? "bg-white" : "bg-slate-50/60"}
                      >
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          {sede.name}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-semibold ${getMarginToneClass(getMarginRatio(dayTotals))}`}
                        >
                          {formatMarginPct(dayTotals)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-semibold ${getMarginToneClass(getMarginRatio(monthTotals))}`}
                        >
                          {formatMarginPct(monthTotals)}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-slate-200 bg-slate-100/80">
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      Total seleccionadas
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold ${getMarginToneClass(getMarginRatio(marginsBySede.totalDay))}`}
                    >
                      {formatMarginPct(marginsBySede.totalDay)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold ${getMarginToneClass(getMarginRatio(marginsBySede.totalMonth))}`}
                    >
                      {formatMarginPct(marginsBySede.totalMonth)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-8 overflow-x-auto rounded-2xl border border-slate-200/70 bg-white shadow-[0_18px_40px_-34px_rgba(15,23,42,0.25)]">
              <div className="flex flex-wrap items-center justify-end gap-2 border-b border-slate-200/70 px-4 py-3">
                <label className="text-xs font-semibold text-slate-600">
                  Ordenar por
                  <select
                    value={lineSortBy}
                    onChange={(e) => setLineSortBy(e.target.value as "day" | "month")}
                    className="ml-2 rounded-full border border-slate-200/70 bg-white px-3 py-1 text-xs text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="day">% dia</option>
                    <option value="month">% mes</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setLineSortOrder((prev) => (prev === "desc" ? "asc" : "desc"))
                  }
                  className="rounded-full border border-slate-200/70 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition-all hover:border-slate-300"
                >
                  {lineSortOrder === "desc" ? "Mayor a menor" : "Menor a mayor"}
                </button>
              </div>
              <table className="min-w-full text-sm text-slate-700">
                <thead className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Linea</th>
                    <th className="px-4 py-3 text-right font-semibold">% dia</th>
                    <th className="px-4 py-3 text-right font-semibold">% mes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedVisibleLineItems.length === 0 && (
                    <tr>
                      <td className="px-4 py-5 text-center text-sm text-slate-500" colSpan={3}>
                        No hay lineas para el filtro seleccionado.
                      </td>
                    </tr>
                  )}
                  {sortedVisibleLineItems.map((line, index) => {
                    const dayTotals = marginsByLine.dayMap.get(line.id) ?? EMPTY_TOTALS;
                    const monthTotals = marginsByLine.monthMap.get(line.id) ?? EMPTY_TOTALS;
                    return (
                      <tr
                        key={line.id}
                        className={index % 2 === 0 ? "bg-white" : "bg-slate-50/60"}
                      >
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          <div className="flex flex-col">
                            <span>{line.name}</span>
                            <span className="font-mono text-sm font-semibold text-slate-600">
                              {line.id}
                            </span>
                          </div>
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-semibold ${getMarginToneClass(getMarginRatio(dayTotals))}`}
                        >
                          {formatMarginPct(dayTotals)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-semibold ${getMarginToneClass(getMarginRatio(monthTotals))}`}
                        >
                          {formatMarginPct(monthTotals)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!isLoading && !selectedDay && (
          <p className="mt-6 text-sm text-slate-600">No hay datos disponibles.</p>
        )}

        <div className="mt-8">
          <button
            type="button"
            onClick={() => router.push("/secciones")}
            className="w-full rounded-full border border-slate-200/70 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700 transition-all hover:border-slate-300 hover:text-slate-900"
          >
            Volver a secciones
          </button>
        </div>
      </div>
    </div>
  );
}
