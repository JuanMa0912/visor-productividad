"use client";

import { usePathname } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { Button } from "@/components/ui/button";

/**
 * Cubre el spinner eterno de las paginas cuando `/api/auth/me` falla
 * (status `error`): muestra mensaje y reintento sin forzar redirect a login.
 */
export function AuthSessionRecovery() {
  const pathname = usePathname();
  const { status, error, refresh } = useAuth();

  if (
    !pathname ||
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/ExcelDian" ||
    pathname.startsWith("/ExcelDian/")
  ) {
    return null;
  }

  if (status !== "error") return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/70 p-6 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-3 flex items-center gap-2 text-amber-700">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <h2 className="text-base font-semibold">No se pudo validar la sesión</h2>
        </div>
        <p className="mb-4 text-sm text-slate-600">
          {error?.trim() ||
            "El servidor no respondió al consultar tu sesión. Puede ser un pico de carga o un problema temporal de red."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => {
              void refresh();
            }}
          >
            Reintentar
          </Button>
          <Button type="button" variant="outline" asChild>
            <a href="/login">Ir al login</a>
          </Button>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          Las pantallas esperan a que la sesión se recupere.
        </p>
      </div>
    </div>
  );
}
