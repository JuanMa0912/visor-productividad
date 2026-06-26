import type { PoolClient } from "pg";
import type { MargenQueryFilters } from "@/lib/margenes/margen-final-query";
import {
  buildMargenWhereClause,
  compactDateToIso,
  empresaLabel,
  sedeLabel,
  tipoLabel,
  toMargenPct,
} from "@/lib/margenes/margen-final-query";
import {
  drillPathSqlFilters,
  type DrillPathStep,
} from "@/lib/margenes/drill-path";
import {
  factPathSqlFilters,
  type FactNavStep,
} from "@/lib/margenes/fact-path";
import {
  buildMargenOrderBy,
  MERCADO_TIPO_SQL,
  METRICS_SQL,
  marginPct,
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

const buildWhere = (
  filters: MargenQueryFilters,
  path: DrillPathStep[],
  params: unknown[],
  kpiMercadoOnly = false,
) => {
  const base = buildMargenWhereClause(filters, params);
  const drill = drillPathSqlFilters(path, params);
  const parts = [base, ...drill];
  if (kpiMercadoOnly) {
    parts.push(MERCADO_TIPO_SQL);
  }
  return parts.join(" AND ");
};

const buildFactWhere = (
  filters: MargenQueryFilters,
  path: FactNavStep[],
  params: unknown[],
) => {
  const base = buildMargenWhereClause(filters, params);
  const fact = factPathSqlFilters(path, params);
  return [base, ...fact].join(" AND ");
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

/** Todas las líneas de una factura (sin filtros de ítem/categoría del drill). */
const queryInvoiceLineRows = async (
  client: PoolClient,
  filters: MargenQueryFilters,
  documento: string,
  tipdoc: string,
  level: number,
): Promise<{ level: number; levelName: string; rows: DrillRow[] }> => {
  const params: unknown[] = [];
  let where = buildMargenWhereClause(filters, params);
  params.push(documento, tipdoc);
  where += ` AND TRIM(COALESCE(documento_fc::text, '')) = $${params.length - 1}`;
  where += ` AND TRIM(COALESCE(id_tipdoc_fc::text, '')) = $${params.length}`;
  where += ` AND NULLIF(TRIM(documento_fc::text), '') IS NOT NULL`;

  const result = await client.query(
    `
    SELECT
      TRIM(COALESCE(id_item::text, '')) AS id_item,
      COALESCE(NULLIF(TRIM(item_descripcion), ''), TRIM(COALESCE(id_item::text, ''))) AS descripcion,
      TRIM(COALESCE(id_linea1::text, '')) AS id_linea1,
      COALESCE(NULLIF(TRIM(nombre_linea1), ''), TRIM(COALESCE(id_linea1::text, ''))) AS linea,
      COALESCE(SUM(COALESCE(cantidad, 0)), 0) AS cantidad,
      COALESCE(SUM(COALESCE(vlrtot_bru, 0)), 0) AS ventas_netas,
      COALESCE(SUM(COALESCE(tot_costo, 0)), 0) AS costo_total,
      COALESCE(SUM(COALESCE(ven_totales, 0)), 0) AS ventas_con_iva
    FROM margen_final
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

export const queryKpi = async (
  client: PoolClient,
  filters: MargenQueryFilters,
  path: DrillPathStep[],
  options?: { mercadoOnly?: boolean },
) => {
  const params: unknown[] = [];
  const mercadoOnly = options?.mercadoOnly ?? path.length <= 1;
  const where = buildWhere(filters, path, params, mercadoOnly);
  const result = await client.query(
    `
    SELECT
      ${METRICS_SQL},
      COUNT(DISTINCT fecha_dcto) AS dias,
      COUNT(DISTINCT (LOWER(TRIM(COALESCE(empresa, ''))), LPAD(TRIM(COALESCE(id_co, '')), 3, '0'))) AS sedes
    FROM margen_final
    WHERE ${where}
    `,
    params,
  );
  const row = result.rows[0] ?? {};
  const metrics = mapMetrics(row);
  return {
    ...metrics,
    dias: toNum(row.dias),
    sedes: toNum(row.sedes),
    subFacturas: `${metrics.facturas} facturas`,
    subCosto: `${metrics.categorias} categ. · ${metrics.lineas} lín.`,
    subMargen: `${metrics.items} ítems · ${metrics.cantidad.toLocaleString("es-CO", { maximumFractionDigits: 2 })} uds`,
    subPct: `${toNum(row.sedes)} sedes · ${toNum(row.dias)} días`,
  };
};

export const queryDrillRows = async (
  client: PoolClient,
  filters: MargenQueryFilters,
  path: DrillPathStep[],
  search?: string,
): Promise<{ level: number; levelName: string; rows: DrillRow[] }> => {
  const level = path.length;
  const params: unknown[] = [];
  const where = buildWhere(filters, path, params);

  if (level === 0) {
    const dayWhere = `${where} AND ${MERCADO_TIPO_SQL}`;
    const result = await client.query(
      `
      SELECT fecha_dcto, ${METRICS_SQL}
      FROM margen_final
      WHERE ${dayWhere}
      GROUP BY fecha_dcto
      ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "fecha_dcto DESC")}
      `,
      params,
    );
    const rows: DrillRow[] = result.rows.map((row) => {
      const fecha = String(row.fecha_dcto);
      const metrics = mapMetrics(row);
      return {
        key: fecha,
        cod: fecha,
        label: formatDayLabel(fecha),
        drillable: true,
        drillStep: { type: "day", fecha, label: formatDayLabel(fecha) },
        ...metrics,
      };
    });
    if (rows.length > 1) {
      const acumResult = await client.query(
        `
        SELECT ${METRICS_SQL}
        FROM margen_final
        WHERE ${dayWhere}
        `,
        params,
      );
      const acc = mapMetrics(acumResult.rows[0] ?? {});
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
    return { level, levelName: "Día", rows };
  }

  if (level === 1) {
    const result = await client.query(
      `
      SELECT TRIM(COALESCE(id_tipo::text, '')) AS id_tipo, ${METRICS_SQL}
      FROM margen_final
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
    const result = await client.query(
      `
      SELECT
        TRIM(COALESCE(id_linea1::text, '')) AS id_linea1,
        COALESCE(NULLIF(TRIM(MAX(nombre_linea1)), ''), TRIM(COALESCE(id_linea1::text, ''))) AS nombre,
        ${METRICS_SQL}
      FROM margen_final
      WHERE ${where}
      GROUP BY 1
      ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "2")}
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
    const result = await client.query(
      `
      SELECT
        TRIM(COALESCE(id_linea2::text, '')) AS id_linea2,
        COALESCE(NULLIF(TRIM(MAX(nombre_linea2)), ''), TRIM(COALESCE(id_linea2::text, ''))) AS nombre,
        ${METRICS_SQL}
      FROM margen_final
      WHERE ${where}
      GROUP BY 1
      ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "2")}
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
      itemWhere += ` AND (
        LOWER(TRIM(COALESCE(id_item::text, ''))) LIKE $${params.length}
        OR LOWER(TRIM(COALESCE(item_descripcion, ''))) LIKE $${params.length}
      )`;
    }
    const result = await client.query(
      `
      SELECT
        TRIM(COALESCE(id_item::text, '')) AS id_item,
        COALESCE(NULLIF(TRIM(MAX(item_descripcion)), ''), TRIM(COALESCE(id_item::text, ''))) AS descripcion,
        ${METRICS_SQL}
      FROM margen_final
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
        TRIM(COALESCE(documento_fc::text, '')) AS documento,
        TRIM(COALESCE(id_tipdoc_fc::text, '')) AS tipdoc,
        ${METRICS_SQL}
      FROM margen_final
      WHERE ${where}
        AND NULLIF(TRIM(documento_fc::text), '') IS NOT NULL
      GROUP BY 1, 2
      ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "ventas_netas DESC")}
      LIMIT 1000
      `,
      params,
    );
    return {
      level,
      levelName: "Factura",
      rows: result.rows.map((row) => {
        const documento = String(row.documento);
        const tipdoc = String(row.tipdoc);
        const metrics = mapMetrics(row);
        return {
          key: `${documento}|${tipdoc}`,
          cod: documento,
          label: documento,
          documento,
          tipdoc,
          drillable: true,
          drillStep: {
            type: "factura",
            documento,
            tipdoc,
            label: documento,
          },
          ...metrics,
        };
      }),
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
    );
  }

  return {
    level: 6,
    levelName: "Ítems de factura",
    rows: [],
  };
};

