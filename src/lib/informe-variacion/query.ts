import type { PoolClient } from "pg";
import {
  listMargenSedeCatalogOptions,
  type MargenSedeCatalogOption,
} from "@/lib/margenes/margen-sede-catalog";
import { sedeKey } from "@/lib/margenes/margen-final-query";
import {
  isRollTable,
  resolveMargenDataSource,
  type MargenDataTable,
} from "@/lib/margenes/margen-data-source";
import {
  buildInformeCategoriaLabel,
  buildInformeItemLabel,
  buildInformeLineaLabel,
  buildInformeSublineaLabel,
  formatInformeSedeLabel,
  informeEmpresaLabel,
} from "@/lib/informe-variacion/labels";
import { computeInformePeriods } from "@/lib/informe-variacion/periods";
import type { InformePeriods } from "@/lib/informe-variacion/types";
import type {
  InformeCompactRow,
  InformeVariacionPayload,
} from "@/lib/informe-variacion/types";

export type InformeDbAggRow = {
  empresa: string;
  id_co: string;
  id_tipo: string;
  id_linea1: string;
  nombre_linea1: string;
  id_linea2: string;
  nombre_linea2: string;
  id_item: string;
  item_descripcion: string;
  id_unidad: string;
  u_cur: string | number;
  u_mom: string | number;
  u_yoy: string | number;
  v_cur: string | number;
  v_mom: string | number;
  v_yoy: string | number;
};

const toNum = (value: string | number | null | undefined) =>
  Number(value ?? 0) || 0;

const buildInformeSql = (table: MargenDataTable, sedeFilterSql: string) => {
  const empresaExpr = isRollTable(table)
    ? "empresa_norm"
    : "LOWER(TRIM(COALESCE(empresa, '')))";
  const coExpr = isRollTable(table)
    ? "id_co_norm"
    : "LPAD(TRIM(COALESCE(id_co::text, '')), 3, '0')";
  const valueExpr = isRollTable(table) ? "ventas_netas" : "vlrtot_bru";
  const unidadExpr = isRollTable(table) ? "''" : "TRIM(COALESCE(id_unidad::text, ''))";
  const unidadGroup = isRollTable(table) ? "" : ", TRIM(COALESCE(id_unidad::text, ''))";

  return `
    SELECT
      ${empresaExpr} AS empresa,
      ${coExpr} AS id_co,
      TRIM(COALESCE(id_tipo::text, '')) AS id_tipo,
      TRIM(COALESCE(id_linea1::text, '')) AS id_linea1,
      TRIM(COALESCE(MAX(nombre_linea1), '')) AS nombre_linea1,
      TRIM(COALESCE(id_linea2::text, '')) AS id_linea2,
      TRIM(COALESCE(MAX(nombre_linea2), '')) AS nombre_linea2,
      TRIM(COALESCE(id_item::text, '')) AS id_item,
      TRIM(COALESCE(MAX(item_descripcion), '')) AS item_descripcion,
      ${unidadExpr} AS id_unidad,
      SUM(CASE WHEN fecha_dcto BETWEEN $1 AND $2 THEN COALESCE(cantidad, 0) ELSE 0 END) AS u_cur,
      SUM(CASE WHEN fecha_dcto BETWEEN $3 AND $4 THEN COALESCE(cantidad, 0) ELSE 0 END) AS u_mom,
      SUM(CASE WHEN fecha_dcto BETWEEN $5 AND $6 THEN COALESCE(cantidad, 0) ELSE 0 END) AS u_yoy,
      SUM(CASE WHEN fecha_dcto BETWEEN $1 AND $2 THEN COALESCE(${valueExpr}, 0) ELSE 0 END) AS v_cur,
      SUM(CASE WHEN fecha_dcto BETWEEN $3 AND $4 THEN COALESCE(${valueExpr}, 0) ELSE 0 END) AS v_mom,
      SUM(CASE WHEN fecha_dcto BETWEEN $5 AND $6 THEN COALESCE(${valueExpr}, 0) ELSE 0 END) AS v_yoy
    FROM ${table}
    WHERE fecha_dcto BETWEEN $5 AND $2
      AND fecha_dcto ~ '^[0-9]{8}$'
      ${sedeFilterSql}
    GROUP BY
      ${empresaExpr},
      ${coExpr},
      TRIM(COALESCE(id_tipo::text, '')),
      TRIM(COALESCE(id_linea1::text, '')),
      TRIM(COALESCE(id_linea2::text, '')),
      TRIM(COALESCE(id_item::text, ''))
      ${unidadGroup}
    HAVING
      SUM(CASE WHEN fecha_dcto BETWEEN $1 AND $2 THEN COALESCE(cantidad, 0) ELSE 0 END) <> 0
      OR SUM(CASE WHEN fecha_dcto BETWEEN $3 AND $4 THEN COALESCE(cantidad, 0) ELSE 0 END) <> 0
      OR SUM(CASE WHEN fecha_dcto BETWEEN $5 AND $6 THEN COALESCE(cantidad, 0) ELSE 0 END) <> 0
      OR SUM(CASE WHEN fecha_dcto BETWEEN $1 AND $2 THEN COALESCE(${valueExpr}, 0) ELSE 0 END) <> 0
      OR SUM(CASE WHEN fecha_dcto BETWEEN $3 AND $4 THEN COALESCE(${valueExpr}, 0) ELSE 0 END) <> 0
      OR SUM(CASE WHEN fecha_dcto BETWEEN $5 AND $6 THEN COALESCE(${valueExpr}, 0) ELSE 0 END) <> 0
  `;
};

