"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, Sparkles, Users } from "lucide-react";

export const PORTAL_APP_VERSION = "v4.0";

const CRONOGRAMA_NOTION_URL =
  "https://www.notion.so/Cronograma-de-Proyectos-UAID-00e49a2ceb6b83f58fc1010dd253ae67";

export type PortalBrandingHeaderProps = {
  canAccessCronograma: boolean;
  isAdmin: boolean;
  /** Si está definido, muestra el botón outline con flecha (hubs) en lugar del bloque Cronograma/Usuarios. */
  onBackToSecciones?: () => void;
  backLabel?: string;
};

export function PortalBrandingHeader({
  canAccessCronograma,
  isAdmin,
  onBackToSecciones,
  backLabel = "Volver a secciones",
}: PortalBrandingHeaderProps) {
  const router = useRouter();
  const showSegment = !onBackToSecciones && (canAccessCronograma || isAdmin);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-violet-500 via-violet-600 to-violet-800 text-white shadow-[0_8px_22px_-12px_rgba(91,33,182,0.65)]"
            aria-hidden
          >
            <Sparkles className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
              Portal <span className="text-muted-foreground/80">•</span> UAID{" "}
              {PORTAL_APP_VERSION}
            </p>
            <p className="mt-0.5 text-[15px] font-semibold tracking-tight text-foreground">
              Portal UAID
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {onBackToSecciones ? (
            <button
              type="button"
              onClick={onBackToSecciones}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-transparent px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-foreground transition-all hover:border-foreground/45 hover:shadow-[0_2px_12px_-4px_rgba(15,23,42,0.18)] active:scale-[0.99]"
            >
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} />
              {backLabel}
            </button>
          ) : null}
          {showSegment ? (
            <div className="inline-flex items-center rounded-full border border-border/80 bg-background/80 p-1 shadow-sm">
              {canAccessCronograma && (
                <button
                  type="button"
                  onClick={() =>
                    window.open(
                      CRONOGRAMA_NOTION_URL,
                      "_blank",
                      "noopener,noreferrer",
                    )
                  }
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                  Cronograma
                </button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => router.push("/admin/usuarios")}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-slate-900 px-3.5 text-[10px] font-bold uppercase tracking-[0.2em] text-white shadow-sm transition-colors hover:bg-slate-800"
                >
                  <Users className="h-3.5 w-3.5 shrink-0" />
                  Usuarios
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
