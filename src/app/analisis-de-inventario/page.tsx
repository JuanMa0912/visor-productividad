"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PieChart } from "lucide-react";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import { canAccessPortalSection } from "@/lib/portal-sections";

export default function AnalisisDeInventarioPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [canAccessCronograma, setCanAccessCronograma] = useState(false);

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
          user?: {
            role?: string;
            allowedDashboards?: string[] | null;
            specialRoles?: string[] | null;
          };
        };
        const userIsAdmin = payload.user?.role === "admin";
        if (
          !userIsAdmin &&
          !canAccessPortalSection(payload.user?.allowedDashboards, "venta")
        ) {
          router.replace("/secciones");
          return;
        }
        if (isMounted) {
          setIsAdmin(userIsAdmin);
          setCanAccessCronograma(
            userIsAdmin ||
              Boolean(payload.user?.specialRoles?.includes("cronograma")),
          );
          setReady(true);
        }
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
          <p className="text-sm text-slate-600">Cargando modulo...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-foreground">
      <PortalBrandingHeader
        canAccessCronograma={canAccessCronograma}
        isAdmin={isAdmin}
        onBackToSecciones={() => router.push("/secciones")}
      />
      <div className="mx-auto w-full max-w-3xl px-4 py-8 lg:px-6">
        <Link
          href="/venta"
          className="inline-flex text-sm font-semibold text-blue-700 underline-offset-4 hover:underline"
        >
          Volver a Venta
        </Link>
        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 border-t-4 border-t-blue-500 bg-white px-6 py-8 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.28)]">
          <div className="flex flex-wrap items-start gap-4">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600">
              <PieChart className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-600">
                Venta • Analisis
              </p>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
                Análisis de inventario
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                Este modulo esta en construccion. Aqui podras profundizar en el
                inventario frente a la venta con vistas analiticas.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
