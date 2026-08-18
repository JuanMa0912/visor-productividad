"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  PackageOpen,
  Search,
  X,
} from "lucide-react";
import type { OcVista } from "@/lib/ordenes-compra/status";
import { formatYyyymmdd } from "@/lib/ordenes-compra/status";
import type {
  OrdenCompraBoard,
  OrdenCompraBreakdown,
  OrdenCompraRow,
} from "@/lib/ordenes-compra/types";
import { OcMultiSelect } from "./oc-multi-select";
import { ScrollToTopButton } from "@/components/ui/scroll-to-top-button";
import {
  labelOcEmpresa,
  ocSedeMatchesEmpresas,
  sortOcSedes,
} from "@/lib/ordenes-compra/filters";

const VISTAS: { id: OcVista; label: string }[] = [
  { id: "abiertas", label: "Abiertas" },
  { id: "incompletas", label: "Incompletas" },
  { id: "vencidas", label: "Vencidas (7d)" },
  { id: "ayer", label: "De ayer" },
  { id: "cumplidas", label: "Cumplidas" },
  { id: "todas", label: "Todas" },
];

const BADGE_CLASS: Record<OrdenCompraRow["badge"], string> = {
  cumplida: "bg-emerald-100 text-emerald-800",
  vencida: "bg-rose-100 text-rose-800",
  incompleta: "bg-amber-100 text-amber-900",
  pendiente: "bg-sky-100 text-sky-800",
  a_tiempo: "bg-slate-100 text-slate-700",
};

const BADGE_LABEL: Record<OrdenCompraRow["badge"], string> = {
  cumplida: "Cumplida",
  vencida: "Vencida",
  incompleta: "Incompleta",
  pendiente: "Pendiente",
  a_tiempo: "A tiempo",
};

type SortKey = "fecha" | "sla" | "pct" | "valor" | "oc";

const fmtQty = (n: number) =>
  n.toLocaleString("es-CO", { maximumFractionDigits: 1 });

const fmtMoney = (n: number) =>
  n.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });

const isoToYmd = (iso: string) => iso.replace(/-/g, "");

