import type { PoolClient } from "pg";
import {
  compactToIsoDate,
  parseProveedorLineaFilter,
  proveedorLineaFamiliaSql,
  type ProveedorLineaFilter,
} from "@/lib/proveedores/board-filters";
import { findTiendaSedeByName } from "@/lib/proveedores/line-family";

export type MargenLineaProveedorAgg = {
  codigo: string;
  proveedor: string;
  empresa: string | null;
  unidades: number;
  ventaNeta: number;
  costoMercancia: number;
  items: number;
  sedesActivas: number;
};

const toNum = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Venta/unidades/costo por proveedor desde el roll de ítem, recortado a una
 * familia N1 (industria / fruver / carnes).
 */
export const listMargenLineaProveedorAgg = async (
  client: PoolClient,
  args: {
    fechaInicioCompact: string;
    fechaFinCompact: string;
    linea: ProveedorLineaFilter;
    sede?: string | null;
    q?: string | null;
    limit?: number;
  },
): Promise<MargenLineaProveedorAgg[]> => {
  const linea = parseProveedorLineaFilter(args.linea);
  if (linea === "todas") return [];

  const params: unknown[] = [args.fechaInicioCompact, args.fechaFinCompact];
  const clauses = [
    `r.fecha_dcto >= $1`,
    `r.fecha_dcto <= $2`,
    `r.fecha_dcto ~ '^[0-9]{8}$'`,
    `COALESCE(r.id_tipo, '') IS DISTINCT FROM '3'`,
    proveedorLineaFamiliaSql("r.id_linea1", linea),
    `NULLIF(btrim(pi.id_cricla1), '') IS NOT NULL`,
    `btrim(pi.id_cricla1) <> '@SP'`,
  ];

  if (args.sede) {
    const tienda = findTiendaSedeByName(args.sede);
    if (tienda) {
      params.push(tienda.empresa, tienda.idCo);
      clauses.push(
        `r.empresa_norm = $${params.length - 1}`,
        `LPAD(TRIM(r.id_co_norm), 3, '0') = $${params.length}`,
      );
    }
  }

  const q = (args.q ?? "").trim().slice(0, 80);
  if (q) {
    params.push(`%${q.replace(/[%_]/g, "")}%`);
    const idx = params.length;
    clauses.push(
      `(pi.id_cricla1 ILIKE $${idx} OR COALESCE(pi.descripcion, '') ILIKE $${idx} OR COALESCE(pc.nombre, '') ILIKE $${idx})`,
    );
  }

  const limit = Math.min(Math.max(args.limit ?? 2000, 1), 5000);
  params.push(limit);

  const result = await client.query<{
    codigo: string;
    proveedor: string | null;
    empresa: string | null;
    unidades: string | number;
    venta_neta: string | number;
    costo: string | number;
    items: string | number;
    sedes: string | number;
  }>(
    `
    SELECT
      upper(btrim(pi.id_cricla1)) AS codigo,
      COALESCE(
        NULLIF(btrim(max(pc.nombre)), ''),
        NULLIF(btrim(max(pi.descripcion)), ''),
        upper(btrim(pi.id_cricla1))
      ) AS proveedor,
      max(NULLIF(btrim(pi.empresa), '')) AS empresa,
      COALESCE(SUM(r.cantidad), 0)::float8 AS unidades,
      COALESCE(SUM(r.ventas_netas), 0)::float8 AS venta_neta,
      COALESCE(SUM(r.costo_total), 0)::float8 AS costo,
      COUNT(DISTINCT r.id_item)::int AS items,
      COUNT(DISTINCT r.id_co_norm)::int AS sedes
    FROM margen_item_dia_roll r
    INNER JOIN proveedor_item pi
      ON pi.empresa = r.empresa_norm
     AND pi.id_item = r.id_item
    LEFT JOIN proveedor_pos_catalogo pc
      ON pc.empresa = pi.empresa
     AND pc.id_cricla1 = pi.id_cricla1
    WHERE ${clauses.join(" AND ")}
    GROUP BY upper(btrim(pi.id_cricla1))
    ORDER BY venta_neta DESC NULLS LAST, codigo ASC
    LIMIT $${params.length}
    `,
    params,
  );

  return (result.rows ?? []).map((row) => ({
    codigo: String(row.codigo ?? "").trim(),
    proveedor: String(row.proveedor ?? "").trim() || String(row.codigo ?? ""),
    empresa: row.empresa ? String(row.empresa).trim() : null,
    unidades: toNum(row.unidades),
    ventaNeta: toNum(row.venta_neta),
    costoMercancia: toNum(row.costo),
    items: toNum(row.items),
    sedesActivas: toNum(row.sedes),
  }));
};

