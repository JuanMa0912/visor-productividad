import type { PoolClient } from "pg";
import {
  findTiendaSedeByName,
  productividadFamiliaSql,
  PROVEEDORES_TIENDA_SEDES,
  resolveTiendaSede,
  type ProveedorProductividadFamilia,
  type ProveedorTiendaSede,
} from "@/lib/proveedores/line-family";

export type ProveedorProductividadMetrics = {
  fechaInicio: string;
  fechaFin: string;
  dias: number;
  industria: number;
  fruver: number;
  carnes: number;
  cajas: number;
  proveedores: number;
};

export type ProveedorProductividadBySede = {
  sede: string;
  industria: number;
  fruver: number;
  carnes: number;
  cajas: number;
};

export type ProveedorProductividadByDay = {
  fecha: string;
  industria: number;
  fruver: number;
  carnes: number;
  cajas: number;
};

export type ProveedorProductividadProveedorRow = {
  proveedor: string;
  codigo: string | null;
  industria: number;
  fruver: number;
  carnes: number;
  sedesActivas: number;
};

const toNum = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const isoToCompact = (iso: string) => iso.replace(/-/g, "");

const compactToIso = (compact: string) => {
  if (!/^\d{8}$/.test(compact)) return compact;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
};

const quoteIdent = (value: string) => `"${value.replace(/"/g, '""')}"`;

const emptyMetrics = (
  fechaInicio: string,
  fechaFin: string,
  dias: number,
): ProveedorProductividadMetrics => ({
  fechaInicio,
  fechaFin,
  dias,
  industria: 0,
  fruver: 0,
  carnes: 0,
  cajas: 0,
  proveedores: 0,
});

const emptyFamily = () => ({ industria: 0, fruver: 0, carnes: 0, cajas: 0 });

const addFamily = (
  target: ReturnType<typeof emptyFamily>,
  familia: string,
  amount: number,
) => {
  if (familia === "industria" || familia === "fruver" || familia === "carnes" || familia === "cajas") {
    target[familia] += amount;
  }
};

const tableExists = async (client: PoolClient, table: string) => {
  const result = await client.query<{ ok: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    ) AS ok
    `,
    [table],
  );
  return Boolean(result.rows[0]?.ok);
};

const listColumns = async (client: PoolClient, table: string) => {
  const result = await client.query<{ column_name: string }>(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
    `,
    [table],
  );
  return result.rows.map((row) => row.column_name);
};

const pickColumn = (columns: string[], candidates: readonly string[]) => {
  const set = new Map(columns.map((col) => [col.trim().toLowerCase(), col]));
  for (const candidate of candidates) {
    const hit = set.get(candidate.toLowerCase());
    if (hit) return hit;
  }
  return null;
};

const resolveSedes = (sedeName?: string | null): ProveedorTiendaSede[] => {
  if (sedeName?.trim()) {
    const hit = findTiendaSedeByName(sedeName.trim());
    return hit ? [hit] : [];
  }
  return [...PROVEEDORES_TIENDA_SEDES];
};

const pushSedeTuples = (
  params: unknown[],
  sedes: ProveedorTiendaSede[],
): string => {
  const tuples = sedes.map((sede) => {
    params.push(sede.empresa, sede.idCo);
    return `($${params.length - 1}, $${params.length})`;
  });
  return tuples.join(", ");
};

