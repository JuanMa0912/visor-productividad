import type { PoolClient } from "pg";
import { listMargenSedeCatalogOptions } from "@/lib/margenes/margen-sede-catalog";
import type {
  PreciosProveedorCell,
  PreciosProveedorMatrix,
  PreciosProveedorMeta,
  PreciosProveedorRow,
  PreciosProveedorSedeColumn,
} from "@/lib/exp-precios-proveedor/types";

const toNum = (value: string | number | null | undefined) =>
  Number(value ?? 0) || 0;

const isoToCompact = (iso: string) => iso.replace(/-/g, "");

const compactToIso = (compact: string): string | null => {
  const raw = String(compact ?? "").trim();
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return null;
};

const unitPrice = (money: number, units: number) =>
  units > 0 ? money / units : 0;

const marginPct = (sales: number, cost: number) =>
  sales > 0 ? ((sales - cost) / sales) * 100 : 0;

/** Sedes tienda (sin Dinastía / plantas). */
export const prototypeSedeColumns = (): PreciosProveedorSedeColumn[] =>
  listMargenSedeCatalogOptions()
    .filter((opt) => opt.empresa !== "dinastia")
    .map((opt) => ({
      key: opt.value,
      label: opt.label,
      empresa: opt.empresa,
      idCo: opt.idCo,
    }));

export const resolveDefaultDateRange = async (
  client: PoolClient,
): Promise<{ start: string; end: string; min: string | null; max: string | null }> => {
  const bounds = await client.query<{ min: string | null; max: string | null }>(`
    SELECT MIN(fecha_dcto) AS min, MAX(fecha_dcto) AS max
    FROM margen_item_dia_roll
    WHERE fecha_dcto ~ '^[0-9]{8}$'
  `);
  const min = compactToIso(String(bounds.rows[0]?.min ?? ""));
  const max = compactToIso(String(bounds.rows[0]?.max ?? ""));
  if (!max) {
    const today = new Date();
    const end = today.toISOString().slice(0, 10);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 6);
    return {
      start: startDate.toISOString().slice(0, 10),
      end,
      min,
      max,
    };
  }
  const endDate = new Date(`${max}T12:00:00`);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 6);
  let start = startDate.toISOString().slice(0, 10);
  if (min && start < min) start = min;
  return { start, end: max, min, max };
};

export const queryPreciosProveedorMeta = async (
  client: PoolClient,
): Promise<PreciosProveedorMeta> => {
  const range = await resolveDefaultDateRange(client);
  const lineas = await client.query<{ id: string; label: string }>(`
    SELECT id_linea1 AS id,
           COALESCE(NULLIF(MAX(nombre_linea1), ''), id_linea1) AS label
    FROM margen_item_dia_roll
    WHERE NULLIF(id_linea1, '') IS NOT NULL
      AND TRIM(COALESCE(id_tipo, '')) = '4'
    GROUP BY id_linea1
    ORDER BY 1
    LIMIT 80
  `);
  return {
    minDate: range.min,
    maxDate: range.max,
    defaultStart: range.start,
    defaultEnd: range.end,
    lineas: lineas.rows.map((row) => ({
      id: String(row.id),
      label: `${row.id} · ${row.label}`,
    })),
    note:
      "Prototipo admin: PVU/PCU = promedio ponderado de venta (margen_item_dia_roll). Proveedor = maestro POS (proveedor_item), no factura de compra. Sin rollup dedicado: acota fechas.",
  };
};

export type PreciosProveedorQueryInput = {
  fromIso: string;
  toIso: string;
  lineaId?: string | null;
  search?: string | null;
  itemLimit?: number;
};

/**
 * Heatmap ítem × sede con proveedor.
 * Fuente: margen_item_dia_roll + LEFT JOIN proveedor_item / proveedor_pos_catalogo.
 * Mercado (id_tipo=4) por defecto, como márgenes.
 */
