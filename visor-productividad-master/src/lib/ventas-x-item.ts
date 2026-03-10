export const SEDE_MAP: Record<string, Record<string, string>> = {
  mercamio: {
    "001": "La 5",
    "002": "La 39",
    "003": "Plaza",
    "004": "Jardin",
    "005": "C.sur",
    "006": "Palmira",
  },
  mtodo: {
    "001": "Floresta",
    "002": "Floralia",
    "003": "Guaduales",
  },
  bogota: {
    "001": "La 80",
    "002": "Chia",
  },
};

export const PREFERRED_ORDER: Record<string, string[]> = {
  mercamio: ["La 5", "La 39", "Plaza", "Jardin", "C.sur", "Palmira"],
  mtodo: ["Floresta", "Floralia", "Guaduales"],
  bogota: ["La 80", "Chia"],
};

const DOW_ABBR_ES: Record<number, string> = {
  0: "lun",
  1: "mar",
  2: "mie",
  3: "jue",
  4: "vie",
  5: "sab",
  6: "dom",
};

const REQUIRED_COLUMNS = [
  "empresa",
  "fecha_dcto",
  "id_co",
  "id_item",
  "descripcion",
  "linea",
  "und_dia",
  "venta_sin_impuesto_dia",
  "und_acum",
  "venta_sin_impuesto_acum",
] as const;

type RequiredColumn = (typeof REQUIRED_COLUMNS)[number];

export type VentasXItemRawRow = Record<string, unknown>;

export type VentasXItemPreparedRow = {
  empresa: string;
  fecha_dcto: string;
  id_co: string;
  id_item: string;
  descripcion: string;
  linea: string;
  und_dia: number;
  venta_sin_impuesto_dia: number;
  und_acum: number;
  venta_sin_impuesto_acum: number;
  empresa_norm: string;
  id_co_norm: string;
  sede: string;
  fecha: Date | null;
};

export type DailyTableCell = string | number;
export type DailyTableRow = Record<string, DailyTableCell>;

const stripAccents = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export const normalizeEmpresa = (value: string) => {
  const base = stripAccents((value ?? "").trim().toLowerCase());
  if (base === "mtodo" || base === "m.t" || base === "m_todo") {
    return "mtodo";
  }
  return base;
};

export const normalizeIdCo = (value: unknown) => {
  const raw = String(value ?? "").trim();
  const asNumber = Number.parseInt(raw, 10);
  if (Number.isFinite(asNumber)) {
    return String(asNumber).padStart(3, "0");
  }
  if (raw.length >= 3 && /^\d{3}/.test(raw)) {
    return raw.slice(0, 3);
  }
  if (/^\d+$/.test(raw)) {
    return raw.padStart(3, "0");
  }
  return raw;
};

export const mapSede = (empresa: string, idCo: string) => {
  const emp = normalizeEmpresa(empresa);
  const idNorm = normalizeIdCo(idCo);
  const mapping = SEDE_MAP[emp] ?? {};
  return mapping[idNorm] ?? idNorm;
};

