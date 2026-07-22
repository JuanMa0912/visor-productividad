import type { PoolClient } from "pg";
import type { MargenQueryFilters } from "@/lib/margenes/margen-final-query";
import {
  compactDateToIso,
  empresaLabel,
  filterSedeOptionsByEmpresas,
  parseSedeKey,
  sedeLabel,
  tipoLabel,
  toMargenPct,
} from "@/lib/margenes/margen-final-query";
import {
  buildMargenWhereForTable,
  clienteSelectSql,
  idTercExpr,
  isRollTable,
  mercadoTipoSql,
  nombreTercExpr,
  sedeDistinctKeySql,
  sedeSelectSql,
  type MargenDataTable,
} from "@/lib/margenes/margen-data-source";
import {
  drillPathForInvoiceDetail,
  drillPathSqlFilters,
  type DrillPathStep,
} from "@/lib/margenes/drill-path";
import {
  factPathSqlFilters,
  type FactNavStep,
} from "@/lib/margenes/fact-path";
import {
  buildMargenOrderBy,
  KPI_MERCADO_TIPO,
  metricsSqlFor,
  marginPct,
  shouldApplyMercadoTipoDefault,
  toNum,
  unitCost,
  unitSaleWithTax,
} from "@/lib/margenes/metrics";

const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const acumMonthLabel = (fechas: string[]) => {
  const months = new Set(
    fechas
      .filter((fecha) => /^\d{8}$/.test(fecha))
      .map((fecha) => fecha.slice(4, 6)),
  );
  return [...months]
    .sort()
    .map((month) => MONTH_NAMES[Number(month) - 1] ?? month)
    .join("/");
};

const dayName = (compact: string) => {
  const iso = compactDateToIso(compact);
  if (!iso) return "";
  const date = new Date(`${iso}T12:00:00`);
  return DAY_NAMES[date.getDay()] ?? "";
};

