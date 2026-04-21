"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  Boxes,
  ChevronRight,
  KeyRound,
  UserCog,
} from "lucide-react";
import {
  PORTAL_APP_VERSION,
  PortalBrandingHeader,
} from "@/components/portal/portal-branding-header";
import {
  PORTAL_SECTIONS,
  type PortalSectionId,
} from "@/lib/portal-sections";

const SECTION_STYLES: Record<
  PortalSectionId,
  {
    radialWashClass: string;
    topBorderClass: string;
    eyebrowClass: string;
    badgeClasses: string;
    iconClasses: string;
    chevronBtnClasses: string;
  }
> = {
  venta: {
    radialWashClass:
      "bg-[radial-gradient(ellipse_120%_100%_at_50%_-25%,rgba(59,130,246,0.16),transparent_58%)]",
    topBorderClass: "before:bg-blue-500",
    eyebrowClass: "text-blue-600",
    badgeClasses:
      "border-blue-200/90 bg-blue-50/90 text-blue-700 ring-1 ring-blue-100/80",
    iconClasses: "border-blue-100 bg-blue-50 text-blue-600",
    chevronBtnClasses:
      "border-blue-200/80 bg-blue-50 text-blue-600 hover:bg-blue-100/90",
  },
  producto: {
    radialWashClass:
      "bg-[radial-gradient(ellipse_120%_100%_at_50%_-25%,rgba(245,158,11,0.16),transparent_58%)]",
    topBorderClass: "before:bg-amber-500",
    eyebrowClass: "text-amber-700",
    badgeClasses:
      "border-amber-200/90 bg-amber-50/90 text-amber-800 ring-1 ring-amber-100/80",
    iconClasses: "border-amber-100 bg-amber-50 text-amber-600",
    chevronBtnClasses:
      "border-amber-200/80 bg-amber-50 text-amber-700 hover:bg-amber-100/90",
  },
  operacion: {
    radialWashClass:
      "bg-[radial-gradient(ellipse_120%_100%_at_50%_-25%,rgba(244,63,94,0.14),transparent_58%)]",
    topBorderClass: "before:bg-rose-500",
    eyebrowClass: "text-rose-700",
    badgeClasses:
      "border-rose-200/90 bg-rose-50/90 text-rose-800 ring-1 ring-rose-100/80",
    iconClasses: "border-rose-100 bg-rose-50 text-rose-600",
    chevronBtnClasses:
      "border-rose-200/80 bg-rose-50 text-rose-700 hover:bg-rose-100/90",
  },
};

/** Texto ceja bajo el contador, alineado a los hubs por sección. */
const SECTION_EYEBROW: Record<PortalSectionId, string> = {
  venta: "Venta • Enfoque • Resultado",
  producto: "Producto • Enfoque • Causa",
  operacion: "Operación • Enfoque • Ejecución",
};

/** Etiqueta en la pastilla (con viñeta al inicio). */
const SECTION_BADGE_TAG: Record<PortalSectionId, string> = {
  venta: "VENTA",
  producto: "PRODUCTO",
  operacion: "OPERACIÓN",
};

const SECTION_ICONS: Record<PortalSectionId, typeof BarChart3> = {
  venta: BarChart3,
  producto: Boxes,
  operacion: Activity,
};

