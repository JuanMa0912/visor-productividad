export type VentasXItemDateRangeRequiredError = {
  code: "DATE_RANGE_REQUIRED";
  error: string;
};

export type VentasXItemDateNotFoundError = {
  code: "DATE_NOT_FOUND";
  error: string;
  requestedStart: string;
  requestedEnd: string;
  availableStart: string | null;
  availableEnd: string | null;
  missingBoundary: "start" | "end" | "both";
};

type DbLikeClient = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows?: Array<Record<string, unknown>> }>;
};

type DateAvailabilityRow = {
  min_fecha: string | null;
  max_fecha: string | null;
  total_rows: string | number | null;
  has_start: boolean | null;
  has_end: boolean | null;
};

export type VentasXItemDateAvailability = {
  minCompactDate: string | null;
  maxCompactDate: string | null;
  minDate: string | null;
  maxDate: string | null;
  totalRows: number;
  hasStart: boolean;
  hasEnd: boolean;
};

export type VentasXItemDateRangeValidationResult =
  | {
      ok: true;
      start: string;
      end: string;
      startCompact: string;
      endCompact: string;
    }
  | {
      ok: false;
      error: VentasXItemDateRangeRequiredError | { error: string };
    };

type DateAvailabilityFilter = {
  whereClauses?: string[];
  params?: unknown[];
};

export const isIsoDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export const isoDateToCompactDate = (value: string) => value.replace(/-/g, "");

export const compactDateToIsoDate = (value: string | null | undefined) => {
  const normalized = String(value ?? "").trim();
  if (!/^\d{8}$/.test(normalized)) return null;
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
};

export const buildDateRangeRequiredError =
  (): VentasXItemDateRangeRequiredError => ({
    code: "DATE_RANGE_REQUIRED",
    error: "Debes enviar start y end.",
  });

export const validateVentasXItemDateRange = (
  start: string | null,
  end: string | null,
): VentasXItemDateRangeValidationResult => {
  if (!start || !end) {
    return { ok: false, error: buildDateRangeRequiredError() };
  }
  if (!isIsoDateKey(start)) {
    return {
      ok: false,
      error: { error: "Formato de start invalido. Use YYYY-MM-DD." },
    };
  }
  if (!isIsoDateKey(end)) {
    return {
      ok: false,
      error: { error: "Formato de end invalido. Use YYYY-MM-DD." },
    };
  }
  if (start > end) {
    return {
      ok: false,
      error: { error: "start no puede ser mayor que end." },
    };
  }
  return {
    ok: true,
    start,
    end,
    startCompact: isoDateToCompactDate(start),
    endCompact: isoDateToCompactDate(end),
  };
};

export const resolveMissingBoundary = (hasStart: boolean, hasEnd: boolean) => {
  if (!hasStart && !hasEnd) return "both" as const;
  if (!hasStart) return "start" as const;
  if (!hasEnd) return "end" as const;
  return null;
};

export const buildDateNotFoundError = (
  availability: Pick<
    VentasXItemDateAvailability,
    "minDate" | "maxDate" | "hasStart" | "hasEnd"
  >,
  requestedStart: string,
  requestedEnd: string,
): VentasXItemDateNotFoundError | null => {
  const missingBoundary = resolveMissingBoundary(
    availability.hasStart,
    availability.hasEnd,
  );
  if (!missingBoundary) return null;

  let error = "La fecha solicitada no se encontro en la base de datos.";
  if (missingBoundary === "start") {
    error = `La fecha inicial ${requestedStart} no se encontro en la base de datos.`;
  } else if (missingBoundary === "end") {
    error = `La fecha final ${requestedEnd} no se encontro en la base de datos.`;
  } else if (missingBoundary === "both") {
    error =
      `Las fechas ${requestedStart} y ${requestedEnd} no se encontraron en la base de datos.`;
  }

  return {
    code: "DATE_NOT_FOUND",
    error,
    requestedStart,
    requestedEnd,
    availableStart: availability.minDate,
    availableEnd: availability.maxDate,
    missingBoundary,
  };
};

export const getVentasXItemDateAvailability = async (
  client: DbLikeClient,
  filter: DateAvailabilityFilter = {},
  requestedRange?: { startCompact: string; endCompact: string },
): Promise<VentasXItemDateAvailability> => {
  const params = [...(filter.params ?? [])];
  let hasStartSql = "FALSE";
  let hasEndSql = "FALSE";

  if (requestedRange) {
    params.push(requestedRange.startCompact);
    const startParamIndex = params.length;
    hasStartSql = `COUNT(*) FILTER (WHERE fecha_dcto = $${startParamIndex}) > 0`;

    params.push(requestedRange.endCompact);
    const endParamIndex = params.length;
    hasEndSql = `COUNT(*) FILTER (WHERE fecha_dcto = $${endParamIndex}) > 0`;
  }

  const whereSql =
    (filter.whereClauses?.length ?? 0) > 0
      ? `WHERE ${filter.whereClauses?.join(" AND ")}`
      : "";

  const result = await client.query(
    `
    SELECT
      MIN(fecha_dcto)::text AS min_fecha,
      MAX(fecha_dcto)::text AS max_fecha,
      COUNT(*) AS total_rows,
      ${hasStartSql} AS has_start,
      ${hasEndSql} AS has_end
    FROM ventas_item_diario
    ${whereSql}
    `,
    params,
  );

  const row = (result.rows?.[0] ?? null) as DateAvailabilityRow | null;
  const minCompactDate = row?.min_fecha ?? null;
  const maxCompactDate = row?.max_fecha ?? null;

  return {
    minCompactDate,
    maxCompactDate,
    minDate: compactDateToIsoDate(minCompactDate),
    maxDate: compactDateToIsoDate(maxCompactDate),
    totalRows: Number(row?.total_rows ?? 0),
    hasStart: Boolean(row?.has_start),
    hasEnd: Boolean(row?.has_end),
  };
};
