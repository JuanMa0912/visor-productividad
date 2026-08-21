"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Truck } from "lucide-react";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import { canAccessProveedoresBoard, canViewProveedoresQrLinks } from "@/lib/shared/special-role-features";
import { canonicalizeProveedoresQrSede, isProveedoresQrSede, PROVEEDORES_QR_SEDES } from "@/lib/proveedores/types";
import type {
  ProveedorVisitaRow,
  ProveedorVisitasMetrics,
} from "@/lib/proveedores/types";
import { ProveedorSedeQr } from "./proveedor-sede-qr";
import type { ProveedorLineaFilter } from "@/lib/proveedores/board-filters";
import { resolveVisitasBoardView } from "@/lib/proveedores/visitas-scope";
import { ProveedoresVentasPanel } from "./proveedores-ventas-panel";
import { ProveedoresProductividadPanel } from "./proveedores-productividad-panel";
import { ProveedoresInasistenciaPanel } from "./proveedores-inasistencia-panel";
import { ProveedoresOipvPanel } from "./proveedores-oipv-panel";
import { ProveedoresLineaFilter } from "./proveedores-linea-filter";

const toISODate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const defaultRange = () => {
  const end = new Date();
  end.setHours(12, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  return { start: toISODate(start), end: toISODate(end) };
};

const formatWhen = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
  });
};

const formatDay = (isoDate: string) => {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(y, m - 1, d).toLocaleDateString("es-CO", {
    dateStyle: "medium",
  });
};

const formatMin = (value: number | null | undefined) =>
  value == null
    ? "—"
    : `${value.toLocaleString("es-CO", { maximumFractionDigits: 1 })} min`;

type QrLink = { sedeName: string; url: string; path: string; activo: boolean };

const SEDE_STORAGE_KEY = "vp-proveedores-visitas-sede";
const SEDE_ALL = "__all__";

const readStoredSede = () => {
  if (typeof window === "undefined") return "";
  try {
    const saved = sessionStorage.getItem(SEDE_STORAGE_KEY);
    if (saved === SEDE_ALL) return SEDE_ALL;
    return saved && isProveedoresQrSede(saved) ? saved : "";
  } catch {
    return "";
  }
};

const MetricCard = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) => (
  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
      {label}
    </div>
    <div className="mt-1 text-2xl font-black tabular-nums text-slate-900">
      {value}
    </div>
    {hint ? (
      <div className="mt-1 text-[11px] text-slate-500">{hint}</div>
    ) : null}
  </div>
);

