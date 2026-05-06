import { withPoolClient } from "@/lib/db";
import type {
  KardexFilters,
  KardexLookups,
  KardexResumenCategoria,
  KardexResumenItem,
  KardexRow,
  KardexTotales,
} from "./types";

type WhereBuild = {
  clause: string;
  params: unknown[];
};

const TABLE_NAME = "rotacion_base_item_dia_sede";

const toNumber = (value: unknown) => Number(value ?? 0) || 0;
const toNullableNumber = (value: unknown) =>
  value === null || value === undefined ? null : Number(value);
export const calculateMarginPctFromTotals = (
  ventas: number,
  margen: number,
): number => {
  if (!Number.isFinite(ventas) || ventas === 0) return 0;
  return Number(((margen / ventas) * 100).toFixed(2));
};

const toNullableString = (value: unknown) =>
  value === null || value === undefined ? null : String(value);

const pushFilter = (
  sqlParts: string[],
  params: unknown[],
  expression: string,
  value: unknown,
) => {
  if (value === undefined || value === null || value === "") return;
  params.push(value);
  sqlParts.push(`${expression} $${params.length}`);
};

export const buildKardexWhereClause = (filters: KardexFilters): WhereBuild => {
  const params: unknown[] = [];
  const parts = ["WHERE 1=1"];

  pushFilter(parts, params, "AND empresa =", filters.empresa);
  pushFilter(parts, params, "AND sede =", filters.sede);
  pushFilter(parts, params, "AND bodega_local =", filters.bodegaLocal);
  pushFilter(parts, params, "AND id_item =", filters.idItem);
  pushFilter(parts, params, "AND id_categoria =", filters.idCategoria);
  pushFilter(parts, params, "AND id_linea_nivel_1 =", filters.idLineaNivel1);

  if (filters.fechaDesde && filters.fechaHasta) {
    params.push(filters.fechaDesde, filters.fechaHasta);
    parts.push(
      `AND fecha_dia BETWEEN $${params.length - 1}::date AND $${params.length}::date`,
    );
  } else if (filters.fechaDesde) {
    params.push(filters.fechaDesde);
    parts.push(`AND fecha_dia >= $${params.length}::date`);
  } else if (filters.fechaHasta) {
    params.push(filters.fechaHasta);
    parts.push(`AND fecha_dia <= $${params.length}::date`);
  }

  return {
    clause: parts.join("\n  "),
    params,
  };
};

type KardexDetalleDbRow = {
  fecha_dia: string;
  empresa: string;
  sede: string;
  nombre_sede: string | null;
  bodega_local: string;
  id_item: string;
  nombre_item: string | null;
  nombre_categoria: string | null;
  nombre_linea_nivel_1: string | null;
  cantidad_vendida: string | number | null;
  ventas: string | number | null;
  costo: string | number | null;
  margen: string | number | null;
  margen_pct: string | number | null;
  precio_unit: string | number | null;
  costo_unit: string | number | null;
  inv_unidades: string | number | null;
  inv_costo_unit: string | number | null;
  inv_valor: string | number | null;
  unidades_acum: string | number;
  ventas_acum: string | number;
  costo_acum: string | number;
  margen_acum: string | number;
  margen_pct_acum: string | number | null;
};

const mapDetalleRow = (row: KardexDetalleDbRow): KardexRow => ({
  fechaDia: row.fecha_dia,
  empresa: row.empresa,
  sede: row.sede,
  nombreSede: toNullableString(row.nombre_sede),
  bodegaLocal: row.bodega_local,
  idItem: row.id_item,
  nombreItem: toNullableString(row.nombre_item),
  nombreCategoria: toNullableString(row.nombre_categoria),
  nombreLineaNivel1: toNullableString(row.nombre_linea_nivel_1),
  cantidadVendida: toNullableNumber(row.cantidad_vendida),
  ventas: toNullableNumber(row.ventas),
  costo: toNullableNumber(row.costo),
  margen: toNullableNumber(row.margen),
  margenPct: toNullableNumber(row.margen_pct),
  precioUnit: toNullableNumber(row.precio_unit),
  costoUnit: toNullableNumber(row.costo_unit),
  invUnidades: toNullableNumber(row.inv_unidades),
  invCostoUnit: toNullableNumber(row.inv_costo_unit),
  invValor: toNullableNumber(row.inv_valor),
  unidadesAcum: toNumber(row.unidades_acum),
  ventasAcum: toNumber(row.ventas_acum),
  costoAcum: toNumber(row.costo_acum),
  margenAcum: toNumber(row.margen_acum),
  margenPctAcum: toNullableNumber(row.margen_pct_acum),
});

