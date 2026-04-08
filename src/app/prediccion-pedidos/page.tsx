"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { canAccessPortalSection } from "@/lib/portal-sections";

export default function PrediccionPedidosPage() {
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
        <div className="mx-auto w-full max-w-3xl rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <p className="text-sm text-slate-600">Cargando seccion...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.14),transparent_52%),linear-gradient(180deg,#fffdf8,#fff7e8)] px-4 py-12 text-foreground">
      <div className="mx-auto w-full max-w-4xl rounded-[30px] border border-slate-200/70 bg-white p-8 shadow-[0_28px_70px_-45px_rgba(15,23,42,0.35)]">
        <div className="rounded-3xl border border-amber-200/80 bg-linear-to-br from-amber-100 via-white to-yellow-50 p-6 shadow-[0_18px_35px_-30px_rgba(245,158,11,0.35)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="max-w-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-amber-700">
                Producto
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">
                Prediccion pedidos
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Este tablero queda creado y reservado para la siguiente etapa.
                Aqui se podran estimar pedidos sugeridos por item a partir de
                venta, inventario, rotacion y comportamiento reciente por sede.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href="/productividad"
                  className="inline-flex items-center rounded-full border border-slate-200/70 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50"
                >
                  Volver a producto
                </Link>
                <Link
                  href="/secciones"
                  className="inline-flex items-center rounded-full border border-blue-200/70 bg-blue-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-blue-700 transition-all hover:border-blue-300 hover:bg-blue-100"
                >
                  Cambiar seccion
                </Link>
              </div>
            </div>
            <div className="max-w-full rounded-2xl border border-slate-200/70 bg-slate-50 px-3 py-2">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Image
                  src="/logos/mercamio.jpeg"
                  alt="Logo Mercamio"
                  width={150}
                  height={48}
                  className="h-10 w-auto rounded-lg bg-white object-cover shadow-sm"
                />
                <Image
                  src="/logos/mercatodo.jpeg"
                  alt="Logo Mercatodo"
                  width={150}
                  height={48}
                  className="h-10 w-auto rounded-lg bg-white object-cover shadow-sm"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-dashed border-amber-300/70 bg-amber-50/70 px-5 py-8 text-center">
          <p className="text-sm font-semibold text-slate-900">
            Modulo creado correctamente.
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Cuando quieras, el siguiente paso es definir el objetivo del
            pronostico, el horizonte de dias y las variables que alimentaran la
            sugerencia de pedido.
          </p>
        </div>
      </div>
    </div>
  );
}
