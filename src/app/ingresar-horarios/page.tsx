import { Suspense } from "react";
import { IngresarHorariosInner } from "./ingresar-horarios-inner";
import { AppTopBar } from "@/components/portal/app-top-bar";

export default function IngresarHorariosPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-slate-600">
          Cargando planilla...
        </div>
      }
    >
      <AppTopBar backHref="/horario" backLabel="Volver a horario" />
      <IngresarHorariosInner />
    </Suspense>
  );
}