export const getKardexDetalle = async (
  filters: KardexFilters,
): Promise<KardexRow[]> => {
  const { clause, params } = buildKardexWhereClause(filters);
  const sql = `
SELECT
  TO_CHAR(fecha_dia, 'YYYY-MM-DD')                           AS fecha_dia,
  empresa,
  sede,
  nombre_sede,
  bodega_local,
  id_item,
  nombre_item,
  nombre_categoria,
  nombre_linea_nivel_1,
  cantidad_vendida,
  ROUND(venta_sin_impuesto, 2)                               AS ventas,
  ROUND(total_costo, 2)                                      AS costo,
  ROUND(venta_sin_impuesto - total_costo, 2)                 AS margen,
  CASE WHEN COALESCE(venta_sin_impuesto,0) = 0 THEN NULL
       ELSE ROUND((venta_sin_impuesto - total_costo)
                  / venta_sin_impuesto * 100, 2)
  END                                                        AS margen_pct,
  CASE WHEN COALESCE(cantidad_vendida,0) = 0 THEN NULL
       ELSE ROUND(venta_sin_impuesto / cantidad_vendida, 4)
  END                                                        AS precio_unit,
  CASE WHEN COALESCE(cantidad_vendida,0) = 0 THEN NULL
       ELSE ROUND(total_costo / cantidad_vendida, 4)
  END                                                        AS costo_unit,
  can_disponible_foto                                        AS inv_unidades,
  ROUND(costo_uni_inventario, 4)                             AS inv_costo_unit,
  ROUND(COALESCE(can_disponible_foto,0)
        * COALESCE(costo_uni_inventario,0), 2)               AS inv_valor,
  ROUND(SUM(COALESCE(cantidad_vendida,0)) OVER w, 4)         AS unidades_acum,
  ROUND(SUM(COALESCE(venta_sin_impuesto,0)) OVER w, 2)       AS ventas_acum,
  ROUND(SUM(COALESCE(total_costo,0)) OVER w, 2)              AS costo_acum,
  ROUND(SUM(COALESCE(venta_sin_impuesto,0)
            - COALESCE(total_costo,0)) OVER w, 2)            AS margen_acum,
  CASE WHEN SUM(COALESCE(venta_sin_impuesto,0)) OVER w = 0 THEN NULL
       ELSE ROUND(
           SUM(COALESCE(venta_sin_impuesto,0)
               - COALESCE(total_costo,0)) OVER w
           / SUM(COALESCE(venta_sin_impuesto,0)) OVER w * 100, 2)
  END                                                        AS margen_pct_acum
FROM ${TABLE_NAME}
${clause}
WINDOW w AS (
  PARTITION BY empresa, sede, bodega_local, id_item
  ORDER BY fecha_dia
  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
)
ORDER BY empresa, sede, id_item, fecha_dia
  `;

  return withPoolClient(async (client) => {
    const result = await client.query(sql, params);
    return ((result.rows ?? []) as KardexDetalleDbRow[]).map(mapDetalleRow);
  });
};

type KardexResumenItemDbRow = {
  empresa: string;
  sede: string;
  nombre_sede: string | null;
  id_item: string;
  nombre_item: string | null;
  nombre_categoria: string | null;
  unidades: string | number | null;
  ventas: string | number | null;
  costo: string | number | null;
  margen: string | number | null;
  margen_pct: string | number | null;
  ultima_fecha: string | null;
  ultima_venta_pdv: string | null;
};

