import type { PoolClient } from "pg";
import { listMargenSedeCatalogOptions } from "@/lib/margenes/margen-sede-catalog";
import { empresaLabel } from "@/lib/margenes/margen-final-query";
import { getSedeOrderIndexForRawName } from "@/lib/shared/constants";
import type {
  PreciosProveedorCell,
  PreciosProveedorExpandRow,
  PreciosProveedorMatrix,
  PreciosProveedorMeta,
  PreciosProveedorRow,
  PreciosProveedorSedeColumn,
} from "@/lib/exp-precios-proveedor/types";

const toNum = (value: string | number | null | undefined) =>
  Number(value ?? 0) || 0;

/** Join opcional a maestro comercial por NIT (misma empresa). */
const PROVEEDOR_TERCERO_LATERAL = `
    LEFT JOIN LATERAL (
      SELECT
        BTRIM(pt.codigo) AS codigo,
        BTRIM(COALESCE(pt.sucursal, '00')) AS sucursal,
        NULLIF(BTRIM(pt.nombre), '') AS nombre
      FROM proveedor_tercero pt
      WHERE pt.empresa = pi.empresa
        AND pt.activo IS TRUE
        AND NULLIF(BTRIM(pc.nit), '') IS NOT NULL
        AND BTRIM(pc.nit) NOT IN ('99999999', '0')
        AND pt.nit = BTRIM(pc.nit)
      ORDER BY
        CASE WHEN BTRIM(COALESCE(pt.sucursal, '00')) IN ('', '00') THEN 0 ELSE 1 END,
        pt.sucursal
      LIMIT 1
    ) pt ON TRUE
`;

type ResolvedItemProveedor = {
  id: string;
  label: string;
  criterioId: string | null;
  criterioLabel: string | null;
  nit: string | null;
  fromTercero: boolean;
};

const resolveItemProveedorRow = (row: {
  id_cricla1: string;
  criterio_nombre: string | null;
  nit: string | null;
  tercero_codigo: string | null;
  tercero_nombre: string | null;
}): ResolvedItemProveedor => {
  const criterioId =
    String(row.id_cricla1 ?? "").trim() || "@SP";
  const criterioLabel =
    String(row.criterio_nombre ?? "").trim() ||
    (criterioId !== "@SP" ? criterioId : "(Sin proveedor)");
  const nit = String(row.nit ?? "").trim() || null;
  const terceroCodigo = String(row.tercero_codigo ?? "").trim();
  const terceroNombre = String(row.tercero_nombre ?? "").trim();
  if (terceroCodigo || terceroNombre) {
    return {
      id: terceroCodigo ? `t:${terceroCodigo}` : `t:${criterioId}`,
      label: terceroNombre || criterioLabel,
      criterioId: criterioId === "@SP" ? null : criterioId,
      criterioLabel,
      nit,
      fromTercero: true,
    };
  }
  return {
    id: criterioId,
    label: criterioLabel,
    criterioId: criterioId === "@SP" ? null : criterioId,
    criterioLabel,
    nit,
    fromTercero: false,
  };
};

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