export const queryFactNavRows = async (
  client: PoolClient,
  filters: MargenQueryFilters,
  path: FactNavStep[],
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
    );
  }

  const level = path.length;
  const params: unknown[] = [];
  const where = buildFactWhere(filters, path, params);

  if (level === 0) {
    const result = await client.query(
      `
      SELECT fecha_dcto, ${METRICS_SQL}
      FROM margen_final
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
      SELECT TRIM(COALESCE(id_tipo::text, '')) AS id_tipo, ${METRICS_SQL}
      FROM margen_final
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
      factWhere += ` AND LOWER(TRIM(COALESCE(documento_fc::text, ''))) LIKE $${params.length}`;
    }
    const result = await client.query(
      `
      SELECT
        TRIM(COALESCE(documento_fc::text, '')) AS documento,
        TRIM(COALESCE(id_tipdoc_fc::text, '')) AS tipdoc,
        ${METRICS_SQL}
      FROM margen_final
      WHERE ${factWhere}
        AND NULLIF(TRIM(documento_fc::text), '') IS NOT NULL
      GROUP BY 1, 2
      ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "ventas_netas DESC")}
      LIMIT 1000
      `,
      params,
    );
    return {
      level,
      levelName: "Factura",
      rows: result.rows.map((row) => {
        const documento = String(row.documento);
        const tipdoc = String(row.tipdoc);
        const metrics = mapMetrics(row);
        return {
          key: `${documento}|${tipdoc}`,
          cod: documento,
          label: documento,
          documento,
          tipdoc,
          drillable: true,
          ...metrics,
        };
      }),
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
  search?: string,
) => {
  const params: unknown[] = [];
  let where = buildMargenWhereClause(filters, params);
  if (search?.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    where += ` AND LOWER(TRIM(COALESCE(documento_fc::text, ''))) LIKE $${params.length}`;
  }
  const result = await client.query(
    `
    SELECT
      TRIM(COALESCE(documento_fc::text, '')) AS documento,
      TRIM(COALESCE(id_tipdoc_fc::text, '')) AS tipdoc,
      fecha_dcto,
      LOWER(TRIM(COALESCE(empresa, ''))) AS empresa,
      LPAD(TRIM(COALESCE(id_co, '')), 3, '0') AS id_co,
      ${METRICS_SQL}
    FROM margen_final
    WHERE ${where}
      AND NULLIF(TRIM(documento_fc::text), '') IS NOT NULL
    GROUP BY 1, 2, 3, 4, 5
    ${buildMargenOrderBy(filters.orderBy, filters.orderDir, "ventas_netas DESC")}
    LIMIT 1000
    `,
    params,
  );
  return result.rows.map((row) => {
    const documento = String(row.documento);
    const tipdoc = String(row.tipdoc);
    const metrics = mapMetrics(row);
    return {
      key: `${documento}|${tipdoc}`,
      cod: documento,
      label: documento,
      documento,
      tipdoc,
      fecha: formatDayLabel(String(row.fecha_dcto)),
      sede: sedeLabel(String(row.empresa), String(row.id_co)),
      drillable: true,
      ...metrics,
    };
  });
};

export const querySedeCompare = async (
  client: PoolClient,
  filters: MargenQueryFilters,
) => {
  const params: unknown[] = [];
  const where = buildMargenWhereClause(filters, params);
  const result = await client.query(
    `
    SELECT
      LOWER(TRIM(COALESCE(empresa, ''))) AS empresa,
      LPAD(TRIM(COALESCE(id_co, '')), 3, '0') AS id_co,
      COUNT(DISTINCT fecha_dcto) AS dias,
      ${METRICS_SQL}
    FROM margen_final
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

