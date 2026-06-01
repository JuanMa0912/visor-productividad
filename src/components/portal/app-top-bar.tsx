"use client";

import { useRouter } from "next/navigation";
import { PortalBrandingHeader } from "./portal-branding-header";
import { useAuth, usePermissions } from "@/lib/auth/auth-context";

export type AppTopBarProps = {
  /**
   * Si `false`, oculta tanto el boton "Volver a X" como el icono Grid2x2 que
   * va a `/secciones`. Default true.
   */
  showBack?: boolean;
  /** Texto del boton "Volver a X". Default "Volver a secciones". */
  backLabel?: string;
  /** Ruta destino del boton "Volver a X". Default "/secciones". */
  backHref?: string;
  /** Variante compacta para paginas con contenido cercano al header. */
  compact?: boolean;
};

/**
 * Header global autonomo: consume la sesion via `useAuth()` (el RootLayout
 * monta el provider, asi que la informacion ya viene cacheada). Antes hacia
 * su propio `fetch('/api/auth/me')` en cada montaje, lo que generaba un
 * parpadeo del header en cada navegacion y una llamada redundante (la
 * pagina tambien la hacia). Ahora es instantaneo si el provider ya cargo.
 */
export function AppTopBar({
  showBack = true,
  backLabel = "Volver a secciones",
  backHref = "/secciones",
  compact = false,
}: AppTopBarProps) {
  const router = useRouter();
  const { user, status } = useAuth();
  const { isAdmin, hasSpecialRole } = usePermissions();

  // Mientras la sesion esta cargando, mostramos solo la barra vacia para
  // mantener el layout estable (sin CLS). Si no hay sesion (unauthenticated),
  // tambien renderizamos la barra vacia: el usuario sera redirigido a /login
  // por la pagina que use `useRequireAuth()`.
  if (status === "loading" || !user) {
    return (
      <header
        className={
          compact
            ? "sticky top-0 z-50 h-[40px] w-full border-b border-border/50 bg-background/70 backdrop-blur-xl"
            : "sticky top-0 z-50 h-[57px] w-full border-b border-border/50 bg-background/70 backdrop-blur-xl"
        }
      />
    );
  }

  const canAccessCronograma = hasSpecialRole("cronograma");

  // Solo mostramos el boton "Volver a X" cuando apunta a un hub distinto a
  // `/secciones` (ej. `/venta`, `/horario`). Si apunta a `/secciones`, el icono
  // Grid2x2 ya cumple esa funcion y no duplicamos.
  const hasDistinctBack = showBack && backHref !== "/secciones";

  return (
    <PortalBrandingHeader
      canAccessCronograma={canAccessCronograma}
      isAdmin={isAdmin}
      compact={compact}
      username={user.username ?? null}
      sede={user.sede}
      showSeccionesShortcut={showBack}
      {...(hasDistinctBack
        ? {
            onBackToSecciones: () => router.push(backHref),
            backLabel,
          }
        : {})}
    />
  );
}
