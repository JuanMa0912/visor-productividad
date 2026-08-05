import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireAuthSession } from "@/lib/auth";

type Props = { children: ReactNode };

/** Solo administradores; el gate de cliente es defensa en profundidad. */
export default async function ProveedoresLayout({ children }: Props) {
  const session = await requireAuthSession();
  if (!session) {
    redirect("/login");
  }
  if (session.user.role !== "admin") {
    redirect("/secciones");
  }
  return <>{children}</>;
}
