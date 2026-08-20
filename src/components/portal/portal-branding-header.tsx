"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, Users } from "lucide-react";
import { PORTAL_APP_VERSION } from "@/lib/shared/uaid-brand";
import { cn } from "@/lib/shared/utils";
import { UserMenu } from "./user-menu";
import { PortalTourHelpButton } from "./portal-tour-help-button";
import { UaidLogoMark } from "./uaid-logo";

const UAID_CTA_FILL =
  "bg-linear-to-r from-sky-500 via-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/30";
const UAID_CTA_HOVER =
  "transition-all hover:from-sky-400 hover:via-blue-600 hover:to-indigo-500 hover:shadow-xl hover:shadow-indigo-600/25 active:scale-[0.97]";

function UaidVersionChip({ compact }: { compact: boolean }) {
  const label = PORTAL_APP_VERSION.replace(/^v/i, "");
  return (
    <span
      className={cn(
        "uaid-sheen inline-flex shrink-0 items-center justify-center font-bold tracking-wide",
        UAID_CTA_FILL,
        compact
          ? "h-5 rounded-md px-1.5 text-[9px]"
          : "h-5 rounded-md px-1.5 text-[10px]",
      )}
      aria-label={`Versión ${PORTAL_APP_VERSION}`}
    >
      {label}
    </span>
  );
}

export { PORTAL_APP_VERSION };

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
    <header
      className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/70 backdrop-blur-xl"
      aria-label="Portal UAID"
    >
      <div
        className={
          compact
            ? "mx-auto flex w-full max-w-[1280px] items-center justify-between gap-2 px-3 py-1.5 sm:gap-4 sm:px-6"
            : "mx-auto flex w-full max-w-[1280px] items-center justify-between gap-2 px-3 py-3 sm:gap-4 sm:px-6"
        }
      >
        <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
          <Link
            href="/secciones"
            className="flex min-w-0 items-center gap-2 rounded-lg outline-none sm:gap-2.5 focus-visible:ring-2 focus-visible:ring-blue-400/70"
            title="Ir a secciones"
            aria-label="Portal UAID, ir a secciones"
          >
            <UaidLogoMark
              className={
                compact
                  ? "h-7 w-7 shrink-0 [filter:drop-shadow(0_6px_12px_rgba(37,99,235,0.38))]"
                  : "h-9 w-9 shrink-0 [filter:drop-shadow(0_8px_16px_rgba(37,99,235,0.4))]"
              }
            />
            {compact ? (
              <p className="hidden min-w-0 truncate text-[12px] font-semibold tracking-tight text-foreground sm:block">
                Portal UAID
              </p>
            ) : (
              <div className="hidden min-w-0 leading-tight sm:block">
                <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                  Portal <span className="text-muted-foreground/80">•</span> UAID
                </p>
                <p className="mt-0.5 text-[15px] font-semibold tracking-tight text-foreground">
                  Portal UAID
                </p>
              </div>
            )}
            <UaidVersionChip compact={compact} />
          </Link>
        </div>

        <div className="flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2">
          {onBackToSecciones ? (
            <button
              type="button"
              onClick={onBackToSecciones}
              title={backLabel}
              aria-label={backLabel}
              className={
                compact
                  ? "inline-flex max-w-[9.5rem] items-center gap-1.5 rounded-md border border-border bg-transparent px-2 py-1 text-[11px] font-semibold uppercase tracking-widest text-foreground transition-all hover:border-foreground/45 active:scale-[0.99] sm:max-w-none sm:px-2.5"
                  : "inline-flex max-w-[9.5rem] items-center gap-1.5 rounded-lg border border-border bg-transparent px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground transition-all hover:border-foreground/45 hover:shadow-[0_2px_12px_-4px_rgba(15,23,42,0.18)] active:scale-[0.99] sm:max-w-none sm:gap-2 sm:px-3 sm:py-2 sm:text-[12px]"
              }
            >
              <ArrowLeft
                className={compact ? "h-3 w-3 shrink-0" : "h-3.5 w-3.5 shrink-0"}
                strokeWidth={2.25}
              />
              <span className="truncate">{backLabel}</span>
            </button>
          ) : null}
          {showSeccionesShortcut ? (
            <button
              type="button"
              onClick={() => router.push("/secciones")}
              title="Ir a secciones"
              aria-label="Ir a secciones"
              className={cn(
                "uaid-sheen inline-flex shrink-0 items-center justify-center",
                UAID_CTA_FILL,
                UAID_CTA_HOVER,
                compact ? "h-7 w-7 rounded-md" : "h-9 w-9 rounded-lg",
              )}
            >
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={compact ? "h-4 w-4 shrink-0" : "h-5 w-5 shrink-0"}
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
