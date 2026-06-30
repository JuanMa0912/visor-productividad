"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { AppTopBar } from "@/components/portal/app-top-bar";
import { PasswordStrengthMeter } from "@/components/portal/password-strength-meter";
import { useDomInputSync } from "@/hooks/use-dom-input-sync";
import { useAuth, useRequireAuth } from "@/lib/auth/auth-context";
import type { PasswordChangeReason } from "@/lib/auth/types";
import { PASSWORD_POLICY_HINT } from "@/lib/auth/password-policy";
import {
  AUTH_MESSAGES,
  VALIDATION_MESSAGES,
  extractErrorMessage,
} from "@/lib/shared/messages";

const reasonCopy = (reason: PasswordChangeReason | null | undefined) => {
  switch (reason) {
    case "weak":
      return "Su contraseña actual no cumple la política de seguridad. Debe definir una nueva antes de continuar.";
    case "expired":
      return "Han transcurrido 30 días desde su último cambio de contraseña. Debe actualizarla para seguir usando el portal.";
    case "unset":
      return "Debe registrar una contraseña segura para continuar.";
    default:
      return "Debe actualizar su contraseña para continuar.";
  }
};

function CambiarContrasenaPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, refresh } = useAuth();
  useRequireAuth();

  const required =
    searchParams.get("required") === "1" || user?.passwordChangeRequired === true;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const newPasswordRef = useDomInputSync(setNewPassword);

  const bannerText = useMemo(
    () => reasonCopy(user?.passwordChangeReason),
    [user?.passwordChangeReason],
  );

  const getCookieValue = (name: string) => {
    if (typeof document === "undefined") return null;
    const value = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${name}=`));
    if (!value) return null;
    return decodeURIComponent(value.split("=").slice(1).join("="));
  };

  const requireCsrfToken = () => {
    const token = getCookieValue("vp_csrf");
    if (!token) {
      toast.error(AUTH_MESSAGES.sessionCheckFailed);
      return null;
    }
    return token;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (newPassword.length < 8) {
      toast.error(VALIDATION_MESSAGES.passwordTooShort);
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(VALIDATION_MESSAGES.passwordsDoNotMatch);
      return;
    }

    setIsSaving(true);
    try {
      const csrfToken = requireCsrfToken();
      if (!csrfToken) {
        setIsSaving(false);
        return;
      }
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          extractErrorMessage(payload, "No se pudo cambiar la contraseña."),
        );
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await refresh();
      toast.success("Contraseña actualizada correctamente.");
      router.replace("/secciones");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <AppTopBar showBack={!required} />
      <div className="min-h-screen bg-slate-100 px-4 py-10 text-foreground">
        <div className="mx-auto w-full max-w-xl rounded-3xl border border-slate-200/70 bg-white p-7 shadow-[0_28px_70px_-45px_rgba(15,23,42,0.4)]">
          {required ? (
            <div
              role="alert"
              className="mb-6 rounded-2xl border-2 border-rose-300 bg-rose-50 px-4 py-4 text-rose-950"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" />
                <div className="space-y-1">
                  <p className="text-sm font-black uppercase tracking-[0.14em] text-rose-800">
                    Cambio de contraseña obligatorio
                  </p>
                  <p className="text-sm leading-relaxed text-rose-900/90">
                    {bannerText}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          <div className="mb-4 flex items-center justify-between gap-3">
            <h1 className="text-2xl font-bold text-slate-900">
              Cambiar contraseña
            </h1>
            {!required ? (
              <button
                type="button"
                onClick={() => router.push("/secciones")}
                className="rounded-full border border-slate-200/70 bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-slate-700 transition-all hover:border-slate-300"
              >
                Volver a secciones
              </button>
            ) : null}
          </div>

          <p className="text-sm text-slate-600">
            {required
              ? "Ingrese su contraseña actual y defina una nueva que cumpla la política de seguridad."
              : "Escribe tu contraseña actual y define una nueva."}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            {PASSWORD_POLICY_HINT}
          </p>
          {!required && user?.passwordDaysUntilExpiry != null ? (
            <p className="mt-2 text-xs font-medium text-slate-600">
              Su contraseña vence en {user.passwordDaysUntilExpiry} día
              {user.passwordDaysUntilExpiry === 1 ? "" : "s"}.
            </p>
          ) : null}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block text-sm text-slate-700">
              Contraseña actual
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="mt-1 w-full rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-all focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </label>

            <div className="space-y-2">
              <label
                className="block text-sm text-slate-700"
                htmlFor="new-password"
              >
                Nueva contraseña
              </label>
              <input
                id="new-password"
                ref={newPasswordRef}
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                onInput={(e) =>
                  setNewPassword((e.target as HTMLInputElement).value)
                }
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-all focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 vp-sync-autofill"
              />
              <PasswordStrengthMeter password={newPassword} />
            </div>

            <label className="block text-sm text-slate-700">
              Confirmar nueva contraseña
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="mt-1 w-full rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-all focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </label>

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
    </>
  );
}

export default function CambiarContrasenaPage() {
  return (
    <Suspense fallback={null}>
      <CambiarContrasenaPageInner />
    </Suspense>
  );
}
