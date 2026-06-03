"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CERO_ROTACION_ESTADO_LABELS,
  CERO_ROTACION_ESTADO_VALUES,
  parseCeroRotacionEstado,
} from "@/lib/rotacion/cero-estado";
import {
  auditChangedAtDateKeyBogota,
  formatAuditContextLabel,
  formatAuditEstadoLabel,
  type SurtidoAuditApiRow,
} from "./audit-utils";

export type SurtidoAuditSedeSelection = { value: string };

export interface SurtidoAuditModalProps {
  onClose: () => void;
  dateRange: { start: string; end: string };
  targetSedeSelections: ReadonlyArray<SurtidoAuditSedeSelection>;
  formattedRange: string;
}

export const SurtidoAuditModal = ({
  onClose,
  dateRange,
  targetSedeSelections,
  formattedRange,
}: SurtidoAuditModalProps) => {
  const router = useRouter();
  const [rows, setRows] = useState<SurtidoAuditApiRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [filterItem, setFilterItem] = useState("");
  const [filterSede, setFilterSede] = useState("");
  const [filterContext, setFilterContext] = useState<"" | "cero" | "restock">(
    "",
  );
  const [filterAntes, setFilterAntes] = useState("");
  const [filterDespues, setFilterDespues] = useState("");

  useEffect(() => {
    if (!dateRange.start || !dateRange.end) return;
    if (targetSedeSelections.length === 0) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const params = new URLSearchParams();
        params.set("start", dateRange.start);
        params.set("end", dateRange.end);
        targetSedeSelections.forEach((s) =>
          params.append("sedeScope", s.value),
        );
        const res = await fetch(
          `/api/rotacion/cero-estados/audit?${params.toString()}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        const data = (await res.json()) as {
          rows?: SurtidoAuditApiRow[];
          auditTableMissing?: boolean;
          message?: string;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error ?? "No fue posible cargar el historial.");
        }
        setRows(data.rows ?? []);
        if (data.auditTableMissing && data.message) {
          setError(data.message);
        } else {
          setError(null);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : "Error cargando historial.",
        );
        setRows([]);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, [dateRange.start, dateRange.end, targetSedeSelections, router]);

  // Las opciones del filtro de sede deben tener llave (empresa, sede_id)
  // porque el numero de sede no es unico entre empresas (ej. Mercatodo 001
  // vs Mercamio 001). Si solo deduplicaramos por sede_id, "001" filtraria
  // simultaneamente a Floresta y Calle 5ta cuando un admin tiene acceso a
  // ambas. Usamos el separador "::" tanto como `value` del <option> como
  // como `key` para diferenciarlas.
  const sedeOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string }>();
    for (const r of rows) {
      if (!r.sede_id) continue;
      const value = `${r.empresa ?? ""}::${r.sede_id}`;
      const label = r.empresa ? `${r.empresa} · ${r.sede_id}` : r.sede_id;
      if (!map.has(value)) map.set(value, { value, label });
    }
    return Array.from(map.values()).sort((a, b) =>
      a.label.localeCompare(b.label, "es"),
    );
  }, [rows]);

  const filteredRows = useMemo(() => {
    const itemQ = filterItem.trim().toLowerCase();
    const userQ = filterUser.trim().toLowerCase();
    const sedeVal = filterSede.trim();
    const from = filterDateFrom.trim();
    const to = filterDateTo.trim();
    const ctx = filterContext;
    const antes = filterAntes.trim();
    const desp = filterDespues.trim();

    return rows.filter((r) => {
      if (from) {
        const dk = auditChangedAtDateKeyBogota(r.changed_at);
        if (dk < from) return false;
      }
      if (to) {
        const dk = auditChangedAtDateKeyBogota(r.changed_at);
        if (dk > to) return false;
      }
      if (itemQ && !r.item.toLowerCase().includes(itemQ)) return false;
      if (userQ) {
        const u = (r.username ?? "").trim().toLowerCase();
        if (!u.includes(userQ)) return false;
      }
      if (sedeVal) {
        const rowKey = `${r.empresa ?? ""}::${r.sede_id}`;
        if (rowKey !== sedeVal) return false;
      }
      if (ctx && r.context !== ctx) return false;
      if (antes === "__vacio__") {
        if (
          r.estado_anterior != null &&
          String(r.estado_anterior).trim() !== ""
        )
          return false;
      } else if (antes) {
        const parsed = parseCeroRotacionEstado(r.estado_anterior ?? "");
        const norm = (parsed ?? r.estado_anterior) as string;
        if (norm !== antes) return false;
      }
      if (desp) {
        const parsed = parseCeroRotacionEstado(r.estado_nuevo);
        const norm = (parsed ?? r.estado_nuevo) as string;
        if (norm !== desp) return false;
      }
      return true;
    });
  }, [
    rows,
    filterDateFrom,
    filterDateTo,
    filterUser,
    filterItem,
    filterSede,
    filterContext,
    filterAntes,
    filterDespues,
  ]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rotacion-surtido-audit-title"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[82vh] w-full max-w-5xl flex-col rounded-2xl border border-amber-200 bg-white p-5 shadow-xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-3 top-3 rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          onClick={onClose}
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>
        <h2
          id="rotacion-surtido-audit-title"
          className="pr-10 text-lg font-bold text-slate-900"
        >
          Historial S.inventario
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {formattedRange} · {targetSedeSelections.length} sede
          {targetSedeSelections.length === 1 ? "" : "s"} seleccionada
          {targetSedeSelections.length === 1 ? "" : "s"}.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Incluye cambios hasta la fecha de hoy (America/Bogota), aunque el
          periodo del tablero termine antes.
        </p>
        {error ? (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {error}
          </div>
        ) : null}
        {!loading && rows.length > 0 ? (
          <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Filtros
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 border-slate-300 text-xs"
                onClick={() => {
                  setFilterDateFrom("");
                  setFilterDateTo("");
                  setFilterUser("");
                  setFilterItem("");
                  setFilterSede("");
                  setFilterContext("");
                  setFilterAntes("");
                  setFilterDespues("");
                }}
              >
                Limpiar filtros
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-0.5 text-xs font-semibold text-slate-700">
                Fecha desde
                <input
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </label>
              <label className="flex flex-col gap-0.5 text-xs font-semibold text-slate-700">
                Fecha hasta
                <input
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </label>
              <label className="flex flex-col gap-0.5 text-xs font-semibold text-slate-700">
                Usuario
                <input
                  type="search"
                  placeholder="Contiene…"
                  value={filterUser}
                  onChange={(e) => setFilterUser(e.target.value)}
                  autoComplete="off"
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </label>
              <label className="flex flex-col gap-0.5 text-xs font-semibold text-slate-700">
                Item
                <input
                  type="search"
                  placeholder="Codigo o parte…"
                  value={filterItem}
                  onChange={(e) => setFilterItem(e.target.value)}
                  autoComplete="off"
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-0.5 text-xs font-semibold text-slate-700">
                Sede
                <select
                  value={filterSede}
                  onChange={(e) => setFilterSede(e.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="">Todas</option>
                  {sedeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-0.5 text-xs font-semibold text-slate-700">
                Origen
                <select
                  value={filterContext}
                  onChange={(e) =>
                    setFilterContext(
                      e.target.value as "" | "cero" | "restock",
                    )
                  }
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="">Todos</option>
                  <option value="cero">Cero rot.</option>
                  <option value="restock">Restock</option>
                </select>
              </label>
              <label className="flex flex-col gap-0.5 text-xs font-semibold text-slate-700">
                Antes
                <select
                  value={filterAntes}
                  onChange={(e) => setFilterAntes(e.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="">Cualquiera</option>
                  <option value="__vacio__">Sin valor anterior</option>
                  {CERO_ROTACION_ESTADO_VALUES.map((v) => (
                    <option key={v} value={v}>
                      {CERO_ROTACION_ESTADO_LABELS[v]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-0.5 text-xs font-semibold text-slate-700">
                Después
                <select
                  value={filterDespues}
                  onChange={(e) => setFilterDespues(e.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="">Cualquiera</option>
                  {CERO_ROTACION_ESTADO_VALUES.map((v) => (
                    <option key={v} value={v}>
                      {CERO_ROTACION_ESTADO_LABELS[v]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-xs text-slate-600">
              Mostrando{" "}
              <span className="font-semibold tabular-nums text-slate-900">
                {filteredRows.length}
              </span>{" "}
              de{" "}
              <span className="font-semibold tabular-nums text-slate-900">
                {rows.length}
              </span>
              .
            </p>
          </div>
        ) : null}
        <div className="mt-4 min-h-[140px] flex-1 overflow-auto rounded-lg border border-slate-200">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-slate-600">
              <Loader2 className="h-6 w-6 shrink-0 animate-spin" />
              Cargando historial…
            </div>
          ) : rows.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-600">
              Sin cambios registrados para estas sedes en el intervalo del
              periodo (desde el inicio hasta hoy en Colombia).
            </p>
          ) : filteredRows.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-600">
              Ningún registro coincide con los filtros. Ajusta o limpia los
              filtros.
            </p>
          ) : (
            <Table className="min-w-208 text-sm">
              <TableHeader>
                <TableRow className="bg-slate-50/90 hover:bg-slate-50/90">
                  <TableHead className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    Fecha y hora
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    Usuario
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    Sede
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    Item
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    Origen
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    Antes
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    Después
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap tabular-nums text-slate-800">
                      {new Date(r.changed_at).toLocaleString("es-CO", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </TableCell>
                    <TableCell className="max-w-40 truncate font-medium text-slate-900">
                      {r.username?.trim() || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-slate-700">
                      {r.empresa ? `${r.empresa} · ${r.sede_id}` : r.sede_id}
                    </TableCell>
                    <TableCell className="max-w-48 truncate font-mono text-xs text-slate-900">
                      {r.item}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-slate-600">
                      {formatAuditContextLabel(r.context)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-slate-700">
                      {formatAuditEstadoLabel(r.estado_anterior)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-semibold text-slate-900">
                      {formatAuditEstadoLabel(r.estado_nuevo)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
};
