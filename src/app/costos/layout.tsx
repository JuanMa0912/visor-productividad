import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireAuthSession } from "@/lib/auth";
import { canAccessPreciosProveedor } from "@/lib/shared/special-role-features";

type Props = { children: ReactNode };

/** Costos (`/costos`): subtablero `precios-proveedor` (opt-in) o admin. */
export default async function CostosLayout({ children }: Props) {
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
