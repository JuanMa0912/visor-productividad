import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireAuthSession } from "@/lib/auth";

type Props = { children: ReactNode };

export default async function AdminUsuariosLayout({ children }: Props) {
  const session = await requireAuthSession();
  if (!session) {
    redirect("/login");
  }
  if (session.user.role !== "admin") {
    redirect("/secciones");
  }
  return <>{children}</>;
}