/** Sedes tienda (sin Dinastía / plantas), izq→der como SEDE_ORDER del portal. */
export const prototypeSedeColumns = (): PreciosProveedorSedeColumn[] =>
  listMargenSedeCatalogOptions()
    .filter((opt) => opt.empresa !== "dinastia")
    .map((opt) => ({
      key: opt.value,
      label: opt.label,
      empresa: opt.empresa,
      idCo: opt.idCo,
    }))
    .sort((a, b) => {
      const ai = getSedeOrderIndexForRawName(a.label);
      const bi = getSedeOrderIndexForRawName(b.label);
      if (ai !== bi) return ai - bi;
      return a.label.localeCompare(b.label, "es");
    });

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
      "Carga el día anterior. Un día = precio/costo de ese día; un rango = promedio simple diario. Precio venta = venta/cant. Costo = costo de entrada (costo_uni_inventario), no COGS de venta. Doble clic en el ítem despliega proveedores del mismo producto.",
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
  const fetchLimit = Math.min(120, Math.max(itemLimit * 3, itemLimit));
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

  const params: unknown[] = [fromCompact, toCompact, fetchLimit];
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
  const priceHavingSql =
    priceFilterParts.length > 0
      ? `HAVING ${priceFilterParts.join(" AND ")}`
      : "";

  const provCheck = await client.query<{ ok: boolean; tercero: boolean }>(`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'proveedor_item'
      ) AS ok,
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'proveedor_tercero'
      ) AS tercero
  `);
  const hasProveedor = Boolean(provCheck.rows[0]?.ok);
  const hasTercero = Boolean(provCheck.rows[0]?.tercero);

  const proveedorJoin = hasProveedor
    ? `
    LEFT JOIN proveedor_item pi
      ON pi.empresa = a.empresa_norm
     AND pi.id_item = a.id_item
    LEFT JOIN proveedor_pos_catalogo pc
      ON pc.empresa = a.empresa_norm
     AND pc.id_cricla1 = pi.id_cricla1
    ${hasTercero ? PROVEEDOR_TERCERO_LATERAL : ""}
  `
    : "";

  const proveedorSelect = hasProveedor
    ? hasTercero
      ? `
      COALESCE(
        NULLIF(TRIM(pt.codigo), ''),
        NULLIF(TRIM(pi.id_cricla1), ''),
        '@SP'
      ) AS proveedor_id,
      COALESCE(
        NULLIF(TRIM(pt.nombre), ''),
        NULLIF(TRIM(pc.nombre), ''),
        NULLIF(TRIM(pi.descripcion), ''),
        '(Sin proveedor)'
      ) AS proveedor_label
    `
      : `
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

  const itemIds = [
    ...new Set(result.rows.map((row) => String(row.id_item).trim()).filter(Boolean)),
  ];
  const costoEntrada = await queryCostoEntradaMap(client, {
    fromIso: input.fromIso,
    toIso: input.toIso,
    itemIds,
    columns,
  });

  const rowMap = new Map<
    string,
    PreciosProveedorRow & {
      pvuSum: number;
      pcuSum: number;
      priceDays: number;
      proveedores: Map<string, string>;
    }
  >();
  const cells: PreciosProveedorCell[] = [];
  const sedeKeySet = new Set(sedeKeys);

  for (const row of result.rows) {
    const key = `${row.empresa_norm}|${String(row.id_co_norm).padStart(3, "0")}`;
    if (!sedeKeySet.has(key)) continue;

    const units = toNum(row.cantidad);
    const sales = toNum(row.ventas_netas);
    const pvu = toNum(row.pvu);
    const itemId = String(row.id_item).trim();
    const pcu = costoEntrada.get(`${itemId}::${key}`) ?? 0;
    const cost = units > 0 && pcu > 0 ? units * pcu : 0;

    cells.push({
      rowId: itemId,
      sedeKey: key,
      units,
      sales,
      cost,
      pvu,
      pcu,
      margenPct: marginPct(sales > 0 ? sales : pvu * units, cost),
    });

    const provId = String(row.proveedor_id ?? "@SP").trim() || "@SP";
    const provLabel = String(row.proveedor_label ?? "(Sin proveedor)").trim() || "(Sin proveedor)";
    const existing = rowMap.get(itemId);
    if (existing) {
      existing.units += units;
      existing.sales += sales;
      existing.cost += cost;
      existing.proveedores.set(provId, provLabel);
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
        proveedorId: provId,
        proveedorLabel: provLabel,
        proveedorCount: 1,
        units,
        sales,
        cost,
        pvu: 0,
        pcu: 0,
        margenPct: 0,
        pvuSum: pvu > 0 || pcu > 0 ? pvu : 0,
        pcuSum: pvu > 0 || pcu > 0 ? pcu : 0,
        priceDays: pvu > 0 || pcu > 0 ? 1 : 0,
        proveedores: new Map([[provId, provLabel]]),
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
        row.priceDays > 0 ? row.pcuSum / row.priceDays : unitPrice(row.cost, row.units);
      const proveedorCount = row.proveedores.size;
      const proveedorLabel =
        proveedorCount > 1
          ? `Varios proveedores (${proveedorCount})`
          : [...row.proveedores.values()][0] ?? row.proveedorLabel;
      return {
        id: row.id,
        label: row.label,
        lineaId: row.lineaId,
        lineaLabel: row.lineaLabel,
        sublineaId: row.sublineaId,
        sublineaLabel: row.sublineaLabel,
        proveedorId: proveedorCount > 1 ? "*" : row.proveedorId,
        proveedorLabel,
        proveedorCount,
        units: row.units,
        sales: row.sales,
        cost: row.cost,
        pvu,
        pcu,
        margenPct: marginPct(row.sales, row.cost),
      };
    })
    .filter((row) => {
      if (pcuMin != null && !(row.pcu >= pcuMin)) return false;
      if (pcuMax != null && !(row.pcu <= pcuMax)) return false;
      return true;
    })
    .sort((a, b) => b.sales - a.sales)
    .slice(0, itemLimit);

  const keepIds = new Set(rows.map((row) => row.id));

  return {
    columns,
    rows,
    cells: cells.filter((cell) => keepIds.has(cell.rowId)),
    from: input.fromIso,
    to: input.toIso,
    itemLimit,
    elapsedMs: Math.round(performance.now() - t0),
  };
};

const ROTACION_SEDE_SQL = `
  CASE
    WHEN TRIM(sede) ~ '^[0-9]+$' THEN LPAD(TRIM(sede), 3, '0')
    ELSE TRIM(sede)
  END
