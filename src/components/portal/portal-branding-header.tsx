"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, CircleHelp, LayoutGrid, Users } from "lucide-react";
import { PORTAL_APP_VERSION } from "@/lib/shared/uaid-brand";
import { UserMenu } from "./user-menu";
import { useUaidSurfaceTheme } from "./uaid-surface-theme";

export { PORTAL_APP_VERSION } from "@/lib/shared/uaid-brand";

export type PortalBrandingHeaderProps = {
  canAccessCronograma: boolean;
  isAdmin: boolean;
  onBackToSecciones?: () => void;
  backLabel?: string;
  showSeccionesShortcut?: boolean;
  compact?: boolean;
  username?: string | null;
  sede?: string | null;
  onTourHelp?: () => void;
};

/**
 * Franja superior UAID 5.0 — fina.
 * Acciones (Cronograma / Usuarios) en pastillas al mismo estilo del menú de usuario.
 */
export function PortalBrandingHeader({
  canAccessCronograma,
  isAdmin,
  onBackToSecciones,
  backLabel = "Volver a secciones",
  showSeccionesShortcut = false,
  compact = false,
  username = null,
  sede = null,
  onTourHelp,
}: PortalBrandingHeaderProps) {
  const router = useRouter();
  const { surface } = useUaidSurfaceTheme();
  const dark = surface === "dark";

  const showSegment =
    !showSeccionesShortcut &&
    !onBackToSecciones &&
    (canAccessCronograma || isAdmin);

  const navPill = dark
    ? "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
    : "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900";

  const navPillPrimary = dark
    ? "inline-flex h-8 items-center gap-1.5 rounded-full bg-sky-500/20 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-200 ring-1 ring-sky-400/35 transition-colors hover:bg-sky-500/30"
    : "inline-flex h-8 items-center gap-1.5 rounded-full bg-sky-50 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700 ring-1 ring-sky-200 transition-colors hover:bg-sky-100";

  const iconBtn = dark
    ? "inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
    : "inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800";

  const cluster = dark
    ? "inline-flex items-center gap-0.5 rounded-full border border-white/10 bg-white/5 p-0.5"
    : "inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white p-0.5 shadow-sm";

  return (
    <header
      className={
        dark
          ? "sticky top-0 z-50 w-full border-b border-white/[0.08] bg-[#05070d]/85 text-slate-100 backdrop-blur-md"
          : "sticky top-0 z-50 w-full border-b border-slate-200/80 bg-white/90 text-slate-800 backdrop-blur-md"
      }
      aria-label="Portal UAID"
    >
      <div
        className={
          compact
            ? "mx-auto flex h-11 w-full max-w-[1280px] items-center justify-between gap-3 px-3 sm:px-6"
            : "mx-auto flex h-12 w-full max-w-[1280px] items-center justify-between gap-3 px-3 sm:px-6"
        }
      >
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/secciones")}
            className="group flex min-w-0 items-center gap-2 text-left"
            title="Ir a secciones"
          >
            <span
              aria-hidden
              className={
                dark
                  ? "h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.9)]"
                  : "h-1.5 w-1.5 shrink-0 rounded-full bg-sky-600"
              }
            />
            <span
              className={
                dark
                  ? "min-w-0 truncate text-[11px] font-medium tracking-[0.04em] text-slate-300 group-hover:text-white"
                  : "min-w-0 truncate text-[11px] font-medium tracking-[0.04em] text-slate-700 group-hover:text-slate-950"
              }
            >
              Portal UAID
              <span className={dark ? "mx-1.5 text-slate-600" : "mx-1.5 text-slate-300"}>
                —
              </span>
              <span className={dark ? "text-slate-500" : "text-slate-400"}>
                Sala de control
              </span>
              <span
                className={
                  dark
                    ? "ml-2 font-mono text-[10px] text-slate-600"
                    : "ml-2 font-mono text-[10px] text-slate-400"
                }
              >
                {PORTAL_APP_VERSION}
              </span>
            </span>
          </button>
        </div>

        <div className="flex min-w-0 shrink-0 items-center gap-2">
          {onBackToSecciones ? (
            <button
              type="button"
              onClick={onBackToSecciones}
              title={backLabel}
              aria-label={backLabel}
              className={navPill}
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.25} />
              <span className="hidden max-w-[9rem] truncate sm:inline">
                {backLabel}
              </span>
            </button>
          ) : null}

          {showSeccionesShortcut ? (
            <button
              type="button"
              onClick={() => router.push("/secciones")}
              title="Ir a secciones"
              aria-label="Ir a secciones"
              className={navPill}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Secciones</span>
            </button>
          ) : null}

          {showSegment ? (
            <div className={cluster}>
              {canAccessCronograma ? (
                <button
                  type="button"
                  onClick={() => router.push("/cronograma")}
                  className={navPill}
                >
                  <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden sm:inline">Cronograma</span>
                </button>
              ) : null}
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => router.push("/admin/usuarios")}
                  className={navPillPrimary}
                >
                  <Users className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden sm:inline">Usuarios</span>
                </button>
              ) : null}
            </div>
          ) : null}

          {onTourHelp ? (
            <button
              type="button"
              onClick={onTourHelp}
              title="Ver tutorial interactivo"
              aria-label="Ayuda"
              className={iconBtn}
            >
              <CircleHelp className="h-4 w-4" />
            </button>
          ) : null}

          {username !== null ? (
            <UserMenu
              username={username}
              role={isAdmin ? "admin" : "user"}
              sede={sede}
              tone={dark ? "control" : "default"}
            />
          ) : null}
        </div>
      </div>
    </header>
  );
}
