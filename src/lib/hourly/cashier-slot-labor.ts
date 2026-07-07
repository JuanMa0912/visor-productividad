/** Marcas de asistencia para calcular minutos laborados dentro de cada franja horaria. */
export type CashierAttendanceShiftMarks = {
  markInMinute: number | null;
  markOutMinute: number | null;
  break1Minute: number | null;
  break2Minute: number | null;
};

const intervalOverlapMinutes = (
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number => {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return Math.max(0, end - start);
};

const isMinuteInBreak = (
  minuteOfDay: number,
  break1: number | null,
  break2: number | null,
) => {
  if (break1 === null || break2 === null) return false;
  if (break1 <= break2) {
    return minuteOfDay >= break1 && minuteOfDay < break2;
  }
  return minuteOfDay >= break1 || minuteOfDay < break2;
};

const isMinuteInShift = (
  minuteOfDay: number,
  entry: number,
  exit: number,
) => {
  if (entry <= exit) {
    return minuteOfDay >= entry && minuteOfDay <= exit;
  }
  return minuteOfDay >= entry || minuteOfDay <= exit;
};

/**
 * Minutos laborados dentro de una franja [slotStart, slotStart + bucketMinutes),
 * usando entrada/salida/descansos. Sin marcas validas devuelve 0.
 */
export const computeSlotWorkedMinutes = (
  slotStartMinute: number,
  bucketMinutes: number,
  shift: CashierAttendanceShiftMarks | null | undefined,
): number => {
  if (!Number.isFinite(bucketMinutes) || bucketMinutes <= 0) return 0;
  if (!shift) return 0;

  const entry = shift.markInMinute;
  const exit = shift.markOutMinute;
  if (entry === null || exit === null) return 0;

  const slotEnd = slotStartMinute + bucketMinutes;

  if (entry <= exit) {
    if (slotEnd <= entry || slotStartMinute >= exit) return 0;
    const effectiveStart = Math.max(slotStartMinute, entry);
    const effectiveEnd = Math.min(slotEnd, exit);
    let worked = effectiveEnd - effectiveStart;
    const { break1Minute: break1, break2Minute: break2 } = shift;
    if (break1 !== null && break2 !== null && break1 < break2) {
      worked -= intervalOverlapMinutes(
        effectiveStart,
        effectiveEnd,
        break1,
        break2,
      );
    }
    return worked > 0 ? worked : 0;
  }

  let worked = 0;
  for (let minute = slotStartMinute; minute < slotEnd && minute < 1440; minute++) {
    if (!isMinuteInShift(minute, entry, exit)) continue;
    if (isMinuteInBreak(minute, shift.break1Minute, shift.break2Minute)) continue;
    worked++;
  }
  return worked > 0 ? worked : 0;
};

export const getCashierSlotLaborHours = (
  slotStartMinute: number,
  bucketMinutes: number,
  shift: CashierAttendanceShiftMarks | null | undefined,
): number => {
  const minutes = computeSlotWorkedMinutes(
    slotStartMinute,
    bucketMinutes,
    shift,
  );
  return minutes / 60;
};