export function OrdenesCompraBoard() {
  const [vista, setVista] = useState<OcVista>("abiertas");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [empresas, setEmpresas] = useState<string[]>([]);
  const [sedes, setSedes] = useState<string[]>([]);
  const [proveedores, setProveedores] = useState<string[]>([]);
  const [tipdoc, setTipdoc] = useState("");
  const [comprador, setComprador] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("sla");
  const [data, setData] = useState<OrdenCompraBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<OrdenCompraRow | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ vista });
    if (qDebounced) params.set("q", qDebounced);
    if (empresas.length) params.set("empresas", empresas.join(","));
    if (sedes.length) params.set("sedes", sedes.join(","));
    if (proveedores.length) params.set("proveedores", proveedores.join(","));
    if (tipdoc) params.set("tipdoc", tipdoc);
    if (comprador) params.set("comprador", comprador);
    if (desde) params.set("desde", isoToYmd(desde));
    if (hasta) params.set("hasta", isoToYmd(hasta));
    try {
      const res = await fetch(`/api/ordenes-compra?${params.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as OrdenCompraBoard & { error?: string };
      if (!res.ok) throw new Error(json.error || "No se pudo cargar.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [vista, qDebounced, empresas, sedes, proveedores, tipdoc, comprador, desde, hasta]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelected(null);
  }, [vista, empresas, sedes, proveedores, tipdoc, comprador, qDebounced, desde, hasta]);

  const loadedLabel = useMemo(() => {
    if (!data?.meta.loadedAt) return "sin recarga registrada";
    const dt = new Date(data.meta.loadedAt);
    if (Number.isNaN(dt.getTime())) return data.meta.loadedAt;
    return dt.toLocaleString("es-CO");
  }, [data?.meta.loadedAt]);

  const sortedRows = useMemo(() => {
    const rows = [...(data?.rows ?? [])];
    rows.sort((a, b) => {
      if (sortKey === "fecha") return b.fechaDcto.localeCompare(a.fechaDcto);
      if (sortKey === "pct") return a.pctRecibida - b.pctRecibida;
      if (sortKey === "valor") return b.totBruto - a.totBruto;
      if (sortKey === "oc") return a.documentoOc.localeCompare(b.documentoOc);
      return a.diasSla - b.diasSla;
    });
    return rows;
  }, [data?.rows, sortKey]);

  const kpis = data?.kpis;
  const badgeMix = useMemo(() => {
    if (!kpis) return [];
    return [
      { key: "vencidas", label: "Vencidas", value: kpis.vencidas, className: "bg-rose-500" },
      { key: "incompletas", label: "Incompletas", value: kpis.incompletas, className: "bg-amber-400" },
      { key: "abiertas", label: "Abiertas", value: kpis.abiertas, className: "bg-sky-500" },
      { key: "cumplidas", label: "Cumplidas", value: kpis.cumplidas, className: "bg-emerald-500" },
    ];
  }, [kpis]);
  const badgeMixTotal = badgeMix.reduce((acc, item) => acc + item.value, 0) || 1;

  const empresaOptions = useMemo(
    () =>
      (data?.meta.empresas ?? []).map((item) => ({
        value: item,
        label: labelOcEmpresa(item),
      })),
    [data?.meta.empresas],
  );
  const sedeOptions = useMemo(() => {
    const list = (data?.meta.sedes ?? []).filter((item) =>
      ocSedeMatchesEmpresas(item, empresas),
    );
    return sortOcSedes(list).map((item) => ({ value: item, label: item }));
  }, [data?.meta.sedes, empresas]);
  const proveedorOptions = useMemo(
    () =>
      (data?.meta.proveedores ?? []).map((item) => ({
        value: item,
        label: item,
      })),
    [data?.meta.proveedores],
  );

  useEffect(() => {
    setSedes((cur) => cur.filter((item) => ocSedeMatchesEmpresas(item, empresas)));
  }, [empresas]);

  const hasFilters = Boolean(
    q ||
      empresas.length ||
      sedes.length ||
      proveedores.length ||
      tipdoc ||
      comprador ||
      desde ||
      hasta,
  );

  const clearFilters = () => {
    setQ("");
    setEmpresas([]);
    setSedes([]);
    setProveedores([]);
    setTipdoc("");
    setComprador("");
    setDesde("");
    setHasta("");
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          active={vista === "abiertas"}
          onClick={() => setVista("abiertas")}
          icon={PackageOpen}
          label="Abiertas"
          value={kpis?.abiertas ?? "—"}
          hint={kpis ? `${fmtMoney(kpis.totBrutoAbiertas)} · rec. ${kpis.pctRecibidaAbiertas.toFixed(0)}%` : "Pendientes + incompletas"}
          tone="sky"
        />
        <KpiCard
          active={vista === "incompletas"}
          onClick={() => setVista("incompletas")}
          icon={Clock3}
          label="Incompletas"
          value={kpis?.incompletas ?? "—"}
          hint="Llegó una parte de la cantidad"
          tone="amber"
        />
        <KpiCard
          active={vista === "vencidas"}
          onClick={() => setVista("vencidas")}
          icon={AlertTriangle}
          label="Vencidas SLA"
          value={kpis?.vencidas ?? "—"}
          hint={`Más de ${data?.meta.slaDays ?? 7} días sin cumplir`}
          tone="rose"
        />
        <KpiCard
          active={vista === "ayer"}
          onClick={() => setVista("ayer")}
          icon={CheckCircle2}
          label="De ayer"
          value={kpis?.deAyer ?? "—"}
          hint={kpis ? `${kpis.cumplidas.toLocaleString("es-CO")} cumplidas en filtro` : "OC con fecha de ayer"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 lg:col-span-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Mix del filtro
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {kpis ? `${kpis.total.toLocaleString("es-CO")} OC` : "—"} · recarga {loadedLabel}
          </p>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100">
            {badgeMix.map((item) => (
              <div
                key={item.key}
                className={item.className}
                style={{ width: `${(item.value / badgeMixTotal) * 100}%` }}
                title={`${item.label}: ${item.value}`}
              />
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
            {badgeMix.map((item) => (
              <div key={item.key} className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${item.className}`} />
                {item.label}: <span className="font-semibold text-slate-800">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
        <BreakdownPanel
          title="Por sede"
          items={data?.breakdowns.sede ?? []}
          activeKeys={sedes}
          onSelect={(key) =>
            setSedes((cur) =>
              cur.includes(key) ? cur.filter((item) => item !== key) : [...cur, key],
            )
          }
        />
        <BreakdownPanel
          title="Por empresa / tipo"
          items={data?.breakdowns.empresa ?? []}
          activeKeys={empresas}
          onSelect={(key) =>
            setEmpresas((cur) =>
              cur.includes(key) ? cur.filter((item) => item !== key) : [...cur, key],
            )
          }
          secondary={data?.breakdowns.tipdoc ?? []}
          secondaryActive={tipdoc}
          onSecondarySelect={(key) => setTipdoc((cur) => (cur === key ? "" : key))}
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {VISTAS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setVista(item.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                  vista === item.id
                    ? "bg-slate-900 text-white"
                    : "bg-slate-50 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {hasFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              <X className="h-3.5 w-3.5" />
              Limpiar filtros
            </button>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
          <label className="relative xl:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="OC, NIT, comprador o conf."
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm"
            />
          </label>
          <OcMultiSelect
            label="Proveedor"
            values={proveedores}
            options={proveedorOptions}
            onChange={setProveedores}
            emptyLabel="Todos los proveedores"
            searchable
            searchPlaceholder="Ej. Nutresa"
            className="xl:col-span-2"
          />
          <OcMultiSelect
            label="Empresa"
            values={empresas}
            options={empresaOptions}
            onChange={setEmpresas}
            emptyLabel="Todas las empresas"
            searchable
            searchPlaceholder="Mercamio, Mercatodo…"
          />
          <OcMultiSelect
            label="Sede"
            values={sedes}
            options={sedeOptions}
            onChange={setSedes}
            emptyLabel="Todas las sedes"
            searchable
            searchPlaceholder="Calle 5ta, Bogotá…"
          />
          <select
            value={tipdoc}
            onChange={(e) => setTipdoc(e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm"
          >
            <option value="">Todos los tipos</option>
            {(data?.meta.tipdocs ?? []).map((item) => (
              <option key={item.codigo} value={item.codigo}>
                {item.codigo} · {item.nombre}
              </option>
            ))}
          </select>
          <select
            value={comprador}
            onChange={(e) => setComprador(e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm"
          >
            <option value="">Todos los compradores</option>
            {(data?.meta.compradores ?? []).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm"
          />
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm"
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          SLA = fecha OC + {data?.meta.slaDays ?? 7} días. Incompleta = llegó parte de la cantidad.
          Recarga automática diaria 8:00.
          {data?.meta.truncated ? " La tabla muestra las primeras 1.500 OC del filtro." : ""}
        </p>
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
            <p className="text-sm font-semibold text-slate-800">
              {loading ? "Cargando órdenes…" : `${sortedRows.length.toLocaleString("es-CO")} OC en vista`}
            </p>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["sla", "SLA"],
                  ["fecha", "Fecha"],
                  ["pct", "% rec."],
                  ["valor", "Valor"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSortKey(key)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    sortKey === key
                      ? "bg-slate-900 text-white"
                      : "bg-slate-50 text-slate-600 ring-1 ring-slate-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[min(70vh,52rem)] overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">OC</th>
                  <th className="px-3 py-2">SLA</th>
                  <th className="px-3 py-2">Sede</th>
                  <th className="px-3 py-2">Proveedor</th>
                  <th className="px-3 py-2">Recepción</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr
                    key={`${row.empresa}-${row.idCo}-${row.tipdoc}-${row.documentoOc}`}
                    className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${
                      selected &&
                      selected.empresa === row.empresa &&
                      selected.idCo === row.idCo &&
                      selected.tipdoc === row.tipdoc &&
                      selected.documentoOc === row.documentoOc
                        ? "bg-slate-50"
                        : ""
                    }`}
                    onClick={() => setSelected(row)}
                  >
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE_CLASS[row.badge]}`}
                      >
                        {BADGE_LABEL[row.badge]}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {row.tipdoc}-{row.documentoOc}
                      <div className="text-[11px] font-normal text-slate-500">
                        {formatYyyymmdd(row.fechaDcto)} · {row.empresa}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <SlaChip dias={row.diasSla} cumplida={row.cumplida} />
                      <div className="text-[11px] text-slate-500">
                        límite {formatYyyymmdd(row.fechaLimiteSla)}
                      </div>
                    </td>
                    <td className="px-3 py-2">{row.sede || row.idCo}</td>
                    <td className="px-3 py-2">
                      {row.tercNombre || row.idTerc || "—"}
                      {row.tercNit ? (
                        <div className="text-[11px] text-slate-500">{row.tercNit}</div>
                      ) : null}
                    </td>
                    <td className="min-w-36 px-3 py-2">
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full ${row.cumplida ? "bg-emerald-500" : row.vencidaSla ? "bg-rose-500" : "bg-sky-500"}`}
                          style={{ width: `${Math.max(0, Math.min(100, row.pctRecibida))}%` }}
                        />
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {fmtQty(row.cantidadEnt)} / {fmtQty(row.cantidad)} · {row.pctRecibida.toFixed(0)}%
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {fmtMoney(row.totBruto)}
                      <div className="text-[11px] text-slate-500">{row.nItems} ítems</div>
                    </td>
                  </tr>
                ))}
                {!loading && sortedRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-slate-500">
                      No hay órdenes en esta vista.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <DetailPanel row={selected} onClose={() => setSelected(null)} />
      </div>
      <ScrollToTopButton />
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  value: number | string;
  hint: string;
  tone?: "sky" | "amber" | "rose";
  icon: typeof PackageOpen;
  active?: boolean;
  onClick: () => void;
}) {
  const toneClass =
    tone === "sky"
      ? "border-sky-200 bg-sky-50"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50"
        : tone === "rose"
          ? "border-rose-200 bg-rose-50"
          : "border-slate-200 bg-white";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-3 text-left transition ${toneClass} ${
        active ? "ring-2 ring-slate-900" : "hover:border-slate-300"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <Icon className="h-4 w-4 text-slate-500" />
      </div>
      <p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-600">{hint}</p>
    </button>
  );
}

function BreakdownPanel({
  title,
  items,
  activeKeys,
  onSelect,
  secondary,
  secondaryActive,
  onSecondarySelect,
}: {
  title: string;
  items: OrdenCompraBreakdown[];
  activeKeys: string[];
  onSelect: (key: string) => void;
  secondary?: OrdenCompraBreakdown[];
  secondaryActive?: string;
  onSecondarySelect?: (key: string) => void;
}) {
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <div className="mt-3 space-y-2">
        {items.slice(0, 8).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.key)}
            className={`block w-full text-left ${activeKeys.includes(item.key) ? "opacity-100" : ""}`}
          >
            <div className="mb-0.5 flex items-center justify-between text-xs">
              <span className={`truncate ${activeKeys.includes(item.key) ? "font-semibold text-slate-900" : "text-slate-700"}`}>
                {item.label}
              </span>
              <span className="ml-2 shrink-0 text-slate-500">
                {item.vencidas > 0 ? (
                  <span className="mr-1 font-semibold text-rose-600">{item.vencidas} venc.</span>
                ) : null}
                {item.count}
              </span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="bg-rose-500" style={{ width: `${(item.vencidas / max) * 100}%` }} />
              <div
                className="bg-amber-400"
                style={{ width: `${(item.incompletas / max) * 100}%` }}
              />
              <div
                className="bg-sky-500"
                style={{ width: `${(Math.max(0, item.abiertas - item.vencidas - item.incompletas) / max) * 100}%` }}
              />
              <div
                className="bg-emerald-400"
                style={{ width: `${(Math.max(0, item.count - item.abiertas) / max) * 100}%` }}
              />
            </div>
          </button>
        ))}
        {items.length === 0 ? <p className="text-xs text-slate-500">Sin datos.</p> : null}
      </div>
      {secondary && onSecondarySelect ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {secondary.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onSecondarySelect(item.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                secondaryActive === item.key
                  ? "bg-slate-900 text-white"
                  : "bg-slate-50 text-slate-600 ring-1 ring-slate-200"
              }`}
            >
              {item.key} · {item.count}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SlaChip({ dias, cumplida }: { dias: number; cumplida: boolean }) {
  if (cumplida) {
    return <span className="text-xs font-semibold text-emerald-700">Cerrada</span>;
  }
  if (dias < 0) {
    return (
      <span className="text-xs font-semibold text-rose-700">
        {Math.abs(dias)}d vencida
      </span>
    );
  }
  if (dias <= 2) {
    return <span className="text-xs font-semibold text-amber-700">{dias}d restantes</span>;
  }
  return <span className="text-xs font-semibold text-slate-700">{dias}d restantes</span>;
}

function DetailPanel({
  row,
  onClose,
}: {
  row: OrdenCompraRow | null;
  onClose: () => void;
}) {
  if (!row) {
    return (
      <aside className="hidden rounded-2xl border border-dashed border-slate-200 bg-white/70 p-5 text-sm text-slate-500 xl:block">
        Elige una OC para ver confirmación del sistema, comprador, entrega POS y el detalle de recepción.
      </aside>
    );
  }
  return (
    <aside className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Detalle
          </p>
          <h2 className="text-lg font-semibold text-slate-900">
            {row.tipdoc}-{row.documentoOc}
          </h2>
          <p className="text-xs text-slate-500">{row.tipdocNom}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <span className={`mt-3 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE_CLASS[row.badge]}`}>
        {BADGE_LABEL[row.badge]}
      </span>
      <dl className="mt-4 space-y-2 text-sm">
        <DetailItem label="Empresa / sede" value={`${row.empresa} · ${row.sede || row.idCo}`} />
        <DetailItem label="Proveedor" value={row.tercNombre || row.idTerc || "—"} />
        <DetailItem label="NIT" value={row.tercNit || "—"} />
        <DetailItem label="Comprador" value={row.compradorNom || "—"} />
        <DetailItem label="Fecha OC" value={formatYyyymmdd(row.fechaDcto)} />
        <DetailItem
          label="Entrega POS"
          value={row.fechaEntrega ? formatYyyymmdd(row.fechaEntrega) : "sin promesa"}
        />
        <DetailItem label="Límite SLA" value={formatYyyymmdd(row.fechaLimiteSla)} />
        <DetailItem
          label="Confirmación sistema"
          value={
            row.usuarioConf
              ? `${row.usuarioConf} · ${formatYyyymmdd(row.fechaConf)}${
                  row.horaConf ? ` ${row.horaConf.slice(0, 2)}:${row.horaConf.slice(2)}` : ""
                }`
              : "sin confirmar"
          }
        />
        <DetailItem
          label="Recepción"
          value={`${fmtQty(row.cantidadEnt)} / ${fmtQty(row.cantidad)} (${row.pctRecibida.toFixed(0)}%)`}
        />
        <DetailItem label="Ítems / líneas" value={`${row.nItems} / ${row.nLineas}`} />
        <DetailItem label="Valor bruto" value={fmtMoney(row.totBruto)} />
        <DetailItem label="Estado POS" value={row.estadoNom || row.indEstado} />
      </dl>
    </aside>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-t border-slate-100 pt-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-right text-slate-800">{value}</dd>
    </div>
  );
}
