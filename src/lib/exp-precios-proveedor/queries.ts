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

const toIsoLocal = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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

/**
 * Default = día anterior (calendario).
 * Si ese día no existe en el roll, cae al MAX disponible (último día con datos).
 */
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

  const yesterday = new Date();
  yesterday.setHours(12, 0, 0, 0);
  yesterday.setDate(yesterday.getDate() - 1);
  let day = toIsoLocal(yesterday);

  if (max && day > max) day = max;
  if (min && day < min) day = min;
  if (!max && !min) {
    return { start: day, end: day, min, max };
  }
  return { start: day, end: day, min, max };
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
  const sublineas = await client.query<{
    id: string;
    label: string;
    linea_id: string;
  }>(`
    SELECT
      id_linea2 AS id,
      COALESCE(NULLIF(MAX(nombre_linea2), ''), id_linea2) AS label,
      MAX(id_linea1) AS linea_id
    FROM margen_item_dia_roll
    WHERE NULLIF(id_linea2, '') IS NOT NULL
      AND TRIM(COALESCE(id_tipo, '')) = '4'
    GROUP BY id_linea2
    ORDER BY 1
    LIMIT 400
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
    sublineas: sublineas.rows.map((row) => ({
      id: String(row.id),
      label: `${row.id} · ${row.label}`,
      lineaId: String(row.linea_id ?? ""),
    })),
    sedes: prototypeSedeColumns().map((col) => ({
      key: col.key,
      label: col.label,
    })),
    note:
      "Carga el día anterior. Un día = precio/costo de ese día; un rango = promedio simple de los precios/costos diarios. Costo = costo unitario de venta (COGS en roll), no factura de compra al proveedor. Proveedor = maestro POS.",
  };
};

export type PreciosProveedorQueryInput = {
  fromIso: string;
  toIso: string;
  lineaId?: string | null;
  sublineaId?: string | null;
  /** Claves `empresa|idCo`. Vacío/null = todas las sedes del prototipo. */
  sedeKeys?: string[] | null;
  search?: string | null;
  /** Filtro sobre el promedio del ítem (sedes seleccionadas). */
  pvuMin?: number | null;
  pvuMax?: number | null;
  pcuMin?: number | null;
  pcuMax?: number | null;
  itemLimit?: number;
};

/**
 * Heatmap ítem × sede.
 * 1) Por día: precio venta = ventas/cant, costo = costo/cant.
 * 2) En rango: AVG de esos precios/costos diarios (no ponderado por volumen del periodo).
 */
export const queryPreciosProveedorMatrix = async (
  client: PoolClient,
  input: PreciosProveedorQueryInput,
): Promise<PreciosProveedorMatrix> => {
  const t0 = performance.now();
  const fromCompact = isoToCompact(input.fromIso);
  const toCompact = isoToCompact(input.toIso);
  const itemLimit = Math.min(80, Math.max(10, Number(input.itemLimit) || 40));
  const allColumns = prototypeSedeColumns();
  const requestedKeys = (input.sedeKeys ?? [])
    .map((key) => key.trim())
    .filter(Boolean);
  const columns =
    requestedKeys.length > 0
      ? allColumns.filter((col) => requestedKeys.includes(col.key))
      : allColumns;
  if (columns.length === 0) {
    return {
      columns: [],
      rows: [],
      cells: [],
      from: input.fromIso,
      to: input.toIso,
      itemLimit,
      elapsedMs: Math.round(performance.now() - t0),
    };
  }
  const sedeKeys = columns.map((col) => col.key);

  const params: unknown[] = [fromCompact, toCompact, itemLimit];
  let lineaSql = "";
  if (input.lineaId?.trim()) {
    params.push(input.lineaId.trim());
    lineaSql = ` AND r.id_linea1 = $${params.length}`;
  }
  let sublineaSql = "";
  if (input.sublineaId?.trim()) {
    params.push(input.sublineaId.trim());
    sublineaSql = ` AND r.id_linea2 = $${params.length}`;
  }

  const sedePairs = columns.map((col) => ({
    empresa: col.empresa,
    idCo: col.idCo.padStart(3, "0"),
  }));
  const sedeTupleSql = sedePairs
    .map((pair) => {
      params.push(pair.empresa, pair.idCo);
      return `($${params.length - 1}, $${params.length})`;
    })
    .join(", ");
  const sedeSql = ` AND (r.empresa_norm, LPAD(TRIM(r.id_co_norm), 3, '0')) IN (${sedeTupleSql})`;

  let searchSql = "";
  if (input.search?.trim()) {
    params.push(`%${input.search.trim().toLowerCase()}%`);
    searchSql = ` AND (
      LOWER(r.id_item) LIKE $${params.length}
      OR LOWER(COALESCE(r.item_descripcion, '')) LIKE $${params.length}
    )`;
  }

  const parseBound = (value: number | null | undefined) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const pvuMin = parseBound(input.pvuMin ?? null);
  const pvuMax = parseBound(input.pvuMax ?? null);
  const pcuMin = parseBound(input.pcuMin ?? null);
  const pcuMax = parseBound(input.pcuMax ?? null);

  const priceFilterParts: string[] = [];
  if (pvuMin != null) {
    params.push(pvuMin);
    priceFilterParts.push(`AVG(pvu) FILTER (WHERE pvu IS NOT NULL) >= $${params.length}`);
  }
  if (pvuMax != null) {
    params.push(pvuMax);
    priceFilterParts.push(`AVG(pvu) FILTER (WHERE pvu IS NOT NULL) <= $${params.length}`);
  }
  if (pcuMin != null) {
    params.push(pcuMin);
    priceFilterParts.push(`AVG(pcu) FILTER (WHERE pcu IS NOT NULL) >= $${params.length}`);
  }
  if (pcuMax != null) {
    params.push(pcuMax);
    priceFilterParts.push(`AVG(pcu) FILTER (WHERE pcu IS NOT NULL) <= $${params.length}`);
  }
  const priceHavingSql =
    priceFilterParts.length > 0
      ? `HAVING ${priceFilterParts.join(" AND ")}`
      : "";

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
    id_linea2: string | null;
    nombre_linea2: string | null;
    proveedor_id: string;
    proveedor_label: string;
    cantidad: string | number;
    ventas_netas: string | number;
    costo_total: string | number;
    pvu: string | number;
    pcu: string | number;
    dias: string | number;
  }>(
    `
    WITH daily AS (
      SELECT
        r.fecha_dcto,
        r.empresa_norm,
        r.id_co_norm,
        r.id_item,
        MAX(r.item_descripcion) AS item_descripcion,
        MAX(r.id_linea1) AS id_linea1,
        MAX(r.nombre_linea1) AS nombre_linea1,
        MAX(r.id_linea2) AS id_linea2,
        MAX(r.nombre_linea2) AS nombre_linea2,
        SUM(COALESCE(r.cantidad, 0)) AS cantidad,
        SUM(COALESCE(r.ventas_netas, 0)) AS ventas_netas,
        SUM(COALESCE(r.costo_total, 0)) AS costo_total,
        CASE
          WHEN SUM(COALESCE(r.cantidad, 0)) > 0
          THEN SUM(COALESCE(r.ventas_netas, 0)) / SUM(COALESCE(r.cantidad, 0))
          ELSE NULL
        END AS pvu_day,
        CASE
          WHEN SUM(COALESCE(r.cantidad, 0)) > 0
          THEN SUM(COALESCE(r.costo_total, 0)) / SUM(COALESCE(r.cantidad, 0))
          ELSE NULL
        END AS pcu_day
      FROM margen_item_dia_roll r
      WHERE r.fecha_dcto >= $1
        AND r.fecha_dcto <= $2
        AND TRIM(COALESCE(r.id_tipo, '')) = '4'
        AND NULLIF(TRIM(r.id_item), '') IS NOT NULL
        ${lineaSql}
        ${sublineaSql}
        ${sedeSql}
        ${searchSql}
      GROUP BY r.fecha_dcto, r.empresa_norm, r.id_co_norm, r.id_item
    ),
    agg AS (
      SELECT
        empresa_norm,
        id_co_norm,
        id_item,
        MAX(item_descripcion) AS item_descripcion,
        MAX(id_linea1) AS id_linea1,
        MAX(nombre_linea1) AS nombre_linea1,
        MAX(id_linea2) AS id_linea2,
        MAX(nombre_linea2) AS nombre_linea2,
        SUM(cantidad) AS cantidad,
        SUM(ventas_netas) AS ventas_netas,
        SUM(costo_total) AS costo_total,
        AVG(pvu_day) AS pvu,
        AVG(pcu_day) AS pcu,
        COUNT(*) FILTER (WHERE pvu_day IS NOT NULL OR pcu_day IS NOT NULL) AS dias
      FROM daily
      GROUP BY empresa_norm, id_co_norm, id_item
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
      ${priceHavingSql}
      ORDER BY SUM(ventas_netas) DESC
      LIMIT $3
    )
    SELECT e.*
    FROM enriched e
    INNER JOIN top_items t ON t.id_item = e.id_item
    `,
    params,
  );

  const rowMap = new Map<
    string,
    PreciosProveedorRow & { pvuSum: number; pcuSum: number; priceDays: number }
  >();
  const cells: PreciosProveedorCell[] = [];
  const sedeKeySet = new Set(sedeKeys);

  for (const row of result.rows) {
    const key = `${row.empresa_norm}|${String(row.id_co_norm).padStart(3, "0")}`;
    if (!sedeKeySet.has(key)) continue;

    const units = toNum(row.cantidad);
    const sales = toNum(row.ventas_netas);
    const cost = toNum(row.costo_total);
    const pvu = toNum(row.pvu);
    const pcu = toNum(row.pcu);
    const itemId = String(row.id_item);

    cells.push({
      rowId: itemId,
      sedeKey: key,
      units,
      sales,
      cost,
      pvu,
      pcu,
      margenPct: marginPct(sales, cost),
    });

    const existing = rowMap.get(itemId);
    if (existing) {
      existing.units += units;
      existing.sales += sales;
      existing.cost += cost;
      if (pvu > 0 || pcu > 0) {
        existing.pvuSum += pvu;
        existing.pcuSum += pcu;
        existing.priceDays += 1;
      }
    } else {
      rowMap.set(itemId, {
        id: itemId,
        label: String(row.item_descripcion ?? itemId).trim() || itemId,
        lineaId: String(row.id_linea1 ?? ""),
        lineaLabel: String(row.nombre_linea1 ?? row.id_linea1 ?? ""),
        sublineaId: String(row.id_linea2 ?? ""),
        sublineaLabel: String(row.nombre_linea2 ?? row.id_linea2 ?? ""),
        proveedorId: String(row.proveedor_id ?? "@SP"),
        proveedorLabel: String(row.proveedor_label ?? "(Sin proveedor)"),
        units,
        sales,
        cost,
        pvu: 0,
        pcu: 0,
        margenPct: 0,
        pvuSum: pvu > 0 || pcu > 0 ? pvu : 0,
        pcuSum: pvu > 0 || pcu > 0 ? pcu : 0,
        priceDays: pvu > 0 || pcu > 0 ? 1 : 0,
      });
    }
  }

  const rows = [...rowMap.values()]
    .map((row) => {
      const pvu =
        row.priceDays > 0
          ? row.pvuSum / row.priceDays
          : unitPrice(row.sales, row.units);
      const pcu =
        row.priceDays > 0
          ? row.pcuSum / row.priceDays
          : unitPrice(row.cost, row.units);
      return {
        id: row.id,
        label: row.label,
        lineaId: row.lineaId,
        lineaLabel: row.lineaLabel,
        sublineaId: row.sublineaId,
        sublineaLabel: row.sublineaLabel,
        proveedorId: row.proveedorId,
        proveedorLabel: row.proveedorLabel,
        units: row.units,
        sales: row.sales,
        cost: row.cost,
        pvu,
        pcu,
        margenPct: marginPct(row.sales, row.cost),
      };
    })
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
