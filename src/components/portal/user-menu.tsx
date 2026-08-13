"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, KeyRound, LogOut, ShieldCheck, User } from "lucide-react";
import { cn } from "@/lib/shared/utils";
import { useAuth } from "@/lib/auth/auth-context";

export type UserMenuProps = {
  username: string | null;
  role: "admin" | "user" | null;
  sede?: string | null;
  /** Estilo fino para header oscuro UAID 5.0 */
  tone?: "default" | "control";
};

const initialsFor = (name: string | null): string => {
  if (!name) return "?";
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const tokens = trimmed.split(/\s+|\.|_|-/).filter(Boolean);
  if (tokens.length === 0) return trimmed.slice(0, 2).toUpperCase();
  if (tokens.length === 1) return tokens[0]!.slice(0, 2).toUpperCase();
  return (tokens[0]![0]! + tokens[1]![0]!).toUpperCase();
};

const colorClassesFor = (name: string | null) => {
  const palette = [
    { bg: "bg-violet-100", text: "text-violet-700", ring: "ring-violet-200" },
    { bg: "bg-amber-100", text: "text-amber-700", ring: "ring-amber-200" },
    { bg: "bg-emerald-100", text: "text-emerald-700", ring: "ring-emerald-200" },
    { bg: "bg-sky-100", text: "text-sky-700", ring: "ring-sky-200" },
    { bg: "bg-rose-100", text: "text-rose-700", ring: "ring-rose-200" },
    { bg: "bg-indigo-100", text: "text-indigo-700", ring: "ring-indigo-200" },
  ];
  if (!name) return palette[0]!;
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length]!;
};

export function UserMenu({
  username,
  role,
  sede,
  tone = "default",
}: UserMenuProps) {
  const router = useRouter();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const control = tone === "control";

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    // `logout()` del AuthProvider limpia el state SINCRONAMENTE (flushSync) y
    // dispara el fetch al server en background. Asi el boton no queda colgado
    // en "Cerrando sesion..." si la red al server esta lenta o caida; el
    // redirect a /login y el cambio de UI son inmediatos.
    await logout();
  }, [loggingOut, logout]);

  const colors = colorClassesFor(username);
  const initials = initialsFor(username);
  const roleLabel = role === "admin" ? "Administrador" : role === "user" ? "Usuario" : null;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          control
            ? "inline-flex h-8 shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 pl-1 pr-2.5 text-[11px] font-semibold tracking-[0.08em] text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            : "inline-flex h-8 shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white pl-1 pr-2.5 text-[11px] font-semibold text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50",
          !control && open && "border-slate-300 ring-2 ring-sky-100",
          control && open && "bg-white/10 text-white",
        )}
      >
        <span
          className={cn(
            "inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold uppercase tracking-wide",
            control
              ? "bg-sky-400/15 text-sky-300 ring-1 ring-sky-400/30"
              : cn(colors.bg, colors.text),
          )}
        >
          {initials}
        </span>
        <span
          className={cn(
            "hidden sm:inline-block",
            control
              ? "normal-case tracking-normal text-slate-300"
              : "uppercase tracking-[0.12em]",
          )}
        >
          {username ?? "..."}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            control ? "text-slate-500" : "text-muted-foreground",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Menú de usuario"
          className={cn(
            "absolute right-0 z-50 mt-2 w-64 origin-top-right p-2 shadow-[0_20px_60px_-25px_rgba(15,23,42,0.3)]",
            control
              ? "rounded-xl border border-white/10 bg-[#0b1220]"
              : "rounded-2xl border border-slate-200 bg-white",
          )}
        >
          <div
            className={cn(
              "flex items-center gap-3 rounded-xl p-3",
              control ? "bg-white/5" : "bg-slate-50/80",
            )}
          >
            <span
              className={cn(
                "inline-flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold uppercase ring-1",
                control
                  ? "bg-sky-400/15 text-sky-300 ring-sky-400/30"
                  : cn(colors.bg, colors.text, colors.ring),
              )}
            >
              {initials}
            </span>
            <div className="min-w-0">
              <p
                className={cn(
                  "truncate text-sm font-semibold",
                  control ? "text-white" : "text-slate-900",
                )}
              >
                {username ?? "Sin sesión"}
              </p>
              <div
                className={cn(
                  "mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                  control ? "text-slate-500" : "text-slate-500",
                )}
              >
                {role === "admin" ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5",
                      control
                        ? "bg-amber-400/15 text-amber-200"
                        : "bg-amber-100 text-amber-800",
                    )}
                  >
                    <ShieldCheck className="h-2.5 w-2.5" />
                    {roleLabel}
                  </span>
                ) : roleLabel ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5",
                      control
                        ? "bg-white/10 text-slate-300"
                        : "bg-slate-200 text-slate-700",
                    )}
                  >
                    <User className="h-2.5 w-2.5" />
                    {roleLabel}
                  </span>
                ) : null}
                {sede && <span className="truncate">{sede}</span>}
              </div>
            </div>
          </div>

          <div
            className={cn("my-1.5 h-px", control ? "bg-white/10" : "bg-slate-100")}
          />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              router.push("/cuenta/contrasena");
            }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
              control
                ? "text-slate-300 hover:bg-white/5 hover:text-white"
                : "text-slate-700 hover:bg-slate-100",
            )}
          >
            <KeyRound
              className={cn("h-4 w-4", control ? "text-slate-500" : "text-slate-500")}
            />
            Cambiar contraseña
          </button>

          <div
            className={cn("my-1.5 h-px", control ? "bg-white/10" : "bg-slate-100")}
          />

          <button
            type="button"
            role="menuitem"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              control
                ? "text-rose-300 hover:bg-rose-500/10"
                : "text-rose-700 hover:bg-rose-50",
            )}
          >
            <LogOut className="h-4 w-4" />
            {loggingOut ? "Cerrando sesión..." : "Cerrar sesión"}
          </button>
        </div>
      )}
    </div>
  );
}
