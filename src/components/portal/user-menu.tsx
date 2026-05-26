"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, KeyRound, LogOut, ShieldCheck, User } from "lucide-react";
import { cn } from "@/lib/shared/utils";

export type UserMenuProps = {
  username: string | null;
  role: "admin" | "user" | null;
  sede?: string | null;
};

const getCookieValue = (name: string): string | null => {
  if (typeof document === "undefined") return null;
  const value = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`));
  if (!value) return null;
  return decodeURIComponent(value.split("=").slice(1).join("="));
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

export function UserMenu({ username, role, sede }: UserMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

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
    try {
      const csrfToken = getCookieValue("vp_csrf");
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: csrfToken ? { "x-csrf-token": csrfToken } : undefined,
      });
    } catch {
      // best-effort; igual redirigimos al login para forzar cierre.
    } finally {
      router.replace("/login");
    }
  }, [loggingOut, router]);

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
          "inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-border/70 bg-background/80 pl-1 pr-3 text-xs font-semibold text-foreground shadow-sm transition-all hover:border-foreground/30",
          open && "border-foreground/40 ring-2 ring-foreground/10",
        )}
      >
        <span
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold uppercase tracking-wide",
            colors.bg,
            colors.text,
          )}
        >
          {initials}
        </span>
        <span className="hidden sm:inline-block uppercase tracking-[0.14em]">
          {username ?? "..."}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Menú de usuario"
          className="absolute right-0 z-50 mt-2 w-64 origin-top-right rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_20px_60px_-25px_rgba(15,23,42,0.3)]"
        >
          <div className="flex items-center gap-3 rounded-xl bg-slate-50/80 p-3">
            <span
              className={cn(
                "inline-flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold uppercase ring-1",
                colors.bg,
                colors.text,
                colors.ring,
              )}
            >
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {username ?? "Sin sesión"}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {role === "admin" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-800">
                    <ShieldCheck className="h-2.5 w-2.5" />
                    {roleLabel}
                  </span>
                ) : roleLabel ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-1.5 py-0.5 text-slate-700">
                    <User className="h-2.5 w-2.5" />
                    {roleLabel}
                  </span>
                ) : null}
                {sede && <span className="truncate">{sede}</span>}
              </div>
            </div>
          </div>

          <div className="my-1.5 h-px bg-slate-100" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              router.push("/cuenta/contrasena");
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
          >
            <KeyRound className="h-4 w-4 text-slate-500" />
            Cambiar contraseña
          </button>

          <div className="my-1.5 h-px bg-slate-100" />

          <button
            type="button"
            role="menuitem"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LogOut className="h-4 w-4" />
            {loggingOut ? "Cerrando sesión..." : "Cerrar sesión"}
          </button>
        </div>
      )}
    </div>
  );
}
