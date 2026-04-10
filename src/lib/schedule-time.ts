/**
 * Normalización de horas para planillas (ingresar horarios / API).
 * Misma lógica en cliente y servidor para que guardar no pierda datos
 * si el usuario no hizo blur en cada celda.
 */

/** Valor final: HH:mm en 24 h (horas 00-23, minutos 00-59) o "" */
export function normalizeScheduleTime(raw: string): string {
  const t = raw.trim();
  if (!t) return "";

  const sec = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(t);
  if (sec) {
    return normalizeScheduleTime(`${sec[1]}:${sec[2]}`);
  }

  const colon = /^(\d{1,2}):(\d{1,2})$/.exec(t);
  if (colon) {
    const h = Number(colon[1]);
    const m = Number(colon[2]);
    if (
      Number.isFinite(h) &&
      Number.isFinite(m) &&
      h >= 0 &&
      h <= 23 &&
      m >= 0 &&
      m <= 59
    ) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
    return "";
  }

  const leadingMin = /^:(\d{1,2})$/.exec(t);
  if (leadingMin) {
    const m = Number(leadingMin[1]);
    if (Number.isFinite(m) && m >= 0 && m <= 59) {
      return `00:${String(m).padStart(2, "0")}`;
    }
    return "";
  }

  const d = t.replace(/\D/g, "");
  if (d.length === 4) {
    const h = Number(d.slice(0, 2));
    const m = Number(d.slice(2));
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${d.slice(0, 2)}:${d.slice(2)}`;
    }
    return "";
  }
  if (d.length === 3) {
    const h = Number(d.slice(0, 1));
    const m = Number(d.slice(1));
    if (h >= 0 && h <= 9 && m >= 0 && m <= 59) {
      return `0${h}:${String(m).padStart(2, "0")}`;
    }
    return "";
  }
  if (d.length === 1 || d.length === 2) {
    const h = Number(d);
    if (Number.isFinite(h) && h >= 0 && h <= 23) {
      return `${String(h).padStart(2, "0")}:00`;
    }
  }
  return "";
}

/** Para columnas `time` en PostgreSQL (HH:MM:SS). */
export function scheduleTimeToPostgresParam(value?: string): string | null {
  const n = normalizeScheduleTime((value ?? "").trim());
  return n ? `${n}:00` : null;
}

type DayLike = {
  he1?: string;
  hs1?: string;
  he2?: string;
  hs2?: string;
  conDescanso?: boolean;
};

/** Normaliza todas las horas de cada fila antes de enviar al API. */
export function normalizeScheduleRowsForSave<
  R extends { days: Record<string, DayLike> },
>(rows: R[]): R[] {
  return rows.map((row) => ({
    ...row,
    days: Object.fromEntries(
      Object.entries(row.days).map(([dayKey, day]) => [
        dayKey,
        {
          ...day,
          he1: normalizeScheduleTime(day.he1 ?? ""),
          hs1: normalizeScheduleTime(day.hs1 ?? ""),
          he2: normalizeScheduleTime(day.he2 ?? ""),
          hs2: normalizeScheduleTime(day.hs2 ?? ""),
        },
      ]),
    ),
  })) as R[];
}
