"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";

/** Redirige al cambio obligatorio de contraseña cuando la política lo exige. */
export function PasswordChangeEnforcer() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, status } = useAuth();

  useEffect(() => {
    if (status !== "authenticated" || !user?.passwordChangeRequired) return;
    if (pathname.startsWith("/cuenta/contrasena")) return;
    if (pathname === "/login") return;
    router.replace("/cuenta/contrasena?required=1");
  }, [status, user, pathname, router]);

  return null;
}