const parseFechaValue = (value: unknown): Date | null => {
  const compact = String(value ?? "")
    .replace(/\.0$/, "")
    .replace(/-/g, "");
  if (!/^\d{8}$/.test(compact)) return null;
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeDay = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const dayKey = (date: Date) => normalizeDay(date).toISOString().slice(0, 10);

const daysInRange = (start: Date, end: Date) => {
  const from = normalizeDay(start);
  const to = normalizeDay(end);
  const out: Date[] = [];
  for (
    let cursor = from;
    cursor.getTime() <= to.getTime();
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
  ) {
    out.push(cursor);
  }
  return out;
};

const fmtNumber = (value: number): number | "-" => {
  if (!Number.isFinite(value)) return "-";
  const roundedInt = Math.trunc(value);
  if (Math.abs(value - roundedInt) < 1e-9) {
    if (roundedInt === 0) return "-";
    return roundedInt;
  }
  return Math.round(value * 10) / 10;
};

export const prepareDataframe = (
  rawRows: VentasXItemRawRow[],
): VentasXItemPreparedRow[] => {
  const missing = REQUIRED_COLUMNS.filter((column) =>
    rawRows.some((row) => !(column in row)),
  );
  if (missing.length > 0) {
    throw new Error(`Faltan columnas en el CSV: ${missing.join(", ")}`);
  }

  return rawRows.map((row) => {
    const empresa = String(row.empresa ?? "");
    const idCo = String(row.id_co ?? "");
    return {
      empresa,
      fecha_dcto: String(row.fecha_dcto ?? ""),
      id_co: idCo,
      id_item: String(row.id_item ?? ""),
      descripcion: String(row.descripcion ?? "").trim(),
      linea: String(row.linea ?? ""),
      und_dia: toNumber(row.und_dia),
      venta_sin_impuesto_dia: toNumber(row.venta_sin_impuesto_dia),
      und_acum: toNumber(row.und_acum),
      venta_sin_impuesto_acum: toNumber(row.venta_sin_impuesto_acum),
      empresa_norm: normalizeEmpresa(empresa),
      id_co_norm: normalizeIdCo(idCo),
      sede: mapSede(empresa, idCo),
      fecha: parseFechaValue(row.fecha_dcto),
    };
  });
};

export const itemsDisplayList = (rows: VentasXItemPreparedRow[]) => {
  const values = new Set<string>();
  rows.forEach((row) => {
    const text = `${String(row.id_item)} - ${String(row.descripcion)}`.trim();
    if (text) values.add(text);
  });
  return Array.from(values).sort((a, b) => a.localeCompare(b, "es"));
};

export const buildNumericPivotRange = (
  rows: VentasXItemPreparedRow[],
  start: Date,
  end: Date,
) => {
  const days = daysInRange(start, end);
  const fromTs = normalizeDay(start).getTime();
  const toTs = normalizeDay(end).getTime();

  const filtered = rows.filter((row) => {
    if (!row.fecha) return false;
    const ts = normalizeDay(row.fecha).getTime();
    return ts >= fromTs && ts <= toTs;
  });

  const sedeSet = new Set(filtered.map((row) => row.sede).filter(Boolean));
  const preferredAll: string[] = [];
  (["mercamio", "mtodo", "bogota"] as const).forEach((emp) => {
    (PREFERRED_ORDER[emp] ?? []).forEach((sede) => {
      if (sedeSet.has(sede) && !preferredAll.includes(sede)) preferredAll.push(sede);
    });
  });
  Array.from(sedeSet)
    .filter((sede) => !preferredAll.includes(sede))
    .sort((a, b) => a.localeCompare(b, "es"))
    .forEach((sede) => preferredAll.push(sede));

  const byDayAndSede = new Map<string, Map<string, number>>();
  filtered.forEach((row) => {
    if (!row.fecha) return;
    const dk = dayKey(row.fecha);
    if (!byDayAndSede.has(dk)) byDayAndSede.set(dk, new Map());
    const sedeMap = byDayAndSede.get(dk)!;
    sedeMap.set(row.sede, (sedeMap.get(row.sede) ?? 0) + row.und_dia);
  });

  const numericRows = days.map((day) => {
    const dk = dayKey(day);
    const sedeValues = byDayAndSede.get(dk) ?? new Map<string, number>();
    const values: Record<string, number> = {};
    preferredAll.forEach((sede) => {
      values[sede] = sedeValues.get(sede) ?? 0;
    });
    values["T. Dia"] = Object.values(values).reduce((sum, val) => sum + val, 0);
    return {
      fecha: day,
      values,
    };
  });

  return {
    columns: [...preferredAll, "T. Dia"],
    rows: numericRows,
  };
};

export const buildDailyTableAllRange = (
  rows: VentasXItemPreparedRow[],
  start: Date,
  end: Date,
  footerLabel = "Acum. Rango:",
): DailyTableRow[] => {
  const pivot = buildNumericPivotRange(rows, start, end);
  const hasData = rows.some((row) => row.fecha !== null);
  const columns = hasData ? pivot.columns : ["T. Dia"];
  const table: DailyTableRow[] = pivot.rows.map(({ fecha, values }) => {
    const dt = normalizeDay(fecha);
    const weekday = DOW_ABBR_ES[(dt.getUTCDay() + 6) % 7] ?? "";
    const current: DailyTableRow = {
      Fecha: `${dt.getUTCDate()}/${weekday}`,
    };
    columns.forEach((column) => {
      current[column] = fmtNumber(values[column] ?? 0);
    });
    return current;
  });

  const footer: DailyTableRow = { Fecha: footerLabel };
  columns.forEach((column) => {
    const total = pivot.rows.reduce((sum, row) => sum + (row.values[column] ?? 0), 0);
    footer[column] = fmtNumber(total);
  });
  table.push(footer);

  return table;
};

export const hasRequiredVentasXItemColumns = (row: VentasXItemRawRow) =>
  REQUIRED_COLUMNS.every((column: RequiredColumn) => column in row);
