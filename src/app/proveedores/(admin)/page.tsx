"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Truck } from "lucide-react";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";
import { canAccessProveedoresBoard } from "@/lib/shared/special-role-features";
import { PROVEEDORES_QR_SEDES } from "@/lib/proveedores/types";
import type {
  ProveedorVisitaRow,
  ProveedorVisitasMetrics,
} from "@/lib/proveedores/types";

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

const formatMin = (value: number | null | undefined) =>
  value == null
    ? "—"
    : `${value.toLocaleString("es-CO", { maximumFractionDigits: 1 })} min`;

type QrLink = { sedeName: string; url: string; path: string; activo: boolean };

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
  const initial = useMemo(() => defaultRange(), []);
  const [dateStart, setDateStart] = useState(initial.start);
  const [dateEnd, setDateEnd] = useState(initial.end);
  const [sede, setSede] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ProveedorVisitaRow[]>([]);
  const [metrics, setMetrics] = useState<ProveedorVisitasMetrics | null>(null);
  const [qrLinks, setQrLinks] = useState<QrLink[]>([]);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (!canAccessProveedoresBoard(isAdmin)) {
      router.replace("/secciones");
    }
  }, [status, isAdmin, router]);

  const loadMeta = useCallback(async () => {
    try {
      const response = await fetch("/api/proveedores/visitas?mode=meta", {
        credentials: "include",
        cache: "no-store",
      });
      const data = (await response.json()) as {
        error?: string;
        qrLinks?: QrLink[];
      };
      if (!response.ok) throw new Error(data.error || "Error meta");
      setQrLinks(data.qrLinks ?? []);
    } catch {
      setQrLinks([]);
    }
  }, []);

  const load = useCallback(async () => {
    if (!dateStart || !dateEnd || dateStart > dateEnd) {
      setError("Rango de fechas inválido.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        dateStart,
        dateEnd,
      });
      if (sede) params.set("sede", sede);
      if (q.trim()) params.set("q", q.trim());
      const response = await fetch(
        `/api/proveedores/visitas?${params.toString()}`,
        { credentials: "include", cache: "no-store" },
      );
      const data = (await response.json()) as {
        error?: string;
        rows?: ProveedorVisitaRow[];
        metrics?: ProveedorVisitasMetrics;
      };
      if (!response.ok) throw new Error(data.error || "No se pudo cargar.");
      setRows(data.rows ?? []);
      setMetrics(data.metrics ?? null);
    } catch (err) {
      setRows([]);
      setMetrics(null);
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setLoading(false);
    }
  }, [dateEnd, dateStart, q, sede]);

  useEffect(() => {
    if (status !== "authenticated" || !isAdmin) return;
    void loadMeta();
    void load();
  }, [status, isAdmin, load, loadMeta]);

  const exportCsv = () => {
    const params = new URLSearchParams({
      mode: "export",
      dateStart,
      dateEnd,
    });
    if (sede) params.set("sede", sede);
    if (q.trim()) params.set("q", q.trim());
    window.open(`/api/proveedores/visitas?${params.toString()}`, "_blank");
  };

  const maxHourVisitas = useMemo(
    () => Math.max(1, ...(metrics?.byHour.map((h) => h.visitas) ?? [1])),
    [metrics],
  );

  if (status !== "authenticated" || !user) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10">
        <p className="text-sm text-slate-600">Cargando...</p>
      </div>
    );
  }

  if (!canAccessProveedoresBoard(isAdmin)) return null;

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
        <Link
          href="/venta"
          className="inline-flex text-sm font-semibold text-blue-700 underline-offset-4 hover:underline"
        >
          Volver a Venta
        </Link>
        <div className="mt-4 mb-6 flex flex-wrap items-start gap-4">
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
              Visitas por QR (entrada/salida) con métricas del rango filtrado.
              Catálogo:{" "}
              <span className="font-mono text-xs">proveedor_pos_catalogo</span>.
            </p>
          </div>
        </div>

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
                <option value="">Todas</option>
                {PROVEEDORES_QR_SEDES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
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
        </section>

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        {metrics ? (
          <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <MetricCard
              label="Visitas"
              value={String(metrics.totalVisitas)}
              hint={`${metrics.cerradas} cerradas`}
            />
            <MetricCard
              label="Abiertas"
              value={String(metrics.abiertas)}
              hint="Sin salida aún"
            />
            <MetricCard
              label="Proveedores"
              value={String(metrics.proveedoresUnicos)}
              hint="Únicos en el rango"
            />
            <MetricCard
              label="Visitantes"
              value={String(metrics.visitantesUnicos)}
              hint="Cédulas únicas"
            />
            <MetricCard
              label="Duración prom."
              value={formatMin(metrics.duracionPromedioMin)}
              hint="Solo cerradas"
            />
            <MetricCard
              label="Duración mediana"
              value={formatMin(metrics.duracionMedianaMin)}
              hint="Solo cerradas"
            />
          </section>
        ) : null}

        {metrics && metrics.totalVisitas > 0 ? (
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
                    {metrics.bySede.map((row) => (
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
                    {metrics.byProveedor.map((row) => (
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
                    {metrics.byDay.map((row) => (
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
                  const found = metrics.byHour.find((h) => h.hour === hour);
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
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">Sede</th>
                  <th className="px-3 py-2.5">Proveedor</th>
                  <th className="px-3 py-2.5">Visitante</th>
                  <th className="px-3 py-2.5">Cédula</th>
                  <th className="px-3 py-2.5">Entrada</th>
                  <th className="px-3 py-2.5">Salida</th>
                  <th className="px-3 py-2.5 text-right">Min</th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-8 text-center text-slate-500"
                    >
                      Cargando visitas…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-8 text-center text-slate-500"
                    >
                      Sin visitas en el rango.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100">
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

        {qrLinks.length > 0 ? (
          <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold text-slate-900">
              Enlaces QR por sede
            </h2>
            <p className="mt-1 text-[11px] text-slate-500">
              Cada URL es exclusiva de una sede. Imprimir / generar QR desde
              estos links.
            </p>
            <ul className="mt-3 space-y-2 text-xs">
              {qrLinks.map((link) => (
                <li
                  key={link.sedeName}
                  className="flex flex-wrap items-baseline gap-2 border-t border-slate-100 pt-2 first:border-0 first:pt-0"
                >
                  <span className="min-w-28 font-semibold text-slate-800">
                    {link.sedeName}
                  </span>
                  <a
                    href={link.path}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all font-mono text-blue-700 underline-offset-2 hover:underline"
                  >
                    {link.url}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