export default function SeccionesPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSwitchingUser, setIsSwitchingUser] = useState(false);
  const [allowedDashboards, setAllowedDashboards] = useState<string[] | null>(null);
  const [specialRoles, setSpecialRoles] = useState<string[] | null>(null);
  const [username, setUsername] = useState<string | null>(null);

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
            username?: string | null;
          };
        };
        if (!isMounted) return;
        setIsAdmin(payload.user?.role === "admin");
        setAllowedDashboards(payload.user?.allowedDashboards ?? null);
        setSpecialRoles(payload.user?.specialRoles ?? null);
        setUsername(payload.user?.username ?? null);
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
  const sectionCount = visibleSections.length;

  return (
    <div className="min-h-screen bg-slate-100 text-foreground">
      <PortalBrandingHeader
        canAccessCronograma={canAccessCronograma}
        isAdmin={isAdmin}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-8 lg:px-6">
        <div className="rounded-2xl border border-slate-200/70 bg-white/90 shadow-[0_8px_30px_-24px_rgba(15,23,42,0.2)] backdrop-blur-sm">
          <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Cuenta</p>
              <p className="text-xs text-slate-500">Ajustes rápidos de sesión.</p>
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                <span>Sesión · {username?.toLowerCase() || "usuario"}</span>
                <span className="hidden text-slate-300 sm:inline" aria-hidden>
                  |
                </span>
                <span>
                  Ciclo {new Date().getFullYear()} · 04
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:pt-0.5">
              <button
                type="button"
                onClick={handleSwitchUser}
                disabled={isSwitchingUser}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[11px] font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                <UserCog className="h-3.5 w-3.5" />
                {isSwitchingUser ? "Saliendo..." : "Cambiar usuario"}
              </button>
              <button
                type="button"
                onClick={() => router.push("/cuenta/contrasena")}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[11px] font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-white"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Cambiar contraseña
              </button>
            </div>
          </div>
        </div>

        <p className="max-w-5xl text-sm leading-6 text-slate-600">
          El Portal UAID integra en un solo entorno la vision completa del
          negocio a traves de tres dimensiones clave:{" "}
          <strong className="font-semibold text-slate-800">Venta</strong>,{" "}
          <strong className="font-semibold text-slate-800">Producto</strong> y{" "}
          <strong className="font-semibold text-slate-800">Operacion</strong>,
          permitiendo entender no solo el resultado, sino tambien sus causas y
          la forma en que se ejecuta.
        </p>

        <div className="grid gap-4 lg:grid-cols-3">
          {visibleSections.map((section, index) => {
            const styles = SECTION_STYLES[section.id];
            const Icon = SECTION_ICONS[section.id];
            const sectionNumber = String(index + 1).padStart(2, "0");
            const modulesCount = String(section.modules.length).padStart(2, "0");
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => router.push(section.href)}
                className={`group relative flex min-h-[280px] w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white px-6 py-6 text-left shadow-[0_16px_34px_-28px_rgba(15,23,42,0.32)] transition-all duration-500 ease-out before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-1 hover:-translate-y-1 hover:border-foreground/15 hover:shadow-floating ${styles.topBorderClass}`}
              >
                <span
                  aria-hidden
                  className={`pointer-events-none absolute inset-0 z-0 rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100 ${styles.radialWashClass}`}
                />
                <div className="relative z-1 flex items-start justify-between gap-3">
                  <span
                    className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-transform duration-500 ease-out will-change-transform group-hover:scale-105 ${styles.iconClasses}`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 text-right">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                      {sectionNumber} /{" "}
                      {String(Math.max(sectionCount, 1)).padStart(2, "0")}
                    </p>
                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                      {modulesCount} modulos
                    </p>
                  </div>
                </div>
                <p
                  className={`relative z-1 mt-4 text-[10px] font-bold uppercase tracking-[0.22em] ${styles.eyebrowClass}`}
                >
                  {SECTION_EYEBROW[section.id]}
                </p>
                <p
                  className={`relative z-1 mt-3 inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-[0.06em] ${styles.badgeClasses}`}
                >
                  <span className="text-[0.65rem] leading-none opacity-90">•</span>
                  {SECTION_BADGE_TAG[section.id]}
                </p>
                <span className="relative z-1 mt-3 block text-xl font-black leading-snug tracking-tight text-slate-900 sm:text-2xl">
                  {section.focus}
                </span>
                <span className="relative z-1 mt-3 block text-sm leading-relaxed text-slate-600">
                  {section.description}
                </span>
                <div className="relative z-1 mt-8 flex items-center justify-between gap-3 pt-1">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                    Abrir modulo
                  </span>
                  <span
                    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors ${styles.chevronBtnClasses}`}
                    aria-hidden
                  >
                    <ChevronRight className="h-4 w-4" strokeWidth={2.25} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {visibleSections.length === 0 && (
          <div className="rounded-2xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            Tu usuario no tiene secciones asignadas en este momento.
          </div>
        )}

        <footer className="mt-2 flex flex-col gap-2 border-t border-slate-200/70 pt-8 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-medium text-slate-600">
            Portal UAID <span className="text-slate-400">{PORTAL_APP_VERSION}</span>
          </p>
          <p className="text-slate-400">
            © {new Date().getFullYear()} · Herramientas internas de seguimiento
          </p>
        </footer>
      </div>
    </div>
  );
}
