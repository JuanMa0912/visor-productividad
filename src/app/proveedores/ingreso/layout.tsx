import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Registro proveedores",
  robots: { index: false, follow: false },
};

/** Pantalla pública aislada: sin chrome del portal. */
export default function ProveedoresIngresoLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
