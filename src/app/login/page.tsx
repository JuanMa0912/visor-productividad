"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

export default function LoginPage() {
  const router = useRouter();
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

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "No se pudo iniciar sesión.");
      }

      router.push("/secciones");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-sky-50 via-blue-50 to-lime-50 px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-xl rounded-3xl border border-blue-200/70 bg-white/90 p-8 shadow-[0_25px_80px_-38px_rgba(15,23,42,0.35)] backdrop-blur">
        <div className="mb-6 flex items-center justify-center gap-3 rounded-2xl border border-slate-200/70 bg-white/90 p-3">
          <Image
            src="/logos/mercamio.jpeg"
            alt="Logo MercaMio"
            width={190}
            height={60}
            className="h-12 w-auto sm:h-14"
            priority
          />
          <Image
            src="/logos/mercatodo.jpeg"
            alt="Logo MercaTodo"
            width={190}
            height={60}
            className="h-12 w-auto sm:h-14"
            priority
          />
        </div>
        <div className="mb-4 text-center">
          <p className="inline-block bg-linear-to-r from-sky-700 via-blue-700 to-slate-800 bg-clip-text text-4xl font-black uppercase tracking-[0.16em] text-transparent sm:text-5xl">
            UAID
          </p>
          <p className="mt-2 text-sm font-medium text-slate-600">
            Unidad de Analitica e Inteligencia de Datos
          </p>
          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
            MercaMio y MercaTodo
          </p>
        </div>

        <h1 className="text-2xl font-bold text-slate-900">Iniciar sesión</h1>
        <p className="mt-1 text-sm text-slate-600">
          Accede con tu cuenta para consultar las secciones e indicadores del
          portal.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block text-sm text-slate-700">
            Usuario
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="mt-1 w-full rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-all focus:border-mercamio-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-mercamio-100"
            />
          </label>
          <label className="block text-sm text-slate-700">
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-1 w-full rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-all focus:border-mercamio-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-mercamio-100"
            />
          </label>

          {error && (
            <div className="rounded-2xl border border-amber-200/70 bg-amber-50 px-4 py-2 text-sm text-amber-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full border border-mercamio-200/70 bg-linear-to-r from-[#4f7eff] via-[#2563eb] to-[#4f7eff] px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-white shadow-[0_8px_16px_-12px_rgba(37,99,235,0.55)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <div className="mt-6 border-t border-slate-200/70 pt-3 text-center">
          <p className="text-xs font-medium tracking-[0.08em] text-slate-500">
            Created by Juan Felipe Gomez and Juan Manuel Velasquez
          </p>
        </div>
      </div>
    </div>
  );
}
