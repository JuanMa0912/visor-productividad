"use client";

import { PortalBrandingHeader } from "./portal-branding-header";
import { useAuth, usePermissions } from "@/lib/auth/auth-context";

/**
 * Hubs de sección. Los tableros ya se abren desde `/secciones`;
 * no mostramos "Volver a venta/productividad/horario".
 */
const SECTION_HUB_HREFS = new Set([
  "/venta",
  "/productividad",
  "/horario",
  "/horarios",
]);

export type AppTopBarProps = {
  /**
   * Si `false`, oculta el icono Grid2x2 que va a `/secciones`. Default true.
   */
  showBack?: boolean;
  /** Texto del boton "Volver a X" (solo flujos que no son hub de sección). */
  backLabel?: string;
  /** Ruta destino del boton "Volver a X". Default "/secciones". */
  backHref?: string;
  /** Variante compacta para paginas con contenido cercano al header. */
  compact?: boolean;
  /** Abre el manual interactivo (driver.js) del tablero actual. */
  onTourHelp?: () => void;
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
  onTourHelp,
}: AppTopBarProps) {
  const { user, status } = useAuth();
  const { isAdmin, hasSpecialRole } = usePermissions();

  const hasDistinctBack =
    showBack &&
    backHref !== "/secciones" &&
    !SECTION_HUB_HREFS.has(backHref);
  const backProps = hasDistinctBack
    ? {
        // Navegacion completa: evita quedar atrapado en bundles SPA viejos
        // (p. ej. un redirect automatico a /rotacion tras un deploy).
        onBackToSecciones: () => {
          window.location.assign(backHref);
        },
        backLabel,
      }
    : {};

  // Mientras la sesion carga, conservamos marca + atajo a secciones.
  if (status === "loading" || !user) {
    return (
      <PortalBrandingHeader
        canAccessCronograma={false}
        isAdmin={false}
        username={null}
        compact={compact}
        showSeccionesShortcut={showBack}
        onTourHelp={onTourHelp}
        {...backProps}
      />
    );
  }

  const canAccessCronograma = hasSpecialRole("cronograma");

  return (
    <PortalBrandingHeader
      canAccessCronograma={canAccessCronograma}
      isAdmin={isAdmin}
      compact={compact}
      username={user.username ?? null}
      sede={typeof user.sede === "string" ? user.sede : null}
      showSeccionesShortcut={showBack}
      onTourHelp={onTourHelp}
      {...backProps}
    />
  );
}
