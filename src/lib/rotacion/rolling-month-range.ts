export type RollingMonthDateRange = {
  start: string;
  end: string;
};

const parseDateKey = (dateKey: string) => new Date(`${dateKey}T12:00:00`);

const toDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const clampDateKeyToBounds = (key: string, min: string, max: string) => {
  if (key < min) return min;
  if (key > max) return max;
  return key;
};

/**
 * Rango por defecto del modulo rotacion (mes calendario anterior anclado al ultimo
 * dato disponible). Debe coincidir con el periodo del snapshot
 * `rotacion_item_periodo_std` y con la UI (`rotacion-preamble`).
 */
export const getRollingMonthBackRange = (
  minAvailable: string,
  maxAvailable: string,
  referenceDate: Date = new Date(),
): RollingMonthDateRange => {
  const daysInPrevMonth = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    0,
  ).getDate();

  const endKey = clampDateKeyToBounds(
    maxAvailable,
    minAvailable,
    maxAvailable,
  );
  const startDate = parseDateKey(endKey);
  startDate.setDate(startDate.getDate() - (daysInPrevMonth - 1));
  let startKey = clampDateKeyToBounds(
    toDateKey(startDate),
    minAvailable,
    maxAvailable,
  );
  if (startKey > endKey) {
    startKey = endKey;
  }
  return { start: startKey, end: endKey };
};
