"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
          Array.isArray(payload.user?.allowedDashboards) &&
          !payload.user?.allowedDashboards.includes("productividad")
        ) {
          router.replace("/tableros");
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
          <p className="text-sm text-slate-600">Cargando opciones...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-12 text-foreground">
      <div className="mx-auto w-full max-w-3xl rounded-3xl border border-slate-200/70 bg-white p-7 shadow-[0_28px_70px_-45px_rgba(15,23,42,0.4)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
          Productividad
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Selecciona una opcion</h1>
          <button
            type="button"
            onClick={() => router.push("/tableros")}
            className="inline-flex items-center rounded-full border border-slate-200/70 bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-200/70"
          >
            Volver a tableros
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Entra al tablero actual por linea o al nuevo subtablero de cajas.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="rounded-2xl border border-blue-300/80 bg-linear-to-br from-blue-100 via-white to-cyan-100 px-5 py-5 text-left text-slate-900 shadow-[0_18px_35px_-30px_rgba(37,99,235,0.45)] transition-all hover:-translate-y-0.5 hover:border-blue-400"
          >
            <span className="inline-flex rounded-full border border-blue-300/80 bg-blue-200/75 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-blue-800">
              Productividad
            </span>
            <span className="mt-3 block text-sm font-semibold">
              Tablero de Productividad
            </span>
            <span className="mt-1 block text-xs text-slate-600">
              Ventas, horas, margen y comparativos por sede y linea.
            </span>
          </button>

          <button
            type="button"
            onClick={() => router.push("/productividad/cajas")}
            className="rounded-2xl border border-emerald-300/80 bg-linear-to-br from-emerald-100 via-white to-lime-100 px-5 py-5 text-left text-slate-900 shadow-[0_18px_35px_-30px_rgba(16,185,129,0.45)] transition-all hover:-translate-y-0.5 hover:border-emerald-400"
          >
            <span className="inline-flex rounded-full border border-emerald-300/80 bg-emerald-200/75 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-800">
              Cajas
            </span>
            <span className="mt-3 block text-sm font-semibold">Cajas</span>
            <span className="mt-1 block text-xs text-slate-600">
              Consulta facturacion por hora y acumulados por rango horario.
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