export const listProductividadProveedores = async (
  client: PoolClient,
  args: {
    dateStart: string;
    dateEnd: string;
    sede?: string | null;
    q?: string | null;
    proveedorLimit?: number;
  },
): Promise<{
  metrics: ProveedorProductividadMetrics;
  bySede: ProveedorProductividadBySede[];
  byDay: ProveedorProductividadByDay[];
  proveedores: ProveedorProductividadProveedorRow[];
}> => {
  const fechaInicio = args.dateStart;
  const fechaFin = args.dateEnd;
  const startMs = Date.parse(`${fechaInicio}T12:00:00`);
  const endMs = Date.parse(`${fechaFin}T12:00:00`);
  const dias =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
      ? Math.floor((endMs - startMs) / 86_400_000) + 1
      : 0;
  const sedes = resolveSedes(args.sede);
  if (sedes.length === 0 || dias <= 0) {
    return {
      metrics: emptyMetrics(fechaInicio, fechaFin, dias),
      bySede: [],
      byDay: [],
      proveedores: [],
    };
  }

  const fromCompact = isoToCompact(fechaInicio);
  const toCompact = isoToCompact(fechaFin);
  const familiaSql = productividadFamiliaSql("r.id_linea1", "r.nombre_linea1");
  const hasRoll = await tableExists(client, "margen_item_dia_roll");
  const hasCajas = await tableExists(client, "ventas_cajas");
  const hasProveedorItem = await tableExists(client, "proveedor_item");
  const hasCatalogo = await tableExists(client, "proveedor_pos_catalogo");

  const bySedeMap = new Map<string, ReturnType<typeof emptyFamily>>();
  for (const sede of sedes) bySedeMap.set(sede.name, emptyFamily());
  const byDayMap = new Map<string, ReturnType<typeof emptyFamily>>();
  const totals = emptyFamily();
  let proveedoresCount = 0;
  let proveedorRows: ProveedorProductividadProveedorRow[] = [];

  if (hasRoll) {
    const params: unknown[] = [fromCompact, toCompact];
    const sedeSql = pushSedeTuples(params, sedes);
    const rollResult = await client.query<{
      fecha: string;
      empresa: string;
      id_co: string;
      familia: ProveedorProductividadFamilia | null;
      cantidad: string | number;
    }>(
      `
      SELECT
        r.fecha_dcto AS fecha,
        LOWER(TRIM(r.empresa_norm)) AS empresa,
        LPAD(TRIM(r.id_co_norm), 3, '0') AS id_co,
        ${familiaSql} AS familia,
        COALESCE(SUM(r.cantidad), 0)::numeric AS cantidad
      FROM margen_item_dia_roll r
      WHERE r.fecha_dcto >= $1
        AND r.fecha_dcto <= $2
        AND r.fecha_dcto ~ '^[0-9]{8}$'
        AND TRIM(COALESCE(r.id_tipo, '')) <> '3'
        AND (LOWER(TRIM(r.empresa_norm)), LPAD(TRIM(r.id_co_norm), 3, '0')) IN (${sedeSql})
      GROUP BY 1, 2, 3, 4
      `,
      params,
    );

    for (const row of rollResult.rows) {
      if (!row.familia) continue;
      const sede = resolveTiendaSede(row.empresa, row.id_co);
      if (!sede) continue;
      const amount = toNum(row.cantidad);
      addFamily(totals, row.familia, amount);
      const sedeBucket = bySedeMap.get(sede.name) ?? emptyFamily();
      addFamily(sedeBucket, row.familia, amount);
      bySedeMap.set(sede.name, sedeBucket);
      const fecha = compactToIso(String(row.fecha ?? ""));
      const dayBucket = byDayMap.get(fecha) ?? emptyFamily();
      addFamily(dayBucket, row.familia, amount);
      byDayMap.set(fecha, dayBucket);
    }

    if (hasProveedorItem) {
      const provParams: unknown[] = [fromCompact, toCompact];
      const provSedeSql = pushSedeTuples(provParams, sedes);
      const q = (args.q ?? "").trim().slice(0, 80);
      const catalogJoin = hasCatalogo
        ? `
        LEFT JOIN proveedor_pos_catalogo pc
          ON pc.empresa = pi.empresa
         AND pc.id_cricla1 = pi.id_cricla1
        `
        : "";
      const proveedorName = hasCatalogo
        ? `COALESCE(NULLIF(TRIM(pc.nombre), ''), NULLIF(TRIM(pi.descripcion), ''), '(Sin proveedor)')`
        : `COALESCE(NULLIF(TRIM(pi.descripcion), ''), '(Sin proveedor)')`;
      let searchSql = "";
      if (q) {
        provParams.push(`%${q.replace(/[%_]/g, "")}%`);
        searchSql = hasCatalogo
          ? `
          AND (
            COALESCE(NULLIF(TRIM(pc.nombre), ''), NULLIF(TRIM(pi.descripcion), ''), '') ILIKE $${provParams.length}
            OR COALESCE(pi.id_cricla1, '') ILIKE $${provParams.length}
          )
        `
          : `
          AND (
            COALESCE(NULLIF(TRIM(pi.descripcion), ''), '') ILIKE $${provParams.length}
            OR COALESCE(pi.id_cricla1, '') ILIKE $${provParams.length}
          )
        `;
      }
      const limit = Math.min(Math.max(args.proveedorLimit ?? 300, 1), 2000);

      const provResult = await client.query<{
        proveedor: string;
        codigo: string | null;
        industria: string | number;
        fruver: string | number;
        carnes: string | number;
        sedes_activas: string | number;
      }>(
        `
        SELECT
          ${proveedorName} AS proveedor,
          MAX(NULLIF(TRIM(pi.id_cricla1), '')) AS codigo,
          COALESCE(SUM(r.cantidad) FILTER (WHERE fam.familia = 'industria'), 0)::numeric AS industria,
          COALESCE(SUM(r.cantidad) FILTER (WHERE fam.familia = 'fruver'), 0)::numeric AS fruver,
          COALESCE(SUM(r.cantidad) FILTER (WHERE fam.familia = 'carnes'), 0)::numeric AS carnes,
          COUNT(DISTINCT NULLIF(TRIM(r.id_co_norm), ''))::int AS sedes_activas
        FROM margen_item_dia_roll r
        LEFT JOIN proveedor_item pi
          ON pi.empresa = r.empresa_norm
         AND pi.id_item = r.id_item
        ${catalogJoin}
        CROSS JOIN LATERAL (
          SELECT ${familiaSql} AS familia
        ) fam
        WHERE r.fecha_dcto >= $1
          AND r.fecha_dcto <= $2
          AND r.fecha_dcto ~ '^[0-9]{8}$'
          AND TRIM(COALESCE(r.id_tipo, '')) <> '3'
          AND fam.familia IS NOT NULL
          AND (LOWER(TRIM(r.empresa_norm)), LPAD(TRIM(r.id_co_norm), 3, '0')) IN (${provSedeSql})
          ${searchSql}
        GROUP BY 1
        HAVING (
          COALESCE(SUM(r.cantidad) FILTER (WHERE fam.familia = 'industria'), 0)
          + COALESCE(SUM(r.cantidad) FILTER (WHERE fam.familia = 'fruver'), 0)
          + COALESCE(SUM(r.cantidad) FILTER (WHERE fam.familia = 'carnes'), 0)
        ) <> 0
        ORDER BY (
          COALESCE(SUM(r.cantidad) FILTER (WHERE fam.familia = 'industria'), 0)
          + COALESCE(SUM(r.cantidad) FILTER (WHERE fam.familia = 'fruver'), 0)
          + COALESCE(SUM(r.cantidad) FILTER (WHERE fam.familia = 'carnes'), 0)
        ) DESC NULLS LAST, 1 ASC
        LIMIT $${provParams.length + 1}
        `,
        [...provParams, limit],
      );

      proveedorRows = provResult.rows.map((row) => ({
        proveedor: String(row.proveedor ?? "(Sin proveedor)"),
        codigo: row.codigo == null ? null : String(row.codigo),
        industria: toNum(row.industria),
        fruver: toNum(row.fruver),
        carnes: toNum(row.carnes),
        sedesActivas: Number(row.sedes_activas ?? 0),
      }));
      proveedoresCount = proveedorRows.length;
    }
  }

  if (hasCajas) {
    const columns = await listColumns(client, "ventas_cajas");
    const docCol = pickColumn(columns, [
      "consecutivo_doc",
      "nro_doc",
      "numero_doc",
      "id_factura",
    ]);
    const tipCol = pickColumn(columns, ["id_tipdoc_fc", "id_tipdoc", "tipdoc"]);
    const txExpr = docCol
      ? tipCol
        ? `COUNT(DISTINCT CONCAT_WS('|', NULLIF(TRIM(${quoteIdent(tipCol)}::text), ''), NULLIF(TRIM(${quoteIdent(docCol)}::text), '')))`
        : `COUNT(DISTINCT NULLIF(TRIM(${quoteIdent(docCol)}::text), ''))`
      : "COUNT(*)";

    const params: unknown[] = [fromCompact, toCompact];
    const sedeSql = pushSedeTuples(params, sedes);
    const cajasResult = await client.query<{
      fecha: string;
      empresa: string;
      id_co: string;
      tx: string | number;
    }>(
      `
      SELECT
        fecha_dcto AS fecha,
        LOWER(TRIM(empresa_bd)) AS empresa,
        LPAD(TRIM(centro_operacion::text), 3, '0') AS id_co,
        ${txExpr} AS tx
      FROM ventas_cajas
      WHERE fecha_dcto >= $1
        AND fecha_dcto <= $2
        AND fecha_dcto ~ '^[0-9]{8}$'
        AND (LOWER(TRIM(empresa_bd)), LPAD(TRIM(centro_operacion::text), 3, '0')) IN (${sedeSql})
      GROUP BY 1, 2, 3
      `,
      params,
    );

    for (const row of cajasResult.rows) {
      const sede = resolveTiendaSede(row.empresa, row.id_co);
      if (!sede) continue;
      const amount = toNum(row.tx);
      totals.cajas += amount;
      const sedeBucket = bySedeMap.get(sede.name) ?? emptyFamily();
      sedeBucket.cajas += amount;
      bySedeMap.set(sede.name, sedeBucket);
      const fecha = compactToIso(String(row.fecha ?? ""));
      const dayBucket = byDayMap.get(fecha) ?? emptyFamily();
      dayBucket.cajas += amount;
      byDayMap.set(fecha, dayBucket);
    }
  }

  const bySede: ProveedorProductividadBySede[] = sedes.map((sede) => {
    const bucket = bySedeMap.get(sede.name) ?? emptyFamily();
    return { sede: sede.name, ...bucket };
  });

  const byDay: ProveedorProductividadByDay[] = [...byDayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fecha, bucket]) => ({ fecha, ...bucket }));

  return {
    metrics: {
      fechaInicio,
      fechaFin,
      dias,
      industria: totals.industria,
      fruver: totals.fruver,
      carnes: totals.carnes,
      cajas: totals.cajas,
      proveedores: proveedoresCount,
    },
    bySede,
    byDay,
    proveedores: proveedorRows,
  };
};
