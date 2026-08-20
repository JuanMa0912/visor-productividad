export const INFORME_DAY_RANGES = [
  { id: "1-7", label: "1 al 7", fromDay: 1, toDay: 7 },
  { id: "1-14", label: "1 al 14", fromDay: 1, toDay: 14 },
  { id: "8-14", label: "8 al 14", fromDay: 8, toDay: 14 },
  { id: "1-21", label: "1 al 21", fromDay: 1, toDay: 21 },
  { id: "15-21", label: "15 al 21", fromDay: 15, toDay: 21 },
  { id: "1-28", label: "1 al 28", fromDay: 1, toDay: 28 },
  { id: "22-28", label: "22 al 28", fromDay: 22, toDay: 28 },
  { id: "1-eom", label: "1 al fin", fromDay: 1, toDay: null },
] as const;

export type InformeClosedDayRangeId = (typeof INFORME_DAY_RANGES)[number]["id"];

/**
 * Último acumulado Excel 1→C estrictamente anterior a `beforeDay`.
 * Ej.: beforeDay=19 → 1-14. Sirve para armar MTD como corte cerrado + días extra.
 */
export const lastClosedCumulativeInformeRange = (
  beforeDay: number,
): (typeof INFORME_DAY_RANGES)[number] | null => {
  if (!Number.isInteger(beforeDay) || beforeDay < 2) return null;
  const closed = INFORME_DAY_RANGES.filter(
    (range) => range.fromDay === 1 && range.toDay != null && range.toDay < beforeDay,
  );
  if (closed.length === 0) return null;
  return closed.reduce((best, range) =>
    (range.toDay ?? 0) > (best.toDay ?? 0) ? range : best,
  );
};

export const splitInformeRangeAgainstClosedCut = (
  range: InformeDayRangeSpec,
): {
  closed: InformeDayRangeSpec | null;
  leftover: InformeDayRangeSpec | null;
} => {
  const actualToDay = range.projection?.actualToDay ?? range.toDay;
  if (range.fromDay !== 1 || actualToDay == null || actualToDay < 2) {
    return { closed: null, leftover: null };
  }
  const closed = lastClosedCumulativeInformeRange(actualToDay);
  if (!closed || closed.toDay == null) return { closed: null, leftover: null };
  if (closed.toDay >= actualToDay) return { closed: null, leftover: null };
  return {
    closed: { ...closed },
    leftover: {
      id: range.id,
      label: `${closed.toDay + 1} al ${actualToDay}`,
      fromDay: closed.toDay + 1,
      toDay: actualToDay,
    },
  };
};

/**
 * Rango de UN SOLO dia: `d-05` = solo el 5 del mes seleccionado.
 *
 * Se modela como un rango normal con `fromDay === toDay`, asi que
 * `computeInformePeriods` lo resuelve sin logica nueva: el mes anterior y el
 * año pasado salen como ESE MISMO dia del calendario.
 *
 * OJO con la comparacion: el mismo numero de dia cae en dias de semana
 * distintos (5-ago-2026 es miercoles, 5-jul-2026 fue domingo). En retail eso
 * mueve mucho la venta, asi que la UI muestra el dia de la semana junto a cada
 * fecha comparada para que la variacion no se lea como una caida real cuando es
 * efecto calendario. Decision explicita del usuario (2026-08-06).
 */
export type InformeSingleDayRangeId = `d-${string}`;

export type InformeDayRangeId =
  | InformeClosedDayRangeId
  | `proj-${InformeClosedDayRangeId}`
  | InformeSingleDayRangeId
  /** Acumulado preciso 1→N (sin proyectar al siguiente corte Excel). */
  | `mtd-${string}`
  /** Proyección 1→hoy calendario, aunque falten días con datos. */
  | `proj-hoy-${string}`;

export const SINGLE_DAY_RANGE_PREFIX = "d-";
export const MTD_RANGE_PREFIX = "mtd-";
export const HOY_PROJ_PREFIX = "proj-hoy-";

export const isSingleDayInformeRangeId = (rangeId: string): boolean =>
  /^d-\d{1,2}$/.test(rangeId.trim());

export const isMtdInformeRangeId = (rangeId: string): boolean =>
  /^mtd-\d{1,2}$/.test(rangeId.trim());

export const isHoyProjectedInformeRangeId = (rangeId: string): boolean =>
  /^proj-hoy-\d{1,2}$/.test(rangeId.trim());