export const formatDayLabel = (compact: string) => {
  const iso = compactDateToIso(compact);
  if (!iso) return compact;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y} · ${dayName(compact)}`;
};

export type DrillRow = {
  key: string;
  cod: string;
  label: string;
  descripcion?: string;
  linea?: string;
  documento?: string;
  tipdoc?: string;
  documentoDocfc?: string;
  idTerc?: string;
  nombreTerc?: string;
  idCaja?: string;
  vendCc?: string;
  vendCcDesc?: string;
  sede?: string;
  empresa?: string;
  idCo?: string;
  fecha?: string;
  drillable: boolean;
  drillStep?: DrillPathStep;
  isAcum?: boolean;
  acumMes?: string;
  ventasNetas: number;
  costoTotal: number;
  margenPesos: number;
  margenPct: number;
  cantidad: number;
  ventasConIva: number;
  pvuIva: number;
  pcu: number;
  facturas: number;
  categorias?: number;
  lineas?: number;
  sublineas?: number;
  items?: number;
};

export type MargenKpi = DrillRow & {
  dias: number;
  sedes: number;
  subFacturas: string;
  subCosto: string;
  subMargen: string;
  subPct: string;
};

const idTipoExpr = (table: MargenDataTable) =>
  isRollTable(table) ? "id_tipo" : `TRIM(COALESCE(id_tipo::text, ''))`;

const idLinea1Expr = (table: MargenDataTable) =>
  isRollTable(table) ? "id_linea1" : `TRIM(COALESCE(id_linea1::text, ''))`;

const idLinea2Expr = (table: MargenDataTable) =>
  isRollTable(table) ? "id_linea2" : `TRIM(COALESCE(id_linea2::text, ''))`;

const idItemExpr = (table: MargenDataTable) =>
  isRollTable(table) ? "id_item" : `TRIM(COALESCE(id_item::text, ''))`;

const documentoExpr = (table: MargenDataTable) =>
  isRollTable(table)
    ? "documento_fc"
    : `TRIM(COALESCE(documento_fc::text, ''))`;

const tipdocExpr = (table: MargenDataTable) =>
  isRollTable(table)
    ? "id_tipdoc_fc"
    : `TRIM(COALESCE(id_tipdoc_fc::text, ''))`;

const documentoNotNull = (table: MargenDataTable) =>
  isRollTable(table)
    ? `NULLIF(documento_fc, '') IS NOT NULL`
    : `NULLIF(TRIM(documento_fc::text), '') IS NOT NULL`;

const buildWhere = (
  filters: MargenQueryFilters,
  path: DrillPathStep[],
  params: unknown[],
  table: MargenDataTable,
  kpiMercadoOnly = false,
) => {
  const base = buildMargenWhereForTable(filters, params, table);
  const drill = drillPathSqlFilters(path, params, table);
  const parts = [base, ...drill];
  if (kpiMercadoOnly) {
    parts.push(mercadoTipoSql(table));
  }
  return parts.join(" AND ");
};

const buildFactWhere = (
  filters: MargenQueryFilters,
  path: FactNavStep[],
  params: unknown[],
  table: MargenDataTable,
) => {
  const base = buildMargenWhereForTable(filters, params, table);
  const fact = factPathSqlFilters(path, params, table);
  return [base, ...fact].join(" AND ");
};

const cleanText = (value: unknown): string | undefined => {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed === "" ? undefined : trimmed;
};

const mapFacturaBoardRow = (row: Record<string, unknown>): DrillRow => {
  const documento = String(row.documento);
  const tipdoc = String(row.tipdoc);
  const empresa = String(row.empresa);
  const idCo = String(row.id_co);
  const metrics = mapMetrics(row);
  return {
    ...metrics,
    key: `${empresa}|${idCo}|${documento}|${tipdoc}`,
    cod: documento,
    label: documento,
    documento,
    tipdoc,
    documentoDocfc: cleanText(row.documento_docfc),
    idTerc: cleanText(row.id_terc),
    nombreTerc: cleanText(row.nombre_terc),
    idCaja: cleanText(row.id_caja),
    vendCc: cleanText(row.vend_cc),
    vendCcDesc: cleanText(row.vend_cc_desc),
    empresa,
    idCo,
    sede: sedeLabel(empresa, idCo),
    drillable: true,
    drillStep: {
      type: "factura",
      documento,
      tipdoc,
      label: documento,
      empresa,
      idCo,
    },
  };
};

const mapInvoiceLineRows = (
  rows: Array<Record<string, string | number>>,
): DrillRow[] =>
  rows.map((row) => {
    const ventasNetas = toNum(row.ventas_netas);
    const costoTotal = toNum(row.costo_total);
    const margenPesos = ventasNetas - costoTotal;
    const cantidad = toNum(row.cantidad);
    const ventasConIva = toNum(row.ventas_con_iva);
    return {
      key: String(row.id_item),
      cod: String(row.id_item),
      label: String(row.descripcion),
      descripcion: String(row.descripcion),
      linea: String(row.linea),
      drillable: false,
      cantidad,
      ventasNetas,
      costoTotal,
      margenPesos,
      margenPct: marginPct(ventasNetas, margenPesos),
      ventasConIva,
      pvuIva: unitSaleWithTax(ventasConIva, cantidad),
      pcu: unitCost(costoTotal, cantidad),
      facturas: 1,
    };
  });

const mapMetrics = (row: Record<string, string | number>): Omit<
  DrillRow,
  "key" | "cod" | "label" | "drillable"
> => {
  const ventasNetas = toNum(row.ventas_netas);
  const costoTotal = toNum(row.costo_total);
  const margenPesos = toNum(row.margen_pesos);
  const cantidad = toNum(row.cantidad);
  const ventasConIva = toNum(row.ventas_con_iva);
  return {
    ventasNetas,
    costoTotal,
    margenPesos,
    margenPct: toMargenPct(ventasNetas, margenPesos),
    cantidad,
    ventasConIva,
    pvuIva: unitSaleWithTax(ventasConIva, cantidad),
    pcu: unitCost(costoTotal, cantidad),
    facturas: toNum(row.facturas),
    categorias: toNum(row.categorias),
    lineas: toNum(row.lineas),
    sublineas: toNum(row.sublineas),
    items: toNum(row.items),
  };
};

const buildKpiPayload = (row: Record<string, string | number>): MargenKpi => {
  const metrics = mapMetrics(row);
  const dias = toNum(row.dias);
  const sedes = toNum(row.sedes);
  return {
    key: "kpi",
    cod: "kpi",
    label: "KPI",
    drillable: false,
    ...metrics,
    dias,
    sedes,
    subFacturas: `${metrics.facturas} facturas`,
    subCosto: `${metrics.categorias} categ. · ${metrics.lineas} lín.`,
    subMargen: `${metrics.items} ítems · ${metrics.cantidad.toLocaleString("es-CO", { maximumFractionDigits: 2 })} uds`,
    subPct: `${sedes} sedes · ${dias} días`,
  };
};

const sortDayRows = (rows: DrillRow[], filters: MargenQueryFilters) => {
  const col = filters.orderBy;
  const dir = filters.orderDir === "desc" ? -1 : 1;
  if (!col) {
    rows.sort((a, b) => a.cod.localeCompare(b.cod) * dir);
    return;
  }
  const key = col as keyof DrillRow;
  rows.sort((a, b) => {
    const av = a[key] ?? 0;
    const bv = b[key] ?? 0;
    if (typeof av === "number" && typeof bv === "number") {
      return (av - bv) * dir;
    }
    return String(av).localeCompare(String(bv)) * dir;
  });
};

const withMercadoDefaultCategoria = (
  filters: MargenQueryFilters,
): MargenQueryFilters => {
  if (!shouldApplyMercadoTipoDefault(filters.categorias)) return filters;
  return { ...filters, categorias: [KPI_MERCADO_TIPO] };
};

const queryDrillLevel0 = async (
  client: PoolClient,
  filters: MargenQueryFilters,
  table: MargenDataTable,
  options?: { includeKpi?: boolean },
): Promise<{
  kpi?: MargenKpi;
  level: number;
  levelName: string;
  rows: DrillRow[];
}> => {
  const params: unknown[] = [];
  // Sin categoría → Mercado (4). Con categoría explícita (p. ej. asaderos = 3)
  // no AND-ear Mercado: antes dejaba el tablero en cero.
  const levelFilters = withMercadoDefaultCategoria(filters);
  const dayWhere = buildWhere(levelFilters, [], params, table, false);
  const sedeKey = sedeDistinctKeySql(table);

  const result = await client.query(
    `
    SELECT
      fecha_dcto,
      GROUPING(fecha_dcto) AS is_total,
      ${metricsSqlFor(table)},
      COUNT(DISTINCT fecha_dcto) AS dias,
      COUNT(DISTINCT ${sedeKey}) AS sedes
    FROM ${table}
    WHERE ${dayWhere}
    GROUP BY GROUPING SETS ((), (fecha_dcto))
    `,
    params,
  );

  let totalRow: Record<string, string | number> | null = null;
  const dayRows: DrillRow[] = [];

  for (const row of result.rows) {
    if (Number(row.is_total) === 1) {
      totalRow = row;
      continue;
    }
    const fecha = String(row.fecha_dcto);
    const metrics = mapMetrics(row);
    dayRows.push({
      key: fecha,
      cod: fecha,
      label: formatDayLabel(fecha),
      drillable: true,
      drillStep: { type: "day", fecha, label: formatDayLabel(fecha) },
      ...metrics,
    });
  }

  sortDayRows(dayRows, filters);

  const rows = [...dayRows];
  if (rows.length > 1 && totalRow) {
    const acc = mapMetrics(totalRow);
    const mes = acumMonthLabel(rows.map((row) => row.cod));
    const acumLabel = `ACUMULADO ${mes}`;
    rows.unshift({
      key: "acum",
      cod: "TODAS",
      label: acumLabel,
      acumMes: mes,
      drillable: true,
      isAcum: true,
      drillStep: { type: "acum", label: acumLabel },
      ...acc,
    });
  }

  const kpi =
    options?.includeKpi && totalRow
      ? buildKpiPayload(totalRow)
      : undefined;

  return { kpi, level: 0, levelName: "Día", rows };
};

/** Todas las líneas de una factura (sin filtros de ítem/categoría del drill). */
const queryInvoiceLineRows = async (
  client: PoolClient,
  filters: MargenQueryFilters,
  documento: string,
  tipdoc: string,
  level: number,
  table: MargenDataTable,
): Promise<{ level: number; levelName: string; rows: DrillRow[] }> => {
  const params: unknown[] = [];
  let where = buildMargenWhereForTable(filters, params, table);
  params.push(documento, tipdoc);
  where += ` AND ${documentoExpr(table)} = $${params.length - 1}`;
  where += ` AND ${tipdocExpr(table)} = $${params.length}`;
  where += ` AND ${documentoNotNull(table)}`;

  const roll = isRollTable(table);
  const result = await client.query(
    roll
      ? `
    SELECT
      id_item,
      COALESCE(NULLIF(item_descripcion, ''), id_item) AS descripcion,
      id_linea1,
      COALESCE(NULLIF(nombre_linea1, ''), id_linea1) AS linea,
      cantidad,
      ventas_netas,
      costo_total,
      ventas_con_iva
    FROM ${table}
    WHERE ${where}
    ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "ventas_netas DESC")}
    `
      : `
    SELECT
      ${idItemExpr(table)} AS id_item,
      COALESCE(NULLIF(TRIM(item_descripcion), ''), ${idItemExpr(table)}) AS descripcion,
      ${idLinea1Expr(table)} AS id_linea1,
      COALESCE(NULLIF(TRIM(nombre_linea1), ''), ${idLinea1Expr(table)}) AS linea,
      COALESCE(SUM(COALESCE(cantidad, 0)), 0) AS cantidad,
      COALESCE(SUM(COALESCE(vlrtot_bru, 0)), 0) AS ventas_netas,
      COALESCE(SUM(COALESCE(tot_costo, 0)), 0) AS costo_total,
      COALESCE(SUM(COALESCE(ven_totales, 0)), 0) AS ventas_con_iva
    FROM ${table}
    WHERE ${where}
    GROUP BY 1, 2, 3, 4
    ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "ventas_netas DESC")}
    `,
    params,
  );

  return {
    level,
    levelName: "Ítems de factura",
    rows: mapInvoiceLineRows(result.rows),
  };
};

export const queryKpi = async (
  client: PoolClient,
  filters: MargenQueryFilters,
  path: DrillPathStep[],
  table: MargenDataTable,
  options?: { mercadoOnly?: boolean },
): Promise<MargenKpi> => {
  // Nivel 0: queryDrillLevel0 aplica Mercado (4) solo si no hay categorias.
  // mercadoOnly === false con categorias vacias evita el default (query abierta).
  if (
    path.length === 0 &&
    !(
      options?.mercadoOnly === false &&
      shouldApplyMercadoTipoDefault(filters.categorias)
    )
  ) {
    const board = await queryDrillLevel0(client, filters, table, {
      includeKpi: true,
    });
    if (board.kpi) return board.kpi;
  }

  const params: unknown[] = [];
  const mercadoOnly =
    shouldApplyMercadoTipoDefault(filters.categorias) &&
    (options?.mercadoOnly ?? path.length <= 1);
  const where = buildWhere(filters, path, params, table, mercadoOnly);
  const sedeKey = sedeDistinctKeySql(table);
  const result = await client.query(
    `
    SELECT
      ${metricsSqlFor(table)},
      COUNT(DISTINCT fecha_dcto) AS dias,
      COUNT(DISTINCT ${sedeKey}) AS sedes
    FROM ${table}
    WHERE ${where}
    `,
    params,
  );
  return buildKpiPayload(result.rows[0] ?? {});
};

export const queryDrillRows = async (
  client: PoolClient,
  filters: MargenQueryFilters,
  path: DrillPathStep[],
  table: MargenDataTable,
  search?: string,
): Promise<{ level: number; levelName: string; rows: DrillRow[] }> => {
  const level = path.length;
  const params: unknown[] = [];
  const where = buildWhere(filters, path, params, table);

  if (level === 0) {
    const board = await queryDrillLevel0(client, filters, table);
    return board;
  }

  if (level === 1) {
    const result = await client.query(
      `
      SELECT ${idTipoExpr(table)} AS id_tipo, ${metricsSqlFor(table)}
      FROM ${table}
      WHERE ${where}
      GROUP BY 1
      ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "1")}
      `,
      params,
    );
    return {
      level,
      levelName: "Categoría",
      rows: result.rows.map((row) => {
        const id = String(row.id_tipo);
        const metrics = mapMetrics(row);
        const nombre = tipoLabel(id);
        return {
          key: id,
          cod: id,
          label: nombre,
          drillable: true,
          drillStep: { type: "tipo", id, label: nombre },
          ...metrics,
        };
      }),
    };
  }

  if (level === 2) {
    const nombreLinea = isRollTable(table)
      ? `COALESCE(NULLIF(MAX(nombre_linea1), ''), ${idLinea1Expr(table)})`
      : `COALESCE(NULLIF(TRIM(MAX(nombre_linea1)), ''), ${idLinea1Expr(table)})`;
    const result = await client.query(
      `
      SELECT
        ${idLinea1Expr(table)} AS id_linea1,
        ${nombreLinea} AS nombre,
        ${metricsSqlFor(table)}
      FROM ${table}
      WHERE ${where}
      GROUP BY 1
      ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "1")}
      `,
      params,
    );
    return {
      level,
      levelName: "Línea",
      rows: result.rows.map((row) => {
        const id = String(row.id_linea1);
        const metrics = mapMetrics(row);
        return {
          key: id,
          cod: id,
          label: String(row.nombre || id),
          drillable: true,
          drillStep: { type: "linea1", id, label: String(row.nombre || id) },
          ...metrics,
        };
      }),
    };
  }

  if (level === 3) {
    const nombreLinea = isRollTable(table)
      ? `COALESCE(NULLIF(MAX(nombre_linea2), ''), ${idLinea2Expr(table)})`
      : `COALESCE(NULLIF(TRIM(MAX(nombre_linea2)), ''), ${idLinea2Expr(table)})`;
    const result = await client.query(
      `
      SELECT
        ${idLinea2Expr(table)} AS id_linea2,
        ${nombreLinea} AS nombre,
        ${metricsSqlFor(table)}
      FROM ${table}
      WHERE ${where}
      GROUP BY 1
      ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "1")}
      `,
      params,
    );
    return {
      level,
      levelName: "Sublínea",
      rows: result.rows.map((row) => {
        const id = String(row.id_linea2);
        const metrics = mapMetrics(row);
        return {
          key: id,
          cod: id,
          label: String(row.nombre || id),
          drillable: true,
          drillStep: { type: "linea2", id, label: String(row.nombre || id) },
          ...metrics,
        };
      }),
    };
  }

  if (level === 4) {
    let itemWhere = where;
    if (search?.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      const itemCol = idItemExpr(table);
      const descCol = isRollTable(table)
        ? "item_descripcion"
        : "TRIM(COALESCE(item_descripcion, ''))";
      itemWhere += ` AND (
        LOWER(${itemCol}) LIKE $${params.length}
        OR LOWER(${descCol}) LIKE $${params.length}
      )`;
    }
    const descripcion = isRollTable(table)
      ? `COALESCE(NULLIF(MAX(item_descripcion), ''), ${idItemExpr(table)})`
      : `COALESCE(NULLIF(TRIM(MAX(item_descripcion)), ''), ${idItemExpr(table)})`;
    const result = await client.query(
      `
      SELECT
        ${idItemExpr(table)} AS id_item,
        ${descripcion} AS descripcion,
        ${metricsSqlFor(table)}
      FROM ${table}
      WHERE ${itemWhere}
      GROUP BY 1
      ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "ventas_netas DESC")}
      LIMIT 1000
      `,
      params,
    );
    return {
      level,
      levelName: "Ítem",
      rows: result.rows.map((row) => {
        const id = String(row.id_item);
        const metrics = mapMetrics(row);
        return {
          key: id,
          cod: id,
          label: String(row.descripcion || id),
          descripcion: String(row.descripcion || id),
          drillable: true,
          drillStep: { type: "item", id, label: String(row.descripcion || id) },
          ...metrics,
        };
      }),
    };
  }

  if (level === 5) {
    const result = await client.query(
      `
      SELECT
        ${documentoExpr(table)} AS documento,
        ${tipdocExpr(table)} AS tipdoc,
        ${sedeSelectSql(table)},
        ${clienteSelectSql(table)},
        ${metricsSqlFor(table)}
      FROM ${table}
      WHERE ${where}
        AND ${documentoNotNull(table)}
      GROUP BY 1, 2, 3, 4
      ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "ventas_netas DESC")}
      LIMIT 1000
      `,
      params,
    );
    return {
      level,
      levelName: "Factura",
      rows: result.rows.map((row) => mapFacturaBoardRow(row)),
    };
  }

  const factura = path.find((step) => step.type === "factura");
  if (factura?.type === "factura") {
    return queryInvoiceLineRows(
      client,
      filters,
      factura.documento,
      factura.tipdoc,
      6,
      table,
    );
  }

  return {
    level: 6,
    levelName: "Ítems de factura",
    rows: [],
  };
};

/** Vista drill con KPI: un solo escaneo en nivel 0. */
export const queryDrillBoard = async (
  client: PoolClient,
  filters: MargenQueryFilters,
  path: DrillPathStep[],
  table: MargenDataTable,
  search?: string,
): Promise<{ kpi: MargenKpi; level: number; levelName: string; rows: DrillRow[] }> => {
  if (path.length === 0) {
    const board = await queryDrillLevel0(client, filters, table, {
      includeKpi: true,
    });
    return {
      kpi: board.kpi ?? buildKpiPayload({}),
      level: board.level,
      levelName: board.levelName,
      rows: board.rows,
    };
  }

  const kpiPath = drillPathForInvoiceDetail(path);
  const [kpi, tableResult] = await Promise.all([
    queryKpi(client, filters, kpiPath, table),
    queryDrillRows(client, filters, path, table, search),
  ]);
  return { kpi, ...tableResult };
};

export const queryFactNavRows = async (
  client: PoolClient,
  filters: MargenQueryFilters,
  path: FactNavStep[],
  table: MargenDataTable,
  search?: string,
): Promise<{ level: number; levelName: string; rows: DrillRow[] }> => {
  const factura = path.find((step) => step.type === "factura");
  if (factura?.type === "factura") {
    return queryInvoiceLineRows(
      client,
      filters,
      factura.documento,
      factura.tipdoc,
      3,
      table,
    );
  }

  const level = path.length;
  const params: unknown[] = [];
  const where = buildFactWhere(filters, path, params, table);

  if (level === 0) {
    const result = await client.query(
      `
      SELECT fecha_dcto, ${metricsSqlFor(table)}
      FROM ${table}
      WHERE ${where}
      GROUP BY fecha_dcto
      ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "fecha_dcto DESC")}
      `,
      params,
    );
    return {
      level,
      levelName: "Fecha",
      rows: result.rows.map((row) => {
        const fecha = String(row.fecha_dcto);
        const metrics = mapMetrics(row);
        return {
          key: fecha,
          cod: fecha,
          label: formatDayLabel(fecha),
          drillable: true,
          drillStep: { type: "day", fecha, label: formatDayLabel(fecha) } as DrillPathStep,
          ...metrics,
        };
      }),
    };
  }

  if (level === 1) {
    const result = await client.query(
      `
      SELECT ${idTipoExpr(table)} AS id_tipo, ${metricsSqlFor(table)}
      FROM ${table}
      WHERE ${where}
      GROUP BY 1
      ORDER BY 1
      `,
      params,
    );
    return {
      level,
      levelName: "Categoría",
      rows: result.rows.map((row) => {
        const id = String(row.id_tipo);
        const metrics = mapMetrics(row);
        const nombre = tipoLabel(id);
        return {
          key: id,
          cod: id,
          label: nombre,
          drillable: true,
          ...metrics,
        };
      }),
    };
  }

  if (level === 2) {
    let factWhere = where;
    if (search?.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      factWhere += ` AND LOWER(${documentoExpr(table)}) LIKE $${params.length}`;
    }
    const result = await client.query(
      `
      SELECT
        ${documentoExpr(table)} AS documento,
        ${tipdocExpr(table)} AS tipdoc,
        ${sedeSelectSql(table)},
        ${clienteSelectSql(table)},
        ${metricsSqlFor(table)}
      FROM ${table}
      WHERE ${factWhere}
        AND ${documentoNotNull(table)}
      GROUP BY 1, 2, 3, 4
      ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "ventas_netas DESC")}
      LIMIT 1000
      `,
      params,
    );
    return {
      level,
      levelName: "Factura",
      rows: result.rows.map((row) => mapFacturaBoardRow(row)),
    };
  }

  return {
    level,
    levelName: "Factura",
    rows: [],
  };
};

export const queryFactListRows = async (
  client: PoolClient,
  filters: MargenQueryFilters,
  table: MargenDataTable,
  search?: string,
) => {
  const params: unknown[] = [];
  let where = buildMargenWhereForTable(filters, params, table);
  if (search?.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    where += ` AND LOWER(${documentoExpr(table)}) LIKE $${params.length}`;
  }
  const sedeCols = sedeSelectSql(table);
  const result = await client.query(
    `
    SELECT
      ${documentoExpr(table)} AS documento,
      ${tipdocExpr(table)} AS tipdoc,
      fecha_dcto,
      ${sedeCols},
      ${clienteSelectSql(table)},
      ${metricsSqlFor(table)}
    FROM ${table}
    WHERE ${where}
      AND ${documentoNotNull(table)}
    GROUP BY 1, 2, 3, 4, 5
    ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "ventas_netas DESC")}
    LIMIT 1000
    `,
    params,
  );
  return result.rows.map((row) => {
    const mapped = mapFacturaBoardRow(row);
    return {
      ...mapped,
      key: `${mapped.empresa}|${mapped.idCo}|${mapped.documento}|${mapped.tipdoc}|${String(row.fecha_dcto)}`,
      fecha: formatDayLabel(String(row.fecha_dcto)),
    };
  });
};

export const querySedeCompare = async (
  client: PoolClient,
  filters: MargenQueryFilters,
  table: MargenDataTable,
) => {
  const params: unknown[] = [];
  const where = buildMargenWhereForTable(filters, params, table);
  const sedeCols = sedeSelectSql(table);
  const result = await client.query(
    `
    SELECT
      ${sedeCols},
      COUNT(DISTINCT fecha_dcto) AS dias,
      ${metricsSqlFor(table)}
    FROM ${table}
    WHERE ${where}
    GROUP BY 1, 2
    ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "ventas_netas DESC")}
    `,
    params,
  );
  return result.rows.map((row) => {
    const metrics = mapMetrics(row);
    return {
      key: `${row.empresa}|${row.id_co}`,
      empresa: empresaLabel(String(row.empresa)),
      cod: String(row.id_co),
      sede: sedeLabel(String(row.empresa), String(row.id_co)),
      dias: toNum(row.dias),
      drillable: true,
      ...metrics,
    };
  });
};

const SIN_CLIENTE_LABEL = "Sin cliente";

export const queryClienteCompare = async (
  client: PoolClient,
  filters: MargenQueryFilters,
  table: MargenDataTable,
  search?: string,
) => {
  const params: unknown[] = [];
  let where = buildMargenWhereForTable(filters, params, table);
  const idTerc = idTercExpr(table);
  const nombreTerc = nombreTercExpr(table);

  if (search?.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    where += ` AND (
      LOWER(${idTerc}) LIKE $${params.length}
      OR LOWER(COALESCE(${nombreTerc}, '')) LIKE $${params.length}
    )`;
  }

  const result = await client.query(
    `
    SELECT
      ${idTerc} AS id_terc,
      MAX(${nombreTerc}) AS nombre_terc,
      ${metricsSqlFor(table)}
    FROM ${table}
    WHERE ${where}
    GROUP BY 1
    ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "ventas_netas DESC")}
    LIMIT 1000
    `,
    params,
  );

  return result.rows.map((row) => {
    const metrics = mapMetrics(row);
    const id = String(row.id_terc ?? "").trim();
    const nombre = cleanText(row.nombre_terc);
    const label = nombre ?? (id ? id : SIN_CLIENTE_LABEL);
    return {
      key: id || "__SIN_CLIENTE__",
      cod: id || "—",
      label,
      idTerc: id || undefined,
      nombreTerc: nombre,
      drillable: true,
      ...metrics,
    } satisfies DrillRow;
  });
};

export const queryClienteFacturas = async (
  client: PoolClient,
  filters: MargenQueryFilters,
  table: MargenDataTable,
  idTerc: string,
  search?: string,
) => {
  const params: unknown[] = [];
  let where = buildMargenWhereForTable(filters, params, table);
  const idTercSql = idTercExpr(table);
  params.push(idTerc.trim());
  where += ` AND ${idTercSql} = $${params.length}`;

  if (search?.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    where += ` AND LOWER(${documentoExpr(table)}) LIKE $${params.length}`;
  }

  const sedeCols = sedeSelectSql(table);
  const result = await client.query(
    `
    SELECT
      ${documentoExpr(table)} AS documento,
      ${tipdocExpr(table)} AS tipdoc,
      fecha_dcto,
      ${sedeCols},
      ${clienteSelectSql(table)},
      ${metricsSqlFor(table)}
    FROM ${table}
    WHERE ${where}
      AND ${documentoNotNull(table)}
    GROUP BY 1, 2, 3, 4, 5
    ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "ventas_netas DESC")}
    LIMIT 1000
    `,
    params,
  );

  return result.rows.map((row) => {
    const mapped = mapFacturaBoardRow(row);
    return {
      ...mapped,
      key: `${mapped.empresa}|${mapped.idCo}|${mapped.documento}|${mapped.tipdoc}|${String(row.fecha_dcto)}`,
      fecha: formatDayLabel(String(row.fecha_dcto)),
    };
  });
};

export const queryFilterOptions = async (
  client: PoolClient,
  filters: MargenQueryFilters,
  table: MargenDataTable,
) => {
  const params: unknown[] = [];
  // Conservar `categorias` (asadero → tipo 3) y `lineas` (fruver → N1 01)
  // para que perfiles bloqueados solo vean dimensiones hijas de su alcance.
  // Limpiar sublíneas / ítems para no auto-restringir el catálogo de cada nivel.
  const where = buildMargenWhereForTable(
    {
      ...filters,
      sublineas: [],
      items: [],
    },
    params,
    table,
  );

  const sedesLocked = filters.sedes.length > 0;
  const roll = isRollTable(table);

  const result = await client.query<{
    fechas: Array<{ value: string }> | null;
    categorias: Array<{ value: string; label: string }> | null;
    lineas: Array<{ value: string; label: string }> | null;
    sublineas: Array<{ value: string; label: string; linea: string }> | null;
    items: Array<{ value: string; label: string; code?: string; linea: string; sublinea: string }> | null;
  }>(
    roll
      ? `
    WITH filtered AS MATERIALIZED (
      SELECT
        fecha_dcto,
        id_tipo,
        id_linea1,
        COALESCE(NULLIF(nombre_linea1, ''), id_linea1) AS nombre_linea1,
        id_linea2,
        COALESCE(NULLIF(nombre_linea2, ''), id_linea2) AS nombre_linea2,
        id_item,
        COALESCE(NULLIF(item_descripcion, ''), id_item) AS item_label
      FROM ${table}
      WHERE ${where}
    )
    SELECT
      (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
        FROM (
          SELECT DISTINCT fecha_dcto AS value
          FROM filtered
          ORDER BY 1 DESC
        ) t
      ) AS fechas,
      (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
        FROM (
          SELECT DISTINCT id_tipo AS value, id_tipo AS label
          FROM filtered
          WHERE id_tipo <> ''
          ORDER BY 1
        ) t
      ) AS categorias,
      (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
        FROM (
          SELECT DISTINCT id_linea1 AS value, nombre_linea1 AS label
          FROM filtered
          WHERE id_linea1 <> ''
          ORDER BY 2
        ) t
      ) AS lineas,
      (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
        FROM (
          SELECT DISTINCT id_linea2 AS value, nombre_linea2 AS label, id_linea1 AS linea
          FROM filtered
          WHERE id_linea2 <> ''
          ORDER BY 3, 2
        ) t
      ) AS sublineas,
      (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
        FROM (
          SELECT DISTINCT
            id_item AS value,
            item_label AS label,
            id_item AS code,
            id_linea1 AS linea,
            id_linea2 AS sublinea
          FROM filtered
          WHERE id_item <> ''
          ORDER BY 2
          LIMIT 500
        ) t
      ) AS items
    `
      : `
    WITH filtered AS MATERIALIZED (
      SELECT
        fecha_dcto,
        TRIM(COALESCE(id_tipo::text, '')) AS id_tipo,
        TRIM(COALESCE(id_linea1::text, '')) AS id_linea1,
        COALESCE(NULLIF(TRIM(nombre_linea1), ''), TRIM(COALESCE(id_linea1::text, ''))) AS nombre_linea1,
        TRIM(COALESCE(id_linea2::text, '')) AS id_linea2,
        COALESCE(NULLIF(TRIM(nombre_linea2), ''), TRIM(COALESCE(id_linea2::text, ''))) AS nombre_linea2,
        TRIM(COALESCE(id_item::text, '')) AS id_item,
        COALESCE(NULLIF(TRIM(item_descripcion), ''), TRIM(COALESCE(id_item::text, ''))) AS item_label
      FROM ${table}
      WHERE ${where}
    )
    SELECT
      (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
        FROM (
          SELECT DISTINCT fecha_dcto AS value
          FROM filtered
          ORDER BY 1 DESC
        ) t
      ) AS fechas,
      (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
        FROM (
          SELECT DISTINCT id_tipo AS value, id_tipo AS label
          FROM filtered
          WHERE id_tipo <> ''
          ORDER BY 1
        ) t
      ) AS categorias,
      (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
        FROM (
          SELECT DISTINCT id_linea1 AS value, nombre_linea1 AS label
          FROM filtered
          WHERE id_linea1 <> ''
          ORDER BY 2
        ) t
      ) AS lineas,
      (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
        FROM (
          SELECT DISTINCT id_linea2 AS value, nombre_linea2 AS label, id_linea1 AS linea
          FROM filtered
          WHERE id_linea2 <> ''
          ORDER BY 3, 2
        ) t
      ) AS sublineas,
      (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
        FROM (
          SELECT DISTINCT
            id_item AS value,
            item_label AS label,
            id_item AS code,
            id_linea1 AS linea,
            id_linea2 AS sublinea
          FROM filtered
          WHERE id_item <> ''
          ORDER BY 2
          LIMIT 500
        ) t
      ) AS items
    `,
    params,
  );

  const row = result.rows[0] ?? {};
  const fechas = row.fechas ?? [];
  const categorias = row.categorias ?? [];
  const lineas = row.lineas ?? [];
  const sublineas = row.sublineas ?? [];
  const items = row.items ?? [];

  const empresas = sedesLocked
    ? [...new Set(
        filters.sedes
          .map((key) => parseSedeKey(key)?.empresa)
          .filter((value): value is string => Boolean(value)),
      )].map((value) => ({
        value,
        label: empresaLabel(value),
      }))
    : [];

  const sedes = filterSedeOptionsByEmpresas(
    sedesLocked
      ? filters.sedes
          .map((value) => {
            const parsed = parseSedeKey(value);
            if (!parsed) return null;
            return {
              value,
              label: sedeLabel(parsed.empresa, parsed.idCo),
              empresa: parsed.empresa,
              idCo: parsed.idCo,
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      : [],
    filters.empresas,
  );

  return {
    empresas,
    sedes,
    fechas: fechas.map((r) => ({
      value: String(r.value),
      label: formatDayLabel(String(r.value)),
    })),
    categorias: categorias.map((r) => ({
      value: String(r.value),
      label: tipoLabel(String(r.value)),
    })),
    lineas: lineas.map((entry) => ({
      value: String(entry.value),
      label: String(entry.label),
    })),
    sublineas: sublineas.map((entry) => ({
      value: String(entry.value),
      label: String(entry.label),
      linea: String(entry.linea),
    })),
    items: items.map((entry) => ({
      value: String(entry.value),
      label: String(entry.label),
      code: String(entry.code ?? entry.value),
      linea: String(entry.linea),
      sublinea: String(entry.sublinea),
    })),
  };
};

/** Búsqueda de ítems por código o nombre (sin límite fijo de catálogo inicial). */
export const queryFilterItemSearch = async (
  client: PoolClient,
  filters: MargenQueryFilters,
  table: MargenDataTable,
  search: string,
  limit = 150,
) => {
  const trimmed = search.trim();
  if (!trimmed) {
    return {
      items: [] as Array<{
        value: string;
        label: string;
        code: string;
        linea: string;
        sublinea: string;
      }>,
    };
  }

  const params: unknown[] = [];
  const where = buildMargenWhereForTable(
    {
      ...filters,
      items: [],
    },
    params,
    table,
  );
  const roll = isRollTable(table);
  params.push(`%${trimmed}%`);
  const patternIdx = params.length;

  const result = await client.query<{
    value: string;
    label: string;
    code: string;
    linea: string;
    sublinea: string;
  }>(
    roll
      ? `
    SELECT DISTINCT
      id_item AS value,
      COALESCE(NULLIF(item_descripcion, ''), id_item) AS label,
      id_item AS code,
      id_linea1 AS linea,
      id_linea2 AS sublinea
    FROM ${table}
    WHERE ${where}
      AND id_item <> ''
      AND (
        id_item ILIKE $${patternIdx}
        OR COALESCE(NULLIF(item_descripcion, ''), id_item) ILIKE $${patternIdx}
      )
    ORDER BY 2
    LIMIT ${limit}
    `
      : `
    SELECT DISTINCT
      TRIM(COALESCE(id_item::text, '')) AS value,
      COALESCE(NULLIF(TRIM(item_descripcion), ''), TRIM(COALESCE(id_item::text, ''))) AS label,
      TRIM(COALESCE(id_item::text, '')) AS code,
      TRIM(COALESCE(id_linea1::text, '')) AS linea,
      TRIM(COALESCE(id_linea2::text, '')) AS sublinea
    FROM ${table}
    WHERE ${where}
      AND TRIM(COALESCE(id_item::text, '')) <> ''
      AND (
        TRIM(COALESCE(id_item::text, '')) ILIKE $${patternIdx}
        OR COALESCE(NULLIF(TRIM(item_descripcion), ''), TRIM(COALESCE(id_item::text, ''))) ILIKE $${patternIdx}
      )
    ORDER BY 2
    LIMIT ${limit}
    `,
    params,
  );

  return {
    items: (result.rows ?? []).map((entry) => ({
      value: String(entry.value),
      label: String(entry.label),
      code: String(entry.code ?? entry.value),
      linea: String(entry.linea ?? ""),
      sublinea: String(entry.sublinea ?? ""),
    })),
  };
};
