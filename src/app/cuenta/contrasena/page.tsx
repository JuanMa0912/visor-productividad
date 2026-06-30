"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Clock3, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  AuthBrandingPanel,
  AuthBrandingPanelFallback,
} from "@/components/portal/auth-branding-panel";
import { MercamioLogo, MercatodoLogo } from "@/components/portal/brand-logos";
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
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      <AuthBrandingPanel className="min-h-[280px] lg:min-h-screen" />

      <main className="flex items-center justify-center overflow-y-auto bg-slate-50 px-6 py-10 lg:px-12 lg:py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center justify-center gap-5 border-b border-slate-200 pb-6">
            <MercamioLogo className="h-16 w-auto" />
            <MercatodoLogo className="h-16 w-auto" />
          </div>

          <h1 className="text-3xl font-bold text-slate-900">Cambiar contraseña</h1>
          <p className="mt-2 text-sm text-slate-600">
            {required
              ? "Ingrese su contraseña actual y defina una nueva que cumpla la política de seguridad."
              : "Actualice su contraseña para mantener su cuenta protegida."}
          </p>

          {required ? (
            <div
              role="alert"
              className="mt-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
            >
              <ShieldAlert
                className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
                aria-hidden
              />
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
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
              <Clock3 className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              Su contraseña vence en {user.passwordDaysUntilExpiry} día
              {user.passwordDaysUntilExpiry === 1 ? "" : "s"}.
            </div>
          ) : null}

          <form
            onSubmit={handleSubmit}
            className={`space-y-5 ${required || user?.passwordDaysUntilExpiry != null ? "mt-6" : "mt-8"}`}
          >
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

            <button
              type="submit"
              disabled={isSaving}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-blue-600/25 transition-all hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-600/30 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
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
          </form>

          <p className="mt-8 text-center text-xs text-slate-500">
            {required ? (
              <>Debe completar este paso para acceder al portal.</>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => router.push("/secciones")}
                  className="font-semibold text-blue-600 underline-offset-4 hover:underline"
                >
                  Volver a secciones
                </button>
                {" · "}
              </>
            )}
            ¿Problemas?{" "}
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

function CambiarContrasenaPageFallback() {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      <AuthBrandingPanelFallback />
      <div className="flex items-center justify-center bg-slate-50 px-6">
        <div className="h-[480px] w-full max-w-md animate-pulse rounded-2xl bg-slate-200/60" />
      </div>
    </div>
  );
}

export default function CambiarContrasenaPage() {
  return (
    <Suspense fallback={<CambiarContrasenaPageFallback />}>
      <CambiarContrasenaPageInner />
    </Suspense>
  );
}
