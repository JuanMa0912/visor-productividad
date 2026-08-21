import { PROVEEDORES_VISITAS_TZ } from "@/lib/proveedores/board-filters";
import { visitaEntradaIsoDateBogota } from "@/lib/proveedores/visitas-scope";

/** Cierre operativo de jornada en sede (America/Bogota). */
export const QR_VISITA_CIERRE_HOUR = 21;
export const QR_VISITA_CIERRE_MIN_MINUTES = 15;

/**
 * Salida imputada si no marcaron QR de salida el mismo día:
 * 21:00 Bogotá del día de entrada, o 15 min después de entrar si ya era noche.
 */
export const visitaJornadaCierreAt = (entrada: Date): Date => {
  const dia = visitaEntradaIsoDateBogota(entrada.toISOString());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return entrada;
  const cierre = new Date(
    `${dia}T${String(QR_VISITA_CIERRE_HOUR).padStart(2, "0")}:00:00-05:00`,
  );
  const minimo = new Date(
    entrada.getTime() + QR_VISITA_CIERRE_MIN_MINUTES * 60_000,
  );
  return cierre.getTime() > minimo.getTime() ? cierre : minimo;
};

/** SQL: instante de cierre de jornada para `entrada_at` (timestamptz). */
export const qrVisitaCierreJornadaSql = (entradaExpr: string) =>
  `GREATEST(
     ${entradaExpr} + interval '${QR_VISITA_CIERRE_MIN_MINUTES} minutes',
     (timezone('${PROVEEDORES_VISITAS_TZ}', ${entradaExpr})::date + time '${String(QR_VISITA_CIERRE_HOUR).padStart(2, "0")}:00')
       AT TIME ZONE '${PROVEEDORES_VISITAS_TZ}'
   )`;
