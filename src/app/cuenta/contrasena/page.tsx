"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CambiarContrasenaPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword.length < 8) {
      setError("La nueva contraseña debe tener mínimo 8 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("La confirmación no coincide con la nueva contraseña.");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "No se pudo cambiar la contraseña.");
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess("Contraseña actualizada correctamente.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-xl rounded-3xl border border-slate-200/70 bg-white p-7 shadow-[0_28px_70px_-45px_rgba(15,23,42,0.4)]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Cambiar contraseña</h1>
          <button
            type="button"
            onClick={() => router.push("/tableros")}
            className="rounded-full border border-slate-200/70 bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-slate-700 transition-all hover:border-slate-300"
          >
            Volver
          </button>
        </div>

        <p className="text-sm text-slate-600">
          Escribe tu contraseña actual y define una nueva.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block text-sm text-slate-700">
            Contraseña actual
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="mt-1 w-full rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-all focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <label className="block text-sm text-slate-700">
            Nueva contraseña
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              className="mt-1 w-full rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-all focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <label className="block text-sm text-slate-700">
            Confirmar nueva contraseña
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              className="mt-1 w-full rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-all focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </label>

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={isSaving}
            className="w-full rounded-full border border-blue-200/70 bg-blue-600 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-white transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSaving ? "Guardando..." : "Actualizar contraseña"}
          </button>
        </form>
      </div>
    </div>
  );
}
