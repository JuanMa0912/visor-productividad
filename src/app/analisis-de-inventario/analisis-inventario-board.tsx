"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronUp,
  Download,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import {
  DI_BAND_LABELS,
  diHeatmapStyle,
  diPillClassName,
  formatDiDays,
  NO_SALES_DI_VALUE,
  type DiBand,
} from "@/lib/analisis-inventario/di";
import { ANALISIS_INVENTARIO_LEVEL_NAMES } from "@/lib/analisis-inventario/drill-path";
import { downloadAnalisisInventarioExcel } from "@/lib/analisis-inventario/export-excel";
import type { AnalisisInventarioFilterCatalog } from "@/lib/analisis-inventario/filters";
import {
  ANALISIS_INVENTARIO_LINE_FAMILY_LABELS,
  type AnalisisInventarioLineFamily,
} from "@/lib/analisis-inventario/line-family";
import type {
  AnalisisInventarioDrillPayload,
  AnalisisInventarioDrillRow,
  AnalisisInventarioDrillStep,
  AnalisisInventarioHeatmapCell,
  AnalisisInventarioHeatmapPayload,
  AnalisisInventarioHeatmapRow,
  AnalisisInventarioMeta,
  AnalisisInventarioMetric,
} from "@/lib/analisis-inventario/types";
import { logExportDownload } from "@/lib/client/log-export-download";
import { empresaLabel } from "@/lib/margenes/margen-final-query";
import { DiMultiSelect } from "./di-multi-select";

type BoardProps = {
  username: string;
};

type DrillSortKey =
  | "name"
  | "proveedor"
  | "diUnits"
  | "diValue"
  | "inventoryUnits"
  | "inventoryValue"
  | "soldUnits"
  | "childCount";

const LEGEND_BANDS: DiBand[] = [
  "alta",
  "normal",
  "revisar",
  "sobrestock",
  "sin-venta",
];

const METRIC_STORAGE_KEY = "analisis-inventario:metric:v1";
const LINE_FAMILY_STORAGE_KEY = "analisis-inventario:line-family:v1";

const LINE_FAMILY_OPTIONS: AnalisisInventarioLineFamily[] = [
  "all",
  "perecederos",
  "manufactura",
];

/** Al cambiar familia, quita pasos de línea/sublínea/ítem del path. */
const stripLineFamilyPath = (steps: AnalisisInventarioDrillStep[]) => {
  const cut = steps.findIndex(
    (step) =>
      step.type === "linea" ||
      step.type === "sublinea" ||
      step.type === "item",
  );
  return cut >= 0 ? steps.slice(0, cut) : steps;
};

const money = (value: number) =>
  value.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });

const units = (value: number) =>
  value.toLocaleString("es-CO", { maximumFractionDigits: 1 });

const scrollToId = (id: string) => {
  const node = document.getElementById(id);
  if (!node) return;
  const top = node.getBoundingClientRect().top + window.scrollY - 88;
  window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
};

const diSortValue = (value: number) =>
  !Number.isFinite(value) || value >= NO_SALES_DI_VALUE ? Number.POSITIVE_INFINITY : value;

const appendDimensionParams = (
  params: URLSearchParams,
  args: {
    empresas: string[];
    sedes: string[];
    lineas: string[];
    sublineas: string[];
    items: string[];
    diMin: number | null;
    metric?: "units" | "value";
  },
) => {
  if (args.empresas.length > 0) params.set("empresas", args.empresas.join(","));
  if (args.sedes.length > 0) params.set("sedes", args.sedes.join(","));
  if (args.lineas.length > 0) params.set("lineas", args.lineas.join(","));
  if (args.sublineas.length > 0)
    params.set("sublineas", args.sublineas.join(","));
  if (args.items.length > 0) params.set("items", args.items.join(","));
  if (args.diMin != null && args.diMin > 0) {
    params.set("diMin", String(args.diMin));
  }
  if (args.metric) params.set("metric", args.metric);
};

