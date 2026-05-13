import type { ReactNode } from "react";

/**
 * Esta ruta fuerza apariencia clara aunque el resto del portal use .dark,
 * para que fondos y componentes shadcn sigan leyendo variables "light".
 */
export default function ExcelDianLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="excel-dian-light min-h-screen w-full bg-[#F8FAFC] text-slate-900"
      style={{ colorScheme: "light" }}
    >
      {children}
    </div>
  );
}
