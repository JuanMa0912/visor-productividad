import type { InformeCompactRow } from "@/lib/informe-variacion/types";

/** True si hay al menos un valor no cero en periodos MoM/YoY (u o v). */
export const informePayloadHasComparisonData = (
  rows: InformeCompactRow[],
): boolean => {
  for (const row of rows) {
    if (row[6] !== 0 || row[7] !== 0 || row[9] !== 0 || row[10] !== 0) {
      return true;
    }
  }
  return false;
};