export const buildSingleDayInformeRangeId = (
  day: number,
): InformeSingleDayRangeId =>
  `${SINGLE_DAY_RANGE_PREFIX}${String(day).padStart(2, "0")}`;

export const buildMtdInformeRangeId = (day: number): `mtd-${string}` =>
  `${MTD_RANGE_PREFIX}${String(day).padStart(2, "0")}`;

/** Numero de dia de un id `d-NN`, o null si no lo es o cae fuera de 1..31. */
export const parseSingleDayInformeRangeId = (
  rangeId: string | null | undefined,
): number | null => {
  if (!rangeId || !isSingleDayInformeRangeId(rangeId)) return null;
  const day = Number(rangeId.trim().slice(SINGLE_DAY_RANGE_PREFIX.length));
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return day;
};

/** Dia N de un id `mtd-NN` (acumulado 1→N), o null si no aplica. */
export const parseMtdInformeRangeId = (
  rangeId: string | null | undefined,
): number | null => {
  if (!rangeId || !isMtdInformeRangeId(rangeId)) return null;
  const day = Number(rangeId.trim().slice(MTD_RANGE_PREFIX.length));
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return day;
};

/** Dia N de un id `proj-hoy-NN`, o null si no aplica. */
export const parseHoyProjectedInformeRangeId = (
  rangeId: string | null | undefined,
): number | null => {
  if (!rangeId || !isHoyProjectedInformeRangeId(rangeId)) return null;
  const day = Number(rangeId.trim().slice(HOY_PROJ_PREFIX.length));
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return day;
};

export const buildHoyProjectedInformeRangeId = (
  day: number,
): `proj-hoy-${string}` =>
  `${HOY_PROJ_PREFIX}${String(day).padStart(2, "0")}`;

/** Acepta YYYYMMDD o YYYY-MM-DD (fecha_dcto::text en PostgreSQL). */
export const normalizeInformeCompactDate = (
  raw: string | null | undefined,
): string | null => {
  if (!raw?.trim()) return null;
  const compact = raw.trim();
  if (/^\d{8}$/.test(compact)) return compact;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(compact);
  if (iso) return `${iso[1]}${iso[2]}${iso[3]}`;
  return null;
};

export type InformeDayRangeProjection = {
  actualToDay: number;
  targetToDay: number;
  factor: number;
  baseId?: InformeClosedDayRangeId | `hoy-${string}`;
};

export type InformeDayRangeSpec = {
  id: InformeDayRangeId;
  label: string;
  fromDay: number;
  toDay: number | null;
  projection?: InformeDayRangeProjection;
};

const DAY_RANGE_BY_ID = new Map(
  INFORME_DAY_RANGES.map((range) => [range.id, range] as const),
);

export const lastDayOfMonth = (year: number, month: number): number =>
  new Date(year, month, 0).getDate();

/** Dia de referencia: hoy (o maxDate en BD) si es el mes en curso; ultimo dia si el mes ya cerro. */
export const resolveInformeReferenceDay = (
  year: number,
  month: number,
  asOf: Date = new Date(),
  maxCompactDate?: string | null,
): number => {
  const monthLast = lastDayOfMonth(year, month);
  const todayYear = asOf.getFullYear();
  const todayMonth = asOf.getMonth() + 1;
  const todayDay = asOf.getDate();

  if (year > todayYear || (year === todayYear && month > todayMonth)) {
    return 0;
  }
  if (year < todayYear || (year === todayYear && month < todayMonth)) {
    return monthLast;
  }

  let ref = todayDay;
  const compactMax = normalizeInformeCompactDate(maxCompactDate);
  if (compactMax) {
    const maxYear = Number(compactMax.slice(0, 4));
    const maxMonth = Number(compactMax.slice(4, 6));
    const maxDay = Number(compactMax.slice(6, 8));
    if (maxYear === year && maxMonth === month) {
      ref = Math.min(ref, maxDay);
    }
  }
  return ref;
};

/**
 * Dia de calendario del mes (hoy si es el mes en curso), sin recortar por
 * maxDate de BD. Sirve para proyectar 1→hoy aunque aún no haya venta esos días.
 */
