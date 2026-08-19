"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import { canAccessPreciosProveedor } from "@/lib/shared/special-role-features";
import type {
  PreciosProveedorExpandRow,
  PreciosProveedorMatrix,
  PreciosProveedorMeta,
  PreciosProveedorMetric,
  PreciosProveedorRow,
} from "@/lib/exp-precios-proveedor/types";

/** Escala 0→verde (bajo), 1→rojo (alto). Para costo/precio. */
const heatStyleLowGreen = (t01: number) => {
  if (!Number.isFinite(t01) || t01 < 0) {
    return { background: "#f1f5f9", color: "#94a3b8" };
  }
  const t = Math.max(0, Math.min(1, t01));
  let r: number;
  let g: number;
  let b: number;
  if (t < 0.5) {
    // verde → ámbar
    const u = t / 0.5;
    r = Math.round(14 + (234 - 14) * u);
    g = Math.round(138 + (179 - 138) * u);
    b = Math.round(77 + (8 - 77) * u);
  } else {
    // ámbar → rojo
    const u = (t - 0.5) / 0.5;
    r = Math.round(234 + (198 - 234) * u);
    g = Math.round(179 + (40 - 179) * u);
    b = Math.round(8 + (56 - 8) * u);
  }
  const alpha = Math.min(0.88, 0.28 + Math.abs(t - 0.5) * 0.5);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const blended = luminance * alpha + (1 - alpha);
  return {
    background: `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`,
    color: blended < 0.62 ? "#fff" : "#1e293b",
  };
};

/** Escala clásica: alto = verde (margen %). */
const heatStyleHighGreen = (t01: number) => {
  if (!Number.isFinite(t01) || t01 <= 0) {
    return { background: "#f1f5f9", color: "#94a3b8" };
  }
  const t = Math.max(0, Math.min(1, t01));
  let r: number;
  let g: number;
  let b: number;
  if (t < 0.5) {
    const u = t / 0.5;
    r = Math.round(198 + (234 - 198) * u);
    g = Math.round(40 + (179 - 40) * u);
    b = Math.round(56 + (8 - 56) * u);
  } else {
    const u = (t - 0.5) / 0.5;
    r = Math.round(234 + (14 - 234) * u);
    g = Math.round(179 + (138 - 179) * u);
    b = Math.round(8 + (77 - 8) * u);
  }
  const alpha = Math.min(0.88, 0.22 + Math.max(t, 1 - t) * 0.35);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const blended = luminance * alpha + (1 - alpha);
  return {
    background: `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`,
    color: blended < 0.62 ? "#fff" : "#1e293b",
  };
};

const money = (value: number) =>
  value.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });

