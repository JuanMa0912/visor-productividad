import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireAuthSession } from "@/lib/auth";
import { canAccessOrdenesCompra } from "@/lib/shared/special-role-features";

type Props = { children: ReactNode };

export default async function OrdenesCompraLayout({ children }: Props) {
  const session = await requireAuthSession();
  if (!session) redirect("/login");
  if (!canAccessOrdenesCompra(
    session.user.role,
    session.user.allowedDashboards,
    session.user.allowedSubdashboards,
  )) {
    redirect("/secciones");
  }
  return <>{children}</>;
}
