"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PORTAL_SECTIONS,
  type PortalSectionId,
} from "@/lib/portal-sections";

const SECTION_STYLES: Record<
  PortalSectionId,
  { classes: string; badgeClasses: string; focusClasses: string; ctaClasses: string }
> = {
  venta: {
    classes:
      "border-blue-300/80 bg-linear-to-br from-blue-100 via-white to-indigo-100 text-slate-900 shadow-[0_18px_35px_-30px_rgba(37,99,235,0.45)] hover:border-blue-400 hover:shadow-[0_22px_44px_-26px_rgba(37,99,235,0.55)]",
    badgeClasses:
      "border-blue-300/80 bg-blue-200/75 text-blue-800",
    focusClasses: "text-blue-950",
    ctaClasses: "text-blue-800",
  },
  producto: {
    classes:
      "border-amber-300/80 bg-linear-to-br from-amber-100 via-white to-yellow-100 text-slate-900 shadow-[0_18px_35px_-30px_rgba(245,158,11,0.45)] hover:border-amber-400 hover:shadow-[0_22px_44px_-26px_rgba(245,158,11,0.55)]",
    badgeClasses: "border-amber-300/80 bg-amber-200/80 text-amber-900",
    focusClasses: "text-amber-950",
    ctaClasses: "text-amber-800",
  },
  operacion: {
    classes:
      "border-rose-300/80 bg-linear-to-br from-rose-100 via-white to-red-100 text-slate-900 shadow-[0_18px_35px_-30px_rgba(244,63,94,0.4)] hover:border-rose-400 hover:shadow-[0_22px_44px_-26px_rgba(244,63,94,0.5)]",
    badgeClasses: "border-rose-300/80 bg-rose-200/75 text-rose-800",
    focusClasses: "text-rose-950",
    ctaClasses: "text-rose-800",
  },
};

export default function SeccionesPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSwitchingUser, setIsSwitchingUser] = useState(false);
  const [allowedDashboards, setAllowedDashboards] = useState<string[] | null>(null);
  const [specialRoles, setSpecialRoles] = useState<string[] | null>(null);

  const getCookieValue = (name: string) => {
    if (typeof document === "undefined") return null;
    const value = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${name}=`));
    if (!value) return null;
    return decodeURIComponent(value.split("=").slice(1).join("="));
  };

  const requireCsrfToken = () => {
    const token = getCookieValue("vp_csrf");
    return token ?? null;
  };

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
        if (!isMounted) return;
        setIsAdmin(payload.user?.role === "admin");
        setAllowedDashboards(payload.user?.allowedDashboards ?? null);
        setSpecialRoles(payload.user?.specialRoles ?? null);
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
      const csrfToken = requireCsrfToken();
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: csrfToken ? { "x-csrf-token": csrfToken } : undefined,
      });
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
  const canAccessCronograma =
    isAdmin || Boolean(specialRoles?.includes("cronograma"));

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-12 text-foreground">
      <div className="mx-auto w-full max-w-5xl rounded-[28px] border border-slate-200/70 bg-white p-7 shadow-[0_28px_70px_-45px_rgba(15,23,42,0.4)]">
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="bg-linear-to-r from-sky-700 via-blue-700 to-slate-800 bg-clip-text text-4xl font-black tracking-tight text-transparent sm:text-5xl">
              Portal UAID
            </h1>
            <p className="mt-2 text-sm font-semibold text-slate-600 sm:text-base">
              Explora las tres dimensiones clave del negocio.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canAccessCronograma && (
              <button
                type="button"
                onClick={() =>
                  window.open(
                    "https://www.notion.so/Cronograma-de-Proyectos-UAID-00e49a2ceb6b83f58fc1010dd253ae67",
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
                className="inline-flex items-center rounded-full border border-sky-200/90 bg-linear-to-r from-sky-50 to-cyan-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-800 transition-all hover:border-sky-300 hover:brightness-105"
              >
                Cronograma
              </button>
            )}
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
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 sm:text-[15px]">
          El Portal UAID integra en un solo entorno la vision completa del
          negocio a traves de tres dimensiones clave: Venta, Producto y
          Operacion, permitiendo entender no solo el resultado, sino tambien sus
          causas y la forma en que se ejecuta.
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
                <span className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Enfoque
                </span>
                <span className={`mt-2 block text-2xl font-black leading-tight ${styles.focusClasses}`}>
                  {section.focus}
                </span>
                <span className="mt-3 block text-sm leading-6 text-slate-700">
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
                  <p className={`mt-4 text-xs font-semibold uppercase tracking-[0.18em] ${styles.ctaClasses}`}>
                    Entrar a {section.label}
                  </p>
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
