"use client";

/**
 * Contexto global de sesion del portal.
 *
 * Antes cada pagina y `AppTopBar` hacian su propio `fetch('/api/auth/me')`,
 * lo que generaba:
 *   - Una llamada redundante por navegacion (topbar + pagina).
 *   - Parpadeo del header en cada cambio de ruta.
 *   - Logica de redirect a `/login` duplicada en ~17 archivos.
 *
 * Este provider hace UNA SOLA llamada al montar el layout raiz y expone el
 * usuario via `useAuth()`. Las paginas que requieran sesion pueden usar
 * `useRequireAuth()` para mantener el comportamiento de redirect.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
  type PortalSectionId,
  type PortalSubsectionId,
} from "@/lib/shared/portal-sections";
import type { AuthUser } from "./types";

export type AuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "error";

export type AuthContextValue = {
  user: AuthUser | null;
  status: AuthStatus;
  error: string | null;
  /** Re-fetch /api/auth/me. Util tras cambios de permisos o login manual. */
  refresh: () => Promise<void>;
  /**
   * Cierra sesion en el server (POST /api/auth/logout) y limpia el state local.
   * Por defecto redirige a `/login`; pasa `redirectTo: null` para no redirigir.
   */
  logout: (options?: { redirectTo?: string | null }) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Lee una cookie del navegador. Devuelve `null` en SSR o si no existe. */
const readCookie = (name: string): string | null => {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"),
  );
  return match ? decodeURIComponent(match[1]) : null;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchSession = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/auth/me", {
        signal: controller.signal,
        credentials: "include",
        cache: "no-store",
      });
      if (response.status === 401) {
        setUser(null);
        setStatus("unauthenticated");
        setError(null);
        return;
      }
      if (!response.ok) {
        setUser(null);
        setStatus("error");
        setError(`No fue posible consultar la sesion (HTTP ${response.status}).`);
        return;
      }
      const payload = (await response.json()) as { user?: AuthUser | null };
      if (payload?.user) {
        setUser(payload.user);
        setStatus("authenticated");
        setError(null);
      } else {
        setUser(null);
        setStatus("unauthenticated");
        setError(null);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setUser(null);
      setStatus("error");
      setError(
        err instanceof Error
          ? err.message
          : "Error desconocido al consultar la sesion.",
      );
    }
  }, []);

  useEffect(() => {
    void fetchSession();
    return () => abortRef.current?.abort();
  }, [fetchSession]);

  const logout = useCallback<AuthContextValue["logout"]>(
    async (options) => {
      const csrf = readCookie("vp_csrf");
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "include",
          headers: csrf ? { "x-csrf-token": csrf } : undefined,
        });
      } catch {
        // Aunque falle el server, limpiamos el state local para no dejar al
        // usuario "atrapado" en una sesion fantasma.
      }
      setUser(null);
      setStatus("unauthenticated");
      setError(null);
      const redirect =
        options?.redirectTo === null ? null : options?.redirectTo ?? "/login";
      if (redirect) router.replace(redirect);
    },
    [router],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, error, refresh: fetchSession, logout }),
    [user, status, error, fetchSession, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Acceso al contexto de sesion. Tira si se usa fuera del provider para
 * detectar configuracion incorrecta temprano.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error(
      "useAuth() debe usarse dentro de <AuthProvider>. Asegurate de que el RootLayout lo envuelva.",
    );
  }
  return ctx;
}

/**
 * Para paginas que requieren sesion activa: cuando el estado pasa a
 * `unauthenticated`, redirige a `/login` (o al `redirectTo` indicado).
 * Devuelve el contexto completo para no obligar a llamar `useAuth()` aparte.
 *
 * Las paginas siguen siendo responsables de mostrar un loader mientras
 * `status === 'loading'`.
 */
export function useRequireAuth(options?: {
  redirectTo?: string;
}): AuthContextValue {
  const router = useRouter();
  const auth = useAuth();
  const redirectTo = options?.redirectTo ?? "/login";

  useEffect(() => {
    if (auth.status === "unauthenticated") {
      router.replace(redirectTo);
    }
  }, [auth.status, router, redirectTo]);

  return auth;
}

/**
 * Helpers de permisos derivados del usuario actual. Si no hay sesion, todos
 * los helpers devuelven `false`. Admin siempre tiene acceso a todo.
 */
export function usePermissions() {
  const { user } = useAuth();
  return useMemo(() => {
    const isAdmin = user?.role === "admin";
    return {
      isAdmin,
      hasSection: (section: PortalSectionId) =>
        Boolean(
          user &&
            (isAdmin ||
              canAccessPortalSection(user.allowedDashboards, section)),
        ),
      hasSubsection: (subsection: PortalSubsectionId) =>
        Boolean(
          user &&
            (isAdmin ||
              canAccessPortalSubsection(
                user.allowedSubdashboards,
                subsection,
              )),
        ),
      hasSpecialRole: (role: string) =>
        Boolean(user && (isAdmin || user.specialRoles?.includes(role))),
    };
  }, [user]);
}
