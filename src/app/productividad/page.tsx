"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { canAccessPortalSection } from "@/lib/portal-sections";

export default function ProductividadHubPage() {
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
          !canAccessPortalSection(payload.user?.allowedDashboards, "producto")
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
        <div className="mx-auto w-full max-w-2xl rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <p className="text-sm text-slate-600">Cargando seccion...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-12 text-foreground">
      <div className="mx-auto w-full max-w-3xl rounded-3xl border border-slate-200/70 bg-white p-7 shadow-[0_28px_70px_-45px_rgba(15,23,42,0.4)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-700">
          Producto
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Causa comercial del resultado</h1>
          <button
            type="button"
            onClick={() => router.push("/secciones")}
            className="inline-flex items-center rounded-full border border-slate-200/70 bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-200/70"
          >
            Volver a secciones
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Usa esta seccion para entender que lineas, productos y margenes
          explican el resultado del negocio por sede.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="rounded-2xl border border-yellow-300/80 bg-linear-to-br from-yellow-50 via-white to-amber-100 px-5 py-5 text-left text-slate-900 shadow-[0_18px_35px_-30px_rgba(245,158,11,0.4)] transition-all hover:-translate-y-0.5 hover:border-amber-400"
          >
            <span className="inline-flex rounded-full border border-yellow-300/80 bg-yellow-200/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-900">
              Mix y linea
            </span>
            <span className="mt-3 block text-sm font-semibold">
              Desempeno comercial por sede
            </span>
            <span className="mt-1 block text-xs text-slate-600">
              Revisa que lineas y sedes empujan o frenan el resultado con
              comparativos de venta y desempeno.
            </span>
          </button>

          <button
            type="button"
            onClick={() => router.push("/margenes")}
            className="rounded-2xl border border-amber-300/80 bg-linear-to-br from-amber-100 via-white to-orange-100 px-5 py-5 text-left text-slate-900 shadow-[0_18px_35px_-30px_rgba(245,158,11,0.45)] transition-all hover:-translate-y-0.5 hover:border-amber-400"
          >
            <span className="inline-flex rounded-full border border-amber-300/80 bg-amber-200/75 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-800">
              Margenes
            </span>
            <span className="mt-3 block text-sm font-semibold">
              Rentabilidad por linea
            </span>
            <span className="mt-1 block text-xs text-slate-600">
              Entiende el aporte de cada linea al resultado desde margen,
              utilidad y rentabilidad.
            </span>
          </button>

          <button
            type="button"
            onClick={() => router.push("/rotacion")}
            className="rounded-2xl border border-orange-300/80 bg-linear-to-br from-orange-100 via-white to-amber-50 px-5 py-5 text-left text-slate-900 shadow-[0_18px_35px_-30px_rgba(251,146,60,0.45)] transition-all hover:-translate-y-0.5 hover:border-orange-400"
          >
            <span className="inline-flex rounded-full border border-orange-300/80 bg-orange-200/75 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-orange-800">
              Rotacion
            </span>
            <span className="mt-3 block text-sm font-semibold">
              Inventario con baja salida
            </span>
            <span className="mt-1 block text-xs text-slate-600">
              Visualiza productos con baja rotacion y los items que no se estan
              moviendo por sede.
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