export function AnalisisInventarioBoard(_props: BoardProps) {
  const [meta, setMeta] = useState<AnalisisInventarioMeta | null>(null);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [metric, setMetric] = useState<AnalisisInventarioMetric>("units");
  const [lineFamily, setLineFamily] =
    useState<AnalisisInventarioLineFamily>("all");
  const [path, setPath] = useState<AnalisisInventarioDrillStep[]>([]);
  const [heatmapPath, setHeatmapPath] = useState<AnalisisInventarioDrillStep[]>(
    [],
  );
  const [drill, setDrill] = useState<AnalisisInventarioDrillPayload | null>(
    null,
  );
  const [heatmap, setHeatmap] =
    useState<AnalisisInventarioHeatmapPayload | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [drillQuery, setDrillQuery] = useState("");
  const [sortKey, setSortKey] = useState<DrillSortKey>("inventoryValue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  /**
   * Orden de filas del mapa:
   * - `label`: por código de línea/categoría (como hoy).
   * - `sede`: por DI de esa columna (menos→mayor / mayor→menos).
   */
  const [heatmapSortBy, setHeatmapSortBy] = useState<"label" | "sede">("label");
  const [heatmapSortSedeKey, setHeatmapSortSedeKey] = useState<string | null>(
    null,
  );
  const [heatmapSortDir, setHeatmapSortDir] = useState<"asc" | "desc">("asc");
  /** Detalle por sede: ordenar por DI (default menos → mayor días). */
  const [sedeDetailSortKey, setSedeDetailSortKey] = useState<
    "sede" | "diUnits" | "diValue" | "inventoryUnits" | "inventoryValue"
  >("diUnits");
  const [sedeDetailSortDir, setSedeDetailSortDir] = useState<"asc" | "desc">(
    "asc",
  );
  const [exportingExcel, setExportingExcel] = useState(false);
  const [selectedEmpresas, setSelectedEmpresas] = useState<string[]>([]);
  const [selectedSedes, setSelectedSedes] = useState<string[]>([]);
  const [selectedLineas, setSelectedLineas] = useState<string[]>([]);
  const [selectedSublineas, setSelectedSublineas] = useState<string[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [diMinInput, setDiMinInput] = useState("");
  const [diMinApplied, setDiMinApplied] = useState<number | null>(null);
  const [filterCatalog, setFilterCatalog] =
    useState<AnalisisInventarioFilterCatalog | null>(null);
  const [itemFilterQuery, setItemFilterQuery] = useState("");
  const [itemFilterOptions, setItemFilterOptions] = useState<
    AnalisisInventarioFilterCatalog["items"]
  >([]);
  const [sedeDetailRow, setSedeDetailRow] =
    useState<AnalisisInventarioHeatmapRow | null>(null);
  const heatmapClickTimerRef = useRef<number | null>(null);

  const skipNextFetchRef = useRef(false);
  const bootstrappedRef = useRef(false);
  const pendingScrollToDrillRef = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(METRIC_STORAGE_KEY);
      if (raw === "units" || raw === "value") setMetric(raw);
    } catch {
      // ignore
    }
    try {
      const rawFamily = window.localStorage.getItem(LINE_FAMILY_STORAGE_KEY);
      if (
        rawFamily === "all" ||
        rawFamily === "perecederos" ||
        rawFamily === "manufactura"
      ) {
        setLineFamily(rawFamily);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(METRIC_STORAGE_KEY, metric);
    } catch {
      // ignore
    }
  }, [metric]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LINE_FAMILY_STORAGE_KEY, lineFamily);
    } catch {
      // ignore
    }
  }, [lineFamily]);

  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 420);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 45_000);

    const loadBoard = async () => {
      setLoadingBoard(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("mode", "board");
        if (dateStart) params.set("dateStart", dateStart);
        if (dateEnd) params.set("dateEnd", dateEnd);
        if (lineFamily !== "all") params.set("lineFamily", lineFamily);
        if (path.length > 0) params.set("drillPath", JSON.stringify(path));
        if (heatmapPath.length > 0) {
          params.set("heatmapPath", JSON.stringify(heatmapPath));
        }
        appendDimensionParams(params, {
          empresas: selectedEmpresas,
          sedes: selectedSedes,
          lineas: selectedLineas,
          sublineas: selectedSublineas,
          items: selectedItems,
          diMin: diMinApplied,
          metric,
        });
        const response = await fetch(
          `/api/analisis-de-inventario?${params.toString()}`,
          {
            cache: "no-store",
            credentials: "include",
            signal: controller.signal,
          },
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error ?? "No se pudo cargar el tablero.");
        }
        const nextMeta = payload.meta as AnalisisInventarioMeta | undefined;
        if (nextMeta) {
          setMeta(nextMeta);
          if (!bootstrappedRef.current) {
            bootstrappedRef.current = true;
            const nextStart =
              nextMeta.selectedDateStart || nextMeta.defaultDateStart || "";
            const nextEnd =
              nextMeta.selectedDateEnd || nextMeta.defaultDateEnd || "";
            if (nextStart && nextEnd) {
              skipNextFetchRef.current = true;
              setDateStart(nextStart);
              setDateEnd(nextEnd);
            }
          }
        }
        setDrill(payload.drill as AnalisisInventarioDrillPayload);
        setHeatmap(payload.heatmap as AnalisisInventarioHeatmapPayload);
        if (typeof payload.message === "string") setMessage(payload.message);
        setDrillQuery("");
      } catch (err) {
        if (controller.signal.aborted) {
          if (timedOut) {
            setError(
              "La consulta superó el tiempo de espera. Recarga o acota el periodo.",
            );
          }
          return;
        }
        setError(err instanceof Error ? err.message : "Error de carga.");
      } finally {
        window.clearTimeout(timeoutId);
        setLoadingBoard(false);
      }
    };

    void loadBoard();
    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [
    dateStart,
    dateEnd,
    path,
    heatmapPath,
    lineFamily,
    selectedEmpresas,
    selectedSedes,
    selectedLineas,
    selectedSublineas,
    selectedItems,
    diMinApplied,
    metric,
  ]);

  useEffect(() => {
    if (!dateStart || !dateEnd) return;
    const controller = new AbortController();
    const loadFilters = async () => {
      try {
        const params = new URLSearchParams();
        params.set("mode", "filters");
        params.set("dateStart", dateStart);
        params.set("dateEnd", dateEnd);
        if (lineFamily !== "all") params.set("lineFamily", lineFamily);
        appendDimensionParams(params, {
          empresas: selectedEmpresas,
          sedes: selectedSedes,
          lineas: selectedLineas,
          sublineas: [],
          items: [],
          diMin: null,
        });
        const response = await fetch(
          `/api/analisis-de-inventario?${params.toString()}`,
          {
            cache: "no-store",
            credentials: "include",
            signal: controller.signal,
          },
        );
        const payload = await response.json();
        if (!response.ok) return;
        setFilterCatalog(
          (payload.filters as AnalisisInventarioFilterCatalog) ?? null,
        );
      } catch {
        if (controller.signal.aborted) return;
      }
    };
    void loadFilters();
    return () => controller.abort();
  }, [
    dateStart,
    dateEnd,
    lineFamily,
    selectedEmpresas,
    selectedSedes,
    selectedLineas,
  ]);

  useEffect(() => {
    const q = itemFilterQuery.trim();
    if (q.length < 2 || !dateStart || !dateEnd) {
      setItemFilterOptions([]);
      return;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams();
          params.set("mode", "filters");
          params.set("dateStart", dateStart);
          params.set("dateEnd", dateEnd);
          params.set("itemQuery", q);
          if (lineFamily !== "all") params.set("lineFamily", lineFamily);
          appendDimensionParams(params, {
            empresas: selectedEmpresas,
            sedes: selectedSedes,
            lineas: selectedLineas,
            sublineas: selectedSublineas,
            items: [],
            diMin: null,
          });
          const response = await fetch(
            `/api/analisis-de-inventario?${params.toString()}`,
            {
              cache: "no-store",
              credentials: "include",
              signal: controller.signal,
            },
          );
          const payload = await response.json();
          if (!response.ok) return;
          const catalog = payload.filters as AnalisisInventarioFilterCatalog;
          setItemFilterOptions(catalog?.items ?? []);
        } catch {
          if (controller.signal.aborted) return;
        }
      })();
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [
    itemFilterQuery,
    dateStart,
    dateEnd,
    lineFamily,
    selectedEmpresas,
    selectedSedes,
    selectedLineas,
    selectedSublineas,
  ]);

  useEffect(() => {
    if (!pendingScrollToDrillRef.current || loadingBoard) return;
    pendingScrollToDrillRef.current = false;
    scrollToId("di-drill");
  }, [loadingBoard, drill]);

  useEffect(() => {
    setHeatmapSortBy("label");
    setHeatmapSortSedeKey(null);
    setHeatmapSortDir("asc");
  }, [heatmap?.rowLevel]);

  useEffect(() => {
    if (!sedeDetailRow) return;
    setSedeDetailSortKey(metric === "value" ? "diValue" : "diUnits");
    setSedeDetailSortDir("asc");
  }, [sedeDetailRow?.id, metric]);

  const cellByKey = useMemo(() => {
    const map = new Map<string, AnalisisInventarioHeatmapCell>();
    for (const cell of heatmap?.cells ?? []) {
      map.set(`${cell.rowId}::${cell.sedeKey}`, cell);
    }
    return map;
  }, [heatmap]);

  const sedeDetailRows = useMemo(() => {
    if (!sedeDetailRow || !heatmap) return [];
    const rows = heatmap.columns.map((col) => {
      const cell = cellByKey.get(`${sedeDetailRow.id}::${col.key}`);
      return {
        key: col.key,
        label: col.label,
        inventoryUnits: cell?.inventoryUnits ?? 0,
        inventoryValue: cell?.inventoryValue ?? 0,
        diUnits: cell?.diUnits ?? Number.NaN,
        diValue: cell?.diValue ?? Number.NaN,
        hasData: Boolean(cell),
      };
    });
    const dir = sedeDetailSortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const pick = (row: (typeof rows)[number]) => {
        switch (sedeDetailSortKey) {
          case "sede":
            return row.label.toLowerCase();
          case "diUnits":
            return diSortValue(row.diUnits);
          case "diValue":
            return diSortValue(row.diValue);
          case "inventoryUnits":
            return row.hasData ? row.inventoryUnits : Number.NEGATIVE_INFINITY;
          case "inventoryValue":
            return row.hasData ? row.inventoryValue : Number.NEGATIVE_INFINITY;
        }
      };
      const av = pick(a);
      const bv = pick(b);
      if (typeof av === "string" && typeof bv === "string") {
        return av.localeCompare(bv, "es") * dir;
      }
      const an = Number(av);
      const bn = Number(bv);
      if (an !== bn) return (an - bn) * dir;
      return a.label.localeCompare(b.label, "es");
    });
  }, [
    sedeDetailRow,
    heatmap,
    cellByKey,
    sedeDetailSortKey,
    sedeDetailSortDir,
  ]);

  const sortedHeatmapRows = useMemo(() => {
    if (!heatmap) return [];
    const dir = heatmapSortDir === "asc" ? 1 : -1;
    if (heatmapSortBy === "sede" && heatmapSortSedeKey) {
      const sedeKey = heatmapSortSedeKey;
      return [...heatmap.rows].sort((a, b) => {
        const cellA = cellByKey.get(`${a.id}::${sedeKey}`);
        const cellB = cellByKey.get(`${b.id}::${sedeKey}`);
        const diA = diSortValue(
          metric === "value"
            ? (cellA?.diValue ?? Number.NaN)
            : (cellA?.diUnits ?? Number.NaN),
        );
        const diB = diSortValue(
          metric === "value"
            ? (cellB?.diValue ?? Number.NaN)
            : (cellB?.diUnits ?? Number.NaN),
        );
        if (diA !== diB) return (diA - diB) * dir;
        return a.id.localeCompare(b.id, "es", { numeric: true });
      });
    }
    return [...heatmap.rows].sort(
      (a, b) => a.id.localeCompare(b.id, "es", { numeric: true }) * dir,
    );
  }, [
    heatmap,
    heatmapSortDir,
    heatmapSortBy,
    heatmapSortSedeKey,
    cellByKey,
    metric,
  ]);

  const toggleHeatmapLabelSort = () => {
    if (heatmapSortBy === "label") {
      setHeatmapSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setHeatmapSortBy("label");
    setHeatmapSortSedeKey(null);
    setHeatmapSortDir("asc");
  };

  const toggleHeatmapSedeSort = (sedeKey: string) => {
    if (heatmapSortBy === "sede" && heatmapSortSedeKey === sedeKey) {
      setHeatmapSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setHeatmapSortBy("sede");
    setHeatmapSortSedeKey(sedeKey);
    setHeatmapSortDir("asc");
  };

  const toggleSedeDetailSort = (
    key: "sede" | "diUnits" | "diValue" | "inventoryUnits" | "inventoryValue",
  ) => {
    if (sedeDetailSortKey === key) {
      setSedeDetailSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSedeDetailSortKey(key);
    setSedeDetailSortDir(
      key === "diUnits" || key === "diValue" ? "asc" : "desc",
    );
  };

  const heatmapSortHint = (active: boolean) => {
    if (!active) return "";
    return heatmapSortDir === "asc" ? " ↑" : " ↓";
  };

  const sedeDetailSortHint = (key: typeof sedeDetailSortKey) => {
    if (sedeDetailSortKey !== key) return "";
    return sedeDetailSortDir === "asc" ? " ↑" : " ↓";
  };

  const empresaOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: { value: string; label: string }[] = [];
    for (const sede of meta?.sedes ?? []) {
      const key = sede.empresa.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      opts.push({ value: key, label: empresaLabel(key) });
    }
    return opts.sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [meta?.sedes]);

  const sedeOptions = useMemo(() => {
    const sedes = meta?.sedes ?? [];
    const filtered =
      selectedEmpresas.length > 0
        ? sedes.filter((s) =>
            selectedEmpresas.includes(s.empresa.toLowerCase()),
          )
        : sedes;
    return filtered.map((s) => ({ value: s.key, label: s.label }));
  }, [meta?.sedes, selectedEmpresas]);

  const lineaOptions = filterCatalog?.lineas ?? [];
  const sublineaOptions = useMemo(() => {
    const all = filterCatalog?.sublineas ?? [];
    if (selectedSublineas.length === 0) return all;
    const selected = new Set(selectedSublineas);
    const missing = selectedSublineas
      .filter((id) => !all.some((o) => o.value === id))
      .map((id) => ({ value: id, label: id }));
    return [...all, ...missing];
  }, [filterCatalog?.sublineas, selectedSublineas]);

  const itemOptions = useMemo(() => {
    const fromSearch = itemFilterOptions;
    const selectedMissing = selectedItems
      .filter((id) => !fromSearch.some((o) => o.value === id))
      .map((id) => ({ value: id, label: id }));
    return [...fromSearch, ...selectedMissing];
  }, [itemFilterOptions, selectedItems]);

  const applyDiMin = () => {
    const raw = diMinInput.replace(",", ".").trim();
    if (!raw) {
      setDiMinApplied(null);
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    // DI se busca a nivel ítem en el alcance de los MultiSelect (vacío = todo).
    setPath([]);
    setHeatmapPath([]);
    setDiMinApplied(n);
  };

  const filteredDrillRows = useMemo(() => {
    const rows = drill?.rows ?? [];
    const q = drillQuery.trim().toLowerCase();
    const filtered = q
      ? rows.filter(
          (row) =>
            row.label.toLowerCase().includes(q) ||
            row.id.toLowerCase().includes(q) ||
            (row.description ?? "").toLowerCase().includes(q) ||
            (row.proveedorLabel ?? "").toLowerCase().includes(q) ||
            (row.proveedorId ?? "").toLowerCase().includes(q),
        )
      : rows;

    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const pick = (row: AnalisisInventarioDrillRow) => {
        switch (sortKey) {
          case "name":
            return row.label.toLowerCase();
          case "proveedor":
            return (row.proveedorLabel ?? row.proveedorId ?? "").toLowerCase();
          case "diUnits":
            return diSortValue(row.diUnits);
          case "diValue":
            return diSortValue(row.diValue);
          case "inventoryUnits":
            return row.inventoryUnits;
          case "inventoryValue":
            return row.inventoryValue;
          case "soldUnits":
            return row.soldUnits;
          case "childCount":
            return row.childCount;
        }
      };
      const av = pick(a);
      const bv = pick(b);
      if (typeof av === "string" && typeof bv === "string") {
        return av.localeCompare(bv, "es") * dir;
      }
      return ((av as number) - (bv as number)) * dir;
    });
  }, [drill, drillQuery, sortDir, sortKey]);

  const openDrillRow = (step: AnalisisInventarioDrillStep) => {
    if (step.type === "item") return;
    setPath((prev) => [...prev, step]);
  };

  const openHeatmapRow = (step: AnalisisInventarioDrillStep) => {
    if (step.type === "item") return;
    setHeatmapPath((prev) => {
      const withoutSame = prev.filter((entry) => entry.type !== step.type);
      return [...withoutSame, step];
    });
    scrollToId("di-heatmap");
  };

  const clearHeatmapClickTimer = () => {
    if (heatmapClickTimerRef.current != null) {
      window.clearTimeout(heatmapClickTimerRef.current);
      heatmapClickTimerRef.current = null;
    }
  };

  /** Clic simple profundiza; doble clic muestra detalle por sede. */
  const scheduleHeatmapDeepen = (step: AnalisisInventarioDrillStep) => {
    if (step.type === "item") return;
    clearHeatmapClickTimer();
    heatmapClickTimerRef.current = window.setTimeout(() => {
      heatmapClickTimerRef.current = null;
      openHeatmapRow(step);
    }, 280);
  };

  const openSedeDetail = (row: AnalisisInventarioHeatmapRow) => {
    clearHeatmapClickTimer();
    setSedeDetailRow(row);
  };

  useEffect(() => {
    return () => clearHeatmapClickTimer();
  }, []);

  useEffect(() => {
    if (!sedeDetailRow) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSedeDetailRow(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sedeDetailRow]);

  const heatmapRowLevelLabel =
    heatmap?.rowLevel === "linea"
      ? "líneas"
      : heatmap?.rowLevel === "sublinea"
        ? "sublíneas"
        : heatmap?.rowLevel === "item"
          ? "ítems"
          : "categorías";

  const formatHeatmapRowLabel = (row: {
    id: string;
    label: string;
    level: string;
    proveedorLabel?: string | null;
  }) => {
    if (row.level === "linea" && row.id && !row.id.startsWith("__")) {
      return `${row.id} · ${row.label}`;
    }
    if (row.level === "item" && row.id && !row.id.startsWith("__")) {
      const base = `${row.id} · ${row.label}`;
      return row.proveedorLabel ? `${base} · ${row.proveedorLabel}` : base;
    }
    return row.label;
  };

  const goUpOneLevel = () => {
    setPath((prev) => prev.slice(0, -1));
  };

  const resetNavigation = () => {
    setPath([]);
    setHeatmapPath([]);
    setDrillQuery("");
    setSelectedEmpresas([]);
    setSelectedSedes([]);
    setSelectedLineas([]);
    setSelectedSublineas([]);
    setSelectedItems([]);
    setDiMinInput("");
    setDiMinApplied(null);
    setItemFilterQuery("");
    scrollToId("di-filters");
  };

  const applyLineFamily = (next: AnalisisInventarioLineFamily) => {
    if (next === lineFamily) return;
    setLineFamily(next);
    setPath((prev) => stripLineFamilyPath(prev));
    setHeatmapPath((prev) => stripLineFamilyPath(prev));
    setSelectedLineas([]);
    setSelectedSublineas([]);
    setSelectedItems([]);
    setDrillQuery("");
  };

  const exportExcel = async () => {
    if (!drill || exportingExcel) return;
    setExportingExcel(true);
    try {
      const result = await downloadAnalisisInventarioExcel({
        dateStart,
        dateEnd,
        metric,
        lineFamily,
        drill,
        heatmap,
        drillPath: path,
        heatmapPath,
      });
      logExportDownload({
        panelPath: "/analisis-de-inventario",
        panelLabel: "Días de inventario",
        exportKind: "dias-inventario-board",
        format: "xlsx",
        fileName: result.fileName,
        dateFrom: dateStart,
        dateTo: dateEnd,
        filters: { metric, lineFamily, drillLevel: drill.level },
        rowCount: result.rowCount,
        byteSize: result.byteSize,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo generar el Excel.",
      );
    } finally {
      setExportingExcel(false);
    }
  };

  const toggleSort = (key: DrillSortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "name" ? "asc" : "desc");
  };

  const sortHint = (key: DrillSortKey) => {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  const levelTitle =
    ANALISIS_INVENTARIO_LEVEL_NAMES[
      path.length >= ANALISIS_INVENTARIO_LEVEL_NAMES.length
        ? ANALISIS_INVENTARIO_LEVEL_NAMES.length - 1
        : path.length
    ] ?? "Sede";

  const applyRollingMonth = () => {
    if (meta?.defaultDateStart && meta.defaultDateEnd) {
      setDateStart(meta.defaultDateStart);
      setDateEnd(meta.defaultDateEnd);
    }
  };

  return (
    <div className="space-y-6">
      <div id="di-filters" className="space-y-3">
        {/* Barra compacta fija: no tapa el mapa al hacer scroll. */}
        <section className="sticky top-14 z-40 rounded-2xl border border-slate-200/90 bg-white/95 px-4 py-3 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.45)] backdrop-blur-md sm:top-16 sm:px-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Desde
                <input
                  type="date"
                  value={dateStart}
                  min={meta?.availableDateStart || undefined}
                  max={meta?.availableDateEnd || undefined}
                  onChange={(event) => setDateStart(event.target.value)}
                  className="mt-1 block h-9 rounded-lg border border-slate-200 px-3 text-sm text-slate-900"
                />
              </label>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Hasta
                <input
                  type="date"
                  value={dateEnd}
                  min={meta?.availableDateStart || undefined}
                  max={meta?.availableDateEnd || undefined}
                  onChange={(event) => setDateEnd(event.target.value)}
                  className="mt-1 block h-9 rounded-lg border border-slate-200 px-3 text-sm text-slate-900"
                />
              </label>
              <button
                type="button"
                onClick={applyRollingMonth}
                className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Mes móvil
              </button>
              <div className="flex h-9 items-center rounded-lg border border-slate-200 p-0.5">
                <button
                  type="button"
                  onClick={() => setMetric("units")}
                  className={`h-full rounded-md px-3 text-xs font-semibold ${
                    metric === "units"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  DI und
                </button>
                <button
                  type="button"
                  onClick={() => setMetric("value")}
                  className={`h-full rounded-md px-3 text-xs font-semibold ${
                    metric === "value"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  DI valor
                </button>
              </div>
              <div
                className="flex h-9 items-center rounded-lg border border-slate-200 p-0.5"
                role="group"
                aria-label="Familia de líneas"
              >
                {LINE_FAMILY_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => applyLineFamily(option)}
                    className={`h-full rounded-md px-2.5 text-xs font-semibold ${
                      lineFamily === option
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                    title={
                      option === "perecederos"
                        ? "Líneas 01, 02, 03, 04 y 12"
                        : option === "manufactura"
                          ? "Resto de líneas N1"
                          : "Todas las líneas"
                    }
                  >
                    {ANALISIS_INVENTARIO_LINE_FAMILY_LABELS[option]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={resetNavigation}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                title="Limpiar filtros y volver a la raíz"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Reiniciar
              </button>
              <button
                type="button"
                onClick={() => void exportExcel()}
                disabled={exportingExcel || loadingBoard || !drill}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="Descargar Excel del drill y mapa de calor"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                {exportingExcel ? "Generando…" : "Excel"}
              </button>
              <button
                type="button"
                onClick={() => scrollToId("di-heatmap")}
                className="h-9 rounded-lg bg-slate-100 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-200"
              >
                Mapa
              </button>
              <button
                type="button"
                onClick={() => scrollToId("di-drill")}
                className="h-9 rounded-lg bg-slate-100 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-200"
              >
                Drill
              </button>
            </div>
          </div>
        </section>

        {/* Alcance / umbral / leyenda: scrollean con la página (no tapan sedes). */}
        <section className="space-y-3 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.28)] sm:p-5">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Alcance
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <DiMultiSelect
                label="Empresas"
                values={selectedEmpresas}
                options={empresaOptions}
                emptyLabel="Todas"
                onChange={(next) => {
                  setSelectedEmpresas(next);
                  setSelectedSedes((prev) =>
                    prev.filter((key) => {
                      const sede = meta?.sedes.find((s) => s.key === key);
                      return sede
                        ? next.length === 0 ||
                            next.includes(sede.empresa.toLowerCase())
                        : false;
                    }),
                  );
                }}
              />
              <DiMultiSelect
                label="Sedes"
                values={selectedSedes}
                options={sedeOptions}
                emptyLabel="Todas"
                searchable
                onChange={setSelectedSedes}
              />
              <DiMultiSelect
                label="Líneas"
                values={selectedLineas}
                options={lineaOptions}
                emptyLabel="Todas"
                searchable
                onChange={(next) => {
                  setSelectedLineas(next);
                  setSelectedSublineas([]);
                  setSelectedItems([]);
                  setPath((prev) => stripLineFamilyPath(prev));
                  setHeatmapPath((prev) => stripLineFamilyPath(prev));
                }}
              />
              <DiMultiSelect
                label="Sublíneas"
                values={selectedSublineas}
                options={sublineaOptions}
                emptyLabel="Todas"
                searchable
                onChange={(next) => {
                  setSelectedSublineas(next);
                  setSelectedItems([]);
                }}
              />
              <DiMultiSelect
                label="Ítems"
                values={selectedItems}
                options={itemOptions}
                emptyLabel="Todas"
                searchable
                searchValue={itemFilterQuery}
                onSearchChange={setItemFilterQuery}
                searchPlaceholder="Código o descripción (≥2)"
                onChange={setSelectedItems}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3 border-t border-slate-100 pt-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                DI &gt; (días)
                <div className="mt-1 flex gap-1">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={diMinInput}
                    onChange={(event) => setDiMinInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") applyDiMin();
                    }}
                    placeholder="ej. 300"
                    className="h-9 w-28 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={applyDiMin}
                    className="h-9 shrink-0 rounded-lg border border-slate-200 px-3 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {diMinApplied != null ? "OK" : "Aplicar"}
                  </button>
                </div>
              </label>
              {diMinApplied != null ? (
                <button
                  type="button"
                  onClick={() => {
                    setDiMinApplied(null);
                    setDiMinInput("");
                  }}
                  className="mb-1.5 text-[11px] font-semibold text-blue-700 hover:underline"
                >
                  {`Quitar (> ${diMinApplied.toLocaleString("es-CO")} d)`}
                </button>
              ) : null}
              <p className="mb-1.5 max-w-xl text-[11px] leading-snug text-slate-500">
                {meta?.fastPath ? "Snapshot · " : ""}
                Sedes en orden Calle 5ta → Bogotá/Chía
                {lineFamily === "perecederos"
                  ? " · Perecederos (01–04, 12)"
                  : lineFamily === "manufactura"
                    ? " · Manufactura"
                    : ""}
                {diMinApplied != null
                  ? ` · Ítems DI ${metric === "value" ? "valor" : "und"} > ${diMinApplied.toLocaleString("es-CO")} d${
                      selectedEmpresas.length ||
                      selectedSedes.length ||
                      selectedLineas.length ||
                      selectedSublineas.length ||
                      selectedItems.length
                        ? " (selección)"
                        : " (todo)"
                    }`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {LEGEND_BANDS.map((band) => (
                <span
                  key={band}
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${diPillClassName(
                    band === "alta"
                      ? 10
                      : band === "normal"
                        ? 25
                        : band === "revisar"
                          ? 45
                          : band === "sobrestock"
                            ? 80
                            : 999999,
                  )}`}
                >
                  {DI_BAND_LABELS[band]}
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {message}
        </div>
      ) : null}

      <section
        id="di-heatmap"
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_34px_-28px_rgba(15,23,42,0.28)]"
      >
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Mapa de calor · {heatmapRowLevelLabel} × sedes
              </h2>
              <p className="text-xs text-slate-500">
                {diMinApplied != null
                  ? `Ítems con DI ${metric === "value" ? "valor" : "und"} > ${diMinApplied.toLocaleString("es-CO")} d. Alcance: ${
                      selectedEmpresas.length ||
                      selectedSedes.length ||
                      selectedLineas.length ||
                      selectedSublineas.length ||
                      selectedItems.length
                        ? "solo filtros seleccionados (empresa/sede/línea/sublínea/ítem)."
                        : "todas las empresas, sedes, líneas, sublíneas e ítems."
                    }`
                  : `Cascada: categoría → línea → sublínea → ítem. Clic profundiza · doble clic: unidades, valor y DI por sede. Clic en sede: ordena filas por DI (menos→mayor). Métrica: ${
                      metric === "units" ? "DI unidades" : "DI valor"
                    }.`}
              </p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setHeatmapPath([])}
              className="text-xs font-semibold text-blue-700 hover:underline"
            >
              Todas las categorías
            </button>
            {heatmapPath
              .filter((step) => step.type !== "sede")
              .map((step, index) => (
                <button
                  key={`${step.type}-${step.id}-${index}`}
                  type="button"
                  onClick={() =>
                    setHeatmapPath(
                      heatmapPath
                        .filter((entry) => entry.type !== "sede")
                        .slice(0, index + 1),
                    )
                  }
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700"
                >
                  {step.type === "linea" && step.id && !step.id.startsWith("__")
                    ? `${step.id} · ${step.label}`
                    : step.label}
                </button>
              ))}
            {heatmapPath.filter((step) => step.type !== "sede").length > 0 ? (
              <button
                type="button"
                onClick={() =>
                  setHeatmapPath((prev) => {
                    const clean = prev.filter((step) => step.type !== "sede");
                    return clean.slice(0, -1);
                  })
                }
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                Regresar
              </button>
            ) : null}
          </div>
        </div>
        <div className="max-h-[min(70vh,640px)] overflow-auto">
          {loadingBoard ? (
            <p className="px-4 py-8 text-sm text-slate-500">
              Cargando mapa de calor…
            </p>
          ) : !heatmap || heatmap.rows.length === 0 ? (
            <p className="px-4 py-8 text-sm text-slate-500">
              Sin datos para el periodo / sedes actuales.
            </p>
          ) : (
            <table className="min-w-full border-collapse text-xs">
              <thead className="sticky top-0 z-20">
                <tr className="bg-slate-50 text-left text-slate-600 shadow-sm">
                  <th className="sticky left-0 z-30 bg-slate-50 px-3 py-2 font-semibold">
                    <button
                      type="button"
                      onClick={toggleHeatmapLabelSort}
                      className="hover:text-slate-900"
                      title={
                        heatmapSortBy === "label" && heatmapSortDir === "asc"
                          ? "Orden: código ascendente. Clic para invertir."
                          : heatmapSortBy === "label"
                            ? "Orden: código descendente. Clic para invertir."
                            : "Ordenar filas por código (01 primero)."
                      }
                    >
                      {heatmap?.rowLevel === "categoria"
                        ? "Categoría"
                        : heatmap?.rowLevel === "linea"
                          ? "Línea"
                          : heatmap?.rowLevel === "sublinea"
                            ? "Sublínea"
                            : "Ítem"}
                      {heatmapSortHint(heatmapSortBy === "label")}
                    </button>
                  </th>
                  {heatmap.columns.map((col) => (
                    <th
                      key={col.key}
                      className="px-2 py-2 text-center font-semibold whitespace-nowrap"
                    >
                      <button
                        type="button"
                        onClick={() => toggleHeatmapSedeSort(col.key)}
                        className="hover:text-slate-900"
                        title={
                          heatmapSortBy === "sede" &&
                          heatmapSortSedeKey === col.key &&
                          heatmapSortDir === "asc"
                            ? `Orden: DI ${col.label} de menos a más días. Clic para invertir.`
                            : heatmapSortBy === "sede" &&
                                heatmapSortSedeKey === col.key
                              ? `Orden: DI ${col.label} de más a menos días. Clic para invertir.`
                              : `Ordenar filas por DI en ${col.label} (menos → mayor días).`
                        }
                      >
                        {col.label}
                        {heatmapSortHint(
                          heatmapSortBy === "sede" &&
                            heatmapSortSedeKey === col.key,
                        )}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedHeatmapRows.map((row) => {
                  const rowLabel = formatHeatmapRowLabel(row);
                  const canDeepen = row.level !== "item";
                  return (
                    <tr key={row.id} className="border-t border-slate-100">
                      <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-semibold text-slate-800">
                        {canDeepen ? (
                          <button
                            type="button"
                            onClick={() => scheduleHeatmapDeepen(row.drillStep)}
                            onDoubleClick={() => openSedeDetail(row)}
                            className="text-left text-blue-700 hover:underline"
                            title="Clic: profundizar · Doble clic: detalle por sede"
                          >
                            {rowLabel}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onDoubleClick={() => openSedeDetail(row)}
                            className="text-left text-slate-800 hover:text-blue-700"
                            title="Doble clic: detalle por sede"
                          >
                            {rowLabel}
                          </button>
                        )}
                      </th>
                      {heatmap.columns.map((col) => {
                        const cell = cellByKey.get(`${row.id}::${col.key}`);
                        const di = cell
                          ? metric === "units"
                            ? cell.diUnits
                            : cell.diValue
                          : Number.NaN;
                        const style = Number.isFinite(di)
                          ? diHeatmapStyle(di)
                          : diHeatmapStyle(999999);
                        return (
                          <td key={col.key} className="p-1">
                            {canDeepen ? (
                              <button
                                type="button"
                                onClick={() =>
                                  scheduleHeatmapDeepen(row.drillStep)
                                }
                                onDoubleClick={() => openSedeDetail(row)}
                                className="block w-full rounded-md px-2 py-2 text-center font-semibold tabular-nums"
                                style={style}
                                title={`${rowLabel} · ${col.label}: ${formatDiDays(di)} · clic profundiza · doble clic detalle`}
                              >
                                {Number.isFinite(di) ? formatDiDays(di) : "—"}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onDoubleClick={() => openSedeDetail(row)}
                                className="block w-full rounded-md px-2 py-2 text-center font-semibold tabular-nums"
                                style={style}
                                title={`${rowLabel} · ${col.label}: ${formatDiDays(di)} · doble clic detalle`}
                              >
                                {Number.isFinite(di) ? formatDiDays(di) : "—"}
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {sedeDetailRow ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="di-sede-detail-title"
          onClick={() => setSedeDetailRow(null)}
        >
          <div
            className="max-h-[min(85vh,720px)] w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div>
                <h3
                  id="di-sede-detail-title"
                  className="text-sm font-bold text-slate-900"
                >
                  Detalle por sede · {formatHeatmapRowLabel(sedeDetailRow)}
                </h3>
                <p className="text-xs text-slate-500">
                  Unidades y valor de inventario, más DI und y DI valor.
                  Orden inicial: DI de menos a más días.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSedeDetailRow(null)}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[min(70vh,600px)] overflow-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">
                      <button
                        type="button"
                        onClick={() => toggleSedeDetailSort("sede")}
                        className="hover:text-slate-900"
                      >
                        Sede
                        {sedeDetailSortHint("sede")}
                      </button>
                    </th>
                    <th className="px-3 py-2 text-right font-semibold">
                      <button
                        type="button"
                        onClick={() => toggleSedeDetailSort("inventoryUnits")}
                        className="hover:text-slate-900"
                      >
                        Inv. und
                        {sedeDetailSortHint("inventoryUnits")}
                      </button>
                    </th>
                    <th className="px-3 py-2 text-right font-semibold">
                      <button
                        type="button"
                        onClick={() => toggleSedeDetailSort("inventoryValue")}
                        className="hover:text-slate-900"
                      >
                        Inv. valor
                        {sedeDetailSortHint("inventoryValue")}
                      </button>
                    </th>
                    <th className="px-3 py-2 text-right font-semibold">
                      <button
                        type="button"
                        onClick={() => toggleSedeDetailSort("diUnits")}
                        className="hover:text-slate-900"
                        title="Ordenar por DI unidades (menos → mayor)"
                      >
                        DI und
                        {sedeDetailSortHint("diUnits")}
                      </button>
                    </th>
                    <th className="px-3 py-2 text-right font-semibold">
                      <button
                        type="button"
                        onClick={() => toggleSedeDetailSort("diValue")}
                        className="hover:text-slate-900"
                        title="Ordenar por DI valor (menos → mayor)"
                      >
                        DI valor
                        {sedeDetailSortHint("diValue")}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sedeDetailRows.map((row) => (
                    <tr key={row.key} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {row.label}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {row.hasData ? units(row.inventoryUnits) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {row.hasData ? money(row.inventoryValue) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {row.hasData ? formatDiDays(row.diUnits) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {row.hasData ? formatDiDays(row.diValue) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-800">
                  <tr>
                    <td className="px-3 py-2 text-left">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {units(
                        sedeDetailRows.reduce(
                          (sum, row) => sum + (row.hasData ? row.inventoryUnits : 0),
                          0,
                        ),
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(
                        sedeDetailRows.reduce(
                          (sum, row) => sum + (row.hasData ? row.inventoryValue : 0),
                          0,
                        ),
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500">—</td>
                    <td className="px-3 py-2 text-right text-slate-500">—</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      <section
        id="di-drill"
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_34px_-28px_rgba(15,23,42,0.28)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Drill · {levelTitle}
            </h2>
            <p className="text-xs text-slate-500">
              Sede → categoría → línea → sublínea → ítem
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPath([])}
              className="text-xs font-semibold text-blue-700 hover:underline"
            >
              Sedes
            </button>
            {path.map((step, index) => (
              <button
                key={`${step.type}-${step.id}-${index}`}
                type="button"
                onClick={() => setPath(path.slice(0, index + 1))}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700"
              >
                {step.label}
              </button>
            ))}
            {path.length > 0 ? (
              <button
                type="button"
                onClick={goUpOneLevel}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                Regresar
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
          <div className="relative min-w-[220px] flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              type="text"
              value={drillQuery}
              onChange={(event) => setDrillQuery(event.target.value)}
              placeholder="Buscar en este nivel…"
              className="w-full rounded-lg border border-slate-200 py-2 pr-8 pl-8 text-sm text-slate-900"
              autoComplete="off"
            />
            {drillQuery ? (
              <button
                type="button"
                onClick={() => setDrillQuery("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <p className="text-xs text-slate-500">
            {filteredDrillRows.length}
            {drill?.rows ? ` / ${drill.rows.length}` : ""} filas
          </p>
        </div>

        <div className="max-h-[min(70vh,720px)] overflow-auto">
          {loadingBoard ? (
            <p className="px-4 py-8 text-sm text-slate-500">Cargando drill…</p>
          ) : filteredDrillRows.length === 0 ? (
            <p className="px-4 py-8 text-sm text-slate-500">
              {drillQuery
                ? "Ninguna fila coincide con la búsqueda."
                : "Sin filas en este nivel."}
            </p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 shadow-sm">
                <tr>
                  {(
                    [
                      ["name", "Nombre", "left"],
                      ...(drill?.level === "item"
                        ? ([["proveedor", "Proveedor", "left"]] as Array<
                            [DrillSortKey, string, "left" | "right"]
                          >)
                        : []),
                      ["diUnits", "DI und.", "right"],
                      ["diValue", "DI valor", "right"],
                      ["inventoryUnits", "Inv. und.", "right"],
                      ["inventoryValue", "Inv. $", "right"],
                      ["soldUnits", "Venta und.", "right"],
                      ["childCount", "Hijos", "right"],
                    ] as Array<[DrillSortKey, string, "left" | "right"]>
                  ).map(([key, label, align]) => (
                    <th
                      key={key}
                      className={`px-3 py-3 font-semibold ${align === "right" ? "text-right" : "px-4 text-left"}`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(key)}
                        className="hover:text-slate-800"
                      >
                        {label}
                        {sortHint(key)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredDrillRows.map((row) => {
                  const diPrimary =
                    metric === "units" ? row.diUnits : row.diValue;
                  return (
                    <tr
                      key={`${row.level}-${row.id}`}
                      className="border-t border-slate-100 hover:bg-slate-50/80"
                    >
                      <td className="px-4 py-2.5">
                        {row.level === "item" ? (
                          <div>
                            <div className="font-semibold text-slate-900">
                              {row.label}
                            </div>
                            <div className="text-xs text-slate-500">
                              {row.id}
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openDrillRow(row.drillStep)}
                            className="text-left font-semibold text-blue-700 hover:underline"
                          >
                            {row.label}
                          </button>
                        )}
                      </td>
                      {drill?.level === "item" ? (
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-800">
                            {row.proveedorLabel ?? "—"}
                          </div>
                          {row.proveedorId &&
                          row.proveedorId !== "@SP" &&
                          row.proveedorLabel ? (
                            <div className="text-[11px] text-slate-500">
                              {row.proveedorId}
                            </div>
                          ) : null}
                        </td>
                      ) : null}
                      <td className="px-3 py-2.5 text-right">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${diPillClassName(row.diUnits)}`}
                        >
                          {formatDiDays(row.diUnits)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${diPillClassName(row.diValue)}`}
                        >
                          {formatDiDays(row.diValue)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        {units(row.inventoryUnits)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        {money(row.inventoryValue)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                        {units(row.soldUnits)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                        <span
                          className={`mr-2 inline-block h-2 w-2 rounded-full ${diPillClassName(diPrimary)}`}
                          aria-hidden
                        />
                        {row.childCount}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {showBackToTop ? (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed right-4 bottom-5 z-40 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 shadow-lg hover:bg-slate-50 sm:right-6"
          aria-label="Volver arriba"
        >
          <ArrowUp className="h-4 w-4" aria-hidden />
          Arriba
        </button>
      ) : null}
    </div>
  );
}
