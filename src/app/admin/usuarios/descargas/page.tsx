"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Download,
  LayoutGrid,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { AppTopBar } from "@/components/portal/app-top-bar";
import { Button } from "@/components/ui/button";
import type {
  AdminExportDownloadListResponse,
  AdminExportDownloadRow,
} from "@/app/api/admin/exports/route";
import { EXPORT_PANEL_FILTER_OPTIONS } from "@/lib/shared/path-labels";

const formatAbsolute = (iso: string) => {
  try {
    return new Intl.DateTimeFormat("es-CO", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
};

const formatBytes = (bytes: number | null) => {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const FORMAT_BADGE: Record<string, string> = {
  xlsx: "bg-emerald-100 text-emerald-800",
  pdf: "bg-rose-100 text-rose-800",
  csv: "bg-sky-100 text-sky-800",
  png: "bg-violet-100 text-violet-800",
  jpeg: "bg-violet-100 text-violet-800",
  other: "bg-slate-100 text-slate-700",
};

const FILTER_LABELS: Record<string, string> = {
  sedes: "Sedes",
  sede: "Sede",
  empresas: "Empresas",
  lineasN1: "Líneas",
  categorias: "Categorías",
  department: "Depto",
  metric: "Métrica",
  mode: "Modo",
  display: "Vista",
  viewMode: "Vista",
};

const summarizeFilters = (
  filters: Record<string, unknown> | null,
): string[] => {
  if (!filters) return [];
  const chips: string[] = [];
  for (const [key, raw] of Object.entries(filters)) {
    if (raw == null || raw === "" || raw === "all") continue;
    const label = FILTER_LABELS[key] ?? key;
    if (Array.isArray(raw)) {
      if (raw.length === 0) continue;
      const preview = raw
        .slice(0, 2)
        .map((v) => String(v))
        .join(", ");
      const extra = raw.length > 2 ? ` +${raw.length - 2}` : "";
      chips.push(`${label}: ${preview}${extra}`);
      continue;
    }
    if (typeof raw === "object") continue;
    chips.push(`${label}: ${String(raw)}`);
  }
  return chips.slice(0, 4);
};

type AppliedFilters = {
  username: string;
  panelPath: string;
  format: string;
  dateFrom: string;
  dateTo: string;
};

const EMPTY_FILTERS: AppliedFilters = {
  username: "",
  panelPath: "",
  format: "",
  dateFrom: "",
  dateTo: "",
};

export default function AdminExportDownloadsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<AdminExportDownloadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tableMissing, setTableMissing] = useState(false);
  const [draft, setDraft] = useState<AppliedFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<AppliedFilters>(EMPTY_FILTERS);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "150" });
      if (applied.username.trim()) params.set("username", applied.username.trim());
      if (applied.panelPath.trim()) params.set("panelPath", applied.panelPath.trim());
      if (applied.format.trim()) params.set("format", applied.format.trim());
      if (applied.dateFrom.trim()) params.set("dateFrom", applied.dateFrom.trim());
      if (applied.dateTo.trim()) params.set("dateTo", applied.dateTo.trim());

      const response = await fetch(`/api/admin/exports?${params.toString()}`, {
        cache: "no-store",
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (response.status === 403) {
        router.replace("/secciones");
        return;
      }
      const data = (await response.json()) as AdminExportDownloadListResponse & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "No se pudo cargar el registro.");
      }
      setRows(data.rows ?? []);
      setTableMissing(Boolean(data.tableMissing));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [applied, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const kpis = useMemo(() => {
    const users = new Set(rows.map((r) => r.username.toLowerCase()));
    const panels = new Set(rows.map((r) => r.panelPath));
    return {
      total: rows.length,
      users: users.size,
      panels: panels.size,
    };
  }, [rows]);

  const csvHref = useMemo(() => {
    if (rows.length === 0) return null;
    const header = [
      "fecha",
      "usuario",
      "panel",
      "ruta",
      "tipo",
      "formato",
      "archivo",
      "desde",
      "hasta",
      "filas",
      "tamano",
      "filtros",
    ];
    const lines = [
      header.join(","),
      ...rows.map((row) =>
        [
          row.createdAt,
          row.username,
          row.panelLabel ?? "",
          row.panelPath,
          row.exportKind,
          row.format,
          row.fileName,
          row.dateFrom ?? "",
          row.dateTo ?? "",
          row.rowCount ?? "",
          row.byteSize ?? "",
          JSON.stringify(row.filters ?? {}),
        ]
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    return `data:text/csv;charset=utf-8,${encodeURIComponent(lines.join("\n"))}`;
  }, [rows]);

  const applyFilters = () => {
    setExpandedId(null);
    setApplied({ ...draft });
  };

  const clearFilters = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setExpandedId(null);
  };

  const hasActiveFilters = Object.values(applied).some((v) => v.trim());

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppTopBar backHref="/admin/usuarios" backLabel="Volver a usuarios" />
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href="/admin/usuarios"
              className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500 hover:text-slate-800"
            >
              <LayoutGrid className="h-3 w-3" />
              Admin · Usuarios
            </Link>
            <h1 className="mt-1 flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
              <Download className="h-7 w-7 text-emerald-600" />
              Descargas
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Quién exportó qué, desde qué panel y con qué filtros. Sin archivo
              adjunto · retención 9 meses.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {csvHref ? (
              <a
                href={csvHref}
                download={`descargas_${new Date().toISOString().slice(0, 10)}.csv`}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-4 w-4" />
                CSV
              </a>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Actualizar
            </Button>
          </div>
        </header>

        <div className="mb-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Registros
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
              {kpis.total}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Usuarios
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
              {kpis.users}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Paneles
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
              {kpis.panels}
            </p>
          </div>
        </div>

        <form
          className="mb-4 rounded-2xl border border-slate-200 bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            applyFilters();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="text-xs font-medium text-slate-600">
              Usuario
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                value={draft.username}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, username: e.target.value }))
                }
                placeholder="PIPE, JSALAZAR…"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Panel
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                value={draft.panelPath}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, panelPath: e.target.value }))
                }
              >
                <option value="">Todos</option>
                {EXPORT_PANEL_FILTER_OPTIONS.map(({ path, label }) => (
                  <option key={path} value={path}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Formato
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                value={draft.format}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, format: e.target.value }))
                }
              >
                <option value="">Todos</option>
                <option value="xlsx">xlsx</option>
                <option value="pdf">pdf</option>
                <option value="csv">csv</option>
                <option value="png">png</option>
                <option value="jpeg">jpeg</option>
                <option value="other">other</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Desde (log)
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                value={draft.dateFrom}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, dateFrom: e.target.value }))
                }
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Hasta (log)
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                value={draft.dateTo}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, dateTo: e.target.value }))
                }
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={loading}>
              <Search className="h-4 w-4" />
              Buscar
            </Button>
            {hasActiveFilters ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearFilters}
              >
                <X className="h-4 w-4" />
                Limpiar
              </Button>
            ) : null}
            <p className="text-xs text-slate-400">
              Usuario acepta coincidencia parcial · panel por ruta
            </p>
          </div>
        </form>

        {tableMissing ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Falta aplicar{" "}
            <code className="text-xs">
              db/migrations/20260721_app_export_download_log.sql
            </code>
            .
          </div>
        ) : null}
        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-8 px-2 py-2" />
                <th className="px-3 py-2 font-semibold">Cuándo</th>
                <th className="px-3 py-2 font-semibold">Usuario</th>
                <th className="px-3 py-2 font-semibold">Panel / qué</th>
                <th className="px-3 py-2 font-semibold">Rango datos</th>
                <th className="px-3 py-2 font-semibold">Archivo</th>
                <th className="px-3 py-2 font-semibold">Filtros</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                    Sin descargas con estos filtros.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const chips = summarizeFilters(row.filters);
                  const open = expandedId === row.id;
                  const badgeClass =
                    FORMAT_BADGE[row.format] ?? FORMAT_BADGE.other;
                  return (
                    <FragmentRow
                      key={row.id}
                      row={row}
                      chips={chips}
                      open={open}
                      badgeClass={badgeClass}
                      onToggle={() =>
                        setExpandedId((current) =>
                          current === row.id ? null : row.id,
                        )
                      }
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FragmentRow({
  row,
  chips,
  open,
  badgeClass,
  onToggle,
}: {
  row: AdminExportDownloadRow;
  chips: string[];
  open: boolean;
  badgeClass: string;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-t border-slate-100 align-top hover:bg-slate-50/70">
        <td className="px-2 py-2">
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-expanded={open}
            aria-label={open ? "Ocultar detalle" : "Ver detalle"}
          >
            <ChevronDown
              className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`}
            />
          </button>
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-slate-700">
          {formatAbsolute(row.createdAt)}
        </td>
        <td className="px-3 py-2 font-medium text-slate-900">
          {row.userId ? (
            <Link
              href={`/admin/usuarios/${row.userId}/metricas`}
              className="hover:text-indigo-700 hover:underline"
            >
              {row.username}
            </Link>
          ) : (
            row.username
          )}
        </td>
        <td className="px-3 py-2">
          <div className="font-medium text-slate-800">
            {row.panelLabel ?? row.panelPath}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badgeClass}`}
            >
              {row.format}
            </span>
            <span className="text-xs text-slate-500">{row.exportKind}</span>
            {row.rowCount != null ? (
              <span className="text-xs text-slate-400">
                · {row.rowCount.toLocaleString("es-CO")} filas
              </span>
            ) : null}
            {formatBytes(row.byteSize) ? (
              <span className="text-xs text-slate-400">
                · {formatBytes(row.byteSize)}
              </span>
            ) : null}
          </div>
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-slate-700">
          {row.dateFrom || row.dateTo
            ? `${row.dateFrom ?? "?"} → ${row.dateTo ?? "?"}`
            : "—"}
        </td>
        <td
          className="max-w-[200px] truncate px-3 py-2 text-slate-700"
          title={row.fileName}
        >
          {row.fileName}
        </td>
        <td className="px-3 py-2">
          {chips.length === 0 ? (
            <span className="text-slate-400">—</span>
          ) : (
            <div className="flex max-w-[280px] flex-wrap gap-1">
              {chips.map((chip) => (
                <span
                  key={chip}
                  className="inline-flex max-w-full truncate rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700"
                  title={chip}
                >
                  {chip}
                </span>
              ))}
            </div>
          )}
        </td>
      </tr>
      {open ? (
        <tr className="border-t border-slate-50 bg-slate-50/80">
          <td colSpan={7} className="px-4 py-3">
            <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="font-semibold uppercase tracking-wide text-slate-400">
                  Ruta
                </p>
                <p className="mt-1 font-mono text-slate-700">{row.panelPath}</p>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wide text-slate-400">
                  Origen
                </p>
                <p className="mt-1 text-slate-700">{row.source}</p>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wide text-slate-400">
                  IP auditada
                </p>
                <p className="mt-1 font-mono text-slate-700">{row.ip ?? "—"}</p>
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <p className="font-semibold uppercase tracking-wide text-slate-400">
                  Filtros (JSON)
                </p>
                <pre className="mt-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-3 font-mono text-[11px] text-slate-700">
                  {JSON.stringify(row.filters ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
