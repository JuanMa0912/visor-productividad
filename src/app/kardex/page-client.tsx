"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  KardexFilters,
  KardexResumenCategoria,
  KardexResumenItem,
  KardexRow,
} from "@/features/kardex/types";
import {
  useKardexDetalle,
  useKardexLookups,
  useKardexResumenCategoria,
  useKardexResumenItem,
  useKardexTotales,
} from "@/features/kardex/hooks";

type KardexView = "detalle" | "resumen-item" | "resumen-categoria" | "totales";

const PAGE_SIZE = 50;

const currencyFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 2,
});
const numberFormatter = new Intl.NumberFormat("es-CO", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});

const formatMoney = (value: number | null | undefined) =>
  currencyFormatter.format(value ?? 0);
const formatNumber = (value: number | null | undefined) =>
  numberFormatter.format(value ?? 0);
const formatPct = (value: number | null | undefined) =>
  value === null || value === undefined ? "-" : `${value.toFixed(2)}%`;

const csvEscape = (value: unknown) => {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const downloadCsv = (filename: string, headers: string[], rows: Array<unknown[]>) => {
  const body = [headers, ...rows]
    .map((row) => row.map((value) => csvEscape(value)).join(","))
    .join("\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const initialFilters: KardexFilters = {
  empresa: "",
  sede: "",
  bodegaLocal: "",
  idItem: "",
  idCategoria: "",
  idLineaNivel1: "",
  fechaDesde: "",
  fechaHasta: "",
};

const sortByKey = <T extends Record<string, unknown>>(
  rows: T[],
  key: string,
  direction: "asc" | "desc",
) => {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = a[key];
    const right = b[key];
    if (left === right) return 0;
    if (left === null || left === undefined) return 1;
    if (right === null || right === undefined) return -1;
    if (typeof left === "number" && typeof right === "number") {
      return sign * (left - right);
    }
    return sign * String(left).localeCompare(String(right), "es", { numeric: true });
  });
};

