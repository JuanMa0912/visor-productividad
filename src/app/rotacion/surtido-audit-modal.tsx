"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Trash2, X } from "lucide-react";
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
  makeCeroRotacionEstadoKey,
  parseCeroRotacionEstado,
} from "@/lib/rotacion/cero-estado";
import {
  auditChangedAtDateKeyBogota,
  formatAuditContextLabel,
  formatAuditEstadoLabel,
  type SurtidoAuditApiRow,
} from "./audit-utils";
import { getCookieValue } from "./rotacion-preamble";

export type SurtidoAuditSedeSelection = { value: string };

export interface SurtidoAuditModalProps {
  onClose: () => void;
  dateRange: { start: string; end: string };
  targetSedeSelections: ReadonlyArray<SurtidoAuditSedeSelection>;
  formattedRange: string;
  canDeleteFoto?: boolean;
  onFotoDeleted?: (key: string) => void;
}

export const SurtidoAuditModal = ({
  onClose,
  dateRange,
  targetSedeSelections,
  formattedRange,
  canDeleteFoto = false,
  onFotoDeleted,
}: SurtidoAuditModalProps) => {
  const router = useRouter();
  const [rows, setRows] = useState<SurtidoAuditApiRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Indice liviano de que items tienen foto: solo mime y fecha, sin el base64.
   * Sirve para saber en que filas ofrecer el boton sin traerse las imagenes.
   */
  const [fotoIndex, setFotoIndex] = useState<
    Record<string, { mime: string; updatedAt: string }>
  >({});
  const [fotoAbierta, setFotoAbierta] = useState<{
    row: SurtidoAuditApiRow;
    loading: boolean;
    error: string | null;
    dataUrl: string | null;
    updatedAt: string | null;
  } | null>(null);
  const [fotoDeleteBusy, setFotoDeleteBusy] = useState(false);
  const [fotoDeleteConfirm, setFotoDeleteConfirm] = useState(false);
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

        // Indice de fotos, en paralelo. Falla en silencio: si no hay fotos o la
        // tabla no existe, el historial se sigue viendo igual que antes.
        const fotoParams = new URLSearchParams();
        fotoParams.set("start", dateRange.start);
        fotoParams.set("end", dateRange.end);
        targetSedeSelections.forEach((sel) =>
          fotoParams.append("sedeScope", sel.value),
        );
        void fetch(`/api/rotacion/restock-fotos?${fotoParams.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => setFotoIndex(d?.fotos ?? {}))
          .catch(() => setFotoIndex({}));
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

  /**
   * Evidencias que no cuelgan de ninguna fila visible.
   *
   * Subir una foto NO cambia el estado, asi que no genera fila de historial: si
   * alguien fotografia hoy un item que quedo surtido hace un mes, la evidencia
   * existe pero el historial no la menciona. Se listan aparte para que se
   * puedan auditar igual.
   */
  const evidenciasSueltas = (() => {
    const visibles = new Set(
      filteredRows.map((r) =>
        makeCeroRotacionEstadoKey(r.empresa, r.sede_id, r.item),
      ),
    );
    return Object.entries(fotoIndex)
      .filter(([clave]) => !visibles.has(clave))
      .map(([clave, meta]) => {
        const [empresa = "", sedeId = "", item = ""] = clave.split("");
        return { clave, empresa, sedeId, item, updatedAt: meta.updatedAt };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  })();

  const abrirFoto = async (row: SurtidoAuditApiRow) => {
  setFotoDeleteConfirm(false);
  setFotoAbierta({
    row,
    loading: true,
    error: null,
    dataUrl: null,
    updatedAt: null,
  });
  try {
    const params = new URLSearchParams();
    params.set("start", dateRange.start);
    params.set("end", dateRange.end);
    params.set("empresa", row.empresa);
    params.set("sedeId", row.sede_id);
    params.set("item", row.item);
    const res = await fetch(
      `/api/rotacion/restock-fotos?${params.toString()}`,
      { cache: "no-store" },
    );
    const data = (await res.json()) as {
      foto?: { fotoBase64: string; mime: string; updatedAt: string } | null;
      error?: string;
    };
    if (!res.ok) throw new Error(data.error ?? "No se pudo cargar la foto.");
    if (!data.foto) {
      setFotoAbierta((current) =>
        current
          ? { ...current, loading: false, error: "Este ítem no tiene foto." }
          : current,
      );
      return;
    }
    setFotoAbierta((current) =>
      current
        ? {
            ...current,
            loading: false,
            dataUrl: `data:${data.foto!.mime};base64,${data.foto!.fotoBase64}`,
            updatedAt: data.foto!.updatedAt,
          }
        : current,
    );
  } catch (err) {
    setFotoAbierta((current) =>
      current
        ? {
            ...current,
            loading: false,
            error:
              err instanceof Error ? err.message : "No se pudo cargar la foto.",
          }
        : current,
    );
  }
  };

  const eliminarFoto = async () => {
    if (!fotoAbierta || fotoDeleteBusy) return;
    const csrf = getCookieValue("vp_csrf");
    if (!csrf) {
      setFotoAbierta((current) =>
        current
          ? { ...current, error: "No se pudo validar la sesion. Recargue la pagina." }
          : current,
      );
      return;
    }
    setFotoDeleteBusy(true);
    try {
      const res = await fetch("/api/rotacion/restock-fotos", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrf,
        },
        body: JSON.stringify({
          empresa: fotoAbierta.row.empresa,
          sedeId: fotoAbierta.row.sede_id,
          item: fotoAbierta.row.item,
          start: dateRange.start,
          end: dateRange.end,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? "No se pudo eliminar la foto.");
      }
      const key = makeCeroRotacionEstadoKey(
        fotoAbierta.row.empresa,
        fotoAbierta.row.sede_id,
        fotoAbierta.row.item,
      );
      setFotoIndex((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      onFotoDeleted?.(key);
      setFotoAbierta(null);
      setFotoDeleteConfirm(false);
    } catch (err) {
      setFotoAbierta((current) =>
        current
          ? {
              ...current,
              error:
                err instanceof Error
                  ? err.message
                  : "No se pudo eliminar la foto.",
            }
          : current,
      );
    } finally {
      setFotoDeleteBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rotacion-surtido-audit-title"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[min(92dvh,52rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-amber-200 bg-white p-5 shadow-xl sm:p-6"
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

            {evidenciasSueltas.length > 0 ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
                <p className="text-xs font-semibold text-amber-900">
                  {evidenciasSueltas.length === 1
                    ? "Hay 1 evidencia sin cambio de estado en este periodo"
                    : `Hay ${evidenciasSueltas.length} evidencias sin cambio de estado en este periodo`}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
                  Subir una foto no cambia el estado del ítem, así que no genera
                  fila en el historial. Estas fotos existen pero su último cambio
                  de estado quedó fuera del rango consultado.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {evidenciasSueltas.map((ev) => (
                    <Button
                      key={ev.clave}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void abrirFoto({
                          id: `foto-${ev.clave}`,
                          empresa: ev.empresa,
                          sede_id: ev.sedeId,
                          item: ev.item,
                          context: "",
                          estado_anterior: null,
                          estado_nuevo: "",
                          changed_at: ev.updatedAt,
                          changed_by: null,
                          username: null,
                        })
                      }
                      className="h-7 gap-1.5 rounded-full border-amber-300 bg-white px-3 text-[11px] font-bold text-amber-900 hover:bg-amber-100"
                    >
                      <Camera className="h-3.5 w-3.5" aria-hidden />
                      {ev.item}
                      <span className="font-normal text-amber-700">
                        {ev.empresa} · {ev.sedeId}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="mt-4 min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200">
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
                  <TableHead className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    Evidencia
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
                    <TableCell className="whitespace-nowrap">
                      {fotoIndex[
                        makeCeroRotacionEstadoKey(r.empresa, r.sede_id, r.item)
                      ] ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void abrirFoto(r)}
                          className="h-7 gap-1.5 rounded-full border-amber-200 bg-amber-50/70 px-3 text-[11px] font-bold uppercase tracking-wide text-amber-900 hover:bg-amber-100"
                        >
                          <Camera className="h-3.5 w-3.5" aria-hidden />
                          Auditar
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {fotoAbierta ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4"
          role="dialog"
          aria-label="Evidencia fotográfica"
        >
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Evidencia de surtido
                </span>
                <span className="truncate font-mono text-sm font-semibold text-slate-900">
                  {fotoAbierta.row.item}
                </span>
                <span className="text-xs text-slate-500">
                  {fotoAbierta.row.empresa} · {fotoAbierta.row.sede_id} ·{" "}
                  {fotoAbierta.row.username?.trim() || "sin usuario"}
                </span>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setFotoAbierta(null)}
                aria-label="Cerrar"
                className="h-8 w-8 shrink-0"
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </div>

            <div className="flex min-h-[220px] items-center justify-center overflow-auto bg-slate-50 p-4">
              {fotoAbierta.loading ? (
                <Loader2
                  className="h-6 w-6 animate-spin text-slate-400"
                  aria-hidden
                />
              ) : fotoAbierta.error ? (
                <p className="text-sm text-rose-700">{fotoAbierta.error}</p>
              ) : fotoAbierta.dataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- base64 en memoria, no pasa por el optimizador
                <img
                  src={fotoAbierta.dataUrl}
                  alt={`Evidencia de surtido del ítem ${fotoAbierta.row.item}`}
                  className="max-h-[62vh] w-auto rounded-lg object-contain"
                />
              ) : null}
            </div>

            <div className="border-t border-slate-100 px-5 py-3">
              <p className="text-xs text-slate-600">
                {fotoAbierta.updatedAt ? (
                  <>
                    Foto tomada el{" "}
                    <strong className="font-semibold text-slate-900">
                      {new Date(fotoAbierta.updatedAt).toLocaleString("es-CO", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </strong>
                    . El cambio de esta fila es del{" "}
                    {new Date(fotoAbierta.row.changed_at).toLocaleString("es-CO", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                    .
                  </>
                ) : null}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                Se guarda <strong>una sola foto por ítem y sede</strong>: cada vez
                que se vuelve a marcar como surtido, la nueva reemplaza a la
                anterior. Si las dos fechas de arriba no coinciden, esta foto
                corresponde a un marcaje posterior, no al de esta fila.
              </p>
              {canDeleteFoto && fotoAbierta.dataUrl ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {fotoDeleteConfirm ? (
                    <>
                      <p className="text-xs text-rose-700">
                        ¿Eliminar esta evidencia? No se puede deshacer.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={fotoDeleteBusy}
                        onClick={() => void eliminarFoto()}
                        className="h-7 gap-1.5 px-3 text-[11px] font-bold uppercase tracking-wide"
                      >
                        {fotoDeleteBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        Confirmar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={fotoDeleteBusy}
                        onClick={() => setFotoDeleteConfirm(false)}
                        className="h-7 px-3 text-[11px] font-semibold uppercase tracking-wide"
                      >
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={fotoDeleteBusy || fotoAbierta.loading}
                      onClick={() => setFotoDeleteConfirm(true)}
                      className="h-7 gap-1.5 border-rose-200 px-3 text-[11px] font-bold uppercase tracking-wide text-rose-800 hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Eliminar foto
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
