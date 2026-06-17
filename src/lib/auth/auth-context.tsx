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
import { flushSync } from "react-dom";
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
  /** Re-fetch /api/auth/me. Util tras cambios de permisos. */
  refresh: () => Promise<void>;
  /**
   * Marca al usuario como autenticado de forma SINCRONA con la data que ya
   * vino en la respuesta del POST /api/auth/login. Pensado para llamarse desde
   * la pagina de /login para evitar la race condition entre el `setState`
   * (asincrono) y el `router.push` (que monta la siguiente pagina antes de
   * que React procese el cambio de estado y manda al usuario de vuelta a
   * /login porque `useRequireAuth` aun ve `status === "unauthenticated"`).
   *
   * Internamente usa `flushSync` para garantizar que el estado quede
   * commiteado antes de que el caller siga ejecutando codigo (ej. navegacion).
   */
  signIn: (user: AuthUser) => void;
  /**
   * Cierra sesion: limpia el state local SINCRONICAMENTE (con `flushSync`) y
   * dispara `POST /api/auth/logout` en segundo plano. Si la red esta lenta o
   * el endpoint cuelga, el usuario igual ve la UI desautenticada al instante
   * y es redirigido a /login (antes el `await fetch` podia colgar el boton
   * en "Cerrando sesion..." indefinidamente).
   *
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

/** Lee /api/auth/me sin tocar React state (seguro para llamar desde effects). */
type SessionLoadResult =
  | { kind: "authenticated"; user: AuthUser }
  | { kind: "unauthenticated" }
  | { kind: "error"; message: string };

async function loadSessionFromApi(
  signal: AbortSignal,
): Promise<SessionLoadResult> {
  const response = await fetch("/api/auth/me", {
    signal,
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 401) {
    return { kind: "unauthenticated" };
  }
  if (!response.ok) {
    return {
      kind: "error",
      message: `No fue posible consultar la sesion (HTTP ${response.status}).`,
    };
  }
  const payload = (await response.json()) as { user?: AuthUser | null };
  if (payload?.user) {
    return { kind: "authenticated", user: payload.user };
  }
  return { kind: "unauthenticated" };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const applySessionResult = useCallback((result: SessionLoadResult) => {
    switch (result.kind) {
      case "authenticated":
        setUser(result.user);
        setStatus("authenticated");
        setError(null);
        break;
      case "unauthenticated":
        setUser(null);
        setStatus("unauthenticated");
        setError(null);
        break;
      case "error":
        setUser(null);
        setStatus("error");
        setError(result.message);
        break;
    }
  }, []);

  const fetchSession = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await loadSessionFromApi(controller.signal);
      if (!controller.signal.aborted) {
        applySessionResult(result);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (!controller.signal.aborted) {
        applySessionResult({
          kind: "error",
          message:
            err instanceof Error
              ? err.message
              : "Error desconocido al consultar la sesion.",
        });
      }
    }
  }, [applySessionResult]);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    void loadSessionFromApi(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          applySessionResult(result);
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!controller.signal.aborted) {
          applySessionResult({
            kind: "error",
            message:
              err instanceof Error
                ? err.message
                : "Error desconocido al consultar la sesion.",
          });
        }
      });
    return () => controller.abort();
  }, [applySessionResult]);

  const signIn = useCallback<AuthContextValue["signIn"]>((nextUser) => {
    // `flushSync` obliga a React a procesar el cambio de estado AHORA, no en
    // el siguiente tick. Sin esto, el caller (ej. login/page.tsx) puede
    // llamar a `router.push("/secciones")` antes de que el contexto refleje
    // `status === "authenticated"`, y /secciones rebota a /login.
    flushSync(() => {
      setUser(nextUser);
      setStatus("authenticated");
      setError(null);
    });
  }, []);

  const logout = useCallback<AuthContextValue["logout"]>(
    async (options) => {
      // 1. Limpia el state local DE INMEDIATO. Si el fetch al server cuelga
      //    (red lenta, servidor caido) el usuario ya ve la UI desautenticada
      //    y puede navegar a /login. Antes este `await` bloqueaba el boton
      //    "Cerrando sesion..." cuando la red se quedaba pegada.
      flushSync(() => {
        setUser(null);
        setStatus("unauthenticated");
        setError(null);
      });

      // 2. Notifica al server en background. No esperamos la respuesta porque
      //    no necesitamos su resultado para mostrar UI; el server simplemente
      //    revoca la sesion en su tabla.
      const csrf = readCookie("vp_csrf");
      void fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: csrf ? { "x-csrf-token": csrf } : undefined,
        keepalive: true,
      }).catch(() => {
        // best-effort: la cookie va a vencer eventualmente por inactividad
      });

      // 3. Redirige.
      const redirect =
        options?.redirectTo === null ? null : options?.redirectTo ?? "/login";
      if (redirect) router.replace(redirect);
    },
    [router],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, error, refresh: fetchSession, signIn, logout }),
    [user, status, error, fetchSession, signIn, logout],
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