export const getResumenPorItem = async (
  filters: KardexFilters,
): Promise<KardexResumenItem[]> => {
  const { clause, params } = buildKardexWhereClause(filters);
  const sql = `
SELECT
  empresa, sede, nombre_sede, id_item, nombre_item, nombre_categoria,
  SUM(cantidad_vendida)                                      AS unidades,
  ROUND(SUM(venta_sin_impuesto), 2)                          AS ventas,
  ROUND(SUM(total_costo), 2)                                 AS costo,
  ROUND(SUM(venta_sin_impuesto - total_costo), 2)            AS margen,
  CASE WHEN SUM(venta_sin_impuesto) = 0 THEN 0
       ELSE ROUND(SUM(venta_sin_impuesto - total_costo)
                  / SUM(venta_sin_impuesto) * 100, 2)
  END                                                        AS margen_pct,
  TO_CHAR(MAX(fecha_dia), 'YYYY-MM-DD')                      AS ultima_fecha,
  TO_CHAR(MAX(ultima_venta_pdv), 'YYYY-MM-DD')               AS ultima_venta_pdv
FROM ${TABLE_NAME}
${clause}
GROUP BY empresa, sede, nombre_sede, id_item, nombre_item, nombre_categoria
ORDER BY margen DESC NULLS LAST
  `;
  return withPoolClient(async (client) => {
    const result = await client.query(sql, params);
    return ((result.rows ?? []) as KardexResumenItemDbRow[]).map((row) => ({
      empresa: row.empresa,
      sede: row.sede,
      nombreSede: toNullableString(row.nombre_sede),
      idItem: row.id_item,
      nombreItem: toNullableString(row.nombre_item),
      nombreCategoria: toNullableString(row.nombre_categoria),
      unidades: toNumber(row.unidades),
      ventas: toNumber(row.ventas),
      costo: toNumber(row.costo),
      margen: toNumber(row.margen),
      margenPct:
        row.margen_pct === null || row.margen_pct === undefined
          ? calculateMarginPctFromTotals(toNumber(row.ventas), toNumber(row.margen))
          : toNumber(row.margen_pct),
      ultimaFecha: toNullableString(row.ultima_fecha),
      ultimaVentaPdv: toNullableString(row.ultima_venta_pdv),
    }));
  });
};

type KardexResumenCategoriaDbRow = {
  empresa: string;
  sede: string;
  id_categoria: string | null;
  nombre_categoria: string | null;
  id_linea_nivel_1: string | null;
  nombre_linea_nivel_1: string | null;
  items: string | number | null;
  unidades: string | number | null;
  ventas: string | number | null;
  costo: string | number | null;
  margen: string | number | null;
  margen_pct: string | number | null;
};

export const getResumenPorCategoria = async (
  filters: KardexFilters,
): Promise<KardexResumenCategoria[]> => {
  const { clause, params } = buildKardexWhereClause(filters);
  const sql = `
SELECT
  empresa, sede,
  id_categoria, nombre_categoria,
  id_linea_nivel_1, nombre_linea_nivel_1,
  COUNT(DISTINCT id_item)                                    AS items,
  SUM(cantidad_vendida)                                      AS unidades,
  ROUND(SUM(venta_sin_impuesto), 2)                          AS ventas,
  ROUND(SUM(total_costo), 2)                                 AS costo,
  ROUND(SUM(venta_sin_impuesto - total_costo), 2)            AS margen,
  CASE WHEN SUM(venta_sin_impuesto) = 0 THEN 0
       ELSE ROUND(SUM(venta_sin_impuesto - total_costo)
                  / SUM(venta_sin_impuesto) * 100, 2)
  END                                                        AS margen_pct
FROM ${TABLE_NAME}
${clause}
GROUP BY empresa, sede, id_categoria, nombre_categoria,
         id_linea_nivel_1, nombre_linea_nivel_1
ORDER BY empresa, sede, margen DESC
  `;
  return withPoolClient(async (client) => {
    const result = await client.query(sql, params);
    return ((result.rows ?? []) as KardexResumenCategoriaDbRow[]).map((row) => ({
      empresa: row.empresa,
      sede: row.sede,
      idCategoria: toNullableString(row.id_categoria),
      nombreCategoria: toNullableString(row.nombre_categoria),
      idLineaNivel1: toNullableString(row.id_linea_nivel_1),
      nombreLineaNivel1: toNullableString(row.nombre_linea_nivel_1),
      items: toNumber(row.items),
      unidades: toNumber(row.unidades),
      ventas: toNumber(row.ventas),
      costo: toNumber(row.costo),
      margen: toNumber(row.margen),
      margenPct:
        row.margen_pct === null || row.margen_pct === undefined
          ? calculateMarginPctFromTotals(toNumber(row.ventas), toNumber(row.margen))
          : toNumber(row.margen_pct),
    }));
  });
};

