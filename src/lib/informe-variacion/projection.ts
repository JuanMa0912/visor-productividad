import type {
  InformeCompactRow,
  InformeVariacionPayload,
} from "@/lib/informe-variacion/types";
import { formatInformePeriodLabel, toCompactDate } from "@/lib/informe-variacion/periods";
import type { InformeDayRangeSpec } from "@/lib/informe-variacion/day-ranges";

/** Indices compactos del periodo actual: u_cur, v_cur, m_cur. */
const CURRENT_METRIC_INDEXES = [5, 8, 11] as const;

export const scaleInformePayloadCurrentPeriod = (
  payload: InformeVariacionPayload,
  factor: number,
): InformeVariacionPayload => {
  if (!Number.isFinite(factor) || factor === 1) return payload;
  const rows = payload.rows.map((row) => {
    const next = [...row] as InformeCompactRow;
    for (const index of CURRENT_METRIC_INDEXES) {
      next[index] = next[index] * factor;
    }
    return next;
  });
  return { ...payload, rows };
};

/**
 * Tras escalar: el periodo current se muestra como el corte meta (1→7),
 * aunque el SQL haya usado solo hasta actualToDay.
 */
export const applyInformeProjectionDisplayPeriods = (
  payload: InformeVariacionPayload,
  year: number,
  month: number,
  dayRange: InformeDayRangeSpec,
): InformeVariacionPayload => {
  const projection = dayRange.projection;
  if (!projection) return payload;

  const from = toCompactDate(year, month, dayRange.fromDay);
  const to = toCompactDate(year, month, projection.targetToDay);
  return {
    ...payload,
    periods: {
      ...payload.periods,
      current: {
        from,
        to,
        label: `${formatInformePeriodLabel(from, to)} · proyección`,
      },
    },
  };
};

export const applyInformeDayRangeProjection = (
  payload: InformeVariacionPayload,
  year: number,
  month: number,
  dayRange: InformeDayRangeSpec | null | undefined,
): InformeVariacionPayload => {
  if (!dayRange?.projection) return payload;
  const scaled = scaleInformePayloadCurrentPeriod(
    payload,
    dayRange.projection.factor,
  );
  return applyInformeProjectionDisplayPeriods(scaled, year, month, dayRange);
};