export const queryFilterOptions = async (
  client: PoolClient,
  filters: MargenQueryFilters,
) => {
  const params: unknown[] = [];
  const where = buildMargenWhereClause(
    {
      ...filters,
      categorias: [],
      lineas: [],
      sublineas: [],
      items: [],
    },
    params,
  );

  const sedesLocked = filters.sedes.length > 0;

  const result = await client.query<{
    fechas: Array<{ value: string }> | null;
    categorias: Array<{ value: string; label: string }> | null;
    lineas: Array<{ value: string; label: string }> | null;
    sublineas: Array<{ value: string; label: string }> | null;
    items: Array<{ value: string; label: string }> | null;
  }>(
    `
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
      FROM margen_final
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
          SELECT DISTINCT id_linea2 AS value, nombre_linea2 AS label
          FROM filtered
          WHERE id_linea2 <> ''
          ORDER BY 2
        ) t
      ) AS sublineas,
      (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
        FROM (
          SELECT DISTINCT id_item AS value, item_label AS label
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
          .map((key) => key.split("|")[0]?.trim().toLowerCase())
          .filter(Boolean),
      )].map((value) => ({
        value,
        label: empresaLabel(value),
      }))
    : [];

  const sedes = sedesLocked
    ? filters.sedes
        .map((value) => {
          const [empresa, idCo] = value.split("|");
          if (!empresa || !idCo) return null;
          return {
            value,
            label: sedeLabel(empresa, idCo),
            empresa,
            idCo,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    : [];

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
    lineas,
    sublineas,
    items,
  };
};
