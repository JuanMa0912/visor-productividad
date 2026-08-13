import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireAuthSession } from "@/lib/auth";
import { canAccessPreciosProveedor } from "@/lib/shared/special-role-features";

type Props = { children: ReactNode };

/** Subtablero `precios-proveedor` (opt-in) o admin. Visible en hub Venta. */
export default async function ExpPreciosProveedorLayout({ children }: Props) {
  const session = await requireAuthSession();
  if (!session) redirect("/login");
  if (
    !canAccessPreciosProveedor(
      session.user.role,
      session.user.allowedDashboards,
      session.user.allowedSubdashboards,
    )
  ) {
    redirect("/secciones");
  }
  return <>{children}</>;
}