export const resolveInformeCalendarDay = (
  year: number,
  month: number,
  asOf: Date = new Date(),
): number => {
  const monthLast = lastDayOfMonth(year, month);
  const todayYear = asOf.getFullYear();
  const todayMonth = asOf.getMonth() + 1;
  const todayDay = asOf.getDate();

  if (year > todayYear || (year === todayYear && month > todayMonth)) {
    return 0;
  }
  if (year < todayYear || (year === todayYear && month < todayMonth)) {
    return monthLast;
  }
  return Math.min(todayDay, monthLast);
};

export const isProjectedInformeRangeId = (rangeId: string): boolean =>
  rangeId.startsWith("proj-");

/**
 * Acumulado preciso 1→refDay cuando el mes aún no cierra en un corte Excel.
 * Ej.: refDay=13 → "1 al 13" (MoM/YoY también 1→13). Sin proyección/escala.
 * Si refDay ya es un acumulado Excel cerrado (7, 14, 21, 28, fin), no se agrega.
 */
export const buildPreciseMtdInformeDayRange = (
  year: number,
  month: number,
  asOf: Date = new Date(),
  maxCompactDate?: string | null,
): InformeDayRangeSpec | null => {
  const refDay = resolveInformeReferenceDay(year, month, asOf, maxCompactDate);
  if (refDay < 1) return null;

  const monthLast = lastDayOfMonth(year, month);
  const matchesClosedCumulative = INFORME_DAY_RANGES.some((range) => {
    if (range.fromDay !== 1) return false;
    const endDay = range.toDay ?? monthLast;
    return endDay === refDay;
  });
  if (matchesClosedCumulative) return null;

  return {
    id: buildMtdInformeRangeId(refDay),
    label: `1 al ${refDay}`,
    fromDay: 1,
    toDay: refDay,
  };
};

/**
 * 1→hoy del calendario, proyectando los días con datos. Si hoy es 20 y el
 * roll llega al 14, escala 1→14 hacia 1→20. MoM/YoY comparan 1→20.
 */
export const buildHoyProjectedInformeDayRange = (
  year: number,
  month: number,
  asOf: Date = new Date(),
  maxCompactDate?: string | null,
): InformeDayRangeSpec | null => {
  const calendarDay = resolveInformeCalendarDay(year, month, asOf);
  const dataDay = resolveInformeReferenceDay(year, month, asOf, maxCompactDate);
  if (calendarDay < 2 || dataDay < 1) return null;
  if (calendarDay <= dataDay) return null;

  const factor = calendarDay / dataDay;
  if (!Number.isFinite(factor) || factor <= 1) return null;

  return {
    id: buildHoyProjectedInformeRangeId(calendarDay),
    label: `1 al ${calendarDay} (proyección)`,
    fromDay: 1,
    toDay: calendarDay,
    projection: {
      actualToDay: dataDay,
      targetToDay: calendarDay,
      factor,
      baseId: `hoy-${String(calendarDay).padStart(2, "0")}`,
    },
  };
};

/**
 * @deprecated Preferir `buildPreciseMtdInformeDayRange`. Se mantiene por compat
 * con ids `proj-*` ya cacheados; la UI de cortes vuelve a ofrecer proyección.
 */
export const buildNextProjectedInformeDayRange = (
  year: number,
  month: number,
  asOf: Date = new Date(),
  maxCompactDate?: string | null,
): InformeDayRangeSpec | null => {
  const refDay = resolveInformeReferenceDay(year, month, asOf, maxCompactDate);
  if (refDay < 1) return null;

  const monthLast = lastDayOfMonth(year, month);
  const cumulative = INFORME_DAY_RANGES.filter((range) => range.fromDay === 1);

  for (const range of cumulative) {
    const targetToDay = range.toDay ?? monthLast;
    if (refDay >= targetToDay) continue;
    if (refDay < range.fromDay) continue;

    const actualToDay = refDay;
    const factor = targetToDay / actualToDay;
    if (!Number.isFinite(factor) || factor <= 1) continue;

    return {
      id: `proj-${range.id}`,
      label: `${range.label} (proyección)`,
      fromDay: range.fromDay,
      toDay: targetToDay,
      projection: {
        actualToDay,
        targetToDay,
        factor,
        baseId: range.id,
      },
    };
  }

  return null;
};

/**
 * Cortes Excel ya cerrados (+ acumulado preciso 1→último día con datos si aplica).
 * `includeProjection` (legacy name): si false, solo cortes cerrados.
 * Default true incluye el MTD preciso; ya no agrega `proj-*`.
 * El warm matutino (`informe:warm-snapshot`) usa el default para precargar
 * `mtd-N` del mes en curso cuando el día no cae en 7/14/21/28/fin de mes.
 */
