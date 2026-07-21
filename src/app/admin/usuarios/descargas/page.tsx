"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Download,
  LayoutGrid,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { AppTopBar } from "@/components/portal/app-top-bar";
import { Button } from "@/components/ui/button";
import type {
  AdminExportDownloadListResponse,
  AdminExportDownloadRow,
} from "@/app/api/admin/exports/route";

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
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const formatFilters = (filters: Record<string, unknown> | null) => {
  if (!filters || Object.keys(filters).length === 0) return "—";
  try {
    const text = JSON.stringify(filters);
    return text.length > 120 ? `${text.slice(0, 117)}…` : text;
  } catch {
    return "—";
  }
};

export default function AdminExportDownloadsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<AdminExportDownloadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tableMissing, setTableMissing] = useState(false);
  const [username, setUsername] = useState("");
  const [panelPath, setPanelPath] = useState("");
  const [format, setFormat] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "150" });
      if (username.trim()) params.set("username", username.trim());
      if (panelPath.trim()) params.set("panelPath", panelPath.trim());
      if (format.trim()) params.set("format", format.trim());
      if (dateFrom.trim()) params.set("dateFrom", dateFrom.trim());
      if (dateTo.trim()) params.set("dateTo", dateTo.trim());

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
  }, [dateFrom, dateTo, format, panelPath, router, username]);

  useEffect(() => {
    void load();
  }, [load]);

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
              Metadatos de Excel/PDF/CSV/imagenes exportados por usuarios. Sin
              archivo adjunto. Retencion 9 meses.
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

        <div className="mb-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs font-medium text-slate-600">
            Usuario
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="PIPE"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Ruta panel
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              value={panelPath}
              onChange={(e) => setPanelPath(e.target.value)}
              placeholder="/rotacion"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Formato
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
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
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Hasta (log)
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
        </div>

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
                <th className="px-3 py-2 font-semibold">Cuándo</th>
                <th className="px-3 py-2 font-semibold">Usuario</th>
                <th className="px-3 py-2 font-semibold">Panel</th>
                <th className="px-3 py-2 font-semibold">Qué</th>
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
                    Sin descargas registradas.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                      {formatAbsolute(row.createdAt)}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {row.username}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">
                        {row.panelLabel ?? row.panelPath}
                      </div>
                      <div className="text-xs text-slate-500">{row.panelPath}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">
                        {row.exportKind}
                      </div>
                      <div className="text-xs uppercase text-slate-500">
                        {row.format}
                        {row.rowCount != null ? ` · ${row.rowCount} filas` : ""}
                        {row.byteSize != null
                          ? ` · ${formatBytes(row.byteSize)}`
                          : ""}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                      {row.dateFrom || row.dateTo
                        ? `${row.dateFrom ?? "?"} → ${row.dateTo ?? "?"}`
                        : "—"}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2 text-slate-700" title={row.fileName}>
                      {row.fileName}
                    </td>
                    <td
                      className="max-w-[240px] truncate px-3 py-2 font-mono text-[11px] text-slate-500"
                      title={formatFilters(row.filters)}
                    >
                      {formatFilters(row.filters)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