export const queryInformeVariacionRows = async (
  client: PoolClient,
  periods: InformePeriods,
  allowedSedeKeys: string[] | null,
): Promise<InformeDbAggRow[]> => {
  const table = await resolveMargenDataSource(client);
  const params: Array<string | string[]> = [
    periods.current.from,
    periods.current.to,
    periods.mom.from,
    periods.mom.to,
    periods.yoy.from,
    periods.yoy.to,
  ];

  let sedeFilterSql = "";
  if (allowedSedeKeys && allowedSedeKeys.length > 0) {
    const pairs = allowedSedeKeys
      .map((key) => {
        const [empresa, idCo] = key.split("|");
        if (!empresa || !idCo) return null;
        return { empresa: empresa.toLowerCase(), idCo: idCo.padStart(3, "0") };
      })
      .filter((pair): pair is { empresa: string; idCo: string } => pair !== null);
    if (pairs.length > 0) {
      params.push(
        pairs.map((pair) => pair.empresa),
        pairs.map((pair) => pair.idCo),
      );
      const empresaParam = params.length - 1;
      const coParam = params.length;
      if (isRollTable(table)) {
        sedeFilterSql = `AND (empresa_norm, id_co_norm) IN (
          SELECT * FROM UNNEST($${empresaParam}::text[], $${coParam}::text[]) AS t(empresa_norm, id_co_norm)
        )`;
      } else {
        sedeFilterSql = `AND (LOWER(TRIM(COALESCE(empresa, ''))), LPAD(TRIM(COALESCE(id_co::text, '')), 3, '0'))
          IN (SELECT * FROM UNNEST($${empresaParam}::text[], $${coParam}::text[]) AS t(empresa, id_co))`;
      }
    }
  }

  const sql = buildInformeSql(table, sedeFilterSql);
  const result = await client.query<InformeDbAggRow>(sql, params);
  return result.rows ?? [];
};

const indexLabel = (
  map: Map<string, number>,
  labels: string[],
  label: string,
): number => {
  const existing = map.get(label);
  if (existing !== undefined) return existing;
  const index = labels.length;
  labels.push(label);
  map.set(label, index);
  return index;
};

const buildSedeCatalog = (
  allowedSedeKeys: string[] | null,
): MargenSedeCatalogOption[] => {
  const catalog = listMargenSedeCatalogOptions();
  if (!allowedSedeKeys) return catalog;
  const allowed = new Set(allowedSedeKeys);
  return catalog.filter((option) => allowed.has(option.value));
};

export const buildInformeVariacionPayload = (
  dbRows: InformeDbAggRow[],
  periods: InformePeriods,
  allowedSedeKeys: string[] | null,
): InformeVariacionPayload => {
  const catalog = buildSedeCatalog(allowedSedeKeys);
  const sedeIndex = new Map<string, number>();
  const sedes = catalog.map((option, index) => {
    sedeIndex.set(option.value, index);
    return {
      e: informeEmpresaLabel(option.empresa),
      s: formatInformeSedeLabel(option.empresa, option.idCo, option.label),
      yoyOk: false,
      key: option.value,
    };
  });

  const cats: string[] = [];
  const lins: string[] = [];
  const subs: string[] = [];
  const items: string[] = [];
  const ums: string[] = [];
  const catMap = new Map<string, number>();
  const linMap = new Map<string, number>();
  const subMap = new Map<string, number>();
  const itemMap = new Map<string, number>();

  const rows: InformeCompactRow[] = [];
  const yoyTotals = new Array(sedes.length).fill(0);

  for (const row of dbRows) {
    const key = sedeKey(row.empresa, row.id_co);
    const sedeIdx = sedeIndex.get(key);
    if (sedeIdx === undefined) continue;

    const catLabel = buildInformeCategoriaLabel(row.id_tipo);
    const linLabel = buildInformeLineaLabel(row.id_linea1, row.nombre_linea1);
    const subLabel = buildInformeSublineaLabel(row.id_linea2, row.nombre_linea2);
    const itemLabel = buildInformeItemLabel(row.id_item, row.item_descripcion);

    const catIdx = indexLabel(catMap, cats, catLabel);
    const linIdx = indexLabel(linMap, lins, linLabel);
    const subIdx = indexLabel(subMap, subs, subLabel);
    const itemIdx = indexLabel(itemMap, items, itemLabel);
    if (!ums[itemIdx]) ums[itemIdx] = (row.id_unidad ?? "").trim();

    const uCur = toNum(row.u_cur);
    const uMom = toNum(row.u_mom);
    const uYoy = toNum(row.u_yoy);
    const vCur = toNum(row.v_cur);
    const vMom = toNum(row.v_mom);
    const vYoy = toNum(row.v_yoy);

    yoyTotals[sedeIdx] += vYoy;

    rows.push([
      sedeIdx,
      catIdx,
      linIdx,
      subIdx,
      itemIdx,
      uCur,
      uMom,
      uYoy,
      vCur,
      vMom,
      vYoy,
    ]);
  }

  sedes.forEach((sede, index) => {
    sede.yoyOk = yoyTotals[index] > 0;
  });

  return {
    periods,
    sedes,
    cats,
    lins,
    subs,
    items,
    ums,
    rows,
    meta: {
      rowCount: rows.length,
      generatedAt: new Date().toISOString(),
    },
  };
};

export const loadInformeVariacionPayload = async (
  client: PoolClient,
  year: number,
  month: number,
  allowedSedeKeys: string[] | null,
): Promise<InformeVariacionPayload> => {
  const periods = computeInformePeriods(year, month);
  const dbRows = await queryInformeVariacionRows(client, periods, allowedSedeKeys);
  return buildInformeVariacionPayload(dbRows, periods, allowedSedeKeys);
};
