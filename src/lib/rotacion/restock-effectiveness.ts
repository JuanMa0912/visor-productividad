/**
 * Efectividad de restock (0–100).
 *
 * Denominador: ítems de la sede con al menos una marca a `surtido` en contexto
 * `restock` cuya **primera** marca cae dentro del rango del correo.
 * Numerador: de esos, cuántos tuvieron venta (unidades > 0) en o después de
 * esa fecha y hasta el fin del rango.
 *
 * No usa la cohorte S actual (sin venta en el periodo): mediría ~0 por definición.
 *
 * Las consultas SQL viven en `server/query-restock-effectiveness.ts` para no
 * arrastrar `pg` a Client Components.
 */
export type RestockEffectivenessScore = {
  score: number | null;
  markedSurtidoCount: number;
  soldAfterCount: number;
  /** true si faltó tabla/matview o la consulta falló de forma recuperable. */
  unavailable: boolean;
};

export const emptyRestockEffectivenessScore = (
  unavailable = false,
): RestockEffectivenessScore => ({
  // Sin datos de sistema → null. Sin marcas en el periodo → 0 (no “inexistente”).
  score: unavailable ? null : 0,
  markedSurtidoCount: 0,
  soldAfterCount: 0,
  unavailable,
});

export const computeRestockEffectivenessScore = (
  markedSurtidoCount: number,
  soldAfterCount: number,
): RestockEffectivenessScore => {
  const marked = Math.max(0, Math.floor(markedSurtidoCount));
  const sold = Math.max(0, Math.min(marked, Math.floor(soldAfterCount)));
  if (marked === 0) {
    return {
      score: 0,
      markedSurtidoCount: 0,
      soldAfterCount: 0,
      unavailable: false,
    };
  }
  return {
    score: Math.round((100 * sold) / marked),
    markedSurtidoCount: marked,
    soldAfterCount: sold,
    unavailable: false,
  };
};