type KardexTotalesDbRow = {
  ventas: string | number | null;
  costo: string | number | null;
  margen: string | number | null;
  margen_pct: string | number | null;
};

export const getTotales = async (
  filters: KardexFilters,
): Promise<KardexTotales> => {
  const { clause, params } = buildKardexWhereClause(filters);
  const sql = `
SELECT
  ROUND(SUM(venta_sin_impuesto), 2)                          AS ventas,
  ROUND(SUM(total_costo), 2)                                 AS costo,
  ROUND(SUM(venta_sin_impuesto - total_costo), 2)            AS margen,
  CASE WHEN SUM(venta_sin_impuesto) = 0 THEN 0
       ELSE ROUND(SUM(venta_sin_impuesto - total_costo)
                  / SUM(venta_sin_impuesto) * 100, 2)
  END                                                        AS margen_pct
FROM ${TABLE_NAME}
${clause}
  `;
  return withPoolClient(async (client) => {
    const result = await client.query(sql, params);
    const row = (result.rows?.[0] ?? {}) as KardexTotalesDbRow;
    return {
      ventas: toNumber(row.ventas),
      costo: toNumber(row.costo),
      margen: toNumber(row.margen),
      margenPct:
        row.margen_pct === null || row.margen_pct === undefined
          ? calculateMarginPctFromTotals(toNumber(row.ventas), toNumber(row.margen))
          : toNumber(row.margen_pct),
    };
  });
};

type KardexLookupDbRow = {
  empresa: string | null;
  sede: string | null;
  bodega_local: string | null;
  id_categoria: string | null;
  nombre_categoria: string | null;
  id_linea_nivel_1: string | null;
  nombre_linea_nivel_1: string | null;
};

export const getKardexLookups = async (
  filters: KardexFilters,
): Promise<KardexLookups> => {
  const { clause, params } = buildKardexWhereClause(filters);
  const sql = `
SELECT DISTINCT
  empresa,
  sede,
  bodega_local,
  id_categoria,
  nombre_categoria,
  id_linea_nivel_1,
  nombre_linea_nivel_1
FROM ${TABLE_NAME}
${clause}
ORDER BY empresa, sede, bodega_local, nombre_categoria, nombre_linea_nivel_1
  `;
  return withPoolClient(async (client) => {
    const result = await client.query(sql, params);
    const rows = (result.rows ?? []) as KardexLookupDbRow[];
    const empresas = Array.from(
      new Set(rows.map((row) => toNullableString(row.empresa)).filter(Boolean)),
    ) as string[];
    const sedes = Array.from(
      new Set(
        rows
          .map((row) => {
            const value = toNullableString(row.sede);
            const empresa = toNullableString(row.empresa);
            if (!value || !empresa) return null;
            return JSON.stringify({ value, empresa });
          })
          .filter(Boolean) as string[],
      ),
    ).map((packed) => JSON.parse(packed) as { value: string; empresa: string });
    const bodegas = Array.from(
      new Set(rows.map((row) => toNullableString(row.bodega_local)).filter(Boolean)),
    ) as string[];
    const categorias = Array.from(
      new Set(
        rows.map((row) =>
          JSON.stringify({
            idCategoria: toNullableString(row.id_categoria),
            nombreCategoria: toNullableString(row.nombre_categoria),
          }),
        ),
      ),
    ).map(
      (packed) =>
        JSON.parse(packed) as {
          idCategoria: string | null;
          nombreCategoria: string | null;
        },
    );
    const lineas = Array.from(
      new Set(
        rows.map((row) =>
          JSON.stringify({
            idLineaNivel1: toNullableString(row.id_linea_nivel_1),
            nombreLineaNivel1: toNullableString(row.nombre_linea_nivel_1),
          }),
        ),
      ),
    ).map(
      (packed) =>
        JSON.parse(packed) as {
          idLineaNivel1: string | null;
          nombreLineaNivel1: string | null;
        },
    );

    return { empresas, sedes, bodegas, categorias, lineas };
  });
};