export const listMargenLineaBySede = async (
  client: PoolClient,
  args: {
    fechaInicioCompact: string;
    fechaFinCompact: string;
    linea: ProveedorLineaFilter;
    sede?: string | null;
  },
): Promise<Array<{ sedeKey: string; empresa: string; idCo: string; ventaNeta: number; unidades: number; proveedores: number }>> => {
  const linea = parseProveedorLineaFilter(args.linea);
  if (linea === "todas") return [];
  const params: unknown[] = [args.fechaInicioCompact, args.fechaFinCompact];
  const clauses = [
    `r.fecha_dcto >= $1`,
    `r.fecha_dcto <= $2`,
    `r.fecha_dcto ~ '^[0-9]{8}$'`,
    `COALESCE(r.id_tipo, '') IS DISTINCT FROM '3'`,
    proveedorLineaFamiliaSql("r.id_linea1", linea),
    `NULLIF(btrim(pi.id_cricla1), '') IS NOT NULL`,
  ];
  if (args.sede) {
    const tienda = findTiendaSedeByName(args.sede);
    if (tienda) {
      params.push(tienda.empresa, tienda.idCo);
      clauses.push(
        `r.empresa_norm = $${params.length - 1}`,
        `LPAD(TRIM(r.id_co_norm), 3, '0') = $${params.length}`,
      );
    }
  }
  const result = await client.query<{
    empresa: string;
    id_co: string;
    venta_neta: string | number;
    unidades: string | number;
    proveedores: string | number;
  }>(
    `
    SELECT
      LOWER(TRIM(r.empresa_norm)) AS empresa,
      LPAD(TRIM(r.id_co_norm), 3, '0') AS id_co,
      COALESCE(SUM(r.ventas_netas), 0)::float8 AS venta_neta,
      COALESCE(SUM(r.cantidad), 0)::float8 AS unidades,
      COUNT(DISTINCT upper(btrim(pi.id_cricla1)))::int AS proveedores
    FROM margen_item_dia_roll r
    INNER JOIN proveedor_item pi
      ON pi.empresa = r.empresa_norm
     AND pi.id_item = r.id_item
    WHERE ${clauses.join(" AND ")}
    GROUP BY 1, 2
    ORDER BY venta_neta DESC
    LIMIT 15
    `,
    params,
  );
  return (result.rows ?? []).map((row) => ({
    sedeKey: `${row.empresa}|${row.id_co}`,
    empresa: String(row.empresa ?? ""),
    idCo: String(row.id_co ?? ""),
    ventaNeta: toNum(row.venta_neta),
    unidades: toNum(row.unidades),
    proveedores: toNum(row.proveedores),
  }));
};

export const listMargenLineaByDay = async (
  client: PoolClient,
  args: {
    fechaInicioCompact: string;
    fechaFinCompact: string;
    linea: ProveedorLineaFilter;
    sede?: string | null;
  },
): Promise<Array<{ fecha: string; ventaNeta: number; unidades: number; proveedores: number }>> => {
  const linea = parseProveedorLineaFilter(args.linea);
  if (linea === "todas") return [];
  const params: unknown[] = [args.fechaInicioCompact, args.fechaFinCompact];
  const clauses = [
    `r.fecha_dcto >= $1`,
    `r.fecha_dcto <= $2`,
    `r.fecha_dcto ~ '^[0-9]{8}$'`,
    `COALESCE(r.id_tipo, '') IS DISTINCT FROM '3'`,
    proveedorLineaFamiliaSql("r.id_linea1", linea),
    `NULLIF(btrim(pi.id_cricla1), '') IS NOT NULL`,
  ];
  if (args.sede) {
    const tienda = findTiendaSedeByName(args.sede);
    if (tienda) {
      params.push(tienda.empresa, tienda.idCo);
      clauses.push(
        `r.empresa_norm = $${params.length - 1}`,
        `LPAD(TRIM(r.id_co_norm), 3, '0') = $${params.length}`,
      );
    }
  }
  const result = await client.query<{
    fecha: string;
    venta_neta: string | number;
    unidades: string | number;
    proveedores: string | number;
  }>(
    `
    SELECT
      r.fecha_dcto AS fecha,
      COALESCE(SUM(r.ventas_netas), 0)::float8 AS venta_neta,
      COALESCE(SUM(r.cantidad), 0)::float8 AS unidades,
      COUNT(DISTINCT upper(btrim(pi.id_cricla1)))::int AS proveedores
    FROM margen_item_dia_roll r
    INNER JOIN proveedor_item pi
      ON pi.empresa = r.empresa_norm
     AND pi.id_item = r.id_item
    WHERE ${clauses.join(" AND ")}
    GROUP BY 1
    ORDER BY 1 ASC
    `,
    params,
  );
  return (result.rows ?? []).map((row) => ({
    fecha: compactToIsoDate(String(row.fecha ?? "")),
    ventaNeta: toNum(row.venta_neta),
    unidades: toNum(row.unidades),
    proveedores: toNum(row.proveedores),
  }));
};
