"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, Sparkles, Users } from "lucide-react";
import { UserMenu } from "./user-menu";
import { PortalTourHelpButton } from "./portal-tour-help-button";

export const PORTAL_APP_VERSION = "v4.0";

export type PortalBrandingHeaderProps = {
  canAccessCronograma: boolean;
  isAdmin: boolean;
  /**
   * Si se provee, muestra un boton "Volver a X" (flecha + texto) que ejecuta
   * este callback. Ideal para paginas internas que quieren volver al hub
   * padre (ej. /venta) ademas del atajo global a /secciones.
   */
  onBackToSecciones?: () => void;
  /** Texto del boton "Volver". Default "Volver a secciones". */
  backLabel?: string;
  /**
   * Si es `true`, muestra el boton-icono cuadricula (2x2) que va a `/secciones`.
   * Coexiste con el boton "Volver a X" cuando ambos estan activos.
   */
  showSeccionesShortcut?: boolean;
  /** Reduce padding y tamaños para no chocar con el contenido inmediatamente debajo. */
  compact?: boolean;
  /** Usuario actual; si se provee se muestra el avatar con menu (cambiar contrasena / cerrar sesion). */
  username?: string | null;
  sede?: string | null;
  /** Si se provee, muestra boton Ayuda para el tutorial interactivo. */
  onTourHelp?: () => void;
};

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
  // Cronograma/Usuarios solo en /secciones (cuando no hay ningun shortcut/back).
  const showSegment =
    !showSeccionesShortcut &&
    !onBackToSecciones &&
    (canAccessCronograma || isAdmin);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/70 backdrop-blur-xl">
      <div
        className={
          compact
            ? "mx-auto flex w-full max-w-[1280px] items-center justify-between gap-4 px-4 py-1.5 sm:px-6"
            : "mx-auto flex w-full max-w-[1280px] items-center justify-between gap-4 px-4 py-3 sm:px-6"
        }
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={
              compact
                ? "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-violet-500 via-violet-600 to-violet-800 text-white shadow-[0_6px_16px_-10px_rgba(91,33,182,0.65)]"
                : "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-violet-500 via-violet-600 to-violet-800 text-white shadow-[0_8px_22px_-12px_rgba(91,33,182,0.65)]"
            }
            aria-hidden
          >
            <Sparkles
              className={compact ? "h-3.5 w-3.5" : "h-4 w-4"}
              strokeWidth={2}
            />
          </span>
          {compact ? (
            <p className="text-[12px] font-semibold tracking-tight text-foreground">
              Portal UAID{" "}
              <span className="font-normal text-muted-foreground/80">
                · {PORTAL_APP_VERSION}
              </span>
            </p>
          ) : (
            <div className="min-w-0 leading-tight">
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                Portal <span className="text-muted-foreground/80">•</span> UAID{" "}
                {PORTAL_APP_VERSION}
              </p>
              <p className="mt-0.5 text-[15px] font-semibold tracking-tight text-foreground">
                Portal UAID
              </p>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {onBackToSecciones ? (
            <button
              type="button"
              onClick={onBackToSecciones}
              className={
                compact
                  ? "inline-flex items-center gap-1.5 rounded-md border border-border bg-transparent px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest text-foreground transition-all hover:border-foreground/45 active:scale-[0.99]"
                  : "inline-flex items-center gap-2 rounded-lg border border-border bg-transparent px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-foreground transition-all hover:border-foreground/45 hover:shadow-[0_2px_12px_-4px_rgba(15,23,42,0.18)] active:scale-[0.99]"
              }
            >
              <ArrowLeft
                className={compact ? "h-3 w-3 shrink-0" : "h-3.5 w-3.5 shrink-0"}
                strokeWidth={2.25}
              />
              {backLabel}
            </button>
          ) : null}
          {showSeccionesShortcut ? (
            <button
              type="button"
              onClick={() => router.push("/secciones")}
              title="Ir a secciones"
              aria-label="Ir a secciones"
              className={
                compact
                  ? "group/grid relative inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-300 bg-linear-to-br from-white to-slate-100 text-slate-900 shadow-[0_1px_3px_-1px_rgba(15,23,42,0.18)] transition-all hover:-translate-y-0.5 hover:border-slate-400 hover:from-slate-50 hover:to-slate-200/80 hover:shadow-[0_6px_14px_-6px_rgba(15,23,42,0.35)] active:translate-y-0 active:scale-[0.96]"
                  : "group/grid relative inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-300 bg-linear-to-br from-white to-slate-100 text-slate-900 shadow-[0_2px_6px_-2px_rgba(15,23,42,0.2)] transition-all hover:-translate-y-0.5 hover:border-slate-400 hover:from-slate-50 hover:to-slate-200/80 hover:shadow-[0_10px_22px_-10px_rgba(15,23,42,0.4)] active:translate-y-0 active:scale-[0.97]"
              }
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/70 to-transparent opacity-0 transition-all duration-500 ease-out group-hover/grid:translate-x-full group-hover/grid:opacity-100"
              />
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={
                  compact
                    ? "relative h-4 w-4 shrink-0 transition-transform duration-200 group-hover/grid:scale-105"
                    : "relative h-5 w-5 shrink-0 transition-transform duration-200 group-hover/grid:scale-105"
                }
              >
                <rect x="2" y="2" width="9" height="9" rx="1.5" />
                <rect x="13" y="2" width="9" height="9" rx="1.5" />
                <rect x="2" y="13" width="9" height="9" rx="1.5" />
                <rect x="13" y="13" width="9" height="9" rx="1.5" />
              </svg>
            </button>
          ) : null}
          {showSegment ? (
            <div
              className={
                compact
                  ? "inline-flex items-center rounded-full border border-border/80 bg-background/80 p-0.5 shadow-sm"
                  : "inline-flex items-center rounded-full border border-border/80 bg-background/80 p-1 shadow-sm"
              }
            >
              {canAccessCronograma && (
                <button
                  type="button"
                  onClick={() => router.push("/cronograma")}
                  className={
                    compact
                      ? "inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                      : "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  }
                >
                  <CalendarDays
                    className={compact ? "h-3 w-3 shrink-0" : "h-3.5 w-3.5 shrink-0"}
                  />
                  Cronograma
                </button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => router.push("/admin/usuarios")}
                  className={
                    compact
                      ? "inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-slate-900 px-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white shadow-sm transition-colors hover:bg-slate-800"
                      : "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-slate-900 px-3.5 text-[10px] font-bold uppercase tracking-[0.2em] text-white shadow-sm transition-colors hover:bg-slate-800"
                  }
                >
                  <Users
                    className={compact ? "h-3 w-3 shrink-0" : "h-3.5 w-3.5 shrink-0"}
                  />
                  Usuarios
                </button>
              )}
            </div>
          ) : null}
          {onTourHelp ? <PortalTourHelpButton onClick={onTourHelp} /> : null}
          {username !== null ? (
            <UserMenu
              username={username}
              role={isAdmin ? "admin" : "user"}
              sede={sede}
            />
          ) : null}
        </div>
      </div>
    </header>
  );
}
