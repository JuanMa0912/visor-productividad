import type { PoolClient } from "pg";
import {
  MARGEN_ITEM_DIA_ROLL_TABLE,
  resolveInformeMargenDataSource,
} from "@/lib/margenes/margen-data-source";
import type { InformeDayRangeSpec } from "@/lib/informe-variacion/day-ranges";
import { lastDayOfMonth } from "@/lib/informe-variacion/day-ranges";
import { computeInformePeriods, toCompactDate } from "@/lib/informe-variacion/periods";
import {
  buildInformeVariacionPayload,
  type InformeDbAggRow,
} from "@/lib/informe-variacion/query";
import type { InformeVariacionPayload } from "@/lib/informe-variacion/types";

export type InformeDailyDbRow = {
  fecha_dcto: string;
  empresa: string;
  id_co: string;
  id_tipo: string;
  id_linea1: string;
  nombre_linea1: string;
  id_linea2: string;
  nombre_linea2: string;
  id_item: string;
  item_descripcion: string;
  cantidad: string | number;
  ventas_netas: string | number;
};

const toNum = (value: string | number | null | undefined) =>
  Number(value ?? 0) || 0;

const itemKey = (row: InformeDailyDbRow) =>
  [
    row.empresa,
    row.id_co,
    row.id_tipo,
    row.id_linea1,
    row.id_linea2,
    row.id_item,
  ].join("\u0001");

const monthFullBounds = (year: number, month: number) => {
  const last = lastDayOfMonth(year, month);
  return {
    from: toCompactDate(year, month, 1),
    to: toCompactDate(year, month, last),
  };
};

type PeriodKind = "cur" | "mom" | "yoy";

const resolvePeriodKind = (
  fecha: string,
  year: number,
  month: number,
): PeriodKind | null => {
  if (!/^\d{8}$/.test(fecha)) return null;
  const y = Number(fecha.slice(0, 4));
  const m = Number(fecha.slice(4, 6));
  const momMonth = month === 1 ? 12 : month - 1;
  const momYear = month === 1 ? year - 1 : year;
  if (y === year && m === month) return "cur";
  if (y === momYear && m === momMonth) return "mom";
  if (y === year - 1 && m === month) return "yoy";
  return null;
};

const dayInRange = (
  day: number,
  fromDay: number,
  toDay: number | null,
  monthLast: number,
): boolean => {
  const end = toDay ?? monthLast;
  return day >= fromDay && day <= Math.min(end, monthLast);
};

const buildSedeFilterDaily = (
  allowedSedeKeys: string[] | null,
  params: Array<string | string[]>,
): string => {
  if (!allowedSedeKeys || allowedSedeKeys.length === 0) return "";

  const pairs = allowedSedeKeys
    .map((key) => {
      const [empresa, idCo] = key.split("|");
      if (!empresa || !idCo) return null;
      return { empresa: empresa.toLowerCase(), idCo: idCo.padStart(3, "0") };
    })
    .filter((pair): pair is { empresa: string; idCo: string } => pair !== null);

  if (pairs.length === 0) return "";

  params.push(
    pairs.map((pair) => pair.empresa),
    pairs.map((pair) => pair.idCo),
  );
  const empresaParam = 6 + params.length - 1;
  const coParam = 6 + params.length;

  return `AND (empresa_norm, id_co_norm) IN (
    SELECT * FROM UNNEST($${empresaParam}::text[], $${coParam}::text[]) AS t(empresa_norm, id_co_norm)
  )`;
};

export const queryInformeDailyRows = async (
  client: PoolClient,
  year: number,
  month: number,
  allowedSedeKeys: string[] | null,
): Promise<InformeDailyDbRow[]> => {
  const table = await resolveInformeMargenDataSource(client);
  if (table !== MARGEN_ITEM_DIA_ROLL_TABLE) {
    return [];
  }

  const cur = monthFullBounds(year, month);
  const momMonth = month === 1 ? 12 : month - 1;
  const momYear = month === 1 ? year - 1 : year;
  const mom = monthFullBounds(momYear, momMonth);
  const yoy = monthFullBounds(year - 1, month);

  const sedeParams: Array<string | string[]> = [];
  const sedeFilterSql = buildSedeFilterDaily(allowedSedeKeys, sedeParams);

  const sql = `
    SELECT
      fecha_dcto,
      empresa_norm AS empresa,
      id_co_norm AS id_co,
      id_tipo,
      id_linea1,
      MAX(nombre_linea1) AS nombre_linea1,
      id_linea2,
      MAX(nombre_linea2) AS nombre_linea2,
      id_item,
      MAX(item_descripcion) AS item_descripcion,
      SUM(COALESCE(cantidad, 0)) AS cantidad,
      SUM(COALESCE(ventas_netas, 0)) AS ventas_netas
    FROM ${MARGEN_ITEM_DIA_ROLL_TABLE}
    WHERE (
        (fecha_dcto >= $1 AND fecha_dcto <= $2)
        OR (fecha_dcto >= $3 AND fecha_dcto <= $4)
        OR (fecha_dcto >= $5 AND fecha_dcto <= $6)
      )
      ${sedeFilterSql}
    GROUP BY
      fecha_dcto,
      empresa_norm,
      id_co_norm,
      id_tipo,
      id_linea1,
      id_linea2,
      id_item
    HAVING
      SUM(COALESCE(cantidad, 0)) <> 0
      OR SUM(COALESCE(ventas_netas, 0)) <> 0
  `;

  const result = await client.query<InformeDailyDbRow>(sql, [
    cur.from,
    cur.to,
    mom.from,
    mom.to,
    yoy.from,
    yoy.to,
    ...sedeParams,
  ]);
  return result.rows ?? [];
};

