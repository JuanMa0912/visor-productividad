import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireAuthSession } from "@/lib/auth";
import { canAccessProveedoresBoard } from "@/lib/shared/special-role-features";

type Props = { children: ReactNode };

/** Tablero Proveedores; no envuelve /proveedores/ingreso (ruta pública). */
export default async function ProveedoresAdminLayout({ children }: Props) {
  const session = await requireAuthSession();
  if (!session) {
    redirect("/login");
  }
  const isAdmin = session.user.role === "admin";
  if (
    !canAccessProveedoresBoard(isAdmin, session.user.allowedSubdashboards)
  ) {
    redirect("/secciones");
  }
  return <>{children}</>;
}
