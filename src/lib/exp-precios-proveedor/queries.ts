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
import {
  mergeExpandCellInto,
  mergeProveedorNits,
} from "@/lib/exp-precios-proveedor/expand-merge";
import {
  hasProveedorFilter,
  parseProveedorFilterIds,
} from "@/lib/exp-precios-proveedor/filters";
import {
  ocEntradaInvTipdocSql,
  ocEntradaPoTipdocSql,
  ocEntradaQtySql,
  ocEntradaTipdocSql,
  proveedorExpandGroupKey,
  stripEmpresaProveedorLabel,
  stripMercamioProveedorLabel,
} from "@/lib/exp-precios-proveedor/labels";

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
  qtyByCo?: Map<string, number>;
  valByCo?: Map<string, number>;
  transitoByCo?: Map<string, number>;
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
  const criterioLabel = stripMercamioProveedorLabel(
    String(row.criterio_nombre ?? "").trim() ||
      (criterioId !== "@SP" ? criterioId : "(Sin proveedor)"),
  );
  const nit = String(row.nit ?? "").trim() || null;
  const terceroCodigo = String(row.tercero_codigo ?? "").trim();
  const terceroNombre = String(row.tercero_nombre ?? "").trim();
  if (terceroCodigo || terceroNombre) {
    return {
      id: terceroCodigo ? `t:${terceroCodigo}` : `t:${criterioId}`,
      label: stripMercamioProveedorLabel(terceroNombre || criterioLabel),
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

type OcLineProveedor = ResolvedItemProveedor & {
  /** Sedes donde este proveedor surte el item en la VENTANA ancha. Solo identidad. */
  idCos: Set<string>;
  /** Kilos del RANGO pedido por el usuario. Es lo unico que se pinta. */
  qtyByCo: Map<string, number>;
  /** Pesos comprados en el RANGO, de los MISMOS documentos que los kilos. */
  valByCo: Map<string, number>;
  /** Kilos en transito (ET) del RANGO. Nunca entran a qtyByCo ni a invCos. */
  transitoByCo: Map<string, number>;
  invQtyByCo: Map<string, number>;
  poQtyByCo: Map<string, number>;
  invValByCo: Map<string, number>;
  poValByCo: Map<string, number>;
};

/**
 * Tercero real por item (quien trajo la mercancia), desde lineas de OC/FR.
 * El criterio del item (p.ej. MERCAMIO FRUVER) no es ese tercero.
 */
async function queryOrdenCompraLineaProveedores(
  client: PoolClient,
  itemIds: string[],
  /** Inicio de la ventana ancha: solo decide QUIENES surten el item. */
  fromCompact: string,
  toCompact: string,
  /** Inicio del rango que pidio el usuario: decide CUANTOS kilos se pintan. */
  rangeFromCompact: string,
): Promise<Map<string, OcLineProveedor[]>> {
  const map = new Map<string, OcLineProveedor[]>();
  if (itemIds.length === 0) return map;

  const exists = await client.query<{ ok: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'orden_compra_linea'
    ) AS ok
  `);
  if (!exists.rows[0]?.ok) return map;

  const res = await client.query<{
    empresa: string;
    id_item: string;
    id_co: string;
    id_terc: string;
    terc_nombre: string | null;
    terc_nit: string | null;
    tipdoc: string;
    qty: string | number | null;
    valor: string | number | null;
    in_range: boolean;
  }>(
    `
    SELECT
      LOWER(BTRIM(empresa)) AS empresa,
      BTRIM(id_item) AS id_item,
      CASE
        WHEN BTRIM(id_co) ~ '^[0-9]+$' THEN LPAD(BTRIM(id_co), 3, '0')
        ELSE BTRIM(id_co)
      END AS id_co,
      BTRIM(COALESCE(id_terc, '')) AS id_terc,
      NULLIF(BTRIM(terc_nombre), '') AS terc_nombre,
      NULLIF(BTRIM(terc_nit), '') AS terc_nit,
      UPPER(BTRIM(tipdoc)) AS tipdoc,
      ${ocEntradaQtySql("tipdoc")} AS qty,
      -- Valor efectivo. En FR/OC el tot_bruto es lo PEDIDO y la cantidad que
      -- cuenta es lo RECIBIDO: dividir uno entre otro sin prorratear infla el
      -- costo (medido: FR-036887 daba 26.786/kg contra 4.500/kg reales).
      CASE
        WHEN UPPER(BTRIM(tipdoc)) IN ('ET', 'EF') THEN COALESCE(tot_bruto, 0)
        WHEN COALESCE(cantidad, 0) > 0
          THEN COALESCE(tot_bruto, 0) * (COALESCE(cantidad_ent, 0) / cantidad)
        ELSE 0
      END AS valor,
      (BTRIM(fecha_dcto) >= $4) AS in_range
    FROM orden_compra_linea
    WHERE BTRIM(id_item) = ANY($1::text[])
      AND fecha_dcto >= $2
      AND fecha_dcto <= $3
      AND ${ocEntradaTipdocSql("empresa", "tipdoc")}
    `,
    [itemIds, fromCompact, toCompact, rangeFromCompact],
  );

  for (const row of res.rows) {
    const itemId = String(row.id_item ?? "").trim();
    const empresa = String(row.empresa ?? "").trim();
    const tipdoc = String(row.tipdoc ?? "").trim().toUpperCase();
    let idTerc = String(row.id_terc ?? "").trim();
    let nombre = String(row.terc_nombre ?? "").trim();
    const idCo = String(row.id_co ?? "").padStart(3, "0");
    if (!itemId || !empresa) continue;
    if (!idTerc) {
      if (tipdoc !== "ET") continue;
      idTerc = "ET";
      nombre = nombre || "Tránsito";
    }
    const groupKey = `${itemId}::${empresa}`;
    let list = map.get(groupKey);
    if (!list) {
      list = [];
      map.set(groupKey, list);
    }
    const provId = `oc:${idTerc}`;
    let prov = list.find((entry) => entry.id === provId);
    if (!prov) {
      prov = {
        id: provId,
        label: stripMercamioProveedorLabel(nombre || idTerc),
        criterioId: null,
        criterioLabel: null,
        nit: String(row.terc_nit ?? "").trim() || null,
        fromTercero: true,
        idCos: new Set(),
        qtyByCo: new Map(),
        valByCo: new Map(),
        transitoByCo: new Map(),
        invQtyByCo: new Map(),
        poQtyByCo: new Map(),
        invValByCo: new Map(),
        poValByCo: new Map(),
      };
      list.push(prov);
    }
    if (!idCo) continue;
    // La ventana ancha solo sirve para saber que este proveedor surte esta sede.
    prov.idCos.add(idCo);
    if (!row.in_range) continue;
    const qty = toNum(row.qty);
    if (!(qty > 0)) continue;
    // El transito va a su propio balde: ni suma kilos, ni aporta costo, ni
    // marca la sede como "ya tiene entrada" para la guarda invCos. Si lo
    // hiciera, un ET pendiente taparia el pedido FR que si trajo mercancia.
    if (tipdoc === "ET") {
      prov.transitoByCo.set(idCo, (prov.transitoByCo.get(idCo) ?? 0) + qty);
      continue;
    }
    const isInv = tipdoc === "EF";
    const bucket = isInv ? prov.invQtyByCo : prov.poQtyByCo;
    bucket.set(idCo, (bucket.get(idCo) ?? 0) + qty);
    const valBucket = isInv ? prov.invValByCo : prov.poValByCo;
    valBucket.set(idCo, (valBucket.get(idCo) ?? 0) + Math.max(0, toNum(row.valor)));
  }

  for (const list of map.values()) {
    const invCos = new Set<string>();
    for (const prov of list) {
      for (const [co, qty] of prov.invQtyByCo) {
        if (qty > 0) invCos.add(co);
      }
    }
    for (const prov of list) {
      prov.qtyByCo = new Map();
      prov.valByCo = new Map();
      for (const [co, qty] of prov.invQtyByCo) {
        if (qty > 0) {
          prov.qtyByCo.set(co, qty);
          prov.valByCo.set(co, prov.invValByCo.get(co) ?? 0);
        }
      }
      for (const [co, qty] of prov.poQtyByCo) {
        // Guarda anti doble conteo: si la entrada ET/EF ya esta en el rango,
        // el pedido FR/OC del mismo recibo no se suma encima. El valor sigue
        // exactamente la misma decision, para que costo y kilos salgan siempre
        // de los mismos documentos.
        if (invCos.has(co) || !(qty > 0)) continue;
        prov.qtyByCo.set(co, (prov.qtyByCo.get(co) ?? 0) + qty);
        prov.valByCo.set(co, (prov.valByCo.get(co) ?? 0) + (prov.poValByCo.get(co) ?? 0));
      }
    }
    // Se conserva al proveedor aunque no tenga kilos en el rango: su celda queda
    // vacia, pero el desglose sigue diciendo quien surte el item.
    const kept = list.filter((prov) => prov.idCos.size > 0);
    if (kept.length !== list.length) {
      list.length = 0;
      list.push(...kept);
    }
  }
  return map;
}

const isoToCompact = (iso: string) => iso.replace(/-/g, "");

/** YYYYMMDD local, para mirar OC de dias previos al dia del tablero. */
const compactShiftDays = (compact: string, days: number) => {
  const raw = String(compact ?? "").trim();
  if (!/^\d{8}$/.test(raw)) return raw;
  const dt = new Date(
    Number(raw.slice(0, 4)),
    Number(raw.slice(4, 6)) - 1,
    Number(raw.slice(6, 8)),
  );
  dt.setDate(dt.getDate() + days);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
};

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

/**
 * Margen al que SALDRIA vendido: precio de venta por kilo contra costo de
 * entrada por kilo. Es lo unico atribuible a un proveedor; la venta completa
 * del item en la sede no lo es, porque no se puede repartir entre proveedores.
 */
export const projectedMarginPct = (pvu: number, pcu: number) =>
  pvu > 0 && pcu > 0 ? ((pvu - pcu) / pvu) * 100 : 0;

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
    empresas: [...new Set(prototypeSedeColumns().map((col) => col.empresa))].map(
      (id) => ({ id, label: empresaLabel(id) }),
    ),
    proveedores: await queryPreciosProveedorCatalogo(client),
    note:
      "Costo de entrada = inventario ET/EF del POS (cmmovimiento_inventario en 217). Si ese día no hay ET/EF, se usa el pedido FR/OC. En Mercatodo ET (tránsito) + EF. Precio venta no se toca. Doble clic: $/kg, kilos y margen vendido.",
  };
};

async function queryPreciosProveedorCatalogo(
  client: PoolClient,
): Promise<Array<{ id: string; label: string }>> {
  const byId = new Map<string, string>();
  const add = (id: string, label: string) => {
    const key = id.trim();
    if (!key) return;
    const name = stripMercamioProveedorLabel(label.trim() || key);
    if (!byId.has(key)) byId.set(key, name);
  };
  try {
    const catalog = await client.query<{ id: string; label: string }>(`
      SELECT
        COALESCE(NULLIF(BTRIM(id_cricla1), ''), '@SP') AS id,
        COALESCE(NULLIF(BTRIM(nombre), ''), id_cricla1, '(Sin proveedor)') AS label
      FROM proveedor_pos_catalogo
      WHERE COALESCE(activo, TRUE) IS TRUE
      ORDER BY 2
      LIMIT 400
    `);
    for (const row of catalog.rows) add(String(row.id), String(row.label));
  } catch {
    // catálogo opcional
  }
  try {
    const oc = await client.query<{ id: string; label: string }>(`
      SELECT
        'oc:' || BTRIM(id_terc) AS id,
        COALESCE(NULLIF(BTRIM(MAX(terc_nombre)), ''), BTRIM(id_terc)) AS label
      FROM orden_compra_linea
      WHERE BTRIM(COALESCE(id_terc, '')) <> ''
      GROUP BY BTRIM(id_terc)
      ORDER BY 2
      LIMIT 400
    `);
    for (const row of oc.rows) add(String(row.id), String(row.label));
  } catch {
    // OC opcional
  }
  return [...byId.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
}

export type PreciosProveedorQueryInput = {
  fromIso: string;
  toIso: string;
  lineaIds?: string[] | null;
  sublineaIds?: string[] | null;
  /** @deprecated usar `sublineaIds`. */
  sublineaId?: string | null;
  proveedorIds?: string[] | null;
  /** @deprecated usar `proveedorIds`. */
  proveedorId?: string | null;
  itemIds?: string[] | null;
  /** Claves `empresa|idCo`. Vacío/null = todas las sedes del prototipo. */
  sedeKeys?: string[] | null;
  search?: string | null;
  itemLimit?: number;
};

const uniqueTrimmed = (
  values: Array<string | null | undefined> | null | undefined,
) =>
  [
    ...new Set(
      (values ?? [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ];

const sqlEqOrAny = (
  params: unknown[],
  columnSql: string,
  values: string[],
): string => {
  if (values.length === 1) {
    params.push(values[0]);
    return `${columnSql} = $${params.length}`;
  }
  params.push(values);
  return `${columnSql} = ANY($${params.length}::text[])`;
};

export const queryPreciosProveedorItemOptions = async (
  client: PoolClient,
  input: {
    q?: string | null;
    lineaIds?: string[] | null;
    sublineaIds?: string[] | null;
    fromIso?: string | null;
    toIso?: string | null;
    limit?: number;
  },
): Promise<
  Array<{ id: string; label: string; lineaId: string; sublineaId: string }>
> => {
  const limit = Math.min(80, Math.max(10, Number(input.limit) || 40));
  const params: unknown[] = [];
  const where: string[] = [
    "TRIM(COALESCE(id_tipo, '')) = '4'",
    "NULLIF(TRIM(id_item), '') IS NOT NULL",
  ];
  const lineaIds = uniqueTrimmed(input.lineaIds);
  if (lineaIds.length > 0) {
    where.push(sqlEqOrAny(params, "id_linea1", lineaIds));
  }
  const sublineaIds = uniqueTrimmed(input.sublineaIds);
  if (sublineaIds.length > 0) {
    where.push(sqlEqOrAny(params, "id_linea2", sublineaIds));
  }
  const fromCompact = input.fromIso ? isoToCompact(input.fromIso) : "";
  const toCompact = input.toIso ? isoToCompact(input.toIso) : "";
  if (/^\d{8}$/.test(fromCompact) && /^\d{8}$/.test(toCompact)) {
    params.push(fromCompact, toCompact);
    where.push(
      `fecha_dcto >= $${params.length - 1} AND fecha_dcto <= $${params.length}`,
    );
  }
  const q = String(input.q ?? "")
    .trim()
    .toLowerCase();
  if (q.length >= 2) {
    params.push(`%${q}%`);
    where.push(`(
      LOWER(id_item) LIKE $${params.length}
      OR LOWER(COALESCE(item_descripcion, '')) LIKE $${params.length}
    )`);
  }
  params.push(limit);
  const result = await client.query<{
    id: string;
    label: string;
    linea_id: string;
    sublinea_id: string;
  }>(
    `
    SELECT
      BTRIM(id_item) AS id,
      COALESCE(NULLIF(MAX(item_descripcion), ''), BTRIM(id_item)) AS label,
      COALESCE(MAX(id_linea1), '') AS linea_id,
      COALESCE(MAX(id_linea2), '') AS sublinea_id
    FROM margen_item_dia_roll
    WHERE ${where.join(" AND ")}
    GROUP BY BTRIM(id_item)
    ORDER BY SUM(COALESCE(ventas_netas, 0)) DESC
    LIMIT $${params.length}
    `,
    params,
  );
  return result.rows.map((row) => ({
    id: String(row.id).trim(),
    label: `${String(row.id).trim()} · ${String(row.label ?? "").trim() || String(row.id).trim()}`,
    lineaId: String(row.linea_id ?? "").trim(),
    sublineaId: String(row.sublinea_id ?? "").trim(),
  }));
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
  const selectedItemIds = uniqueTrimmed(input.itemIds);
  const itemLimit =
    selectedItemIds.length > 0
      ? Math.min(80, Math.max(selectedItemIds.length, 1))
      : Math.min(80, Math.max(10, Number(input.itemLimit) || 40));
  const fetchLimit =
    selectedItemIds.length > 0
      ? selectedItemIds.length
      : Math.min(120, Math.max(itemLimit * 3, itemLimit));
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
  const lineaIds = uniqueTrimmed(input.lineaIds);
  if (lineaIds.length > 0) {
    lineaSql = ` AND ${sqlEqOrAny(params, "r.id_linea1", lineaIds)}`;
  }
  let sublineaSql = "";
  const sublineaIds = uniqueTrimmed([
    ...(input.sublineaIds ?? []),
    input.sublineaId ?? "",
  ]);
  if (sublineaIds.length > 0) {
    sublineaSql = ` AND ${sqlEqOrAny(params, "r.id_linea2", sublineaIds)}`;
  }
  let proveedorSql = "";
  const proveedorIds = parseProveedorFilterIds([
    ...(input.proveedorIds ?? []),
    input.proveedorId ?? "",
  ]);
  if (hasProveedorFilter(proveedorIds)) {
    const parts: string[] = [];
    if (proveedorIds.oc.length > 0) {
      parts.push(`EXISTS (
      SELECT 1 FROM orden_compra_linea oc
      WHERE BTRIM(oc.id_item) = BTRIM(r.id_item)
        AND LOWER(BTRIM(oc.empresa)) = LOWER(BTRIM(r.empresa_norm))
        AND ${sqlEqOrAny(params, "BTRIM(oc.id_terc)", proveedorIds.oc)}
    )`);
    }
    if (proveedorIds.tercero.length > 0) {
      parts.push(`EXISTS (
      SELECT 1 FROM proveedor_item pi0
      LEFT JOIN proveedor_tercero pt0
        ON pt0.empresa = pi0.empresa
       AND pt0.nit = NULLIF(BTRIM((
         SELECT pc0.nit FROM proveedor_pos_catalogo pc0
         WHERE pc0.empresa = pi0.empresa AND pc0.id_cricla1 = pi0.id_cricla1
         LIMIT 1
       )), '')
      WHERE pi0.empresa = r.empresa_norm
        AND pi0.id_item = r.id_item
        AND ${sqlEqOrAny(params, "BTRIM(COALESCE(pt0.codigo, ''))", proveedorIds.tercero)}
    )`);
    }
    if (proveedorIds.criterio.length > 0) {
      parts.push(`EXISTS (
      SELECT 1 FROM proveedor_item pi0
      WHERE pi0.empresa = r.empresa_norm
        AND pi0.id_item = r.id_item
        AND ${sqlEqOrAny(params, "COALESCE(NULLIF(BTRIM(pi0.id_cricla1), ''), '@SP')", proveedorIds.criterio)}
    )`);
    }
    if (parts.length > 0) {
      proveedorSql = ` AND (${parts.join(" OR ")})`;
    }
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
  if (selectedItemIds.length > 0) {
    searchSql = ` AND ${sqlEqOrAny(params, "BTRIM(r.id_item)", selectedItemIds)}`;
  } else if (input.search?.trim()) {
    params.push(`%${input.search.trim().toLowerCase()}%`);
    searchSql = ` AND (
      LOWER(r.id_item) LIKE $${params.length}
      OR LOWER(COALESCE(r.item_descripcion, '')) LIKE $${params.length}
    )`;
  }

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
        ${proveedorSql}
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
    -- El top-N se calcula POR EMPRESA, no sobre la union. Antes ordenaba por
    -- venta sobre todas las empresas juntas, asi que al marcar una segunda
    -- empresa la mas grande copaba el cupo y la otra PERDIA filas: agregar un
    -- filtro hacia desaparecer datos en vez de sumarlos.
    top_items AS (
      SELECT DISTINCT id_item
      FROM (
        SELECT
          empresa_norm,
          id_item,
          ROW_NUMBER() OVER (
            PARTITION BY empresa_norm
            ORDER BY SUM(ventas_netas) DESC, id_item
          ) AS rn
        FROM enriched
        GROUP BY empresa_norm, id_item
      ) ranked
      WHERE rn <= $3
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
      transito: 0,
      units,
      sales,
      cost,
      pvu,
      pcu,
      margenPct: marginPct(sales > 0 ? sales : pvu * units, cost),
    });

    const provId = String(row.proveedor_id ?? "@SP").trim() || "@SP";
    const provLabel = stripMercamioProveedorLabel(
      String(row.proveedor_label ?? "(Sin proveedor)").trim() || "(Sin proveedor)",
    );
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

  const fromCompact = isoToCompact(input.fromIso);
  const toCompact = isoToCompact(input.toIso);
  const params: unknown[] = [
    input.fromIso,
    input.toIso,
    input.itemIds,
    fromCompact,
    toCompact,
  ];
  const tupleSql = input.columns
    .map((col) => {
      params.push(col.empresa.trim().toLowerCase(), col.idCo);
      return `($${params.length - 1}, $${params.length})`;
    })
    .join(", ");

  const tables = await client.query<{ oc: boolean; rot: boolean }>(`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'orden_compra_linea'
      ) AS oc,
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'rotacion_salidas_dia'
      ) AS rot
  `);
  const ocExists = Boolean(tables.rows[0]?.oc);
  const rotExists = Boolean(tables.rows[0]?.rot);

  const extraCtes: string[] = [];
  if (ocExists) {
    extraCtes.push(`
    etef_oc AS (
      SELECT
        LOWER(BTRIM(empresa)) AS empresa,
        CASE
          WHEN BTRIM(id_co) ~ '^[0-9]+$' THEN LPAD(BTRIM(id_co), 3, '0')
          ELSE BTRIM(id_co)
        END AS id_co,
        BTRIM(id_item) AS id_item,
        BTRIM(fecha_dcto) AS fecha,
        SUM(tot_bruto)
          / NULLIF(SUM(${ocEntradaQtySql("tipdoc")}), 0) AS pcu
      FROM orden_compra_linea
      WHERE BTRIM(fecha_dcto) >= $4
        AND BTRIM(fecha_dcto) <= $5
        AND BTRIM(id_item) = ANY($3::text[])
        AND ${ocEntradaInvTipdocSql("empresa", "tipdoc")}
      GROUP BY 1, 2, 3, 4
      HAVING SUM(${ocEntradaQtySql("tipdoc")}) > 0
    )`);
    extraCtes.push(`
    po AS (
      SELECT
        LOWER(BTRIM(empresa)) AS empresa,
        CASE
          WHEN BTRIM(id_co) ~ '^[0-9]+$' THEN LPAD(BTRIM(id_co), 3, '0')
          ELSE BTRIM(id_co)
        END AS id_co,
        BTRIM(id_item) AS id_item,
        BTRIM(fecha_dcto) AS fecha,
        SUM(tot_bruto)
          / NULLIF(SUM(${ocEntradaQtySql("tipdoc")}), 0) AS pcu
      FROM orden_compra_linea
      WHERE BTRIM(fecha_dcto) >= $4
        AND BTRIM(fecha_dcto) <= $5
        AND BTRIM(id_item) = ANY($3::text[])
        AND ${ocEntradaPoTipdocSql("empresa", "tipdoc")}
      GROUP BY 1, 2, 3, 4
      HAVING SUM(${ocEntradaQtySql("tipdoc")}) > 0
    )`);
  }
  if (rotExists) {
    extraCtes.push(`
    etef_rot AS (
      SELECT
        LOWER(BTRIM(empresa)) AS empresa,
        ${ROTACION_SEDE_SQL} AS id_co,
        BTRIM(id_item) AS id_item,
        TO_CHAR(fecha_dia, 'YYYYMMDD') AS fecha,
        SUM(valor) / NULLIF(SUM(unidades), 0) AS pcu
      FROM rotacion_salidas_dia
      WHERE fecha_dia >= $1::date
        AND fecha_dia <= $2::date
        AND BTRIM(id_item) = ANY($3::text[])
        AND ind_es = 1
        AND ${ocEntradaInvTipdocSql("empresa", "doc_inv_tipo")}
        AND (LOWER(BTRIM(empresa)), ${ROTACION_SEDE_SQL}) IN (${tupleSql})
      GROUP BY 1, 2, 3, 4
      HAVING SUM(unidades) > 0
    )`);
  }

  const dayParts = ["SELECT empresa, id_co, id_item, fecha FROM inv"];
  if (ocExists) {
    dayParts.push("SELECT empresa, id_co, id_item, fecha FROM etef_oc");
    dayParts.push("SELECT empresa, id_co, id_item, fecha FROM po");
  }
  if (rotExists) {
    dayParts.push("SELECT empresa, id_co, id_item, fecha FROM etef_rot");
  }
  extraCtes.push(`days AS (${dayParts.join(" UNION ")})`);

  const joins: string[] = [];
  const coalesceArgs: string[] = [];
  if (ocExists) {
    joins.push(`LEFT JOIN etef_oc eo
      ON eo.empresa = d.empresa AND eo.id_co = d.id_co
     AND eo.id_item = d.id_item AND eo.fecha = d.fecha`);
    coalesceArgs.push("eo.pcu");
  }
  if (rotExists) {
    joins.push(`LEFT JOIN etef_rot er
      ON er.empresa = d.empresa AND er.id_co = d.id_co
     AND er.id_item = d.id_item AND er.fecha = d.fecha`);
    coalesceArgs.push("er.pcu");
  }
  if (ocExists) {
    joins.push(`LEFT JOIN po p
      ON p.empresa = d.empresa AND p.id_co = d.id_co
     AND p.id_item = d.id_item AND p.fecha = d.fecha`);
    coalesceArgs.push("p.pcu");
  }
  joins.push(`LEFT JOIN inv i
      ON i.empresa = d.empresa AND i.id_co = d.id_co
     AND i.id_item = d.id_item AND i.fecha = d.fecha`);
  coalesceArgs.push("i.pcu_inv");

  const result = await client.query<{
    empresa: string;
    id_co: string;
    id_item: string;
    costo_entrada: string | number | null;
  }>(
    `
    WITH inv AS (
      SELECT
        LOWER(BTRIM(empresa)) AS empresa,
        ${ROTACION_SEDE_SQL} AS id_co,
        BTRIM(id_item) AS id_item,
        TO_CHAR(fecha_dia, 'YYYYMMDD') AS fecha,
        AVG(costo_uni_inventario) FILTER (
          WHERE COALESCE(costo_uni_inventario, 0) > 0
        ) AS pcu_inv
      FROM rotacion_base_item_dia_sede
      WHERE fecha_dia >= $1::date
        AND fecha_dia <= $2::date
        AND BTRIM(id_item) = ANY($3::text[])
        AND (LOWER(BTRIM(empresa)), ${ROTACION_SEDE_SQL}) IN (${tupleSql})
      GROUP BY 1, 2, 3, 4
    ),
    ${extraCtes.join(",\n")}
    SELECT
      d.empresa,
      d.id_co,
      d.id_item,
      AVG(COALESCE(${coalesceArgs.join(", ")})) AS costo_entrada
    FROM days d
    ${joins.join("\n    ")}
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

  // La OC del fruver no siempre cae el mismo dia de la venta/costo. Si filtramos
  // solo el dia del tablero, el desglose cae al criterio POS (MERCAMIO FRUVER).
  const ocFromCompact =
    compactShiftDays(toCompact, -13) < fromCompact
      ? compactShiftDays(toCompact, -13)
      : fromCompact;
  const ocByItemEmpresa = await queryOrdenCompraLineaProveedores(
    client,
    variantItemIds,
    ocFromCompact,
    toCompact,
    fromCompact,
  );

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

  const provsForSede = (
    variantId: string,
    empresa: string,
    idCo: string,
  ): ResolvedItemProveedor[] => {
    const ocList = ocByItemEmpresa.get(`${variantId}::${empresa.toLowerCase()}`);
    if (ocList && ocList.length > 0) {
      const matched = ocList.filter((entry) => entry.idCos.has(idCo));
      return matched.length > 0 ? matched : ocList;
    }
    return [provByItemEmpresa.get(`${variantId}::${empresa}`) ?? fallbackProv()];
  };

  const upsertExpandCell = (
    prov: ResolvedItemProveedor,
    variantId: string,
    variantLabel: string,
    empresa: string,
    cell: PreciosProveedorCell,
  ) => {
    const proveedorLabel = stripEmpresaProveedorLabel(prov.label);
    const expandId = proveedorExpandGroupKey(variantId, proveedorLabel);
    const nextCell = { ...cell, rowId: expandId };
    const existing = expandMap.get(expandId);
    if (existing) {
      mergeExpandCellInto(existing.cells, nextCell);
      existing.fromTercero = existing.fromTercero || prov.fromTercero;
      existing.nit = mergeProveedorNits(existing.nit, prov.nit);
      if (prov.id.startsWith("oc:") && !existing.proveedorId.startsWith("oc:")) {
        existing.proveedorId = prov.id;
      }
      return;
    }
    expandMap.set(expandId, {
      rowId: expandId,
      itemId: variantId,
      label: variantLabel,
      proveedorId: prov.id,
      proveedorLabel,
      criterioId: prov.criterioId,
      criterioLabel: prov.criterioLabel,
      empresa,
      empresaLabel: empresaLabel(empresa),
      nit: prov.nit,
      fromTercero: prov.fromTercero,
      cells: [nextCell],
    });
  };

  for (const row of variants.rows) {
    const variantId = String(row.id_item).trim();
    const empresa = String(row.empresa).trim();
    const idCo = String(row.id_co).padStart(3, "0");
    const sedeKey = `${empresa}|${idCo}`;
    if (!sedeKeySet.has(sedeKey)) continue;

    const sales = toNum(row.ventas_netas);
    const pvu = toNum(row.pvu);
    const pcu = costoEntrada.get(`${variantId}::${sedeKey}`) ?? 0;
    const variantLabel = String(row.label ?? variantId).trim() || variantId;
    for (const prov of provsForSede(variantId, empresa, idCo)) {
      // Kilos COMPRADOS dentro del rango pedido. Si no hubo entrada en ese
      // rango la celda queda vacia: antes se caia a los kilos VENDIDOS del
      // item, que son otra magnitud y se repetian identicos en cada proveedor.
      const units = prov.qtyByCo?.get(idCo) ?? 0;
      const transito = prov.transitoByCo?.get(idCo) ?? 0;
      // Costo de ESTE proveedor, de los mismos documentos que los kilos. Antes
      // se leia un unico casillero por (item, sede) sin dimension de proveedor,
      // asi que todos los proveedores de una sede mostraban el mismo $/kg.
      const provValue = prov.valByCo?.get(idCo) ?? 0;
      const provPcu = units > 0 && provValue > 0 ? provValue / units : 0;
      const cellPcu = provPcu > 0 ? provPcu : pcu;
      const cost =
        provValue > 0 ? provValue : units > 0 && pcu > 0 ? units * pcu : 0;
      upsertExpandCell(prov, variantId, variantLabel, empresa, {
        rowId: "",
        sedeKey,
        units,
        sales,
        cost,
        pvu,
        pcu: cellPcu,
        margenPct: projectedMarginPct(pvu, cellPcu),
        transito,
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
    const idCo = (sedeKey.split("|")[1] ?? "").padStart(3, "0");
    const variantLabel = itemLabelById.get(variantId) ?? variantId;
    for (const prov of provsForSede(variantId, empresa, idCo)) {
      const proveedorLabel = stripEmpresaProveedorLabel(prov.label);
      const expandId = proveedorExpandGroupKey(variantId, proveedorLabel);
      let existing = expandMap.get(expandId);
      if (!existing) {
        existing = {
          rowId: expandId,
          itemId: variantId,
          label: variantLabel,
          proveedorId: prov.id,
          proveedorLabel,
          criterioId: prov.criterioId,
          criterioLabel: prov.criterioLabel,
          empresa,
          empresaLabel: empresaLabel(empresa),
          nit: prov.nit,
          fromTercero: prov.fromTercero,
          cells: [],
        };
        expandMap.set(expandId, existing);
      } else {
        existing.fromTercero = existing.fromTercero || prov.fromTercero;
        existing.nit = mergeProveedorNits(existing.nit, prov.nit);
        if (prov.id.startsWith("oc:") && !existing.proveedorId.startsWith("oc:")) {
          existing.proveedorId = prov.id;
        }
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
        transito: 0,
        units: 0,
        sales: 0,
        cost: 0,
        pvu: 0,
        pcu: costo,
        margenPct: 0,
      });
    }
  }

  const rows = [...expandMap.values()].sort((a, b) => {
    if (a.itemId === itemId && b.itemId !== itemId) return -1;
    if (b.itemId === itemId && a.itemId !== itemId) return 1;
    const byProv = a.proveedorLabel.localeCompare(b.proveedorLabel, "es");
    if (byProv !== 0) return byProv;
    return a.itemId.localeCompare(b.itemId, "es");
  });

  return { itemId, label, rows };
};
