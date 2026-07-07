import type { InformeCompactRow, InformeVariacionPayload } from "@/lib/informe-variacion/types";

/** Multiplicador estable 1 ± spread a partir de indices de fila. */
export const mockInformeComparisonMultiplier = (
  parts: readonly number[],
  salt: string,
  spread: number,
): number => {
  let hash = 0;
  const key = `${parts.join(":")}:${salt}`;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  const unit = (hash % 10_000) / 10_000;
  return 1 + (unit - 0.5) * 2 * spread;
};

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

/**
 * Rellena u/v de MoM y YoY cuando vienen en cero pero el periodo actual tiene venta.
 * Los factores son deterministicos por fila para que recargas den el mismo patron.
 */
export const applyInformeMockComparisonBases = (
  payload: InformeVariacionPayload,
): InformeVariacionPayload => {
  const yoyTotals = new Array(payload.sedes.length).fill(0);

  const rows = payload.rows.map((row) => {
    const key = [row[0], row[1], row[2], row[3], row[4]] as const;
    const momFactor = mockInformeComparisonMultiplier(key, "mom", 0.1);
    const yoyFactor = mockInformeComparisonMultiplier(key, "yoy", 0.22);

    const uCur = row[5];
    let uMom = row[6];
    let uYoy = row[7];
    const vCur = row[8];
    let vMom = row[9];
    let vYoy = row[10];

    if (uMom === 0 && uCur > 0) {
      uMom = Math.max(0.01, uCur / momFactor);
    }
    if (uYoy === 0 && uCur > 0) {
      uYoy = Math.max(0.01, uCur / yoyFactor);
    }
    if (vMom === 0 && vCur > 0) {
      vMom = Math.max(1, vCur / momFactor);
    }
    if (vYoy === 0 && vCur > 0) {
      vYoy = Math.max(1, vCur / yoyFactor);
    }

    yoyTotals[row[0]] += vYoy;

    return [row[0], row[1], row[2], row[3], row[4], uCur, uMom, uYoy, vCur, vMom, vYoy] as InformeCompactRow;
  });

  const sedes = payload.sedes.map((sede, index) => ({
    ...sede,
    yoyOk: yoyTotals[index] > 0,
  }));

  return {
    ...payload,
    sedes,
    rows,
    meta: {
      ...payload.meta,
      mockBases: true,
      comparisonAvailable: true,
    },
  };
};

export const resolveInformeMockBasesEnabled = (
  mockParam: string | null,
): boolean => {
  if (mockParam === "1" || mockParam === "true") return true;
  if (mockParam === "0" || mockParam === "false") return false;
  return process.env.INFORME_VARIACION_MOCK_BASES?.trim().toLowerCase() === "true";
};
