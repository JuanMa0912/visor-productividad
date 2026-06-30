"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Clock3, KeyRound, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { AppTopBar } from "@/components/portal/app-top-bar";
import { MercamioLogo } from "@/components/portal/brand-logos";
import { PasswordInputField } from "@/components/portal/password-input-field";
import { PasswordPolicyChecklist } from "@/components/portal/password-policy-checklist";
import { PasswordStrengthMeter } from "@/components/portal/password-strength-meter";
import { useDomInputSync } from "@/hooks/use-dom-input-sync";
import { useAuth, useRequireAuth } from "@/lib/auth/auth-context";
import type { PasswordChangeReason } from "@/lib/auth/types";
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

const reasonTitle = (reason: PasswordChangeReason | null | undefined) => {
  switch (reason) {
    case "weak":
      return "Contraseña no segura";
    case "expired":
      return "Contraseña vencida";
    case "unset":
      return "Contraseña pendiente";
    default:
      return "Actualización requerida";
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
  const alertTitle = useMemo(
    () => reasonTitle(user?.passwordChangeReason),
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
    <div className="min-h-screen bg-linear-to-br from-slate-100 via-slate-50 to-blue-50/40 text-foreground">
      {required ? (
        <header className="border-b border-slate-200/70 bg-white/80 px-6 py-4 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
            <MercamioLogo className="h-10 w-auto" />
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Seguridad de cuenta
            </p>
          </div>
        </header>
      ) : (
        <AppTopBar showBack />
      )}

      <main className="flex items-center justify-center px-4 py-10 sm:py-14">
        <div className="w-full max-w-2xl">
          <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_24px_80px_-40px_rgba(15,23,42,0.35)]">
            <div className="border-b border-slate-200/70 bg-linear-to-r from-slate-50 via-blue-50/60 to-slate-50 px-6 py-6 sm:px-8 sm:py-7">
              <div className="flex items-start gap-4">
                <div className="rounded-2xl bg-blue-600 p-3 text-white shadow-lg shadow-blue-600/20">
                  <KeyRound className="h-6 w-6" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                    Cambiar contraseña
                  </h1>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                    {required
                      ? "Ingrese su contraseña actual y defina una nueva que cumpla la política de seguridad."
                      : "Actualice su contraseña para mantener su cuenta protegida."}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-6 px-6 py-6 sm:px-8 sm:py-8">
              {required ? (
                <div
                  role="alert"
                  className="flex items-start gap-3 rounded-2xl border border-amber-200/80 bg-amber-50/90 px-4 py-4"
                >
                  <div className="rounded-xl bg-amber-100 p-2 text-amber-700">
                    <ShieldAlert className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-amber-950">
                      {alertTitle}
                    </p>
                    <p className="text-sm leading-relaxed text-amber-900/90">
                      {bannerText}
                    </p>
                  </div>
                </div>
              ) : null}

              {!required && user?.passwordDaysUntilExpiry != null ? (
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                  <Clock3 className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                  Su contraseña vence en {user.passwordDaysUntilExpiry} día
                  {user.passwordDaysUntilExpiry === 1 ? "" : "s"}.
                </div>
              ) : null}

              <form onSubmit={handleSubmit} className="space-y-5">
                <PasswordInputField
                  id="current-password"
                  label="Contraseña actual"
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  required
                  autoComplete="current-password"
                />

                <div className="space-y-3">
                  <PasswordInputField
                    id="new-password"
                    label="Nueva contraseña"
                    value={newPassword}
                    onChange={setNewPassword}
                    onInput={setNewPassword}
                    inputRef={newPasswordRef}
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                  <PasswordStrengthMeter password={newPassword} />
                </div>

                <PasswordInputField
                  id="confirm-password"
                  label="Confirmar nueva contraseña"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />

                <PasswordPolicyChecklist password={newPassword} />

                <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
                  {!required ? (
                    <button
                      type="button"
                      onClick={() => router.push("/secciones")}
                      className="order-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 sm:order-1"
                    >
                      Volver a secciones
                    </button>
                  ) : (
                    <p className="order-2 text-xs text-slate-500 sm:order-1">
                      Debe completar este paso para acceder al portal.
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={isSaving}
                    className="order-1 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-md shadow-blue-600/25 transition-all hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-600/30 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 sm:order-2 sm:w-auto sm:min-w-[220px]"
                  >
                    {isSaving ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Guardando...
                      </>
                    ) : (
                      "Actualizar contraseña"
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-slate-500">
            ¿Problemas para cambiar la contraseña?{" "}
            <a
              href="mailto:soporte@mercamio.com.co"
              className="font-semibold text-blue-600 underline-offset-4 hover:underline"
            >
              Contacte al administrador
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}

export default function CambiarContrasenaPage() {
  return (
    <Suspense fallback={null}>
      <CambiarContrasenaPageInner />
    </Suspense>
  );
}