`;

async function queryCostoEntradaMap(
  client: PoolClient,
  input: {
    fromIso: string;
    toIso: string;
    itemIds: string[];
    columns: PreciosProveedorSedeColumn[];
  },
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (input.itemIds.length === 0 || input.columns.length === 0) return map;

  const cols = await client.query<{ column_name: string }>(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'rotacion_base_item_dia_sede'
      AND column_name = ANY($1::text[])
    `,
    [["empresa", "sede", "id_item", "fecha_dia", "costo_uni_inventario"]],
  );
  if (cols.rows.length !== 5) return map;

  const params: unknown[] = [input.fromIso, input.toIso, input.itemIds];
  const tupleSql = input.columns
    .map((col) => {
      params.push(col.empresa.trim().toLowerCase(), col.idCo);
      return `($${params.length - 1}, $${params.length})`;
    })
    .join(", ");

  const result = await client.query<{
    empresa: string;
    id_co: string;
    id_item: string;
    costo_entrada: string | number | null;
  }>(
    `
    SELECT
      LOWER(BTRIM(empresa)) AS empresa,
      ${ROTACION_SEDE_SQL} AS id_co,
      BTRIM(id_item) AS id_item,
      AVG(costo_uni_inventario) FILTER (
        WHERE COALESCE(costo_uni_inventario, 0) > 0
      ) AS costo_entrada
    FROM rotacion_base_item_dia_sede
    WHERE fecha_dia >= $1::date
      AND fecha_dia <= $2::date
      AND BTRIM(id_item) = ANY($3::text[])
      AND (LOWER(BTRIM(empresa)), ${ROTACION_SEDE_SQL}) IN (${tupleSql})
    GROUP BY 1, 2, 3
    `,
    params,
  );

  for (const row of result.rows) {
    const costo = toNum(row.costo_entrada);
    if (!(costo > 0)) continue;
    map.set(`${row.id_item}::${row.empresa}|${row.id_co}`, costo);
  }
  return map;
}

