import { redirect } from "next/navigation";

/** URL anterior del tablero; ahora vive en `/costos`. */
export default function ExpPreciosProveedorRedirectPage() {
  redirect("/costos");
}
