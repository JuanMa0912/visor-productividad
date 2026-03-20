"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PORTAL_SECTIONS,
  type PortalSectionId,
} from "@/lib/portal-sections";

const SECTION_STYLES: Record<
  PortalSectionId,
  { classes: string; badgeClasses: string }
> = {
  venta: {
    classes:
      "border-emerald-300/80 bg-linear-to-br from-emerald-100 via-white to-lime-100 text-slate-900 shadow-[0_18px_35px_-30px_rgba(16,185,129,0.45)] hover:border-emerald-400 hover:shadow-[0_22px_44px_-26px_rgba(16,185,129,0.55)]",
    badgeClasses:
      "border-emerald-300/80 bg-emerald-200/75 text-emerald-800",
  },
  producto: {
    classes:
      "border-blue-300/80 bg-linear-to-br from-blue-100 via-white to-cyan-100 text-slate-900 shadow-[0_18px_35px_-30px_rgba(37,99,235,0.45)] hover:border-blue-400 hover:shadow-[0_22px_44px_-26px_rgba(37,99,235,0.55)]",
    badgeClasses: "border-blue-300/80 bg-blue-200/75 text-blue-800",
  },
  operacion: {
    classes:
      "border-rose-300/80 bg-linear-to-br from-rose-100 via-white to-pink-100 text-slate-900 shadow-[0_18px_35px_-30px_rgba(244,63,94,0.4)] hover:border-rose-400 hover:shadow-[0_22px_44px_-26px_rgba(244,63,94,0.5)]",
    badgeClasses: "border-rose-300/80 bg-rose-200/75 text-rose-800",
  },
};

export default function SeccionesPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSwitchingUser, setIsSwitchingUser] = useState(false);
  const [allowedDashboards, setAllowedDashboards] = useState<string[] | null>(null);

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
        if (!isMounted) return;
        setIsAdmin(payload.user?.role === "admin");
        setAllowedDashboards(payload.user?.allowedDashboards ?? null);
        setReady(true);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
      }
    };

    void loadUser();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [router]);

  const handleSwitchUser = async () => {
    if (isSwitchingUser) return;
    setIsSwitchingUser(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen bg-background px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-md rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.15)]">
          <p className="text-sm text-slate-600">Cargando secciones...</p>
        </div>
      </div>
    );
  }

  const visibleSections =
    isAdmin || allowedDashboards === null
      ? PORTAL_SECTIONS
      : PORTAL_SECTIONS.filter((section) => allowedDashboards.includes(section.id));

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-12 text-foreground">
      <div className="mx-auto w-full max-w-5xl rounded-[28px] border border-slate-200/70 bg-white p-7 shadow-[0_28px_70px_-45px_rgba(15,23,42,0.4)]">
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="bg-linear-to-r from-sky-700 via-blue-700 to-slate-800 bg-clip-text text-4xl font-black tracking-tight text-transparent sm:text-5xl">
              Portal UAID
            </h1>
            <p className="mt-2 text-sm font-semibold text-slate-600 sm:text-base">
              Explora las secciones del portal
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => router.push("/admin/usuarios")}
              className="inline-flex items-center rounded-full border border-slate-900/90 bg-linear-to-r from-slate-900 to-slate-700 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white transition-all hover:brightness-110"
            >
              Usuarios
            </button>
          )}
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 sm:text-[15px]">
          La UAID concentra analisis, modelos y herramientas operativas para que
          cada equipo encuentre rapido la informacion que necesita y tome
          decisiones con mas claridad.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {visibleSections.map((section) => {
            const styles = SECTION_STYLES[section.id];
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => router.push(section.href)}
                className={`group flex min-h-[260px] w-full flex-col rounded-2xl border px-5 py-5 text-left transition-all hover:-translate-y-0.5 ${styles.classes}`}
              >
                <span
                  className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${styles.badgeClasses}`}
                >
                  {section.label}
                </span>
                <span className="mt-4 block text-xl font-bold text-slate-900">
                  {section.label}
                </span>
                <span className="mt-2 block text-sm text-slate-700">
                  {section.description}
                </span>
                <div className="mt-auto pt-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                    Modulos
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {section.modules.map((module) => (
                      <span
                        key={module}
                        className="rounded-full border border-white/70 bg-white/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-700"
                      >
                        {module}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {visibleSections.length === 0 && (
          <div className="mt-6 rounded-2xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            Tu usuario no tiene secciones asignadas en este momento.
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-slate-200/70 pt-4">
          <button
            type="button"
            onClick={handleSwitchUser}
            disabled={isSwitchingUser}
            className="inline-flex items-center rounded-full border border-slate-200/70 bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-200/70 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSwitchingUser ? "Saliendo..." : "Cambiar usuario"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/cuenta/contrasena")}
            className="inline-flex items-center rounded-full border border-blue-200/70 bg-blue-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-blue-700 transition-all hover:border-blue-300 hover:bg-blue-100"
          >
            Cambiar contrasena
          </button>
        </div>
      </div>
    </div>
  );
}