export const queryPreciosProveedorMatrix = async (
  client: PoolClient,
  input: PreciosProveedorQueryInput,
): Promise<PreciosProveedorMatrix> => {
  const t0 = performance.now();
  const fromCompact = isoToCompact(input.fromIso);
  const toCompact = isoToCompact(input.toIso);
  const itemLimit = Math.min(80, Math.max(10, Number(input.itemLimit) || 40));
  const columns = prototypeSedeColumns();
  const sedeKeys = columns.map((col) => col.key);

  const params: unknown[] = [fromCompact, toCompact, itemLimit];
  let lineaSql = "";
  if (input.lineaId?.trim()) {
    params.push(input.lineaId.trim());
    lineaSql = ` AND r.id_linea1 = $${params.length}`;
  }
  let searchSql = "";
  if (input.search?.trim()) {
    params.push(`%${input.search.trim().toLowerCase()}%`);
    searchSql = ` AND (
      LOWER(r.id_item) LIKE $${params.length}
      OR LOWER(COALESCE(r.item_descripcion, '')) LIKE $${params.length}
    )`;
  }

  // ¿Existe el puente proveedor?
  const provCheck = await client.query<{ ok: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'proveedor_item'
    ) AS ok
  `);
  const hasProveedor = Boolean(provCheck.rows[0]?.ok);

  const proveedorJoin = hasProveedor
    ? `
    LEFT JOIN proveedor_item pi
      ON pi.empresa = a.empresa_norm
     AND pi.id_item = a.id_item
    LEFT JOIN proveedor_pos_catalogo pc
      ON pc.empresa = a.empresa_norm
     AND pc.id_cricla1 = pi.id_cricla1
  `
    : "";

  const proveedorSelect = hasProveedor
    ? `
      COALESCE(NULLIF(TRIM(pi.id_cricla1), ''), '@SP') AS proveedor_id,
      COALESCE(
        NULLIF(TRIM(pc.nombre), ''),
        NULLIF(TRIM(pi.descripcion), ''),
        '(Sin proveedor)'
      ) AS proveedor_label
    `
    : `
      '@SP'::text AS proveedor_id,
      '(Sin puente proveedor_item)'::text AS proveedor_label
    `;

  const result = await client.query<{
    empresa_norm: string;
    id_co_norm: string;
    id_item: string;
    item_descripcion: string | null;
    id_linea1: string | null;
    nombre_linea1: string | null;
    proveedor_id: string;
    proveedor_label: string;
    cantidad: string | number;
    ventas_netas: string | number;
    costo_total: string | number;
  }>(
    `
    WITH agg AS (
      SELECT
        r.empresa_norm,
        r.id_co_norm,
        r.id_item,
        MAX(r.item_descripcion) AS item_descripcion,
        MAX(r.id_linea1) AS id_linea1,
        MAX(r.nombre_linea1) AS nombre_linea1,
        SUM(COALESCE(r.cantidad, 0)) AS cantidad,
        SUM(COALESCE(r.ventas_netas, 0)) AS ventas_netas,
        SUM(COALESCE(r.costo_total, 0)) AS costo_total
      FROM margen_item_dia_roll r
      WHERE r.fecha_dcto >= $1
        AND r.fecha_dcto <= $2
        AND TRIM(COALESCE(r.id_tipo, '')) = '4'
        AND NULLIF(TRIM(r.id_item), '') IS NOT NULL
        ${lineaSql}
        ${searchSql}
      GROUP BY r.empresa_norm, r.id_co_norm, r.id_item
    ),
    enriched AS (
      SELECT
        a.*,
        ${proveedorSelect}
      FROM agg a
      ${proveedorJoin}
    ),
    top_items AS (
      SELECT id_item
      FROM enriched
      GROUP BY id_item
      ORDER BY SUM(ventas_netas) DESC
      LIMIT $3
    )
    SELECT e.*
    FROM enriched e
    INNER JOIN top_items t ON t.id_item = e.id_item
    `,
    params,
  );

  const rowMap = new Map<string, PreciosProveedorRow>();
  const cells: PreciosProveedorCell[] = [];
  const sedeKeySet = new Set(sedeKeys);

  for (const row of result.rows) {
    const key = `${row.empresa_norm}|${String(row.id_co_norm).padStart(3, "0")}`;
    if (!sedeKeySet.has(key)) continue;

    const units = toNum(row.cantidad);
    const sales = toNum(row.ventas_netas);
    const cost = toNum(row.costo_total);
    const pvu = unitPrice(sales, units);
    const pcu = unitPrice(cost, units);
    const margen = marginPct(sales, cost);
    const itemId = String(row.id_item);

    cells.push({
      rowId: itemId,
      sedeKey: key,
      units,
      sales,
      cost,
      pvu,
      pcu,
      margenPct: margen,
    });

    const existing = rowMap.get(itemId);
    if (existing) {
      existing.units += units;
      existing.sales += sales;
      existing.cost += cost;
    } else {
      rowMap.set(itemId, {
        id: itemId,
        label: String(row.item_descripcion ?? itemId).trim() || itemId,
        lineaId: String(row.id_linea1 ?? ""),
        lineaLabel: String(row.nombre_linea1 ?? row.id_linea1 ?? ""),
        proveedorId: String(row.proveedor_id ?? "@SP"),
        proveedorLabel: String(row.proveedor_label ?? "(Sin proveedor)"),
        units,
        sales,
        cost,
        pvu: 0,
        pcu: 0,
        margenPct: 0,
      });
    }
  }

  const rows = [...rowMap.values()]
    .map((row) => ({
      ...row,
      pvu: unitPrice(row.sales, row.units),
      pcu: unitPrice(row.cost, row.units),
      margenPct: marginPct(row.sales, row.cost),
    }))
    .sort((a, b) => b.sales - a.sales);

  return {
    columns,
    rows,
    cells,
    from: input.fromIso,
    to: input.toIso,
    itemLimit,
    elapsedMs: Math.round(performance.now() - t0),
  };
};