export const getAvailableInformeDayRanges = (
  year: number,
  month: number,
  asOf: Date = new Date(),
  maxCompactDate?: string | null,
  options: { includeProjection?: boolean } = {},
): InformeDayRangeSpec[] => {
  const includeOpenMtd = options.includeProjection !== false;
  const refDay = resolveInformeReferenceDay(year, month, asOf, maxCompactDate);
  if (refDay <= 0) return [];

  const monthLast = lastDayOfMonth(year, month);
  const closed = INFORME_DAY_RANGES.filter((range) => {
    const endDay = range.toDay ?? monthLast;
    return refDay >= endDay;
  }).map((range) => ({ ...range }) as InformeDayRangeSpec);

  if (!includeOpenMtd) return closed;

  const mtd = buildPreciseMtdInformeDayRange(
    year,
    month,
    asOf,
    maxCompactDate,
  );
  if (!mtd) return closed;
  return [...closed, mtd];
};

/** Cortes de la pestaña 2: Excel cerrado + MTD + proyección 1→hoy + siguiente corte. */
export const getInformeCortesDayRanges = (
  year: number,
  month: number,
  asOf: Date = new Date(),
  maxCompactDate?: string | null,
): InformeDayRangeSpec[] => {
  const ranges = getAvailableInformeDayRanges(year, month, asOf, maxCompactDate);
  const hoy = buildHoyProjectedInformeDayRange(
    year,
    month,
    asOf,
    maxCompactDate,
  );
  const nextExcel = buildNextProjectedInformeDayRange(
    year,
    month,
    asOf,
    maxCompactDate,
  );
  const extra: InformeDayRangeSpec[] = [];
  if (hoy) extra.push(hoy);
  if (
    nextExcel &&
    nextExcel.projection?.targetToDay !== hoy?.projection?.targetToDay
  ) {
    extra.push(nextExcel);
  }
  return [
    ...ranges,
    ...extra.filter(
      (range) => !ranges.some((existing) => existing.id === range.id),
    ),
  ];
};

export const defaultInformeDayRangeId = (
  available: readonly InformeDayRangeSpec[],
): InformeDayRangeId | null => {
  if (available.length === 0) return null;
  // Preferir el acumulado preciso 1→N cuando existe (fecha real, no proyección).
  const mtd = available.find((range) => isMtdInformeRangeId(range.id));
  if (mtd) return mtd.id;

  const cumulative = available.filter((range) => range.fromDay === 1);
  const pool = cumulative.length > 0 ? cumulative : available;
  const real = pool.filter((range) => !range.projection);
  const prefer = real.length > 0 ? real : pool;
  return prefer.reduce((best, range) =>
    (range.toDay ?? Number.POSITIVE_INFINITY) >
    (best.toDay ?? Number.POSITIVE_INFINITY)
      ? range
      : best,
  ).id;
};

/**
 * Spec de un dia suelto. Devuelve null si el dia no existe en ese mes (31 de
 * febrero) o si aun no hay datos: `refDay` marca hasta donde esta cargado el mes.
 *
 * A proposito NO entra en `getAvailableInformeDayRanges`: ese listado alimenta el
 * bundle mensual, y en modo dinastia el bundle lanza UNA CONSULTA POR RANGO de
 * forma secuencial. Meter 31 dias ahi serian 31 consultas encadenadas. El dia se
 * resuelve bajo demanda.
 */
export const buildInformeSingleDayRange = (
  year: number,
  month: number,
  day: number,
  asOf: Date = new Date(),
  maxCompactDate?: string | null,
): InformeDayRangeSpec | null => {
  if (!Number.isInteger(day) || day < 1) return null;
  const monthLast = lastDayOfMonth(year, month);
  if (day > monthLast) return null;

  const refDay = resolveInformeReferenceDay(year, month, asOf, maxCompactDate);
  if (refDay < day) return null;

  return {
    id: buildSingleDayInformeRangeId(day),
    label: `Dia ${day}`,
    fromDay: day,
    toDay: day,
  };
};

/** Ultimo dia con datos del mes; null si el mes aun no empieza. Es el dia por defecto. */
export const latestInformeSingleDay = (
  year: number,
  month: number,
  asOf: Date = new Date(),
  maxCompactDate?: string | null,
): number | null => {
  const refDay = resolveInformeReferenceDay(year, month, asOf, maxCompactDate);
  return refDay >= 1 ? Math.min(refDay, lastDayOfMonth(year, month)) : null;
};

