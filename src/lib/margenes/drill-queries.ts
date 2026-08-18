import type { ClientBase } from "pg";
import type { MargenQueryFilters } from "@/lib/margenes/margen-final-query";
import {
  compactDateToIso,
  empresaLabel,
  filterSedeOptionsByEmpresas,
  parseSedeKey,
  sedeKey,
  sedeLabel,
  tipoLabel,
  toMargenPct,
} from "@/lib/margenes/margen-final-query";
import {
  buildMargenWhereForTable,
  clienteSelectSql,
  MARGEN_ITEM_DIA_ROLL_TABLE,
  MARGEN_ROLL_TABLE,
  resolveInformeMargenDataSource,
  facturaSedeSqlFilters,
  fechaDctoCompactSql,
  idTercExpr,
  isRollTable,
  mercadoTipoSql,
  nombreTercExpr,
  sedeDistinctKeySql,
  sedeSelectSql,
  shouldSkipMercadoTipoDefault,
  vendCcDescExpr,
  vendCcExpr,
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
  buildDayMetricsHybridSql,
  buildDayMetricsSql,
  buildEntityBoardMetricsSql,
  buildGroupedMetricsHybridSql,
  buildGroupedMetricsSql,
  buildMargenOrderBy,
  KPI_MERCADO_TIPO,
  metricsSqlFor,
  marginPct,
  shouldApplyMercadoTipoDefault,
  sumMetricsSqlFor,
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
  /** Fecha compacta YYYYMMDD (para lookup rápido de factura). */
  fechaDcto?: string;
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
  /** Días con venta (p. ej. ranking por sede). */
  dias?: number;
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
  const fechaDcto = cleanText(row.fecha_dcto);
  const metrics = mapMetrics(row as Record<string, string | number>);
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
    fechaDcto,
    drillable: true,
    drillStep: {
      type: "factura",
      documento,
      tipdoc,
      label: documento,
      empresa,
      idCo,
      ...(fechaDcto ? { fechaDcto } : {}),
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
  // boardMetricsSqlFor no emite categorias/lineas/items; no inventar "0 categ.".
  const hasDimCounts =
    Object.prototype.hasOwnProperty.call(row, "categorias") ||
    Object.prototype.hasOwnProperty.call(row, "lineas") ||
    Object.prototype.hasOwnProperty.call(row, "items");
  const cantidadLabel = metrics.cantidad.toLocaleString("es-CO", {
    maximumFractionDigits: 2,
  });
  return {
    key: "kpi",
    cod: "kpi",
    label: "KPI",
    drillable: false,
    ...metrics,
    dias,
    sedes,
    subFacturas: `${metrics.facturas} facturas`,
    subCosto: hasDimCounts
      ? `${metrics.categorias} categ. · ${metrics.lineas} lín.`
      : `${cantidadLabel} uds`,
    subMargen: hasDimCounts
      ? `${metrics.items} ítems · ${cantidadLabel} uds`
      : `${metrics.margenPct.toFixed(1)}% margen`,
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

/**
 * Totales nivel 0 desde filas por día (sin segundo scan SQL).
 *
 * Ventas/costo/margen/cantidad son exactos (suma aditiva).
 * `facturas`/`items`/dims suman conteos diarios: pueden sobrecontar uniques
 * entre días; se acepta para evitar ~20–25 s de `buildTotalMetricsSql`.
 */
export const aggregateLevel0TotalsFromDayRows = (
  dayRows: ReadonlyArray<
    Pick<
      DrillRow,
      | "ventasNetas"
      | "costoTotal"
      | "margenPesos"
      | "cantidad"
      | "ventasConIva"
      | "facturas"
      | "categorias"
      | "lineas"
      | "sublineas"
      | "items"
    >
  >,
  sedeCount: number,
): Record<string, string | number> => {
  let ventasNetas = 0;
  let costoTotal = 0;
  let margenPesos = 0;
  let cantidad = 0;
  let ventasConIva = 0;
  let facturas = 0;
  let items = 0;
  let categorias = 0;
  let lineas = 0;
  let sublineas = 0;

  for (const row of dayRows) {
    ventasNetas += row.ventasNetas;
    costoTotal += row.costoTotal;
    margenPesos += row.margenPesos;
    cantidad += row.cantidad;
    ventasConIva += row.ventasConIva;
    facturas += row.facturas ?? 0;
    items += row.items ?? 0;
    categorias += row.categorias ?? 0;
    lineas += row.lineas ?? 0;
    sublineas += row.sublineas ?? 0;
  }

  return {
    ventas_netas: ventasNetas,
    costo_total: costoTotal,
    margen_pesos: margenPesos,
    cantidad,
    ventas_con_iva: ventasConIva,
    facturas,
    items,
    categorias,
    lineas,
    sublineas,
    dias: dayRows.length,
    sedes: sedeCount,
  };
};

/** KPI de cabecera a partir de filas ya agregadas (evita queryKpi + COUNT DISTINCT). */
export const kpiFromAggregatedRows = (
  rows: ReadonlyArray<
    Pick<
      DrillRow,
      | "ventasNetas"
      | "costoTotal"
      | "margenPesos"
      | "cantidad"
      | "ventasConIva"
      | "facturas"
      | "dias"
    >
  >,
  sedeCount: number,
  options?: { dias?: number },
): MargenKpi => {
  const totals = aggregateLevel0TotalsFromDayRows(rows, sedeCount);
  const dias =
    options?.dias ??
    (rows.length > 0 && rows.every((row) => typeof row.dias === "number")
      ? Math.max(...rows.map((row) => row.dias ?? 0), 1)
      : Math.max(1, Number(totals.dias) || 1));
  return buildKpiPayload({
    ventas_netas: totals.ventas_netas,
    costo_total: totals.costo_total,
    margen_pesos: totals.margen_pesos,
    cantidad: totals.cantidad,
    ventas_con_iva: totals.ventas_con_iva,
    facturas: totals.facturas,
    dias,
    sedes: sedeCount,
  });
};

/**
 * ¿Se pueden sacar los conteos de dimensiones de `margen_item_dia_roll`?
 *
 * Solo con el roll legacy: esa tabla se alimenta ÚNICAMENTE de
 * `margen_final_roll` (ver refresh_margen_item_dia_roll), así que no tiene ni
 * una fila de Dinastía (verificado en GCP 2026-08-14: empresa_norm ∈
 * {bogota, mercamio, mtodo}). El guard anterior era `isFacturaItemRollTable`,
 * que también acepta `margen_dinastia_roll`: un usuario Dinastía entraba al
 * híbrido y el lado item_dia no casaba ninguna fila, así que categorías/líneas/
 * sublíneas/ítems salían en 0. Mismo criterio que ya usa `queryFilterOptions`.
 */
const canUseItemDiaHybrid = async (
  client: ClientBase,
  table: MargenDataTable,
): Promise<boolean> =>
  table === MARGEN_ROLL_TABLE &&
  (await resolveInformeMargenDataSource(client)) === MARGEN_ITEM_DIA_ROLL_TABLE;

const withMercadoDefaultCategoria = (
  filters: MargenQueryFilters,
  table: MargenDataTable,
): MargenQueryFilters => {
  if (shouldSkipMercadoTipoDefault(table)) return filters;
  if (!shouldApplyMercadoTipoDefault(filters.categorias)) return filters;
  return { ...filters, categorias: [KPI_MERCADO_TIPO] };
};

const queryDrillLevel0 = async (
  client: ClientBase,
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
  const levelFilters = withMercadoDefaultCategoria(filters, table);

  // UNA consulta (filas por día). El total/KPI/ACUMULADO se deriva en JS.
  //
  // Antes: day (~26 s) + buildTotalMetricsSql (~22 s) ≈ 49 s en julio × 11 sedes.
  // El segundo scan solo aportaba COUNT DISTINCT global de facturas/ítems/dims;
  // ventas/costo/margen ya son aditivos por día. Evitarlo corta ~40% el wall time
  // del nivel 0 y reduce competencia con `mode=filters` (que antes sumaba ~30 s
  // en paralelo y empujaba al proxy 90 s → 504).
  //
  // Híbrido: dinero+facturas en roll + dims en item_dia (~5,8 s → ~4,5 s con
  // 5 días × 13 sedes). Si item_dia no está, cae al GROUP BY completo del roll.
  let daySql: string;
  if (await canUseItemDiaHybrid(client, table)) {
    const rollWhere = buildWhere(levelFilters, [], params, table, false);
    const itemWhere = buildWhere(
      levelFilters,
      [],
      params,
      MARGEN_ITEM_DIA_ROLL_TABLE,
      false,
    );
    daySql = buildDayMetricsHybridSql(table, rollWhere, itemWhere);
  } else {
    const dayWhere = buildWhere(levelFilters, [], params, table, false);
    daySql = buildDayMetricsSql(table, dayWhere);
  }
  const dayResult = await client.query(daySql, params);

  const dayRows: DrillRow[] = dayResult.rows.map((row) => {
    const fecha = String(row.fecha_dcto);
    return {
      key: fecha,
      cod: fecha,
      label: formatDayLabel(fecha),
      drillable: true,
      drillStep: { type: "day", fecha, label: formatDayLabel(fecha) },
      ...mapMetrics(row),
    } as DrillRow;
  });

  sortDayRows(dayRows, filters);

  const needsTotal =
    (dayRows.length > 1 || options?.includeKpi === true) && dayRows.length > 0;
  const totalRow = needsTotal
    ? aggregateLevel0TotalsFromDayRows(dayRows, levelFilters.sedes.length)
    : null;

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

  // KPI: sin categorias/lineas/items (suma diaria sobrecuenta uniques); el
  // subtítulo usa cantidad / % margen en vez de "N ítems".
  const kpi =
    options?.includeKpi && totalRow
      ? buildKpiPayload({
          ventas_netas: totalRow.ventas_netas,
          costo_total: totalRow.costo_total,
          margen_pesos: totalRow.margen_pesos,
          cantidad: totalRow.cantidad,
          ventas_con_iva: totalRow.ventas_con_iva,
          facturas: totalRow.facturas,
          dias: totalRow.dias,
          sedes: totalRow.sedes,
        })
      : undefined;

  return { kpi, level: 0, levelName: "Día", rows };
};

/** Columnas ORDER BY válidas en detalle de factura (SELECT reducido). */
const INVOICE_LINE_ORDER_ALLOWED = [
  "ventasNetas",
  "costoTotal",
  "margenPesos",
  "margenPct",
  "cantidad",
  "pvuIva",
  "pcu",
];

/** Columnas ORDER BY válidas con boardMetricsSqlFor (Por Cliente / facturas). */
const BOARD_FACTURA_ORDER_ALLOWED = [
  "ventasNetas",
  "costoTotal",
  "margenPesos",
  "margenPct",
  "cantidad",
  "facturas",
  "pvuIva",
  "pcu",
];

type InvoiceFactRef = {
  documento: string;
  tipdoc: string;
  empresa?: string;
  idCo?: string;
  fechaDcto?: string;
};

/** Si el usuario tiene sedes acotadas, no servir facturas de otra sede. */
const invoiceSedeAllowed = (
  filters: MargenQueryFilters,
  factura: InvoiceFactRef,
): boolean => {
  if (filters.sedes.length === 0) return true;
  const empresa = factura.empresa?.trim();
  const idCo = factura.idCo?.trim();
  if (!empresa || !idCo) return true;
  const key = sedeKey(empresa, idCo);
  return filters.sedes.some((raw) => {
    const parsed = parseSedeKey(raw);
    return parsed !== null && sedeKey(parsed.empresa, parsed.idCo) === key;
  });
};

/**
 * WHERE del detalle de factura: igualdad por documento/tipdoc/sede/fecha
 * para usar margen_final_roll_idx_documento (evita BETWEEN + UNNEST de sedes).
 */
const buildInvoiceDetailWhere = (
  filters: MargenQueryFilters,
  factura: InvoiceFactRef,
  params: unknown[],
  table: MargenDataTable,
): string => {
  const parts: string[] = [];
  const roll = isRollTable(table);

  params.push(factura.documento, factura.tipdoc);
  parts.push(`${documentoExpr(table)} = $${params.length - 1}`);
  parts.push(`${tipdocExpr(table)} = $${params.length}`);
  parts.push(documentoNotNull(table));

  const sedeParts = facturaSedeSqlFilters(
    { empresa: factura.empresa, idCo: factura.idCo },
    params,
    table,
  );
  if (sedeParts.length > 0) {
    parts.push(...sedeParts);
  } else if (filters.sedes.length > 0) {
    const sedePairs = filters.sedes
      .map(parseSedeKey)
      .filter((pair): pair is { empresa: string; idCo: string } => pair !== null);
    if (sedePairs.length > 0) {
      const empresaList = sedePairs.map((pair) => pair.empresa);
      const coList = sedePairs.map((pair) => pair.idCo);
      params.push(empresaList, coList);
      if (roll) {
        parts.push(
          `(empresa_norm, id_co_norm) IN (
            SELECT * FROM UNNEST($${params.length - 1}::text[], $${params.length}::text[]) AS t(empresa, id_co)
          )`,
        );
      } else {
        parts.push(
          `(LOWER(TRIM(COALESCE(empresa, ''))), LPAD(TRIM(COALESCE(id_co, '')), 3, '0')) IN (
            SELECT * FROM UNNEST($${params.length - 1}::text[], $${params.length}::text[]) AS t(empresa, id_co)
          )`,
        );
      }
    }
  }

  if (factura.fechaDcto && /^[0-9]{8}$/.test(factura.fechaDcto)) {
    params.push(factura.fechaDcto);
    parts.push(`${fechaDctoCompactSql(table)} = $${params.length}`);
  } else if (filters.fechas.length > 0) {
    params.push(filters.fechas);
    parts.push(`${fechaDctoCompactSql(table)} = ANY($${params.length}::text[])`);
  } else {
    params.push(filters.fromCompact, filters.toCompact);
    parts.push(
      `${fechaDctoCompactSql(table)} BETWEEN $${params.length - 1} AND $${params.length}`,
    );
  }

  if (filters.empresas.length > 0 && !factura.empresa?.trim()) {
    params.push(filters.empresas);
    parts.push(
      roll
        ? `empresa_norm = ANY($${params.length}::text[])`
        : `LOWER(TRIM(COALESCE(empresa, ''))) = ANY($${params.length}::text[])`,
    );
  }

  if (roll) {
    if (filters.categorias.length > 0) {
      params.push(filters.categorias);
      parts.push(`id_tipo = ANY($${params.length}::text[])`);
    }
    if (filters.excludedCategorias && filters.excludedCategorias.length > 0) {
      params.push(filters.excludedCategorias);
      parts.push(`NOT (id_tipo = ANY($${params.length}::text[]))`);
    }
    if (filters.lineas.length > 0) {
      params.push(filters.lineas);
      parts.push(`id_linea1 = ANY($${params.length}::text[])`);
    }
    if (filters.sublineas.length > 0) {
      params.push(filters.sublineas);
      parts.push(`id_linea2 = ANY($${params.length}::text[])`);
    }
    if (filters.items.length > 0) {
      params.push(filters.items);
      parts.push(`id_item = ANY($${params.length}::text[])`);
    }
  } else {
    if (filters.categorias.length > 0) {
      params.push(filters.categorias);
      parts.push(
        `TRIM(COALESCE(id_tipo::text, '')) = ANY($${params.length}::text[])`,
      );
    }
    if (filters.excludedCategorias && filters.excludedCategorias.length > 0) {
      params.push(filters.excludedCategorias);
      parts.push(
        `NOT (TRIM(COALESCE(id_tipo::text, '')) = ANY($${params.length}::text[]))`,
      );
    }
    if (filters.lineas.length > 0) {
      params.push(filters.lineas);
      parts.push(
        `TRIM(COALESCE(id_linea1::text, '')) = ANY($${params.length}::text[])`,
      );
    }
    if (filters.sublineas.length > 0) {
      params.push(filters.sublineas);
      parts.push(
        `TRIM(COALESCE(id_linea2::text, '')) = ANY($${params.length}::text[])`,
      );
    }
    if (filters.items.length > 0) {
      params.push(filters.items);
      parts.push(
        `TRIM(COALESCE(id_item::text, '')) = ANY($${params.length}::text[])`,
      );
    }
  }

  return parts.join(" AND ");
};

const kpiFromInvoiceLines = (rows: DrillRow[]): MargenKpi => {
  let ventasNetas = 0;
  let costoTotal = 0;
  let cantidad = 0;
  let ventasConIva = 0;
  for (const row of rows) {
    ventasNetas += row.ventasNetas;
    costoTotal += row.costoTotal;
    cantidad += row.cantidad;
    ventasConIva += row.ventasConIva;
  }
  const margenPesos = ventasNetas - costoTotal;
  return buildKpiPayload({
    ventas_netas: ventasNetas,
    costo_total: costoTotal,
    margen_pesos: margenPesos,
    cantidad,
    ventas_con_iva: ventasConIva,
    facturas: rows.length > 0 ? 1 : 0,
    dias: rows.length > 0 ? 1 : 0,
    sedes: rows.length > 0 ? 1 : 0,
  });
};

/** Líneas de una factura vía lookup indexado (documento + tipdoc + sede + fecha). */
const queryInvoiceLineRows = async (
  client: ClientBase,
  filters: MargenQueryFilters,
  factura: InvoiceFactRef,
  level: number,
  table: MargenDataTable,
): Promise<{ level: number; levelName: string; rows: DrillRow[] }> => {
  if (!invoiceSedeAllowed(filters, factura)) {
    return { level, levelName: "Ítems de factura", rows: [] };
  }

  const params: unknown[] = [];
  const where = buildInvoiceDetailWhere(filters, factura, params, table);

  const orderSql = buildMargenOrderBy(
    filters.orderBy,
    filters.orderDir,
    "ventas_netas DESC",
    INVOICE_LINE_ORDER_ALLOWED,
  );

  const roll = isRollTable(table);
  const result = await client.query(
    roll
      ? `
    SELECT
      id_item,
      COALESCE(NULLIF(MAX(item_descripcion), ''), id_item) AS descripcion,
      MAX(id_linea1) AS id_linea1,
      COALESCE(NULLIF(MAX(nombre_linea1), ''), MAX(id_linea1)) AS linea,
      COALESCE(SUM(cantidad), 0) AS cantidad,
      COALESCE(SUM(ventas_netas), 0) AS ventas_netas,
      COALESCE(SUM(costo_total), 0) AS costo_total,
      COALESCE(SUM(margen_pesos), 0) AS margen_pesos,
      COALESCE(SUM(ventas_con_iva), 0) AS ventas_con_iva,
      CASE
        WHEN SUM(COALESCE(ventas_netas, 0)) > 0
        THEN SUM(COALESCE(margen_pesos, 0)) / SUM(COALESCE(ventas_netas, 0))
        ELSE 0
      END AS margen_pct,
      CASE
        WHEN SUM(COALESCE(cantidad, 0)) > 0
        THEN SUM(COALESCE(ventas_con_iva, 0)) / SUM(COALESCE(cantidad, 0))
        ELSE 0
      END AS pvu_iva,
      CASE
        WHEN SUM(COALESCE(cantidad, 0)) > 0
        THEN SUM(COALESCE(costo_total, 0)) / SUM(COALESCE(cantidad, 0))
        ELSE 0
      END AS pcu
    FROM ${table}
    WHERE ${where}
    GROUP BY id_item
    ${orderSql}
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
      COALESCE(SUM(COALESCE(vlrtot_bru, 0) - COALESCE(tot_costo, 0)), 0) AS margen_pesos,
      COALESCE(SUM(COALESCE(ven_totales, 0)), 0) AS ventas_con_iva,
      CASE
        WHEN SUM(COALESCE(vlrtot_bru, 0)) > 0
        THEN SUM(COALESCE(vlrtot_bru, 0) - COALESCE(tot_costo, 0))
             / SUM(COALESCE(vlrtot_bru, 0))
        ELSE 0
      END AS margen_pct,
      CASE
        WHEN SUM(COALESCE(cantidad, 0)) > 0
        THEN SUM(COALESCE(ven_totales, 0)) / SUM(COALESCE(cantidad, 0))
        ELSE 0
      END AS pvu_iva,
      CASE
        WHEN SUM(COALESCE(cantidad, 0)) > 0
        THEN SUM(COALESCE(tot_costo, 0)) / SUM(COALESCE(cantidad, 0))
        ELSE 0
      END AS pcu
    FROM ${table}
    WHERE ${where}
    GROUP BY 1, 2, 3, 4
    ${orderSql}
    `,
    params,
  );

  return {
    level,
    levelName: "Ítems de factura",
    rows: mapInvoiceLineRows(result.rows),
  };
};

/** Detalle de factura: un solo round-trip; KPI se agrega desde las líneas. */
export const queryInvoiceDetailBoard = async (
  client: ClientBase,
  filters: MargenQueryFilters,
  factura: InvoiceFactRef,
  table: MargenDataTable,
  level = 3,
): Promise<{
  kpi: MargenKpi;
  level: number;
  levelName: string;
  rows: DrillRow[];
}> => {
  const tableResult = await queryInvoiceLineRows(
    client,
    filters,
    factura,
    level,
    table,
  );
  return {
    kpi: kpiFromInvoiceLines(tableResult.rows),
    ...tableResult,
  };
};

export const queryKpi = async (
  client: ClientBase,
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
    !shouldSkipMercadoTipoDefault(table) &&
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
  client: ClientBase,
  filters: MargenQueryFilters,
  path: DrillPathStep[],
  table: MargenDataTable,
  search?: string,
): Promise<{ level: number; levelName: string; rows: DrillRow[] }> => {
  const level = path.length;

  if (level === 0) {
    const board = await queryDrillLevel0(client, filters, table);
    return board;
  }

  const params: unknown[] = [];
  const where = buildWhere(filters, path, params, table);

  // Niveles 1..4 agrupan por dimensiones que `margen_item_dia_roll` también
  // tiene: los conteos de categorías/líneas/sublíneas/ítems salen de ahí y solo
  // el dinero + facturas siguen leyendo el roll factura+ítem. Nivel 5 (factura)
  // y el detalle sí necesitan `documento_fc`, que item_dia no guarda.
  const hybrid = level <= 4 && (await canUseItemDiaHybrid(client, table));
  /**
   * WHERE gemelo sobre item_dia. Encola sus params DESPUÉS de los del roll en
   * el MISMO array, que es lo que espera `buildGroupedMetricsHybridSql`.
   * Ojo: solo llamar cuando el híbrido está activo; si no, quedarían params de
   * más y el bind falla.
   */
  const itemDiaWhere = () =>
    buildWhere(filters, path, params, MARGEN_ITEM_DIA_ROLL_TABLE);

  if (level === 1) {
    const group = { keySql: idTipoExpr(table), keyAlias: "id_tipo" };
    const orderBy = buildMargenOrderBy(filters.orderBy, filters.orderDir, "1");
    const result = await client.query(
      hybrid
        ? buildGroupedMetricsHybridSql(
            table,
            where,
            itemDiaWhere(),
            group,
            orderBy,
          )
        : buildGroupedMetricsSql(table, where, group, orderBy),
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
    const labelSrc = isRollTable(table)
      ? "NULLIF(nombre_linea1, '')"
      : "NULLIF(TRIM(nombre_linea1), '')";
    const group = {
      keySql: idLinea1Expr(table),
      keyAlias: "id_linea1",
      labelSourceSql: labelSrc,
      labelAlias: "nombre",
    };
    const orderBy = buildMargenOrderBy(filters.orderBy, filters.orderDir, "1");
    const result = await client.query(
      hybrid
        ? buildGroupedMetricsHybridSql(
            table,
            where,
            itemDiaWhere(),
            group,
            orderBy,
          )
        : buildGroupedMetricsSql(table, where, group, orderBy),
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
    const labelSrc = isRollTable(table)
      ? "NULLIF(nombre_linea2, '')"
      : "NULLIF(TRIM(nombre_linea2), '')";
    const group = {
      keySql: idLinea2Expr(table),
      keyAlias: "id_linea2",
      labelSourceSql: labelSrc,
      labelAlias: "nombre",
    };
    const orderBy = buildMargenOrderBy(filters.orderBy, filters.orderDir, "1");
    const result = await client.query(
      hybrid
        ? buildGroupedMetricsHybridSql(
            table,
            where,
            itemDiaWhere(),
            group,
            orderBy,
          )
        : buildGroupedMetricsSql(table, where, group, orderBy),
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
    // El filtro de búsqueda se reusa TAL CUAL en el lado item_dia: ambas tablas
    // son rolls, así que `id_item` / `item_descripcion` se escriben igual y el
    // placeholder ya empujado sirve para las dos (un $n puede repetirse).
    let searchClause = "";
    if (search?.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      const itemCol = idItemExpr(table);
      const descCol = isRollTable(table)
        ? "item_descripcion"
        : "TRIM(COALESCE(item_descripcion, ''))";
      searchClause = ` AND (
        LOWER(${itemCol}) LIKE $${params.length}
        OR LOWER(${descCol}) LIKE $${params.length}
      )`;
    }
    const itemWhere = where + searchClause;
    const labelSrc = isRollTable(table)
      ? "NULLIF(item_descripcion, '')"
      : "NULLIF(TRIM(item_descripcion), '')";
    const group = {
      keySql: idItemExpr(table),
      keyAlias: "id_item",
      labelSourceSql: labelSrc,
      labelAlias: "descripcion",
    };
    const orderBy = buildMargenOrderBy(
      filters.orderBy,
      filters.orderDir,
      "ventas_netas DESC",
    );
    const result = await client.query(
      hybrid
        ? buildGroupedMetricsHybridSql(
            table,
            itemWhere,
            itemDiaWhere() + searchClause,
            group,
            orderBy,
            "LIMIT 1000",
          )
        : buildGroupedMetricsSql(table, itemWhere, group, orderBy, "LIMIT 1000"),
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
    return queryInvoiceLineRows(client, filters, factura, 6, table);
  }

  return {
    level: 6,
    levelName: "Ítems de factura",
    rows: [],
  };
};

/** Vista drill con KPI: un solo escaneo en nivel 0. */
export const queryDrillBoard = async (
  client: ClientBase,
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
  const factura = kpiPath.find((step) => step.type === "factura");
  if (factura?.type === "factura") {
    return queryInvoiceDetailBoard(client, filters, factura, table, 6);
  }

  // Una sola query de filas (HashAggregate). KPI se deriva en JS: evita el
  // segundo scan con metricsSqlFor (antes duplicaba el minuto al abrir un día).
  const tableResult = await queryDrillRows(
    client,
    filters,
    path,
    table,
    search,
  );
  const dias = path.some((step) => step.type === "day") ? 1 : undefined;
  const kpi = kpiFromAggregatedRows(tableResult.rows, filters.sedes.length, {
    dias,
  });
  return { kpi, ...tableResult };
};

export const queryFactNavRows = async (
  client: ClientBase,
  filters: MargenQueryFilters,
  path: FactNavStep[],
  table: MargenDataTable,
  search?: string,
): Promise<{ level: number; levelName: string; rows: DrillRow[] }> => {
  const factura = path.find((step) => step.type === "factura");
  if (factura?.type === "factura") {
    return queryInvoiceLineRows(client, filters, factura, 3, table);
  }

  const level = path.length;
  const params: unknown[] = [];
  const where = buildFactWhere(filters, path, params, table);

  if (level === 0) {
    // Misma forma (y mismo costo) que el nivel 0 del drill. Híbrido con
    // item_dia cuando existe (dinero+facturas en roll, dims en item_dia).
    const orderBy = buildMargenOrderBy(
      filters.orderBy,
      filters.orderDir,
      "fecha_dcto DESC",
    );
    let daySql: string;
    if (await canUseItemDiaHybrid(client, table)) {
      const itemWhere = buildFactWhere(
        filters,
        path,
        params,
        MARGEN_ITEM_DIA_ROLL_TABLE,
      );
      daySql = buildDayMetricsHybridSql(table, where, itemWhere, orderBy);
    } else {
      daySql = buildDayMetricsSql(table, where, orderBy);
    }
    const result = await client.query(daySql, params);
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
      buildGroupedMetricsSql(
        table,
        where,
        { keySql: idTipoExpr(table), keyAlias: "id_tipo" },
        "ORDER BY 1",
      ),
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
    // SUM only: el GROUP BY ya es la factura → facturas=1, sin COUNT DISTINCT.
    const result = await client.query(
      `
      SELECT
        ${documentoExpr(table)} AS documento,
        ${tipdocExpr(table)} AS tipdoc,
        ${sedeSelectSql(table)},
        ${clienteSelectSql(table)},
        ${sumMetricsSqlFor(table)}
      FROM ${table}
      WHERE ${factWhere}
        AND ${documentoNotNull(table)}
      GROUP BY 1, 2, 3, 4
      ${buildMargenOrderBy(
        filters.orderBy,
        filters.orderDir,
        "ventas_netas DESC",
        BOARD_FACTURA_ORDER_ALLOWED,
      )}
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
  client: ClientBase,
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
      ${sumMetricsSqlFor(table)}
    FROM ${table}
    WHERE ${where}
      AND ${documentoNotNull(table)}
    GROUP BY 1, 2, 3, 4, 5
    ${buildMargenOrderBy(
      filters.orderBy,
      filters.orderDir,
      "ventas_netas DESC",
      BOARD_FACTURA_ORDER_ALLOWED,
    )}
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
  client: ClientBase,
  filters: MargenQueryFilters,
  table: MargenDataTable,
) => {
  const params: unknown[] = [];
  const where = buildMargenWhereForTable(filters, params, table);
  const keySql = isRollTable(table)
    ? `(empresa_norm || '|' || id_co_norm)`
    : `(LOWER(TRIM(COALESCE(empresa, ''))) || '|' || LPAD(TRIM(COALESCE(id_co, '')), 3, '0'))`;
  const result = await client.query(
    buildEntityBoardMetricsSql(
      table,
      where,
      {
        keySql,
        keyAlias: "sede_key",
        includeDias: true,
      },
      buildMargenOrderBy(
        filters.orderBy,
        filters.orderDir ?? "desc",
        "ventas_netas DESC",
        BOARD_FACTURA_ORDER_ALLOWED,
      ),
    ),
    params,
  );
  return result.rows.map((row) => {
    const mapped = mapMetrics(row);
    const sedeKey = String(row.sede_key ?? "");
    const pipe = sedeKey.indexOf("|");
    const empresa = pipe >= 0 ? sedeKey.slice(0, pipe) : sedeKey;
    const idCo = pipe >= 0 ? sedeKey.slice(pipe + 1) : "";
    return {
      key: sedeKey,
      empresa: empresaLabel(empresa),
      cod: idCo,
      sede: sedeLabel(empresa, idCo),
      dias: toNum(row.dias),
      drillable: true,
      ...mapped,
    };
  });
};

const diasSpanFromFilters = (filters: MargenQueryFilters): number => {
  if (filters.fechas.length > 0) return Math.max(1, filters.fechas.length);
  const from = filters.fromCompact;
  const to = filters.toCompact;
  if (!/^\d{8}$/.test(from) || !/^\d{8}$/.test(to)) return 1;
  const start = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(4, 6)) - 1,
    Number(from.slice(6, 8)),
  );
  const end = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(4, 6)) - 1,
    Number(to.slice(6, 8)),
  );
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
};

const SIN_CLIENTE_LABEL = "Sin cliente";

/** KPI + filas de clientes en un solo barrido (HashAggregate, sin meta DISTINCT). */
export const queryClienteCompare = async (
  client: ClientBase,
  filters: MargenQueryFilters,
  table: MargenDataTable,
  search?: string,
): Promise<{
  kpi: MargenKpi;
  rows: DrillRow[];
  truncated: boolean;
  totalClientes: number;
}> => {
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
    buildEntityBoardMetricsSql(
      table,
      where,
      {
        keySql: idTerc,
        keyAlias: "id_terc",
        labelSourceSql: nombreTerc,
        labelAlias: "nombre_terc",
      },
      "",
    ),
    params,
  );

  const orderBy = filters.orderBy;
  const orderDir = filters.orderDir === "asc" ? 1 : -1;
  const allRows = result.rows.map((row) => {
    const metricsMapped = mapMetrics(row);
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
      ...metricsMapped,
    } satisfies DrillRow;
  });

  allRows.sort((a, b) => {
    if (orderBy) {
      const av = a[orderBy as keyof DrillRow];
      const bv = b[orderBy as keyof DrillRow];
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * orderDir;
      }
      if (av !== undefined || bv !== undefined) {
        return (
          String(av ?? "").localeCompare(String(bv ?? ""), "es", {
            numeric: true,
          }) * orderDir
        );
      }
    }
    return (b.ventasNetas - a.ventasNetas) * (filters.orderDir === "asc" ? -1 : 1);
  });

  const kpi = kpiFromAggregatedRows(allRows, filters.sedes.length, {
    dias: diasSpanFromFilters(filters),
  });

  const truncated = allRows.length > 1000;
  return {
    kpi,
    rows: allRows.slice(0, 1000),
    truncated,
    totalClientes: allRows.length,
  };
};

const SIN_VENDEDOR_LABEL = "Sin vendedor";

/** KPI + filas de vendedores en un solo barrido (HashAggregate, sin meta DISTINCT). */
export const queryVendedorCompare = async (
  client: ClientBase,
  filters: MargenQueryFilters,
  table: MargenDataTable,
  search?: string,
): Promise<{
  kpi: MargenKpi;
  rows: DrillRow[];
  truncated: boolean;
  totalVendedores: number;
}> => {
  const params: unknown[] = [];
  let where = buildMargenWhereForTable(filters, params, table);
  const vendCc = vendCcExpr(table);
  const vendCcDesc = vendCcDescExpr(table);

  if (search?.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    where += ` AND (
      LOWER(${vendCc}) LIKE $${params.length}
      OR LOWER(COALESCE(${vendCcDesc}, '')) LIKE $${params.length}
    )`;
  }

  const result = await client.query(
    buildEntityBoardMetricsSql(
      table,
      where,
      {
        keySql: vendCc,
        keyAlias: "vend_cc",
        labelSourceSql: vendCcDesc,
        labelAlias: "vend_cc_desc",
      },
      "",
    ),
    params,
  );

  const orderBy = filters.orderBy;
  const orderDir = filters.orderDir === "asc" ? 1 : -1;
  const allRows = result.rows.map((row) => {
    const metricsMapped = mapMetrics(row);
    const code = String(row.vend_cc ?? "").trim();
    const nombre = cleanText(row.vend_cc_desc);
    const label = nombre ?? (code ? code : SIN_VENDEDOR_LABEL);
    return {
      key: code || "__SIN_VENDEDOR__",
      cod: code || "—",
      label,
      vendCc: code || undefined,
      vendCcDesc: nombre,
      drillable: true,
      ...metricsMapped,
    } satisfies DrillRow;
  });

  allRows.sort((a, b) => {
    if (orderBy) {
      const av = a[orderBy as keyof DrillRow];
      const bv = b[orderBy as keyof DrillRow];
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * orderDir;
      }
      if (av !== undefined || bv !== undefined) {
        return (
          String(av ?? "").localeCompare(String(bv ?? ""), "es", {
            numeric: true,
          }) * orderDir
        );
      }
    }
    return (b.ventasNetas - a.ventasNetas) * (filters.orderDir === "asc" ? -1 : 1);
  });

  const kpi = kpiFromAggregatedRows(allRows, filters.sedes.length, {
    dias: diasSpanFromFilters(filters),
  });

  const truncated = allRows.length > 1000;
  return {
    kpi,
    rows: allRows.slice(0, 1000),
    truncated,
    totalVendedores: allRows.length,
  };
};

/** KPI + facturas de un vendedor; ambas queries usan indice (vend_cc, fecha). */
export const queryVendedorFacturas = async (
  client: ClientBase,
  filters: MargenQueryFilters,
  table: MargenDataTable,
  vendCc: string,
  search?: string,
): Promise<{ kpi: MargenKpi; rows: DrillRow[] }> => {
  const buildWhere = () => {
    const params: unknown[] = [];
    let where = buildMargenWhereForTable(filters, params, table);
    const vendCcSql = vendCcExpr(table);
    params.push(vendCc.trim());
    where += ` AND ${vendCcSql} = $${params.length}`;
    if (search?.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      where += ` AND LOWER(${documentoExpr(table)}) LIKE $${params.length}`;
    }
    where += ` AND ${documentoNotNull(table)}`;
    return { where, params };
  };

  const rowMetrics = sumMetricsSqlFor(table);
  const sedeCols = sedeSelectSql(table);
  const { where: kpiWhere, params: kpiParams } = buildWhere();
  const { where: rowWhere, params: rowParams } = buildWhere();

  const kpiResult = await client.query(
    buildEntityBoardMetricsSql(
      table,
      kpiWhere,
      { keySql: `'all'`, keyAlias: "grp", includeDias: true },
    ),
    kpiParams,
  );
  const rowResult = await client.query(
    `
    SELECT
      ${documentoExpr(table)} AS documento,
      ${tipdocExpr(table)} AS tipdoc,
      fecha_dcto,
      ${sedeCols},
      ${clienteSelectSql(table)},
      ${rowMetrics}
    FROM ${table}
    WHERE ${rowWhere}
    GROUP BY 1, 2, 3, 4, 5
    ${buildMargenOrderBy(
      filters.orderBy,
      filters.orderDir ?? "desc",
      "ventas_netas",
      BOARD_FACTURA_ORDER_ALLOWED,
    )}
    LIMIT 1000
    `,
    rowParams,
  );

  const rows = rowResult.rows.map((row) => {
    const mapped = mapFacturaBoardRow(row);
    return {
      ...mapped,
      key: `${mapped.empresa}|${mapped.idCo}|${mapped.documento}|${mapped.tipdoc}|${String(row.fecha_dcto)}`,
      fecha: formatDayLabel(String(row.fecha_dcto)),
    };
  });

  const kpiRow = kpiResult.rows[0] ?? {};
  return {
    kpi: buildKpiPayload({
      ...kpiRow,
      sedes: filters.sedes.length,
    }),
    rows,
  };
};

/** KPI + facturas de un cliente; ambas queries usan indice (id_terc, fecha). */
export const queryClienteFacturas = async (
  client: ClientBase,
  filters: MargenQueryFilters,
  table: MargenDataTable,
  idTerc: string,
  search?: string,
): Promise<{ kpi: MargenKpi; rows: DrillRow[] }> => {
  const buildWhere = () => {
    const params: unknown[] = [];
    let where = buildMargenWhereForTable(filters, params, table);
    const idTercSql = idTercExpr(table);
    params.push(idTerc.trim());
    where += ` AND ${idTercSql} = $${params.length}`;
    if (search?.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      where += ` AND LOWER(${documentoExpr(table)}) LIKE $${params.length}`;
    }
    where += ` AND ${documentoNotNull(table)}`;
    return { where, params };
  };

  const rowMetrics = sumMetricsSqlFor(table);
  const sedeCols = sedeSelectSql(table);
  const { where: kpiWhere, params: kpiParams } = buildWhere();
  const { where: rowWhere, params: rowParams } = buildWhere();

  // Secuencial: mismo ClientBase no soporta queries concurrentes.
  // KPI sin COUNT(DISTINCT) exterior (HashAgg); sedes del filtro.
  const kpiResult = await client.query(
    buildEntityBoardMetricsSql(
      table,
      kpiWhere,
      { keySql: `'all'`, keyAlias: "grp", includeDias: true },
    ),
    kpiParams,
  );
  const rowResult = await client.query(
    `
    SELECT
      ${documentoExpr(table)} AS documento,
      ${tipdocExpr(table)} AS tipdoc,
      fecha_dcto,
      ${sedeCols},
      ${clienteSelectSql(table)},
      ${rowMetrics}
    FROM ${table}
    WHERE ${rowWhere}
    GROUP BY 1, 2, 3, 4, 5
    ${buildMargenOrderBy(
      filters.orderBy,
      filters.orderDir ?? "desc",
      "ventas_netas",
      BOARD_FACTURA_ORDER_ALLOWED,
    )}
    LIMIT 1000
    `,
    rowParams,
  );

  const rows = rowResult.rows.map((row) => {
    const mapped = mapFacturaBoardRow(row);
    return {
      ...mapped,
      key: `${mapped.empresa}|${mapped.idCo}|${mapped.documento}|${mapped.tipdoc}|${String(row.fecha_dcto)}`,
      fecha: formatDayLabel(String(row.fecha_dcto)),
    };
  });

  const kpiRow = kpiResult.rows[0] ?? {};
  return {
    kpi: buildKpiPayload({
      ...kpiRow,
      sedes: filters.sedes.length,
    }),
    rows,
  };
};

export const queryFilterOptions = async (
  client: ClientBase,
  filters: MargenQueryFilters,
  table: MargenDataTable,
) => {
  // Los desplegables solo necesitan DIMENSIONES (fecha, categoría, línea,
  // sublínea, ítem y sus nombres). Todas viven en margen_item_dia_roll, que es
  // el mismo dato ya colapsado a día/sede/ítem: para julio son 1.029.776 filas
  // contra 8.262.298 de margen_final_roll, porque este último repite cada ítem
  // una vez por factura.
  //
  // Medido contra producción el 2026-07-31, alternando A/B para no confundir
  // caché fría con costo real (la primera lectura de item_dia_roll dio 31,8 s
  // por venir de disco, y estuve a punto de descartarla por eso):
  //
  //            margen_item_dia_roll   margen_final_roll
  //   ronda 1        5.850 ms             39.179 ms
  //   ronda 2        3.879 ms             13.094 ms   <- en caliente, 3,4x
  //   ronda 3        5.769 ms
  //
  // Verificado que los cinco desplegables salen idénticos byte a byte desde
  // ambas tablas (30 fechas, 2 categorías, 51 líneas, 216 sublíneas, 500 ítems).
  //
  // Si la tabla no existe o está vacía, `resolveInformeMargenDataSource` cae
  // sola a la fuente anterior. El riesgo residual es que el refresco del roll
  // falle un día: los desplegables quedarían sin los ítems nuevos, pero las
  // cifras del tablero (que salen de `table`) siguen correctas.
  const resolved =
    table === MARGEN_ROLL_TABLE
      ? await resolveInformeMargenDataSource(client)
      : table;
  const catalogTable =
    resolved === MARGEN_ITEM_DIA_ROLL_TABLE ? resolved : table;

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
    catalogTable,
  );

  const sedesLocked = filters.sedes.length > 0;
  const roll = isRollTable(catalogTable);

  const result = await client.query<{
    fechas: Array<{ value: string }> | null;
    categorias: Array<{ value: string; label: string }> | null;
    lineas: Array<{ value: string; label: string }> | null;
    sublineas: Array<{ value: string; label: string; linea: string }> | null;
    items: Array<{ value: string; label: string; code?: string; linea: string; sublinea: string }> | null;
  }>(
    roll
      ? `
    -- El DISTINCT del CTE NO es cosmetico: colapsa la relacion antes de que las
    -- cinco subconsultas la recorran. Medido contra produccion el 2026-07-31
    -- (julio x 11 sedes): 8.262.298 filas -> 245.252 (34x menos), y la consulta
    -- baja de 29,6 s a 13,2 s.
    --
    -- No cambia ningun resultado: las cinco salidas ya aplican su propio
    -- DISTINCT, asi que deduplicar antes produce los mismos conjuntos.
    -- Verificado campo por campo contra la version sin DISTINCT: fechas,
    -- categorias, lineas y sublineas salen identicas byte a byte, y los items
    -- coinciden 500/500. El JSON de items no coincidia byte a byte solo por el
    -- ORDEN de los empates de etiqueta, que era no determinista de antes; por
    -- eso ahora ese ORDER BY lleva desempate (ver abajo).
    WITH filtered AS MATERIALIZED (
      SELECT DISTINCT
        fecha_dcto,
        id_tipo,
        id_linea1,
        COALESCE(NULLIF(nombre_linea1, ''), id_linea1) AS nombre_linea1,
        id_linea2,
        COALESCE(NULLIF(nombre_linea2, ''), id_linea2) AS nombre_linea2,
        id_item,
        COALESCE(NULLIF(item_descripcion, ''), id_item) AS item_label
      FROM ${catalogTable}
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
          -- Desempate por id_item: ordenar solo por la etiqueta NO es un orden
          -- total, hay descripciones repetidas entre items distintos. Con un
          -- LIMIT 500 encima, el corte y el orden dependian del plan: el mismo
          -- filtro podia devolver los empates en distinto orden entre cargas.
          -- Verificado al cambiar el plan de esta consulta el 2026-07-31: el
          -- conjunto de 500 salia identico (500/500) pero el JSON no coincidia
          -- byte a byte.
          ORDER BY 2, 1
          LIMIT 500
        ) t
      ) AS items
    `
      : `
    -- Mismo DISTINCT que la rama roll, por la misma razon.
    WITH filtered AS MATERIALIZED (
      SELECT DISTINCT
        fecha_dcto,
        TRIM(COALESCE(id_tipo::text, '')) AS id_tipo,
        TRIM(COALESCE(id_linea1::text, '')) AS id_linea1,
        COALESCE(NULLIF(TRIM(nombre_linea1), ''), TRIM(COALESCE(id_linea1::text, ''))) AS nombre_linea1,
        TRIM(COALESCE(id_linea2::text, '')) AS id_linea2,
        COALESCE(NULLIF(TRIM(nombre_linea2), ''), TRIM(COALESCE(id_linea2::text, ''))) AS nombre_linea2,
        TRIM(COALESCE(id_item::text, '')) AS id_item,
        COALESCE(NULLIF(TRIM(item_descripcion), ''), TRIM(COALESCE(id_item::text, ''))) AS item_label
      FROM ${catalogTable}
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
          -- Desempate por id_item: ordenar solo por la etiqueta NO es un orden
          -- total, hay descripciones repetidas entre items distintos. Con un
          -- LIMIT 500 encima, el corte y el orden dependian del plan: el mismo
          -- filtro podia devolver los empates en distinto orden entre cargas.
          -- Verificado al cambiar el plan de esta consulta el 2026-07-31: el
          -- conjunto de 500 salia identico (500/500) pero el JSON no coincidia
          -- byte a byte.
          ORDER BY 2, 1
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
  client: ClientBase,
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
