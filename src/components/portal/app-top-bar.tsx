"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PortalBrandingHeader } from "./portal-branding-header";

export type AppTopBarProps = {
  /** Si `false`, no muestra el boton "Volver a secciones". Default true. */
  showBack?: boolean;
  /** Texto del boton de volver. Default "Volver a secciones". */
  backLabel?: string;
  /** Ruta a la que apunta el boton de volver. Default "/secciones". */
  backHref?: string;
  /** Variante compacta para paginas con contenido cercano al header. */
  compact?: boolean;
};

type AuthSnapshot = {
  isAdmin: boolean;
  canAccessCronograma: boolean;
  username: string | null;
  sede: string | null;
};

/**
 * Header global autonomo: lee la sesion via /api/auth/me y renderiza
 * `PortalBrandingHeader` con los permisos correctos. Pensado para usar en
 * todas las paginas para mantener una navegacion consistente.
 */
export function AppTopBar({
  showBack = true,
  backLabel = "Volver a secciones",
  backHref = "/secciones",
  compact = false,
}: AppTopBarProps) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<AuthSnapshot | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/auth/me", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          user?: {
            username?: string;
            role?: string;
            sede?: string | null;
            specialRoles?: string[] | null;
          };
        };
        const isAdmin = payload.user?.role === "admin";
        const canAccessCronograma =
          isAdmin ||
          Boolean(payload.user?.specialRoles?.includes("cronograma"));
        setSnapshot({
          isAdmin,
          canAccessCronograma,
          username: payload.user?.username ?? null,
          sede: payload.user?.sede ?? null,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  if (!snapshot) {
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

  return (
    <PortalBrandingHeader
      canAccessCronograma={snapshot.canAccessCronograma}
      isAdmin={snapshot.isAdmin}
      compact={compact}
      username={snapshot.username}
      sede={snapshot.sede}
      {...(showBack
        ? {
            onBackToSecciones: () => router.push(backHref),
            backLabel,
          }
        : {})}
    />
  );
}
