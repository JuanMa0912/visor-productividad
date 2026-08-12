import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireAuthSession } from "@/lib/auth";

type Props = { children: ReactNode };

/** Experimental: solo admin; visible en hub Venta para administradores. */
export default async function ExpPreciosProveedorLayout({ children }: Props) {
  const session = await requireAuthSession();
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/secciones");
  return <>{children}</>;
}
