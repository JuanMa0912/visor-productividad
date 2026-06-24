"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Loader2 } from "lucide-react";
import { AppTopBar } from "@/components/portal/app-top-bar";
import { useRequireAuth, usePermissions } from "@/lib/auth/auth-context";

type MargenMeta = {
  ready: boolean;
  table: string;
  rowCount: number;
  minDate: string | null;
  maxDate: string | null;
  sedeCount: number;
  message?: string | null;
  error?: string;
};

const KPI_PLACEHOLDER = "—";

export default function MargenesPage() {
  const router = useRouter();
  const { user, status } = useRequireAuth();
  const { hasSection, hasSubsection } = usePermissions();
  const [meta, setMeta] = useState<MargenMeta | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);

  useEffect(() => {
    if (status !== "authenticated" || !user) return;
    if (!hasSection("producto") || !hasSubsection("margenes")) {
      router.replace("/secciones");
    }
  }, [status, user, hasSection, hasSubsection, router]);

  useEffect(() => {
    if (status !== "authenticated") return;

    let cancelled = false;
    const load = async () => {
      setLoadingMeta(true);
      try {
        const response = await fetch("/api/margenes/meta", { cache: "no-store" });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        const payload = (await response.json()) as MargenMeta;
        if (!cancelled) setMeta(payload);
      } catch {
        if (!cancelled) {
          setMeta({
            ready: false,
            table: "margen_final",
            rowCount: 0,
            minDate: null,
            maxDate: null,
            sedeCount: 0,
            error: "No se pudo consultar el estado de la tabla.",
          });
        }
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [status, router]);

  if (status !== "authenticated" || !user) {
    return (
      <div className="flex min-h-screen flex-col bg-[#0d0f18] text-[#dde3f0]">
        <AppTopBar />
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[#4f8ef7]" />
        </div>
      </div>
    );
  }

  const rangeLabel =
    meta?.minDate && meta?.maxDate
      ? `${meta.minDate} → ${meta.maxDate}`
      : "Sin rango cargado";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0d0f18] text-[13px] text-[#dde3f0]">
      <AppTopBar />
      <header className="flex shrink-0 items-center gap-2.5 border-b border-[#2a2f47] bg-[#141720] px-4 py-2.5">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-linear-to-br from-[#4f8ef7] to-[#a78bfa]">
          <BarChart3 className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
        </div>
        <h1 className="text-sm font-bold">Análisis de Margen</h1>
        <span className="rounded-full border border-[#2a2f47] bg-[#232740] px-2.5 py-0.5 text-[11px] text-[#6b7590]">
          margen_final · dark
        </span>
        <button
          type="button"
          disabled
          className="ml-1 rounded-md border border-[#2a2f47] bg-[#1b1e2e] px-3 py-1.5 text-xs text-[#6b7590] opacity-60"
          title="Disponible cuando haya datos cargados"
        >
          ⟳ Cambiar selección
        </button>
        <span className="rounded-full border border-[#2a2f47] bg-[#232740] px-2.5 py-0.5 text-[11px] text-[#6b7590]">
          {rangeLabel}
        </span>
        <span className="ml-auto whitespace-nowrap text-[11px] text-[#6b7590]">
          {loadingMeta
            ? "Consultando tabla…"
            : meta?.ready
              ? `${meta.rowCount.toLocaleString("es-CO")} filas · ${meta.sedeCount} sede(s)`
              : "Pendiente ETL"}
        </span>
      </header>

      <div className="flex shrink-0 flex-wrap items-end gap-2.5 border-b border-[#2a2f47] bg-[#141720] px-4 py-2 opacity-50">
        {["Empresa", "Sede", "Fecha", "Categoría", "Línea", "Sublínea", "Ítem"].map(
          (label) => (
            <div key={label} className="flex min-w-[105px] flex-col gap-0.5">
              <span className="text-[10px] tracking-wide text-[#6b7590] uppercase">
                {label}
              </span>
              <div className="rounded-md border border-[#2a2f47] bg-[#1b1e2e] px-2.5 py-1.5 text-xs text-[#6b7590]">
                Todos
              </div>
            </div>
          ),
        )}
      </div>

      <div className="flex shrink-0 border-b border-[#2a2f47] bg-[#141720] px-4">
        {[
          { id: "producto", label: "📦 Producto", active: true },
          { id: "factura", label: "📋 Por Factura", active: false },
          { id: "sede", label: "🏢 Por Sede", active: false },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            disabled
            className={`border-b-2 px-4 py-2 text-xs font-semibold whitespace-nowrap ${
              tab.active
                ? "border-[#4f8ef7] text-[#4f8ef7]"
                : "border-transparent text-[#6b7590]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex shrink-0 border-b border-[#2a2f47] bg-[#141720]">
        {[
          { label: "Ventas netas (miles)", valueClass: "text-[#4f8ef7]" },
          { label: "Costo total (miles)", valueClass: "text-[#dde3f0]" },
          { label: "Margen $ (miles)", valueClass: "text-[#dde3f0]" },
          { label: "Margen %", valueClass: "text-[#34d399]" },
        ].map((kpi, index, arr) => (
          <div
            key={kpi.label}
            className={`flex-1 px-3.5 py-2.5 ${index < arr.length - 1 ? "border-r border-[#2a2f47]" : ""}`}
          >
            <div className="mb-0.5 text-[10px] tracking-wide text-[#6b7590] uppercase">
              {kpi.label}
            </div>
            <div className={`text-lg font-bold ${kpi.valueClass}`}>
              {KPI_PLACEHOLDER}
            </div>
          </div>
        ))}
      </div>

      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="max-w-lg rounded-xl border border-[#2a2f47] bg-[#141720] p-6 shadow-[0_12px_36px_rgba(0,0,0,0.45)]">
          <h2 className="text-base font-bold text-[#dde3f0]">
            Nuevo tablero de margen unificado
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[#9aa3bc]">
            Interfaz basada en el prototipo{" "}
            <span className="text-[#dde3f0]">margen_unificado_11sedes</span> con
            tema oscuro, drill por producto/factura/sede y tabla{" "}
            <span className="font-mono text-[#4f8ef7]">margen_final</span>.
          </p>
          {meta?.message ? (
            <p className="mt-3 rounded-md border border-[#2a2f47] bg-[#1b1e2e] px-3 py-2 text-xs text-[#fbbf24]">
              {meta.message}
            </p>
          ) : null}
          {meta?.error ? (
            <p className="mt-3 text-xs text-[#f87171]">{meta.error}</p>
          ) : null}
          <ul className="mt-4 space-y-1.5 text-left text-xs text-[#6b7590]">
            <li>· Migración: <span className="font-mono">20260622_margen_final.sql</span></li>
            <li>· Columnas CSV: empresa, fecha_dcto (YYYYMMDD), id_co, id_caja, id_tipo, líneas, ventas, costos, factura</li>
            <li>· Legacy <span className="font-mono">margenes_linea_co_dia</span> se mantiene hasta validar carga</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
