import type { InformeCompactRow } from "@/lib/informe-variacion/types";

/** Fixture helper: completa m_cur/m_mom/m_yoy si el arreglo viene corto. */
export const r = (...cells: number[]): InformeCompactRow => {
  const next = cells.slice(0, 14);
  while (next.length < 14) next.push(0);
  return next as InformeCompactRow;
};
