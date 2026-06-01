"use client";

import { Toaster } from "sonner";

/**
 * Toaster global del Portal UAID (basado en `sonner`).
 *
 * Se monta una sola vez en `RootLayout` para que cualquier componente o
 * pagina pueda disparar notificaciones via `import { toast } from "sonner"`.
 *
 * Reemplazo de `window.alert()`, `window.confirm()` para confirmaciones, y
 * de los `setError(...)` con `<div>` rojo inline que estaban repartidos por
 * el portal. Los `setError` para errores DENTRO de un formulario (que
 * deben quedar inline al campo) NO se reemplazan por toasts.
 *
 * Como usar:
 *   import { toast } from "sonner";
 *   import { ACTION_MESSAGES, AUTH_MESSAGES } from "@/lib/shared/messages";
 *
 *   toast.success(ACTION_MESSAGES.saveSuccess);
 *   toast.error(AUTH_MESSAGES.sessionExpired);
 *   toast.info("Procesando solicitud...");
 *
 *   // Async con loading -> success/error automatico:
 *   toast.promise(savePromise, {
 *     loading: "Guardando...",
 *     success: ACTION_MESSAGES.saveSuccess,
 *     error: (err) => err?.message ?? ACTION_MESSAGES.saveFailed,
 *   });
 *
 * Decisiones de diseno:
 *   - `position: "top-right"` para no tapar contenido al pie de pantalla y
 *     alinearse con el avatar/menu de usuario que esta en la esquina superior.
 *   - `richColors` para que success/error/warning tengan paleta semantica
 *     consistente sin tener que custmizar manualmente cada toast.
 *   - `closeButton` siempre visible para que el usuario tenga control
 *     explicito si no quiere esperar al auto-dismiss.
 *   - Duracion mayor para errores (5s) que para info/success (3s) porque
 *     los errores requieren mas lectura.
 */
export function PortalToaster() {
  return (
    <Toaster
      position="top-right"
      richColors
      closeButton
      toastOptions={{
        duration: 3500,
        classNames: {
          // Pequeno polish del frame para que se sienta del mismo "lenguaje"
          // que el footer y los cards del portal (bordes redondos amplios,
          // sombra suave estilo elevation).
          toast:
            "rounded-2xl shadow-[0_18px_40px_-25px_rgba(15,23,42,0.45)] border-slate-200/70",
          title: "font-medium tracking-tight",
          description: "text-slate-600",
        },
      }}
    />
  );
}