export default function KardexPageClient() {
  const [filters, setFilters] = useState<KardexFilters>(initialFilters);
  const [view, setView] = useState<KardexView>("detalle");
  const [sortField, setSortField] = useState("fechaDia");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const { data: lookups } = useKardexLookups(filters);
  const {
    data: detalle,
    loading: loadingDetalle,
    error: detalleError,
  } = useKardexDetalle(filters);
  const { data: resumenItem, loading: loadingResumenItem } =
    useKardexResumenItem(filters);
  const { data: resumenCategoria, loading: loadingResumenCategoria } =
    useKardexResumenCategoria(filters);
  const { data: totales, loading: loadingTotales, error: totalesError } =
    useKardexTotales(filters);

  const selectedSedes = useMemo(() => {
    if (!filters.empresa) return lookups.sedes;
    return lookups.sedes.filter((row) => row.empresa === filters.empresa);
  }, [filters.empresa, lookups.sedes]);

  const handleFilterChange = (field: keyof KardexFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
    setPage(1);
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const rowsForView = useMemo(() => {
    if (view === "detalle") {
      return sortByKey(detalle as unknown as Record<string, unknown>[], sortField, sortDirection);
    }
    if (view === "resumen-item") {
      return sortByKey(
        resumenItem as unknown as Record<string, unknown>[],
        sortField,
        sortDirection,
      );
    }
    if (view === "resumen-categoria") {
      return sortByKey(
        resumenCategoria as unknown as Record<string, unknown>[],
        sortField,
        sortDirection,
      );
    }
    return [];
  }, [detalle, resumenCategoria, resumenItem, sortDirection, sortField, view]);

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return rowsForView.slice(start, start + PAGE_SIZE);
  }, [rowsForView, page]);

  const totalPages = Math.max(1, Math.ceil(rowsForView.length / PAGE_SIZE));

  const handleExport = () => {
    if (view === "detalle") {
      const rows = (rowsForView as KardexRow[]).map((row) => [
        row.fechaDia,
        row.empresa,
        row.sede,
        row.bodegaLocal,
        row.idItem,
        row.nombreItem ?? "",
        row.ventas ?? 0,
        row.costo ?? 0,
        row.margen ?? 0,
        row.margenPct ?? "",
      ]);
      downloadCsv(
        "kardex-detalle.csv",
        [
          "Fecha",
          "Empresa",
          "Sede",
          "Bodega",
          "Item",
          "Nombre item",
          "Ventas",
          "Costo",
          "Margen",
          "Margen %",
        ],
        rows,
      );
      return;
    }
    if (view === "resumen-item") {
      const rows = (rowsForView as KardexResumenItem[]).map((row) => [
        row.empresa,
        row.sede,
        row.idItem,
        row.nombreItem ?? "",
        row.ventas,
        row.costo,
        row.margen,
        row.margenPct,
      ]);
      downloadCsv(
        "kardex-resumen-item.csv",
        ["Empresa", "Sede", "Item", "Nombre", "Ventas", "Costo", "Margen", "Margen %"],
        rows,
      );
      return;
    }
    if (view === "resumen-categoria") {
      const rows = (rowsForView as KardexResumenCategoria[]).map((row) => [
        row.empresa,
        row.sede,
        row.idCategoria ?? "",
        row.nombreCategoria ?? "",
        row.ventas,
        row.costo,
        row.margen,
        row.margenPct,
      ]);
      downloadCsv(
        "kardex-resumen-categoria.csv",
        [
          "Empresa",
          "Sede",
          "ID Categoria",
          "Categoria",
          "Ventas",
          "Costo",
          "Margen",
          "Margen %",
        ],
        rows,
      );
    }
  };

  const isLoading =
    loadingDetalle || loadingResumenItem || loadingResumenCategoria || loadingTotales;

  return (
    <main className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Kardex de margen</h1>
          <p className="text-sm text-slate-600">
            Detalle diario y resumen por item/categoria con calculo SUM(margen)/SUM(ventas).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/rotacion">
              <ArrowLeft className="size-4" />
              Volver a rotacion
            </Link>
          </Button>
          <Button onClick={handleExport} variant="outline">
            <Download className="size-4" />
            Exportar CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="text-sm">
            Empresa
            <select
              className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2"
              value={filters.empresa}
              onChange={(event) => handleFilterChange("empresa", event.target.value)}
            >
              <option value="">Todas</option>
              {lookups.empresas.map((empresa) => (
                <option key={empresa} value={empresa}>
                  {empresa}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Sede
            <select
              className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2"
              value={filters.sede}
              onChange={(event) => handleFilterChange("sede", event.target.value)}
            >
              <option value="">Todas</option>
              {selectedSedes.map((sede) => (
                <option key={`${sede.empresa}-${sede.value}`} value={sede.value}>
                  {sede.value}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Bodega
            <select
              className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2"
              value={filters.bodegaLocal}
              onChange={(event) => handleFilterChange("bodegaLocal", event.target.value)}
            >
              <option value="">Todas</option>
              {lookups.bodegas.map((bodega) => (
                <option key={bodega} value={bodega}>
                  {bodega}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Item
            <input
              className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2"
              value={filters.idItem}
              onChange={(event) => handleFilterChange("idItem", event.target.value)}
              placeholder="ID de item"
            />
          </label>
          <label className="text-sm">
            Categoria
            <select
              className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2"
              value={filters.idCategoria}
              onChange={(event) => handleFilterChange("idCategoria", event.target.value)}
            >
              <option value="">Todas</option>
              {lookups.categorias.map((row) => (
                <option key={`${row.idCategoria ?? "null"}-${row.nombreCategoria ?? "null"}`} value={row.idCategoria ?? ""}>
                  {row.nombreCategoria ?? row.idCategoria ?? "Sin categoria"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Linea N1
            <select
              className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2"
              value={filters.idLineaNivel1}
              onChange={(event) => handleFilterChange("idLineaNivel1", event.target.value)}
            >
              <option value="">Todas</option>
              {lookups.lineas.map((row) => (
                <option
                  key={`${row.idLineaNivel1 ?? "null"}-${row.nombreLineaNivel1 ?? "null"}`}
                  value={row.idLineaNivel1 ?? ""}
                >
                  {row.nombreLineaNivel1 ?? row.idLineaNivel1 ?? "Sin linea"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Fecha desde
            <input
              type="date"
              className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2"
              value={filters.fechaDesde}
              onChange={(event) => handleFilterChange("fechaDesde", event.target.value)}
            />
          </label>
          <label className="text-sm">
            Fecha hasta
            <input
              type="date"
              className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2"
              value={filters.fechaHasta}
              onChange={(event) => handleFilterChange("fechaHasta", event.target.value)}
            />
          </label>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-slate-600">Ventas</CardTitle>
          </CardHeader>
          <CardContent className="text-xl font-bold">{formatMoney(totales.ventas)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-slate-600">Costo</CardTitle>
          </CardHeader>
          <CardContent className="text-xl font-bold">{formatMoney(totales.costo)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-slate-600">Margen</CardTitle>
          </CardHeader>
          <CardContent
            className={`text-xl font-bold ${totales.margen < 0 ? "text-rose-600" : "text-emerald-700"}`}
          >
            {formatMoney(totales.margen)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-slate-600">Margen %</CardTitle>
          </CardHeader>
          <CardContent className="text-xl font-bold">{formatPct(totales.margenPct)}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Vistas</CardTitle>
          <div className="flex flex-wrap gap-2">
            {[
              { id: "detalle", label: "Detalle" },
              { id: "resumen-item", label: "Por item" },
              { id: "resumen-categoria", label: "Por categoria" },
              { id: "totales", label: "Totales" },
            ].map((option) => (
              <Button
                key={option.id}
                size="sm"
                variant={view === option.id ? "default" : "outline"}
                onClick={() => {
                  setView(option.id as KardexView);
                  setPage(1);
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-slate-600">Cargando kardex...</p> : null}
          {detalleError || totalesError ? (
            <p className="text-sm text-rose-600">{detalleError ?? totalesError}</p>
          ) : null}
          {view === "totales" ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ventas</TableHead>
                  <TableHead>Costo</TableHead>
                  <TableHead>Margen</TableHead>
                  <TableHead>Margen %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>{formatMoney(totales.ventas)}</TableCell>
                  <TableCell>{formatMoney(totales.costo)}</TableCell>
                  <TableCell>{formatMoney(totales.margen)}</TableCell>
                  <TableCell>{formatPct(totales.margenPct)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          ) : null}

          {view === "detalle" ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead onClick={() => handleSort("fechaDia")}>Fecha</TableHead>
                  <TableHead onClick={() => handleSort("empresa")}>Empresa</TableHead>
                  <TableHead onClick={() => handleSort("sede")}>Sede</TableHead>
                  <TableHead onClick={() => handleSort("idItem")}>Item</TableHead>
                  <TableHead className="text-right" onClick={() => handleSort("ventas")}>
                    Ventas
                  </TableHead>
                  <TableHead className="text-right" onClick={() => handleSort("costo")}>
                    Costo
                  </TableHead>
                  <TableHead className="text-right" onClick={() => handleSort("margen")}>
                    Margen
                  </TableHead>
                  <TableHead className="text-right" onClick={() => handleSort("margenPct")}>
                    Margen %
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedRows.map((row) => {
                  const typed = row as unknown as KardexRow;
                  return (
                    <TableRow key={`${typed.empresa}-${typed.sede}-${typed.idItem}-${typed.fechaDia}`}>
                      <TableCell>{typed.fechaDia}</TableCell>
                      <TableCell>{typed.empresa}</TableCell>
                      <TableCell>{typed.sede}</TableCell>
                      <TableCell>{typed.idItem}</TableCell>
                      <TableCell className="text-right">{formatMoney(typed.ventas)}</TableCell>
                      <TableCell className="text-right">{formatMoney(typed.costo)}</TableCell>
                      <TableCell
                        className={`text-right ${((typed.margen ?? 0) < 0 ? "text-rose-600" : "")}`}
                      >
                        {formatMoney(typed.margen)}
                      </TableCell>
                      <TableCell className="text-right">{formatPct(typed.margenPct)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : null}

          {view === "resumen-item" ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead onClick={() => handleSort("empresa")}>Empresa</TableHead>
                  <TableHead onClick={() => handleSort("sede")}>Sede</TableHead>
                  <TableHead onClick={() => handleSort("idItem")}>Item</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="text-right" onClick={() => handleSort("unidades")}>
                    Unidades
                  </TableHead>
                  <TableHead className="text-right" onClick={() => handleSort("ventas")}>
                    Ventas
                  </TableHead>
                  <TableHead className="text-right" onClick={() => handleSort("margenPct")}>
                    Margen %
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedRows.map((row) => {
                  const typed = row as unknown as KardexResumenItem;
                  return (
                    <TableRow key={`${typed.empresa}-${typed.sede}-${typed.idItem}`}>
                      <TableCell>{typed.empresa}</TableCell>
                      <TableCell>{typed.sede}</TableCell>
                      <TableCell>{typed.idItem}</TableCell>
                      <TableCell>{typed.nombreItem ?? "-"}</TableCell>
                      <TableCell className="text-right">{formatNumber(typed.unidades)}</TableCell>
                      <TableCell className="text-right">{formatMoney(typed.ventas)}</TableCell>
                      <TableCell className="text-right">{formatPct(typed.margenPct)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : null}

          {view === "resumen-categoria" ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead onClick={() => handleSort("empresa")}>Empresa</TableHead>
                  <TableHead onClick={() => handleSort("sede")}>Sede</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right" onClick={() => handleSort("items")}>
                    Items
                  </TableHead>
                  <TableHead className="text-right" onClick={() => handleSort("ventas")}>
                    Ventas
                  </TableHead>
                  <TableHead className="text-right" onClick={() => handleSort("margen")}>
                    Margen
                  </TableHead>
                  <TableHead className="text-right" onClick={() => handleSort("margenPct")}>
                    Margen %
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedRows.map((row) => {
                  const typed = row as unknown as KardexResumenCategoria;
                  return (
                    <TableRow key={`${typed.empresa}-${typed.sede}-${typed.idCategoria ?? "sin-cat"}`}>
                      <TableCell>{typed.empresa}</TableCell>
                      <TableCell>{typed.sede}</TableCell>
                      <TableCell>{typed.nombreCategoria ?? typed.idCategoria ?? "Sin categoria"}</TableCell>
                      <TableCell className="text-right">{formatNumber(typed.items)}</TableCell>
                      <TableCell className="text-right">{formatMoney(typed.ventas)}</TableCell>
                      <TableCell
                        className={`text-right ${typed.margen < 0 ? "text-rose-600" : ""}`}
                      >
                        {formatMoney(typed.margen)}
                      </TableCell>
                      <TableCell className="text-right">{formatPct(typed.margenPct)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : null}

          {view !== "totales" ? (
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page <= 1}
              >
                Anterior
              </Button>
              <span className="text-xs text-slate-500">
                Pagina {page} de {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={page >= totalPages}
              >
                Siguiente
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