export const aggregateDailyRowsForRange = (
  dailyRows: InformeDailyDbRow[],
  year: number,
  month: number,
  dayRange: InformeDayRangeSpec,
): InformeDbAggRow[] => {
  const curLast = lastDayOfMonth(year, month);
  const momMonth = month === 1 ? 12 : month - 1;
  const momYear = month === 1 ? year - 1 : year;
  const momLast = lastDayOfMonth(momYear, momMonth);
  const yoyLast = lastDayOfMonth(year - 1, month);

  const lastByPeriod: Record<PeriodKind, number> = {
    cur: curLast,
    mom: momLast,
    yoy: yoyLast,
  };

  const map = new Map<string, InformeDbAggRow>();

  for (const row of dailyRows) {
    const period = resolvePeriodKind(row.fecha_dcto, year, month);
    if (!period) continue;

    const day = Number(row.fecha_dcto.slice(6, 8));
    if (
      !dayInRange(
        day,
        dayRange.fromDay,
        dayRange.toDay,
        lastByPeriod[period],
      )
    ) {
      continue;
    }

    const key = itemKey(row);
    let acc = map.get(key);
    if (!acc) {
      acc = {
        empresa: row.empresa,
        id_co: row.id_co,
        id_tipo: row.id_tipo,
        id_linea1: row.id_linea1,
        nombre_linea1: row.nombre_linea1,
        id_linea2: row.id_linea2,
        nombre_linea2: row.nombre_linea2,
        id_item: row.id_item,
        item_descripcion: row.item_descripcion,
        id_unidad: "",
        u_cur: 0,
        u_mom: 0,
        u_yoy: 0,
        v_cur: 0,
        v_mom: 0,
        v_yoy: 0,
      };
      map.set(key, acc);
    }

    const qty = toNum(row.cantidad);
    const val = toNum(row.ventas_netas);
    if (period === "cur") {
      acc.u_cur = toNum(acc.u_cur) + qty;
      acc.v_cur = toNum(acc.v_cur) + val;
    } else if (period === "mom") {
      acc.u_mom = toNum(acc.u_mom) + qty;
      acc.v_mom = toNum(acc.v_mom) + val;
    } else {
      acc.u_yoy = toNum(acc.u_yoy) + qty;
      acc.v_yoy = toNum(acc.v_yoy) + val;
    }
  }

  return [...map.values()].filter(
    (row) =>
      toNum(row.u_cur) !== 0 ||
      toNum(row.u_mom) !== 0 ||
      toNum(row.u_yoy) !== 0 ||
      toNum(row.v_cur) !== 0 ||
      toNum(row.v_mom) !== 0 ||
      toNum(row.v_yoy) !== 0,
  );
};

export type InformeVariacionMonthBundle = {
  bundle: true;
  year: number;
  month: number;
  payloads: Record<string, InformeVariacionPayload>;
  rangeIds: string[];
};

export const loadInformeVariacionMonthBundle = async (
  client: PoolClient,
  year: number,
  month: number,
  allowedSedeKeys: string[] | null,
  availableRanges: InformeDayRangeSpec[],
): Promise<InformeVariacionMonthBundle | null> => {
  const table = await resolveInformeMargenDataSource(client);
  if (table !== MARGEN_ITEM_DIA_ROLL_TABLE) {
    return null;
  }

  const dailyRows = await queryInformeDailyRows(
    client,
    year,
    month,
    allowedSedeKeys,
  );

  const payloads: Record<string, InformeVariacionPayload> = {};
  for (const range of availableRanges) {
    const dbRows = aggregateDailyRowsForRange(dailyRows, year, month, range);
    const periods = computeInformePeriods(year, month, range);
    const payload = buildInformeVariacionPayload(
      dbRows,
      periods,
      allowedSedeKeys,
    );
    payloads[range.id] = {
      ...payload,
      meta: {
        ...payload.meta,
        dayRange: {
          id: range.id,
          label: range.label,
          fromDay: range.fromDay,
          toDay: range.toDay,
        },
      },
    };
  }

  return {
    bundle: true,
    year,
    month,
    payloads,
    rangeIds: availableRanges.map((range) => range.id),
  };
};
