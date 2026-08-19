import { ReactNode } from "react";

type Props = { children: ReactNode };

/** Redirección a `/costos`; el layout nuevo aplica permisos. */
export default function ExpPreciosProveedorRedirectLayout({ children }: Props) {
  return <>{children}</>;
}