export const parseInformeDayRangeId = (
  value: string | null | undefined,
): InformeDayRangeSpec | null => {
  if (!value?.trim()) return null;
  const raw = value.trim();
  const singleDay = parseSingleDayInformeRangeId(raw);
  if (singleDay !== null) {
    return {
      id: raw as InformeDayRangeId,
      label: `Dia ${singleDay}`,
      fromDay: singleDay,
      toDay: singleDay,
    };
  }
  const mtdDay = parseMtdInformeRangeId(raw);
  if (mtdDay !== null) {
    return {
      id: raw as InformeDayRangeId,
      label: `1 al ${mtdDay}`,
      fromDay: 1,
      toDay: mtdDay,
    };
  }
  const hoyDay = parseHoyProjectedInformeRangeId(raw);
  if (hoyDay !== null) {
    return {
      id: raw as InformeDayRangeId,
      label: `1 al ${hoyDay} (proyección)`,
      fromDay: 1,
      toDay: hoyDay,
    };
  }
  if (raw.startsWith("proj-")) {
    const baseId = raw.slice(5) as InformeClosedDayRangeId;
    const found = DAY_RANGE_BY_ID.get(baseId);
    if (!found) return null;
    return {
      id: raw as InformeDayRangeId,
      label: `${found.label} (proyección)`,
      fromDay: found.fromDay,
      toDay: found.toDay,
    };
  }
  const found = DAY_RANGE_BY_ID.get(raw as InformeClosedDayRangeId);
  return found ? { ...found } : null;
};

export const isInformeDayRangeAvailable = (
  rangeId: InformeDayRangeId,
  year: number,
  month: number,
  asOf: Date = new Date(),
  maxCompactDate?: string | null,
): boolean =>
  getInformeCortesDayRanges(year, month, asOf, maxCompactDate).some(
    (range) => range.id === rangeId,
  );

const compactDate = (year: number, month: number, day: number) =>
  `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;

/** El payload mostrado corresponde al mes, rango de dias y periodo anterior. */
export const payloadMatchesInformeSelection = (
  payload: {
    periods: {
      current: { from: string; to: string };
      mom?: { from: string; to: string };
    };
  },
  year: number,
  month: number,
  dayRangeId: InformeDayRangeId | "",
  availableRanges: readonly InformeDayRangeSpec[],
  compare?: { year: number; month: number } | null,
): boolean => {
  const { from, to } = payload.periods.current;
  const payloadYear = Number(from.slice(0, 4));
  const payloadMonth = Number(from.slice(4, 6));
  if (payloadYear !== year || payloadMonth !== month) return false;
  if (compare) {
    const momFrom = payload.periods.mom?.from;
    if (!momFrom) return false;
    const momYear = Number(momFrom.slice(0, 4));
    const momMonth = Number(momFrom.slice(4, 6));
    if (momYear !== compare.year || momMonth !== compare.month) return false;
  }
  if (!dayRangeId) return true;

  // Los dias sueltos y el MTD preciso no siempre viven en `availableRanges`
  // (MTD sí cuando includeOpenMtd; dias sueltos nunca). Resolver aparte.
  const singleDay = parseSingleDayInformeRangeId(dayRangeId);
  if (singleDay !== null) {
    const expected = compactDate(year, month, singleDay);
    return from === expected && to === expected;
  }
  const mtdDay = parseMtdInformeRangeId(dayRangeId);
  if (mtdDay !== null) {
    const expectedFrom = compactDate(year, month, 1);
    const expectedTo = compactDate(year, month, mtdDay);
    return from === expectedFrom && to === expectedTo;
  }
  const hoyDay = parseHoyProjectedInformeRangeId(dayRangeId);
  if (hoyDay !== null) {
    const expectedFrom = compactDate(year, month, 1);
    const expectedTo = compactDate(year, month, hoyDay);
    return from === expectedFrom && to === expectedTo;
  }

  const range = availableRanges.find((entry) => entry.id === dayRangeId);
  if (!range) return true;

  const monthLast = lastDayOfMonth(year, month);
  const expectedFrom = compactDate(year, month, range.fromDay);
  const expectedTo = compactDate(
    year,
    month,
    range.projection?.targetToDay ?? range.toDay ?? monthLast,
  );
  return from === expectedFrom && to === expectedTo;
};
