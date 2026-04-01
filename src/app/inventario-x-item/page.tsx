"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { canAccessPortalSection } from "@/lib/portal-sections";

export default function InventarioXItemPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const loadUser = async () => {
      try {
        const response = await fetch("/api/auth/me", {
          signal: controller.signal,
        });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) return;
        const payload = (await response.json()) as {
          user?: { role?: string; allowedDashboards?: string[] | null };
        };
        const isAdmin = payload.user?.role === "admin";
        if (
          !isAdmin &&
          !canAccessPortalSection(payload.user?.allowedDashboards, "venta")
        ) {
          router.replace("/secciones");
          return;
        }
        if (isMounted) setReady(true);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    };

    void loadUser();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [router]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-3xl rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <p className="text-sm text-slate-600">Cargando seccion...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.14),transparent_55%),linear-gradient(180deg,#f8fafc,#eef6ff)] px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-5xl rounded-[30px] border border-slate-200/70 bg-white p-8 shadow-[0_30px_80px_-55px_rgba(15,23,42,0.45)]">
        <div className="rounded-3xl border border-cyan-200/80 bg-linear-to-br from-cyan-50 via-white to-sky-50 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-cyan-700">
                Venta
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
                Inventario x item
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-[15px]">
                Este modulo ya quedo habilitado dentro de la seccion de venta.
                En la siguiente iteracion definiremos el cuadro resumen y el
                detalle analitico por referencia.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/venta"
                className="inline-flex items-center rounded-full border border-slate-200/70 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50"
              >
                Volver a venta
              </Link>
              <Link
                href="/secciones"
                className="inline-flex items-center rounded-full bg-cyan-600 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white transition-all hover:bg-cyan-700"
              >
                Cambiar seccion
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-5 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.28)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Estado del modulo
            </p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">
              Acceso y estructura listos
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Ya puedes ingresar desde el sub menu de venta y dejar este modulo
              preparado para crecer sin tocar de nuevo la navegacion principal.
            </p>
          </div>

          <div className="rounded-2xl border border-cyan-200/80 bg-cyan-50/70 p-5 shadow-[0_18px_40px_-32px_rgba(14,165,233,0.28)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-700">
              Siguiente paso
            </p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">
              Definir el resumen por item
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              En la siguiente ronda aterrizamos los filtros, indicadores y el
              cuadro resumen usando el inventario que ya existe en el portal.
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-4 text-sm leading-6 text-slate-600">
          Por ahora esta vista no consulta base de datos ni muestra tabla
          detallada. El objetivo de esta entrega es dejar listo el acceso, la
          identidad visual y el espacio funcional para continuar.
        </div>
      </div>
    </div>
  );
}
