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
import type { AuthUser } from "@/lib/auth/types";

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
  const { signIn } = useAuth();
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

      signIn(payload.user);

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

      <main className="flex items-center justify-center bg-slate-50 px-6 py-12 lg:px-12">
        <div className="w-full max-w-md">
          <div className="mb-8 grid grid-cols-2 gap-x-4 gap-y-4 border-b border-slate-200 pb-6">
            {/* MercaMio primero (marca principal). Celdas fijas para igualar tamaño visual. */}
            <div className="flex h-20 items-center justify-center overflow-hidden">
              <MercamioLogo className="h-16 w-auto max-w-full object-contain" />
            </div>
            <div className="flex h-20 items-center justify-center overflow-hidden">
              <MercatodoLogo className="h-16 w-auto max-w-full object-contain" />
            </div>
            <div className="flex h-20 items-center justify-center overflow-hidden">
              <MerkmiosLogo className="h-[4.75rem] w-auto max-w-[110%] object-contain" />
            </div>
            <div className="flex h-20 items-center justify-center overflow-hidden">
              <DinastiaLogo className="h-[4.75rem] w-auto max-w-[110%] object-contain" />
            </div>
          </div>

          <h2 className="text-3xl font-bold text-slate-900">Bienvenido</h2>
          <p className="mt-2 text-sm text-slate-600">
            Ingresa tus credenciales para acceder al portal.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
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
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-3 pl-10 text-sm text-slate-900 shadow-sm transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none"
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
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-3 pl-10 text-sm text-slate-900 shadow-sm transition-all placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none"
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
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-blue-600/25 transition-all hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-600/30 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
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

          <p className="mt-8 text-center text-xs text-slate-500">
            ¿No puedes ingresar?{" "}
            <a
              href="mailto:soporte@mercamio.com.co"
              className="font-semibold text-blue-600 underline-offset-4 hover:underline"
            >
              Contacta al administrador
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
