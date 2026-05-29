import type { CashierAttendanceShiftMarks } from "@/lib/hourly/cashier-slot-labor";
import { formatShiftMarksLabel } from "./cashier-utils";

/**
 * Linea compacta con las marcas de asistencia del dia, mismo formato que el
 * usado debajo de cada fecha en el detalle por rango (p. ej.
 * "Marcas 07:30-12:34 / 16:31-20:08"). Si no hay marcas utiles, no pinta nada.
 */
export const CashierShiftMarks = ({
  shift,
}: {
  shift: CashierAttendanceShiftMarks | null | undefined;
}) => {
  const marksLabel = formatShiftMarksLabel(shift);
  if (!marksLabel) return null;
  return (
    <p className="px-2 pb-1 text-[10px] font-medium text-(--cashier-muted)/80">
      {marksLabel}
    </p>
  );
};