const unitsFmt = (value: number) =>
  value.toLocaleString("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });

const pctFmt = (value: number) =>
  `${value.toLocaleString("es-CO", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;

const unitMoney = (value: number) =>
  value.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });

const toIsoLocal = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

/** Día anterior (calendario local); la meta del API puede ajustar al último día con datos. */
const yesterdayIso = () => {
  const day = new Date();
  day.setHours(12, 0, 0, 0);
  day.setDate(day.getDate() - 1);
  return toIsoLocal(day);
};

export default function CostosPage() {
  const router = useRouter();
  const { user, status } = useRequireAuth();
  const { isAdmin, hasSpecialRole } = usePermissions();
  const canAccess = canAccessPreciosProveedor(
    user?.role ?? "user",
    user?.allowedDashboards,
    user?.allowedSubdashboards,
  );

  const [meta, setMeta] = useState<PreciosProveedorMeta | null>(null);
  const [matrix, setMatrix] = useState<PreciosProveedorMatrix | null>(null);
  const [dateStart, setDateStart] = useState(yesterdayIso);
  const [dateEnd, setDateEnd] = useState(yesterdayIso);
  const [selectedLineas, setSelectedLineas] = useState<string[]>([]);
  const [sublinea, setSublinea] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [selectedSedes, setSelectedSedes] = useState<string[]>([]);
  const [sedesReady, setSedesReady] = useState(false);
  const [search, setSearch] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [metric, setMetric] = useState<PreciosProveedorMetric>("pcu");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [expandMode, setExpandMode] = useState<"cost" | "detail">("cost");
  const [expandLoading, setExpandLoading] = useState<string | null>(null);
  const [expandRows, setExpandRows] = useState<PreciosProveedorExpandRow[]>([]);
  const [expandError, setExpandError] = useState<string | null>(null);
  const skipNextMatrixEffect = useRef(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sublineasOptions = useMemo(() => {
    const all = meta?.sublineas ?? [];
    if (selectedLineas.length === 0) return all;
    return all.filter((opt) => selectedLineas.includes(opt.lineaId));
  }, [meta, selectedLineas]);

  const allSedeKeys = useMemo(
    () => (meta?.sedes ?? []).map((sede) => sede.key),
    [meta],
  );
  const visibleSedeKeys = useMemo(
    () =>
      empresa
        ? allSedeKeys.filter((key) => key.startsWith(`${empresa}|`))
        : allSedeKeys,
    [allSedeKeys, empresa],
  );

  const toggleSede = (key: string) => {
    setSelectedSedes((prev) => {
      if (prev.includes(key)) {
        if (prev.length <= 1) return prev;
        return prev.filter((item) => item !== key);
      }
      return [...prev, key];
    });
  };

  const toggleLinea = (id: string) => {
    setSelectedLineas((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
    setSublinea("");
  };

  const cellByKey = useMemo(() => {
    const map = new Map<
      string,
      PreciosProveedorMatrix["cells"][number]
    >();
    for (const cell of matrix?.cells ?? []) {
      map.set(`${cell.rowId}::${cell.sedeKey}`, cell);
    }
    return map;
  }, [matrix]);

  /** Escala por ítem (fila): compara sedes entre sí, no ítem vs ítem. */
  const heatScaleByRow = useMemo(() => {
    const map = new Map<string, { min: number; max: number }>();
    const byRow = new Map<string, number[]>();
    const pushCell = (cell: PreciosProveedorMatrix["cells"][number]) => {
      const raw =
        metric === "pvu"
          ? cell.pvu
          : metric === "pcu"
            ? cell.pcu
            : metric === "units"
              ? cell.units
              : cell.margenPct;
      if (!Number.isFinite(raw)) return;
      if (metric !== "margenPct" && !(raw > 0)) return;
      const list = byRow.get(cell.rowId);
      if (list) list.push(raw);
      else byRow.set(cell.rowId, [raw]);
    };
    for (const cell of matrix?.cells ?? []) pushCell(cell);
    for (const row of expandRows) {
      for (const cell of row.cells) pushCell(cell);
    }
    for (const [rowId, values] of byRow) {
      map.set(rowId, { min: Math.min(...values), max: Math.max(...values) });
    }
    return map;
  }, [matrix, metric, expandRows]);

  const loadMatrix = useCallback(
    async (override?: {
      from?: string;
      to?: string;
      sedes?: string[];
    }) => {
      const from = override?.from ?? dateStart;
      const to = override?.to ?? dateEnd;
      const sedes = (override?.sedes ?? selectedSedes).filter((key) =>
        empresa ? key.startsWith(`${empresa}|`) : true,
      );
      if (!from || !to) return;
      if (sedes.length === 0) {
        setMatrix({
          columns: [],
          rows: [],
          cells: [],
          from,
          to,
          itemLimit: 40,
          elapsedMs: 0,
        });
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          mode: "matrix",
          from,
          to,
          limit: "40",
          sedes: sedes.join(","),
        });
        if (selectedLineas.length > 0) {
          params.set("linea", selectedLineas.join(","));
        }
        if (sublinea) params.set("sublinea", sublinea);
        if (proveedor) params.set("proveedor", proveedor);
        if (searchApplied.trim()) params.set("search", searchApplied.trim());
        const res = await fetch(`/api/costos?${params}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as {
          matrix?: PreciosProveedorMatrix;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? "Error matriz");
        setMatrix(data.matrix ?? null);
        setExpandedItemId(null);
        setExpandRows([]);
        setExpandError(null);
        setExpandMode("cost");
      } catch (err) {
        setMatrix(null);
        setError(err instanceof Error ? err.message : "Error cargando");
      } finally {
        setLoading(false);
      }
    },
    [
      dateEnd,
      dateStart,
      selectedLineas,
      sublinea,
      proveedor,
      selectedSedes,
      searchApplied,
      empresa,
    ],
  );

  const loadExpand = useCallback(
    async (row: PreciosProveedorRow, mode: "cost" | "detail") => {
      if (expandedItemId === row.id && expandMode === mode) {
        setExpandedItemId(null);
        setExpandRows([]);
        setExpandError(null);
        setExpandLoading(null);
        return;
      }
      setExpandMode(mode);
      if (expandedItemId === row.id && expandRows.length > 0) {
        return;
      }
      if (!dateStart || !dateEnd || selectedSedes.length === 0) return;
      setExpandedItemId(row.id);
      setExpandRows([]);
      setExpandLoading(row.id);
      setExpandError(null);
      try {
        const params = new URLSearchParams({
          mode: "proveedores",
          item: row.id,
          label: row.label,
          from: dateStart,
          to: dateEnd,
          sedes: selectedSedes.join(","),
        });
        const res = await fetch(`/api/costos?${params}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as {
          expand?: { rows?: PreciosProveedorExpandRow[] };
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? "Error proveedores");
        setExpandedItemId(row.id);
        setExpandRows(data.expand?.rows ?? []);
      } catch (err) {
        setExpandedItemId(row.id);
        setExpandRows([]);
        setExpandError(
          err instanceof Error ? err.message : "Error cargando proveedores",
        );
      } finally {
        setExpandLoading(null);
      }
    },
    [dateEnd, dateStart, expandMode, expandRows.length, expandedItemId, selectedSedes],
  );

  const loadMeta = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/costos?mode=meta", {
      cache: "no-store",
    });
    const data = (await res.json()) as {
      meta?: PreciosProveedorMeta;
      error?: string;
    };
    if (!res.ok) throw new Error(data.error ?? "Error meta");
    if (!data.meta) throw new Error("Meta vacía");
    const start = data.meta.defaultStart;
    const end = data.meta.defaultEnd;
    const empresas = data.meta.empresas ?? [];
    const defaultEmpresa =
      empresas.find((item) => item.id === "mercamio")?.id ??
      empresas[0]?.id ??
      "";
    const sedeKeys = data.meta.sedes
      .map((sede) => sede.key)
      .filter((key) =>
        defaultEmpresa ? key.startsWith(`${defaultEmpresa}|`) : true,
      );
    setMeta(data.meta);
    setDateStart(start);
    setDateEnd(end);
    setEmpresa(defaultEmpresa);
    setSelectedSedes(sedeKeys);
    setSedesReady(true);
    // Carga inmediata del día anterior (no espera otro ciclo ni input del usuario).
    skipNextMatrixEffect.current = true;
    await loadMatrix({ from: start, to: end, sedes: sedeKeys });
  }, [loadMatrix]);

  useEffect(() => {
    if (status !== "authenticated" || !user) return;
    if (!canAccess) router.replace("/secciones");
  }, [status, user, canAccess, router]);

  useEffect(() => {
    if (status !== "authenticated" || !canAccess) return;
    void loadMeta().catch((err) => {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Error meta");
    });
    // Solo al autenticar: la recarga por filtros va en el efecto de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/auth gate
  }, [status, canAccess]);

  useEffect(() => {
    if (status !== "authenticated" || !canAccess) return;
    if (!sedesReady || !dateStart || !dateEnd) return;
    if (skipNextMatrixEffect.current) {
      skipNextMatrixEffect.current = false;
      return;
    }
    void loadMatrix();
  }, [
    status,
    canAccess,
    dateStart,
    dateEnd,
    selectedLineas,
    sublinea,
    proveedor,
    selectedSedes,
    sedesReady,
    searchApplied,
    empresa,
    loadMatrix,
  ]);

  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed.length < 2) {
      setSearchApplied("");
      return;
    }
    const timer = window.setTimeout(() => setSearchApplied(trimmed), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!sublinea) return;
    const stillValid = sublineasOptions.some((opt) => opt.id === sublinea);
    if (!stillValid) setSublinea("");
  }, [selectedLineas, sublinea, sublineasOptions]);

  if (status !== "authenticated" || !user) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10">
        <p className="text-sm text-slate-600">Cargando…</p>
      </div>
    );
  }

  const formatCell = (
    cell: PreciosProveedorMatrix["cells"][number] | undefined,
  ) => {
    if (!cell) return "—";
    if (metric === "pvu") return unitMoney(cell.pvu);
    if (metric === "pcu") return unitMoney(cell.pcu);
    return (
      <div className="leading-tight">
        <div>{unitMoney(cell.pcu)}/kg</div>
        <div className="text-[10px] font-medium opacity-90">
          {unitsFmt(cell.units)} kg
        </div>
        <div className="text-[10px] font-medium opacity-90">
          {pctFmt(cell.margenPct)}
        </div>
      </div>
    );
  };

  const formatExpandCell = (
    cell: PreciosProveedorMatrix["cells"][number] | undefined,
  ) => {
    if (!cell) return "—";
    return (
      <div className="leading-tight">
        <div>{unitMoney(cell.pcu)}/kg</div>
        <div className="text-[10px] font-medium opacity-90">
          {unitsFmt(cell.units)} kg
        </div>
        <div className="text-[10px] font-medium opacity-90">
          {pctFmt(cell.margenPct)}
        </div>
      </div>
    );
  };

  const cellHeatStyle = (
    cell: PreciosProveedorMatrix["cells"][number] | undefined,
  ) => {
    if (!cell) return heatStyleLowGreen(-1);
    const raw =
      metric === "pvu"
        ? cell.pvu
        : metric === "pcu"
          ? cell.pcu
          : metric === "units"
            ? cell.units
            : cell.margenPct;
    if (!(raw > 0) && metric !== "margenPct") return heatStyleLowGreen(-1);
    if (metric === "margenPct" && !Number.isFinite(raw)) {
      return heatStyleLowGreen(-1);
    }
    const scale = heatScaleByRow.get(cell.rowId);
    if (!scale) return heatStyleLowGreen(-1);
    const span = scale.max - scale.min;
    const t01 = span < 1e-9 ? 0.5 : (raw - scale.min) / span;
    // Costo y precio venta: verde = más bajo entre sedes, rojo = más alto.
    if (metric === "pcu" || metric === "pvu") {
      return heatStyleLowGreen(t01);
    }
    return heatStyleHighGreen(t01);
  };

  const isSingleDay = Boolean(dateStart && dateEnd && dateStart === dateEnd);

  return (
    <div className="min-h-screen bg-slate-100 text-foreground">
      <PortalBrandingHeader
        canAccessCronograma={hasSpecialRole("cronograma")}
        isAdmin={isAdmin}
        username={user.username}
        sede={user.sede}
        showSeccionesShortcut
      />
      <div className="mx-auto w-full max-w-[1400px] px-4 py-6 lg:px-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Link
            href="/venta"
            className="text-sm font-semibold text-blue-700 underline-offset-4 hover:underline"
          >
            Volver a Venta
          </Link>
        </div>

        <h1 className="text-2xl font-black tracking-tight text-slate-900">
          Costos
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          Por defecto el <strong>día anterior</strong>. Si eliges un rango, se
          promedian los precios/costos de cada día. El color compara{" "}
          <strong>sedes del mismo ítem</strong> (no ítem contra ítem). En costo
          de entrada y precio venta: verde = más bajo, rojo = más alto.{" "}
          <strong>Un clic</strong> abre proveedores con costo de entrada.{" "}
          <strong>Doble clic</strong> muestra valor por kilo, kilos y margen
          vendido.
        </p>
        {meta?.note ? (
          <p className="mt-2 max-w-3xl text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {meta.note}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="text-xs font-semibold text-slate-600">
            Empresa
            <select
              required
              value={empresa}
              onChange={(e) => {
                const next = e.target.value;
                if (!next) return;
                setEmpresa(next);
                const keys = (meta?.sedes ?? [])
                  .map((sede) => sede.key)
                  .filter((key) => key.startsWith(`${next}|`));
                setSelectedSedes(keys);
              }}
              className="mt-1 block min-w-[10rem] rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            >
              {(meta?.empresas ?? []).map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <div className="w-full">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-600">Sedes</span>
              <button
                type="button"
                onClick={() => setSelectedSedes(visibleSedeKeys)}
                className="rounded border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                Todas
              </button>
              <span className="text-[10px] text-slate-400">
                {selectedSedes.length}/{visibleSedeKeys.length} · siempre una
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(meta?.sedes ?? [])
                .filter((sede) =>
                  empresa ? sede.key.startsWith(`${empresa}|`) : true,
                )
                .map((sede) => {
                const active = selectedSedes.includes(sede.key);
                return (
                  <button
                    key={sede.key}
                    type="button"
                    onClick={() => toggleSede(sede.key)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      active
                        ? "bg-slate-900 text-white"
                        : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {sede.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="w-full">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-600">Líneas</span>
              <button
                type="button"
                onClick={() => {
                  setSelectedLineas([]);
                  setSublinea("");
                }}
                className="rounded border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                Todas
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(meta?.lineas ?? []).map((opt) => {
                const active = selectedLineas.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => toggleLinea(opt.id)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      active
                        ? "bg-slate-900 text-white"
                        : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="text-xs font-semibold text-slate-600">
            Desde
            <input
              type="date"
              value={dateStart}
              min={meta?.minDate ?? undefined}
              max={meta?.maxDate ?? undefined}
              onChange={(e) => setDateStart(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Hasta
            <input
              type="date"
              value={dateEnd}
              min={meta?.minDate ?? undefined}
              max={meta?.maxDate ?? undefined}
              onChange={(e) => setDateEnd(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Sublínea
            <select
              value={sublinea}
              onChange={(e) => setSublinea(e.target.value)}
              className="mt-1 block min-w-[14rem] rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            >
              <option value="">Todas</option>
              {sublineasOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[14rem] flex-1 text-xs font-semibold text-slate-600">
            Buscar ítem
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Código o descripción…"
              className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Proveedor
            <select
              value={proveedor}
              onChange={(e) => setProveedor(e.target.value)}
              className="mt-1 block min-w-[14rem] rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            >
              <option value="">Todos</option>
              {(meta?.proveedores ?? []).map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex rounded-lg border border-slate-200 p-1">
            {(
              [
                ["pcu", "Costo entrada"],
                ["pvu", "Precio venta"],
                ["margenPct", "Margen %"],
                ["units", "Kilos"],
              ] as Array<[PreciosProveedorMetric, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMetric(key)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-bold ${
                  metric === key
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="w-full text-[11px] text-slate-500">
            {isSingleDay
              ? "Modo 1 día: precio venta / costo de entrada de ese día."
              : "Modo rango: promedio simple diario de precio venta y costo de entrada."}{" "}
            Empresa y sede van siempre seleccionadas. En kilos/margen se ve
            valor por kilo, kilos y margen vendido.
          </p>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </p>
        ) : null}

        <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Matriz · ítem × sede
              </h2>
              <p className="text-xs text-slate-500">
                Top {matrix?.itemLimit ?? 40} ítems por venta neta · clic:
                costo de entrada · doble clic: $/kg, kilos y margen ·{" "}
                {matrix
                  ? `${matrix.elapsedMs} ms servidor · ${matrix.rows.length} filas`
                  : loading
                    ? "cargando…"
                    : "—"}
              </p>
            </div>
          </div>
          <div className="max-h-[min(70vh,820px)] overflow-auto">
            {!matrix || matrix.rows.length === 0 ? (
              <p className="px-4 py-8 text-sm text-slate-500">
                {loading
                  ? "Consultando costo de entrada…"
                  : "Sin datos para el filtro."}
              </p>
            ) : (
              <table className="min-w-full border-collapse text-xs">
                <thead className="sticky top-0 z-20">
                  <tr className="bg-slate-50 text-slate-600 shadow-sm">
                    <th className="sticky left-0 z-30 bg-slate-50 px-3 py-2 text-left font-semibold">
                      Ítem · proveedor
                    </th>
                    {matrix.columns.map((col) => (
                      <th
                        key={col.key}
                        className="px-2 py-2 text-center font-semibold whitespace-nowrap"
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows.map((row) => {
                    const isExpanded = expandedItemId === row.id;
                    const isExpanding = expandLoading === row.id;
                    return (
                      <Fragment key={row.id}>
                        <tr
                          className={`cursor-pointer select-none border-t border-slate-100 ${
                            isExpanded ? "bg-indigo-50/60" : "hover:bg-slate-50"
                          }`}
                          onClick={() => {
                            if (clickTimer.current) return;
                            clickTimer.current = setTimeout(() => {
                              clickTimer.current = null;
                              void loadExpand(row, "cost");
                            }, 280);
                          }}
                          onDoubleClick={() => {
                            if (clickTimer.current) {
                              clearTimeout(clickTimer.current);
                              clickTimer.current = null;
                            }
                            void loadExpand(row, "detail");
                          }}
                          title="Clic: proveedores y costo de entrada. Doble clic: kilos, venta y margen."
                        >
                          <th
                            className={`sticky left-0 z-10 max-w-[18rem] px-3 py-2 text-left font-semibold ${
                              isExpanded ? "bg-indigo-50" : "bg-white"
                            }`}
                          >
                            <div
                              className="truncate text-slate-900"
                              title={row.label}
                            >
                              <span className="tabular-nums text-slate-500">
                                {row.id}
                              </span>
                              <span className="text-slate-400"> · </span>
                              {row.label}
                            </div>
                            <div
                              className="mt-0.5 truncate text-[10px] font-medium text-indigo-700"
                              title={`${row.proveedorId} · ${row.proveedorLabel}`}
                            >
                              {row.proveedorLabel}
                              {row.proveedorCount > 1 ? (
                                <span className="ml-1 font-semibold text-slate-500">
                                  · clic / doble clic
                                </span>
                              ) : null}
                            </div>
                          </th>
                          {matrix.columns.map((col) => {
                            const cell = cellByKey.get(`${row.id}::${col.key}`);
                            const style = cellHeatStyle(cell);
                            const title = cell
                              ? `${row.label} · ${col.label}
Precio venta ${unitMoney(cell.pvu)} · Costo entrada ${unitMoney(cell.pcu)}
Margen ${pctFmt(cell.margenPct)} · ${unitsFmt(cell.units)} und
Venta ${money(cell.sales)} · Costo entrada tot. ${money(cell.cost)}`
                              : "";
                            return (
                              <td key={col.key} className="p-1">
                                <div
                                  className="rounded-md px-2 py-2 text-center font-semibold tabular-nums"
                                  style={style}
                                  title={title}
                                >
                                  {formatCell(cell)}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                        {isExpanded ? (
                          isExpanding ? (
                            <tr className="border-t border-indigo-100 bg-indigo-50/40">
                              <td
                                colSpan={matrix.columns.length + 1}
                                className="px-6 py-2 text-[11px] text-indigo-800"
                              >
                                Cargando proveedores…
                              </td>
                            </tr>
                          ) : expandError ? (
                            <tr className="border-t border-rose-100 bg-rose-50/60">
                              <td
                                colSpan={matrix.columns.length + 1}
                                className="px-6 py-2 text-[11px] text-rose-800"
                              >
                                {expandError}
                              </td>
                            </tr>
                          ) : expandRows.length === 0 ? (
                            <tr className="border-t border-indigo-100 bg-indigo-50/40">
                              <td
                                colSpan={matrix.columns.length + 1}
                                className="px-6 py-2 text-[11px] text-slate-600"
                              >
                                Sin otros proveedores ni SKUs con costo de
                                entrada para este producto.
                              </td>
                            </tr>
                          ) : (
                            expandRows.map((child) => {
                              const childBySede = new Map(
                                child.cells.map((cell) => [cell.sedeKey, cell]),
                              );
                              return (
                                <tr
                                  key={child.rowId}
                                  className="border-t border-indigo-100 bg-indigo-50/40"
                                >
                                  <th className="sticky left-0 z-10 max-w-[18rem] bg-indigo-50 px-3 py-2 pl-8 text-left font-semibold">
                                    <div
                                      className="truncate text-indigo-950"
                                      title={`${child.proveedorLabel}${
                                        child.criterioLabel
                                          ? ` · criterio ${child.criterioLabel}`
                                          : ""
                                      }`}
                                    >
                                      {child.proveedorLabel}
                                      {child.proveedorId.startsWith("oc:") ? (
                                        <span className="ml-1 text-[10px] font-semibold text-emerald-700">
                                          OC
                                        </span>
                                      ) : child.fromTercero ? (
                                        <span className="ml-1 text-[10px] font-semibold text-emerald-700">
                                          comercial
                                        </span>
                                      ) : (
                                        <span className="ml-1 text-[10px] font-semibold text-amber-700">
                                          criterio
                                        </span>
                                      )}
                                    </div>
                                    <div className="mt-0.5 truncate text-[10px] font-medium text-slate-500">
                                      {child.itemId}
                                      {child.itemId !== row.id
                                        ? ` · ${child.label}`
                                        : ""}
                                      {child.nit ? ` · NIT ${child.nit}` : ""}
                                      {child.criterioLabel &&
                                      child.criterioLabel !==
                                        child.proveedorLabel
                                        ? ` · POS ${child.criterioLabel}`
                                        : ""}
                                    </div>
                                  </th>
                                  {matrix.columns.map((col) => {
                                    const cell = childBySede.get(col.key);
                                    const style = cellHeatStyle(cell);
                                    const title = cell
                                      ? `${child.proveedorLabel} · ${col.label}
Costo entrada ${unitMoney(cell.pcu)} · Precio venta ${unitMoney(cell.pvu)}
Margen ${pctFmt(cell.margenPct)} · ${unitsFmt(cell.units)} und`
                                      : "";
                                    return (
                                      <td key={col.key} className="p-1">
                                        <div
                                          className="rounded-md px-2 py-2 text-center font-semibold tabular-nums"
                                          style={style}
                                          title={title}
                                        >
                                          {expandMode === "detail"
                                            ? formatExpandCell(cell)
                                            : cell
                                              ? unitMoney(cell.pcu)
                                              : "—"}
                                        </div>
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })
                          )
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
