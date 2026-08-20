"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, User } from "lucide-react";
import { AuthBrandingPanel } from "@/components/portal/auth-branding-panel";
import {
  DinastiaLogo,
  MercamioLogo,
  MercatodoLogo,
  MerkmiosLogo,
} from "@/components/portal/brand-logos";
import { useAuth } from "@/lib/auth/auth-context";
import { LOGIN_IDLE_QUERY } from "@/lib/auth/session-idle";
import type { AuthUser } from "@/lib/auth/types";
import { PORTAL_APP_VERSION, PORTAL_APP_VERSION_LABEL } from "@/lib/shared/uaid-brand";

const sanitizeFrom = (raw: string | null): string => {
  // `/` es productividad por linea; tras login el hub del portal es `/secciones`.
  if (!raw || raw === "/") return "/secciones";
  if (!raw.startsWith("/")) return "/secciones";
  if (raw.startsWith("//")) return "/secciones";
  if (raw.includes(":")) return "/secciones";
  return raw;
};

export function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, refresh } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });

      const payload = (await response.json()) as {
        user?: AuthUser;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "No se pudo iniciar sesión.");
      }

      if (!payload.user) {
        throw new Error("Respuesta de login invalida (falta usuario).");
      }

      // Hidrata el contexto de inmediato (evita rebote a /login) y luego
      // relee /api/auth/me por si el login omitiera algun campo de permisos
      // (p. ej. allowedEmpresas / Dinastia).
      signIn(payload.user);
      try {
        await refresh();
      } catch {
        // best-effort: ya tenemos el user del login
      }

      if (payload.user.passwordChangeRequired) {
        router.push("/cuenta/contrasena?required=1");
        return;
      }

      const destination = sanitizeFrom(searchParams.get("from"));
      router.push(destination);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      <AuthBrandingPanel className="min-h-[280px] lg:min-h-screen" />

      <main className="relative flex items-center justify-center overflow-hidden px-6 py-12 lg:px-12 lg:shadow-[-40px_0_80px_-36px_rgba(2,6,23,0.5)]">
        <div className="login-form-aurora pointer-events-none absolute inset-0" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-32 bg-linear-to-r from-[#03060d]/12 to-transparent"
        />

        <div className="relative w-full max-w-md">
          <div className="relative z-10">
          <div className="mb-6 grid grid-cols-2 gap-x-4 gap-y-4 rounded-2xl border border-white/70 bg-white/55 px-4 py-4 shadow-sm shadow-slate-900/5 backdrop-blur-sm">
            {/* MercaMio primero. Mismo ancho en las 4 celdas. */}
            <div className="flex h-16 items-center justify-center sm:h-20">
              <MercamioLogo className="h-auto w-full max-w-[11.5rem] object-contain" />
            </div>
            <div className="flex h-16 items-center justify-center sm:h-20">
              <MercatodoLogo className="h-auto w-full max-w-[11.5rem] object-contain" />
            </div>
            <div className="flex h-16 items-center justify-center sm:h-20">
              <MerkmiosLogo className="h-auto w-full max-w-[11.5rem] object-contain" />
            </div>
            <div className="flex h-16 items-center justify-center sm:h-20">
              <DinastiaLogo className="h-auto w-full max-w-[11.5rem] object-contain" />
            </div>
          </div>

          <div className="relative">
            <div className="login-aurora-waves" aria-hidden>
              <svg
                className="login-aurora-lines"
                viewBox="0 0 440 520"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id="loginAuroraStroke" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity="0" />
                    <stop offset="30%" stopColor="#22d3ee" stopOpacity="0.7" />
                    <stop offset="62%" stopColor="#818cf8" stopOpacity="0.65" />
                    <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d="M20 150 C 90 120, 150 185, 230 145 S 350 115, 420 155" />
                <path d="M16 250 C 100 215, 170 295, 250 245 S 360 215, 424 255" />
                <path d="M24 345 C 110 315, 175 390, 255 340 S 355 315, 418 350" />
              </svg>
            </div>

          <div className="relative z-10 overflow-hidden rounded-3xl border border-white/80 bg-white/80 p-6 shadow-[0_24px_60px_-28px_rgba(15,23,42,0.35)] backdrop-blur-md sm:p-8">
            <p
              aria-hidden
              className="login-form-watermark pointer-events-none absolute -top-3 right-2 font-black uppercase select-none"
            >
              {PORTAL_APP_VERSION.replace(/^v/i, "")}
            </p>

            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-700">
              Nueva versión · {PORTAL_APP_VERSION_LABEL}
            </p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              <span className="block text-lg font-semibold text-slate-700 sm:text-xl">
                Bienvenido a
              </span>
              <span className="login-form-uaid mt-1 inline-block" aria-label="UAID">
                <span className="login-form-uaid-spray" aria-hidden>
                  UAID
                </span>
                <span className="login-form-uaid-drip" aria-hidden>
                  UAID
                </span>
                <span className="login-form-uaid-word">UAID</span>
              </span>
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Ingresa tus credenciales para acceder al portal.
            </p>

            {searchParams.get("razon") === LOGIN_IDLE_QUERY ? (
              <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                Tu sesión se cerró por inactividad. Vuelve a ingresar.
              </p>
            ) : null}

            <form onSubmit={handleSubmit} className="mt-7 space-y-5">
              <div>
                <label
                  htmlFor="username"
                  className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-700"
                >
                  Usuario
                </label>
                <div className="relative mt-2">
                  <User
                    className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden
                  />
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoComplete="username"
                    placeholder="tu.usuario"
                    className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-3 pl-10 text-sm text-slate-900 shadow-sm transition-all placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-700"
                >
                  Contraseña
                </label>
                <div className="relative mt-2">
                  <Lock
                    className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden
                  />
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-3 pl-10 text-sm text-slate-900 shadow-sm transition-all placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 focus:outline-none"
                  />
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="login-form-cta flex w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-sky-500 via-blue-600 to-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 transition-all hover:from-sky-400 hover:via-blue-600 hover:to-indigo-500 hover:shadow-xl hover:shadow-indigo-600/25 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Verificando...
                  </>
                ) : (
                  "Iniciar sesión"
                )}
              </button>
            </form>

            <p className="mt-6 border-t border-slate-200/80 pt-4 text-xs leading-relaxed text-slate-500">
              El resto de pantallas se irá renovando en las próximas
              actualizaciones.
            </p>
          </div>
          </div>

          <p className="mt-6 text-center text-xs text-slate-500">
            ¿No puedes ingresar?{" "}
            <a
              href="mailto:soporte@mercamio.com.co"
              className="font-semibold text-blue-700 underline-offset-4 hover:underline"
            >
              Contacta al administrador
            </a>
          </p>
          </div>
        </div>
      </main>
    </div>
  );
}
