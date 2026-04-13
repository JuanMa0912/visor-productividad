import { redirect } from "next/navigation";

/** Alias corto: Operación → hub de horarios y turnos (`/horario`). */
export default function HorariosAliasPage() {
  redirect("/horario");
}