export default function ProveedoresBoardPage() {
  const router = useRouter();
  const { user, status } = useRequireAuth();
  const { isAdmin, hasSpecialRole } = usePermissions();
  const allowedSubdashboards = user?.allowedSubdashboards ?? null;
  const canAccessBoard = canAccessProveedoresBoard(
    isAdmin,
    allowedSubdashboards,
  );
  const canViewQr = canViewProveedoresQrLinks(user?.specialRoles, isAdmin);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [sede, setSede] = useState("");
  const sedeReadyRef = useRef(false);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ProveedorVisitaRow[]>([]);
  const [metrics, setMetrics] = useState<ProveedorVisitasMetrics | null>(null);
  const [qrLinks, setQrLinks] = useState<QrLink[]>([]);
  const [tab, setTab] = useState<
    "visitas" | "qr" | "ventas" | "productividad" | "inasistencia" | "oipv"
  >("visitas");
  const [linea, setLinea] = useState<ProveedorLineaFilter>("todas");
  const [lastDataDate, setLastDataDate] = useState<string | null>(null);
  const visitasAbortRef = useRef<AbortController | null>(null);
  const datesReadyRef = useRef(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (!canAccessBoard) {
      router.replace("/secciones");
    }
  }, [status, canAccessBoard, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (sedeReadyRef.current) return;
    sedeReadyRef.current = true;
    const saved = readStoredSede();
    if (saved === SEDE_ALL || isProveedoresQrSede(saved)) {
      setSede(saved);
      return;
    }
    const fromUser = canonicalizeProveedoresQrSede(user?.sede);
    if (fromUser) setSede(fromUser);
  }, [status, user?.sede]);

  useEffect(() => {
    if (!sedeReadyRef.current) return;
    try {
      if (sede === SEDE_ALL || isProveedoresQrSede(sede)) {
        sessionStorage.setItem(SEDE_STORAGE_KEY, sede);
      }
    } catch {
      /* ignore */
    }
  }, [sede]);

  const loadMeta = useCallback(async () => {
    try {
      const response = await fetch("/api/proveedores/visitas?mode=meta", {
        credentials: "include",
        cache: "no-store",
      });
      const data = (await response.json()) as {
        error?: string;
        qrLinks?: QrLink[];
        lastDataDate?: string | null;
      };
      if (!response.ok) throw new Error(data.error || "Error meta");
      setQrLinks(canViewQr ? (data.qrLinks ?? []) : []);
      if (data.lastDataDate) {
        setLastDataDate(data.lastDataDate);
        if (!datesReadyRef.current) {
          setDateStart(data.lastDataDate);
          setDateEnd(data.lastDataDate);
        }
      } else if (!datesReadyRef.current) {
        const fallback = defaultRange();
        setDateStart(fallback.start);
        setDateEnd(fallback.end);
      }
      datesReadyRef.current = true;
    } catch {
      setQrLinks([]);
      if (!datesReadyRef.current) {
        const fallback = defaultRange();
        setDateStart(fallback.start);
        setDateEnd(fallback.end);
        datesReadyRef.current = true;
      }
    }
  }, [canViewQr]);

  const load = useCallback(async () => {
    if (!dateStart || !dateEnd || dateStart > dateEnd) {
      setError("Rango de fechas inválido.");
      return;
    }
    if (!sede) {
      setRows([]);
      setMetrics(null);
      setError(null);
      setLoading(false);
      return;
    }
    const sedeParam = sede === SEDE_ALL ? "" : sede;
    visitasAbortRef.current?.abort();
    const controller = new AbortController();
    visitasAbortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        dateStart,
        dateEnd,
      });
      if (sedeParam) params.set("sede", sedeParam);
      if (q.trim()) params.set("q", q.trim());
      const response = await fetch(
        `/api/proveedores/visitas?${params.toString()}`,
        {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        },
      );
      const data = (await response.json()) as {
        error?: string;
        dateStart?: string;
        dateEnd?: string;
        sede?: string | null;
        q?: string | null;
        rows?: ProveedorVisitaRow[];
        metrics?: ProveedorVisitasMetrics;
      };
      if (!response.ok) throw new Error(data.error || "No se pudo cargar.");
      const sameRange =
        data.dateStart === dateStart &&
        data.dateEnd === dateEnd &&
        (data.sede ?? "") === sedeParam &&
        (data.q ?? "") === q.trim();
      if (!sameRange) return;
      setRows(data.rows ?? []);
      setMetrics(data.metrics ?? null);
    } catch (err) {
      if (controller.signal.aborted) return;
      setRows([]);
      setMetrics(null);
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      if (visitasAbortRef.current === controller) {
        visitasAbortRef.current = null;
        setLoading(false);
      }
    }
  }, [dateEnd, dateStart, q, sede]);

  useEffect(() => {
    if (status !== "authenticated" || !canAccessBoard) return;
    void loadMeta();
  }, [status, canAccessBoard, loadMeta]);

  useEffect(() => {
    if (status !== "authenticated" || !canAccessBoard) return;
    if (!dateStart || !dateEnd) return;
    if (!sede) {
      setRows([]);
      setMetrics(null);
      return;
    }
    void load();
    return () => visitasAbortRef.current?.abort();
  }, [status, canAccessBoard, dateStart, dateEnd, load, sede]);

  const exportCsv = () => {
    const params = new URLSearchParams({
      mode: "export",
      dateStart,
      dateEnd,
    });
    if (sede && sede !== SEDE_ALL) params.set("sede", sede);
    if (q.trim()) params.set("q", q.trim());
    window.open(`/api/proveedores/visitas?${params.toString()}`, "_blank");
  };

  const selectedSede =
    sede && sede !== SEDE_ALL ? canonicalizeProveedoresQrSede(sede) : null;

  const board = useMemo(
    () =>
      resolveVisitasBoardView({
        rows,
        metrics,
        dateStart,
        dateEnd,
        sedeName: selectedSede,
      }),
    [dateEnd, dateStart, metrics, rows, selectedSede],
  );
  const viewRows = selectedSede
    ? board.rows.filter(
        (row) => canonicalizeProveedoresQrSede(row.sedeName) === selectedSede,
      )
    : sede === SEDE_ALL
      ? board.rows
      : [];
  const viewMetrics = selectedSede
    ? board.metrics
    : sede === SEDE_ALL
      ? board.metrics
      : null;

  const maxHourVisitas = useMemo(
    () => Math.max(1, ...(viewMetrics?.byHour.map((h) => h.visitas) ?? [1])),
    [viewMetrics],
  );

  if (status !== "authenticated" || !user) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10">
        <p className="text-sm text-slate-600">Cargando...</p>
      </div>
    );
  }

  if (!canAccessBoard) return null;

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
        <div className="mb-6 flex flex-wrap items-start gap-4">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-sky-100 bg-sky-50 text-sky-700">
            <Truck className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-sky-700">
              Venta • Proveedores
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900">
              Proveedores
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
              Asistencia (entrada/salida por sede), códigos QR, ventas por
              proveedor, inasistencia (personas = und÷350÷7) y productividad
              por familia: unidades (industria), kilos (fruver y carnes) y
              transacciones (cajas). Fechas ancladas al último día con datos.
            </p>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab("visitas")}
            className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide ${
              tab === "visitas"
                ? "bg-sky-700 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            Asistencia
          </button>
          {canViewQr ? (
            <button
              type="button"
              onClick={() => setTab("qr")}
              className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide ${
                tab === "qr"
                  ? "bg-sky-700 text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              QR
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setTab("ventas")}
            className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide ${
              tab === "ventas"
                ? "bg-sky-700 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            Ventas por proveedor
          </button>
          <button
            type="button"
            onClick={() => setTab("productividad")}
            className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide ${
              tab === "productividad"
                ? "bg-sky-700 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            Productividad
          </button>
          <button
            type="button"
            onClick={() => setTab("inasistencia")}
            className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide ${
              tab === "inasistencia"
                ? "bg-sky-700 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            Inasistencia
          </button>
          {isAdmin ? (
            <button
              type="button"
              onClick={() => setTab("oipv")}
              className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide ${
                tab === "oipv"
                  ? "bg-sky-700 text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              OIPV asistencia
            </button>
          ) : null}
          </div>
          {tab === "ventas" ||
          tab === "productividad" ||
          tab === "inasistencia" ||
          tab === "oipv" ? (
            <ProveedoresLineaFilter value={linea} onChange={setLinea} />
          ) : null}
        </div>

        {tab === "ventas" ? <ProveedoresVentasPanel linea={linea} /> : null}
        {tab === "productividad" ? (
          <ProveedoresProductividadPanel
            linea={linea}
            lastDataDate={lastDataDate}
          />
        ) : null}
        {tab === "inasistencia" ? (
          <ProveedoresInasistenciaPanel linea={linea} />
        ) : null}
        {tab === "oipv" && isAdmin ? (
          <ProveedoresOipvPanel linea={linea} lastDataDate={lastDataDate} />
        ) : null}

        {tab === "qr" && canViewQr ? (
          qrLinks.length > 0 ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-bold text-slate-900">
                Códigos QR por sede
              </h2>
              <p className="mt-1 text-[11px] text-slate-500">
                Un código por sede. El visitante escanea, registra entrada y
                salida. Los códigos se generan aquí (sin servicios externos) y
                no caducan.
              </p>
              <ul className="mt-3 space-y-1 text-xs">
                {qrLinks.map((link) => (
                  <ProveedorSedeQr
                    key={link.sedeName}
                    sedeName={link.sedeName}
                    url={link.url}
                    path={link.path}
                    activo={link.activo}
                  />
                ))}
              </ul>
            </section>
          ) : (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              No hay tokens QR de sede. Un admin debe generarlos en esta pestaña
              (migración / seed de{" "}
              <span className="font-mono text-xs">proveedor_sede_qr</span>).
            </section>
          )
        ) : null}

        {tab === "visitas" ? (
          <>
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Desde
              <input
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
                className="mt-1 block h-9 rounded-lg border border-slate-200 px-3 text-sm"
              />
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Hasta
              <input
                type="date"
                value={dateEnd}
                onChange={(e) => setDateEnd(e.target.value)}
                className="mt-1 block h-9 rounded-lg border border-slate-200 px-3 text-sm"
              />
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Sede
              <select
                value={sede}
                onChange={(e) => setSede(e.target.value)}
                className="mt-1 block h-9 min-w-40 rounded-lg border border-slate-200 px-3 text-sm"
              >
                <option value="" disabled>
                  Seleccione sede
                </option>
                {PROVEEDORES_QR_SEDES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                <option value={SEDE_ALL}>Todas las sedes</option>
              </select>
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Buscar
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Proveedor, nombre o cédula"
                className="mt-1 block h-9 min-w-56 rounded-lg border border-slate-200 px-3 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="h-9 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {loading ? "Cargando…" : "Actualizar"}
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              CSV
            </button>
          </div>
          {dateStart && dateEnd ? (
            <p className="mt-3 text-xs text-slate-500">
              {!sede ? (
                "Elija una sede. El detalle no muestra todas juntas."
              ) : (
                <>
                  El conteo usa solo entradas QR del{" "}
                  <span className="font-semibold text-slate-700">
                    {formatDay(dateStart)}
                    {dateStart !== dateEnd ? ` al ${formatDay(dateEnd)}` : ""}
                  </span>
                  {selectedSede ? (
                    <>
                      {" "}
                      en{" "}
                      <span className="font-semibold text-slate-700">
                        {selectedSede}
                      </span>
                      . El detalle lista únicamente esa sede.
                    </>
                  ) : (
                    <>
                      {" "}
                      en{" "}
                      <span className="font-semibold text-amber-800">
                        todas las sedes
                      </span>
                      .
                    </>
                  )}
                </>
              )}
            </p>
          ) : null}
        </section>

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        {viewMetrics ? (
          <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <MetricCard
              label="Visitas"
              value={String(viewMetrics.totalVisitas)}
              hint={`${viewMetrics.cerradas} cerradas`}
            />
            <MetricCard
              label="Abiertas"
              value={String(viewMetrics.abiertas)}
              hint="Sin salida aún"
            />
            <MetricCard
              label="Proveedores"
              value={String(viewMetrics.proveedoresUnicos)}
              hint="Únicos en el rango"
            />
            <MetricCard
              label="Visitantes"
              value={String(viewMetrics.visitantesUnicos)}
              hint="Cédulas únicas"
            />
            <MetricCard
              label="Duración prom."
              value={formatMin(viewMetrics.duracionPromedioMin)}
              hint="Solo cerradas"
            />
            <MetricCard
              label="Duración mediana"
              value={formatMin(viewMetrics.duracionMedianaMin)}
              hint="Solo cerradas"
            />
          </section>
        ) : null}

        {viewMetrics && viewMetrics.totalVisitas > 0 ? (
          <section className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
                Por sede
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Sede</th>
                      <th className="px-3 py-2 text-right">Visitas</th>
                      <th className="px-3 py-2 text-right">Abiertas</th>
                      <th className="px-3 py-2 text-right">Prom. min</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewMetrics.bySede.map((row) => (
                      <tr key={row.sedeName} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {row.sedeName}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.visitas}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                          {row.abiertas}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                          {formatMin(row.duracionPromedioMin)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
                Top proveedores
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Proveedor</th>
                      <th className="px-3 py-2 text-right">Visitas</th>
                      <th className="px-3 py-2 text-right">Prom. min</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewMetrics.byProveedor.map((row) => (
                      <tr
                        key={row.proveedorNombre}
                        className="border-t border-slate-100"
                      >
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {row.proveedorNombre}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.visitas}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                          {formatMin(row.duracionPromedioMin)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
                Por día
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2 text-right">Visitas</th>
                      <th className="px-3 py-2 text-right">Abiertas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewMetrics.byDay.map((row) => (
                      <tr key={row.date} className="border-t border-slate-100">
                        <td className="px-3 py-2 tabular-nums text-slate-800">
                          {row.date}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.visitas}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                          {row.abiertas}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-sm font-bold text-slate-900">
                Horario de entradas
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Distribución por hora (America/Bogota)
              </p>
              <div className="mt-4 flex h-36 items-end gap-1">
                {Array.from({ length: 24 }, (_, hour) => {
                  const found = viewMetrics.byHour.find((h) => h.hour === hour);
                  const visitas = found?.visitas ?? 0;
                  const heightPct = (visitas / maxHourVisitas) * 100;
                  return (
                    <div
                      key={hour}
                      className="flex min-w-0 flex-1 flex-col items-center justify-end"
                      title={`${String(hour).padStart(2, "0")}:00 · ${visitas}`}
                    >
                      <div
                        className="w-full rounded-t bg-sky-500/80"
                        style={{
                          height: `${visitas === 0 ? 2 : Math.max(8, heightPct)}%`,
                        }}
                      />
                      {hour % 3 === 0 ? (
                        <span className="mt-1 text-[9px] tabular-nums text-slate-400">
                          {hour}
                        </span>
                      ) : (
                        <span className="mt-1 h-3" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ) : null}

        <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
            Detalle de visitas
          </div>
          <div className="max-h-[min(70vh,32rem)] overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-20 bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_rgb(226,232,240)]">
                <tr>
                  <th className="sticky top-0 bg-slate-50 px-3 py-2.5">Sede</th>
                  <th className="sticky top-0 bg-slate-50 px-3 py-2.5">
                    Proveedor
                  </th>
                  <th className="sticky top-0 bg-slate-50 px-3 py-2.5">
                    Visitante
                  </th>
                  <th className="sticky top-0 bg-slate-50 px-3 py-2.5">
                    Cédula
                  </th>
                  <th className="sticky top-0 bg-slate-50 px-3 py-2.5">
                    Entrada
                  </th>
                  <th className="sticky top-0 bg-slate-50 px-3 py-2.5">
                    Salida
                  </th>
                  <th className="sticky top-0 bg-slate-50 px-3 py-2.5 text-right">
                    Min
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && viewRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-8 text-center text-slate-500"
                    >
                      Cargando visitas…
                    </td>
                  </tr>
                ) : !sede ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-8 text-center text-slate-500"
                    >
                      Seleccione una sede para ver el detalle.
                    </td>
                  </tr>
                ) : viewRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-8 text-center text-slate-500"
                    >
                      Sin visitas en esa sede y rango.
                    </td>
                  </tr>
                ) : (
                  viewRows.map((row) => (
                    <tr
                      key={`${row.sedeName}-${row.id}`}
                      className="border-t border-slate-100"
                    >
                      <td className="px-3 py-2.5 font-medium text-slate-800">
                        {row.sedeName}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">
                        {row.proveedorNombre}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">
                        {row.visitanteNombre}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-600">
                        {row.visitanteCedula}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-600">
                        {formatWhen(row.entradaAt)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-600">
                        {row.salidaAt ? (
                          formatWhen(row.salidaAt)
                        ) : (
                          <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                            Abierta
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                        {row.duracionMinutos ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

          </>
        ) : null}
      </div>
    </div>
  );
}
