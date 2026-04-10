import { Suspense } from "react";
import { IngresarHorariosInner } from "./ingresar-horarios-inner";

export default function IngresarHorariosPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-slate-600">
          Cargando planilla...
        </div>
      }
    >
      <IngresarHorariosInner />
    </Suspense>
  );
}