export async function queryPreciosProveedorItemExpand(
  client: PoolClient,
  input: {
    itemId: string;
    label?: string | null;
    fromIso: string;
    toIso: string;
    sedeKeys?: string[] | null;
  },
): Promise<{ itemId: string; label: string; rows: PreciosProveedorExpandRow[] }> {
  const itemId = input.itemId.trim();
  const allColumns = prototypeSedeColumns();
  const requestedKeys = (input.sedeKeys ?? []).map((key) => key.trim()).filter(Boolean);
  const columns =
    requestedKeys.length > 0
      ? allColumns.filter((col) => requestedKeys.includes(col.key))
      : allColumns;
  const fromCompact = isoToCompact(input.fromIso);
  const toCompact = isoToCompact(input.toIso);

  const descRes = await client.query<{ label: string | null }>(
    `
    SELECT COALESCE(NULLIF(BTRIM(MAX(item_descripcion)), ''), $3) AS label
    FROM margen_item_dia_roll
    WHERE fecha_dcto >= $1
      AND fecha_dcto <= $2
      AND BTRIM(id_item) = $3
    `,
    [fromCompact, toCompact, itemId],
  );
  const label =
    (input.label ?? "").trim() ||
    String(descRes.rows[0]?.label ?? "").trim() ||
    itemId;

  const params: unknown[] = [fromCompact, toCompact, label, itemId];
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
  const sedeSql =
    columns.length > 0
      ? ` AND (r.empresa_norm, LPAD(TRIM(r.id_co_norm), 3, '0')) IN (${sedeTupleSql})`
      : "";

  const variants = await client.query<{
    id_item: string;
    label: string | null;
    empresa: string;
    id_co: string;
    cantidad: string | number;
    ventas_netas: string | number;
    pvu: string | number;
  }>(
    `
    WITH daily AS (
      SELECT
        r.fecha_dcto,
        r.empresa_norm,
        r.id_co_norm,
        BTRIM(r.id_item) AS id_item,
        MAX(r.item_descripcion) AS item_descripcion,
        SUM(COALESCE(r.cantidad, 0)) AS cantidad,
        SUM(COALESCE(r.ventas_netas, 0)) AS ventas_netas,
        CASE
          WHEN SUM(COALESCE(r.cantidad, 0)) > 0
          THEN SUM(COALESCE(r.ventas_netas, 0)) / SUM(COALESCE(r.cantidad, 0))
          ELSE NULL
        END AS pvu_day
      FROM margen_item_dia_roll r
      WHERE r.fecha_dcto >= $1
        AND r.fecha_dcto <= $2
        AND TRIM(COALESCE(r.id_tipo, '')) = '4'
        AND (
          BTRIM(r.id_item) = $4
          OR UPPER(BTRIM(COALESCE(r.item_descripcion, ''))) = UPPER(BTRIM($3))
        )
        ${sedeSql}
      GROUP BY r.fecha_dcto, r.empresa_norm, r.id_co_norm, BTRIM(r.id_item)
    )
    SELECT
      id_item,
      MAX(item_descripcion) AS label,
      empresa_norm AS empresa,
      LPAD(TRIM(id_co_norm), 3, '0') AS id_co,
      SUM(cantidad) AS cantidad,
      SUM(ventas_netas) AS ventas_netas,
      AVG(pvu_day) AS pvu
    FROM daily
    GROUP BY id_item, empresa_norm, LPAD(TRIM(id_co_norm), 3, '0')
    `,
    params,
  );

  const variantItemIds = [
    ...new Set(variants.rows.map((row) => String(row.id_item).trim()).filter(Boolean)),
  ];
  if (!variantItemIds.includes(itemId)) variantItemIds.unshift(itemId);

  const costoEntrada = await queryCostoEntradaMap(client, {
    fromIso: input.fromIso,
    toIso: input.toIso,
    itemIds: variantItemIds,
    columns,
  });

  const provCheck = await client.query<{ ok: boolean; tercero: boolean }>(`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'proveedor_item'
      ) AS ok,
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'proveedor_tercero'
      ) AS tercero
  `);
  const provByItemEmpresa = new Map<string, ResolvedItemProveedor>();
  if (provCheck.rows[0]?.ok && variantItemIds.length > 0) {
    const hasTercero = Boolean(provCheck.rows[0]?.tercero);
    const provRes = await client.query<{
      empresa: string;
      id_item: string;
      id_cricla1: string;
      criterio_nombre: string | null;
      nit: string | null;
      tercero_codigo: string | null;
      tercero_nombre: string | null;
    }>(
      `
      SELECT
        pi.empresa,
        BTRIM(pi.id_item) AS id_item,
        COALESCE(NULLIF(BTRIM(pi.id_cricla1), ''), '@SP') AS id_cricla1,
        COALESCE(
          NULLIF(BTRIM(pc.nombre), ''),
          NULLIF(BTRIM(pi.descripcion), ''),
          NULLIF(BTRIM(pi.id_cricla1), ''),
          '(Sin proveedor)'
        ) AS criterio_nombre,
        NULLIF(BTRIM(pc.nit), '') AS nit
        ${
          hasTercero
            ? `,
        pt.codigo AS tercero_codigo,
        pt.nombre AS tercero_nombre`
            : `,
        NULL::text AS tercero_codigo,
        NULL::text AS tercero_nombre`
        }
      FROM proveedor_item pi
      LEFT JOIN proveedor_pos_catalogo pc
        ON pc.empresa = pi.empresa
       AND pc.id_cricla1 = pi.id_cricla1
      ${hasTercero ? PROVEEDOR_TERCERO_LATERAL : ""}
      WHERE BTRIM(pi.id_item) = ANY($1::text[])
      `,
      [variantItemIds],
    );
    for (const row of provRes.rows) {
      provByItemEmpresa.set(
        `${row.id_item}::${row.empresa}`,
        resolveItemProveedorRow(row),
      );
    }
  }

  const expandMap = new Map<string, PreciosProveedorExpandRow>();
  const sedeKeySet = new Set(columns.map((col) => col.key));

  const fallbackProv = (): ResolvedItemProveedor => ({
    id: "@SP",
    label: "(Sin proveedor)",
    criterioId: null,
    criterioLabel: null,
    nit: null,
    fromTercero: false,
  });

  for (const row of variants.rows) {
    const variantId = String(row.id_item).trim();
    const empresa = String(row.empresa).trim();
    const idCo = String(row.id_co).padStart(3, "0");
    const sedeKey = `${empresa}|${idCo}`;
    if (!sedeKeySet.has(sedeKey)) continue;

    const prov =
      provByItemEmpresa.get(`${variantId}::${empresa}`) ?? fallbackProv();
    const expandId = `${variantId}::${empresa}::${prov.id}`;
    const units = toNum(row.cantidad);
    const sales = toNum(row.ventas_netas);
    const pvu = toNum(row.pvu);
    const pcu = costoEntrada.get(`${variantId}::${sedeKey}`) ?? 0;
    const cost = units > 0 && pcu > 0 ? units * pcu : 0;
    const cell: PreciosProveedorCell = {
      rowId: expandId,
      sedeKey,
      units,
      sales,
      cost,
      pvu,
      pcu,
      margenPct: marginPct(sales > 0 ? sales : pvu * units, cost),
    };

    const existing = expandMap.get(expandId);
    if (existing) {
      existing.cells.push(cell);
    } else {
      expandMap.set(expandId, {
        rowId: expandId,
        itemId: variantId,
        label: String(row.label ?? variantId).trim() || variantId,
        proveedorId: prov.id,
        proveedorLabel: prov.label,
        criterioId: prov.criterioId,
        criterioLabel: prov.criterioLabel,
        empresa,
        empresaLabel: empresaLabel(empresa),
        nit: prov.nit,
        fromTercero: prov.fromTercero,
        cells: [cell],
      });
    }
  }

  const itemLabelById = new Map<string, string>([[itemId, label]]);
  for (const row of variants.rows) {
    const variantId = String(row.id_item).trim();
    const variantLabel = String(row.label ?? "").trim();
    if (variantId && variantLabel && !itemLabelById.has(variantId)) {
      itemLabelById.set(variantId, variantLabel);
    }
  }

  for (const [costKey, costo] of costoEntrada) {
    const sep = costKey.indexOf("::");
    if (sep < 0 || !(costo > 0)) continue;
    const variantId = costKey.slice(0, sep);
    const sedeKey = costKey.slice(sep + 2);
    if (!sedeKeySet.has(sedeKey)) continue;
    const empresa = sedeKey.split("|")[0] ?? "";
    const prov =
      provByItemEmpresa.get(`${variantId}::${empresa}`) ?? fallbackProv();
    const expandId = `${variantId}::${empresa}::${prov.id}`;
    let existing = expandMap.get(expandId);
    if (!existing) {
      existing = {
        rowId: expandId,
        itemId: variantId,
        label: itemLabelById.get(variantId) ?? variantId,
        proveedorId: prov.id,
        proveedorLabel: prov.label,
        criterioId: prov.criterioId,
        criterioLabel: prov.criterioLabel,
        empresa,
        empresaLabel: empresaLabel(empresa),
        nit: prov.nit,
        fromTercero: prov.fromTercero,
        cells: [],
      };
      expandMap.set(expandId, existing);
    }
    const current = existing.cells.find((cell) => cell.sedeKey === sedeKey);
    if (current) {
      if (!(current.pcu > 0)) {
        current.pcu = costo;
        current.cost = current.units > 0 ? current.units * costo : 0;
        current.margenPct = marginPct(
          current.sales > 0 ? current.sales : current.pvu * current.units,
          current.cost,
        );
      }
      continue;
    }
    existing.cells.push({
      rowId: expandId,
      sedeKey,
      units: 0,
      sales: 0,
      cost: 0,
      pvu: 0,
      pcu: costo,
      margenPct: 0,
    });
  }

  const rows = [...expandMap.values()].sort((a, b) => {
    if (a.itemId === itemId && b.itemId !== itemId) return -1;
    if (b.itemId === itemId && a.itemId !== itemId) return 1;
    const byEmpresa = a.empresaLabel.localeCompare(b.empresaLabel, "es");
    if (byEmpresa !== 0) return byEmpresa;
    const byProv = a.proveedorLabel.localeCompare(b.proveedorLabel, "es");
    if (byProv !== 0) return byProv;
    return a.empresa.localeCompare(b.empresa, "es");
  });

  return { itemId, label, rows };
};
