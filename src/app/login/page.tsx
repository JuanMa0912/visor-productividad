"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, User } from "lucide-react";
import { MercamioLogo, MercatodoLogo } from "@/components/portal/brand-logos";
import { useAuth } from "@/lib/auth/auth-context";
import type { AuthUser } from "@/lib/auth/types";

const sanitizeFrom = (raw: string | null): string => {
  if (!raw) return "/secciones";
  if (!raw.startsWith("/")) return "/secciones";
  if (raw.startsWith("//")) return "/secciones";
  if (raw.includes(":")) return "/secciones";
  return raw;
};

function LoginPageInner() {
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
      {/* ─── PANEL IZQUIERDO — BRANDING ─── */}
      <aside className="relative flex flex-col items-start justify-center overflow-hidden bg-linear-to-br from-slate-950 via-blue-950 to-blue-800 px-8 py-12 text-white lg:px-16 lg:py-16">
        {/* Manchas decorativas de fondo */}
        <div className="pointer-events-none absolute -top-24 -right-24 h-96 w-96 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-sky-400/15 blur-3xl" />

        {/* Hero — UAID gigante (centrado verticalmente) */}
        <div className="relative z-10">
          <p className="text-sm font-semibold uppercase tracking-[0.32em] text-blue-300">
            Portal corporativo
          </p>
          <h1 className="mt-3 text-6xl font-black uppercase tracking-tight text-white sm:text-7xl lg:text-8xl">
            UAID
          </h1>
          <p className="mt-4 max-w-md text-lg font-medium text-blue-100">
            Unidad de Analítica e Inteligencia de Datos
          </p>
          <p className="mt-8 max-w-md text-sm leading-relaxed text-blue-200/80">
            Datos confiables para decisiones claras. Indicadores de
            productividad, márgenes, rotación y ventas consolidados para
            Mercamio, Mercatodo y Merkmios.
          </p>
        </div>

        {/* Footer anclado abajo */}
        <div className="absolute right-8 bottom-8 left-8 z-10 flex items-center justify-between text-xs text-blue-200/60 lg:right-16 lg:bottom-12 lg:left-16">
          <p>© 2026 Mercamio · Todos los derechos reservados</p>
          <p className="rounded-full bg-white/10 px-2.5 py-0.5 font-mono text-[10px]">v4.0</p>
        </div>
      </aside>

      {/* ─── PANEL DERECHO — FORMULARIO ─── */}
      <main className="flex items-center justify-center bg-slate-50 px-6 py-12 lg:px-12">
        <div className="w-full max-w-sm">
          {/* Logos arriba del form */}
          <div className="mb-8 flex items-center justify-center gap-5 border-b border-slate-200 pb-6">
            <MercamioLogo className="h-16 w-auto" />
            <MercatodoLogo className="h-16 w-auto" />
          </div>

          <h2 className="text-3xl font-bold text-slate-900">Bienvenido</h2>
          <p className="mt-2 text-sm text-slate-600">
            Ingresa tus credenciales para acceder al portal.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            {/* Usuario */}
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

            {/* Contraseña */}
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

            {/* Error */}
            {error && (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
              >
                {error}
              </div>
            )}

            {/* Botón */}
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

          {/* Ayuda */}
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

function LoginPageFallback() {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      <div className="bg-linear-to-br from-slate-950 via-blue-950 to-blue-800" />
      <div className="flex items-center justify-center bg-slate-50 px-6">
        <div className="h-[360px] w-full max-w-sm animate-pulse rounded-2xl bg-slate-200/60" />
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginPageFallback />}>
      <LoginPageInner />
    </Suspense>
  );
}
