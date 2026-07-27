import type { PoolClient } from "pg";
import type { MargenQueryFilters } from "@/lib/margenes/margen-final-query";
import { parseSedeKey } from "@/lib/margenes/margen-final-query";
import { KPI_MERCADO_TIPO } from "@/lib/margenes/metrics";

export type MargenDataTable =
  | "margen_final"
  | "margen_final_roll"
  | "margen_item_dia_roll"
  | "margen_dinastia"
  | "margen_dinastia_roll";

export const MARGEN_ROLL_TABLE: MargenDataTable = "margen_final_roll";
export const MARGEN_ITEM_DIA_ROLL_TABLE: MargenDataTable = "margen_item_dia_roll";
export const MARGEN_RAW_TABLE: MargenDataTable = "margen_final";
export const MARGEN_DINASTIA_TABLE: MargenDataTable = "margen_dinastia";
export const MARGEN_DINASTIA_ROLL_TABLE: MargenDataTable = "margen_dinastia_roll";

let rollTableAvailable: boolean | null = null;
let dinastiaRollAvailable: boolean | null = null;
let itemDiaRollAvailable: boolean | null = null;

/** Roll factura+item (legacy o Dinastia). */
export const isFacturaItemRollTable = (table: MargenDataTable): boolean =>
  table === MARGEN_ROLL_TABLE || table === MARGEN_DINASTIA_ROLL_TABLE;

export const isRollTable = (table: MargenDataTable): boolean =>
  isFacturaItemRollTable(table) || table === MARGEN_ITEM_DIA_ROLL_TABLE;

/** Columnas de factura que el tablero exige en rolls factura+item. */
export const MARGEN_ROLL_FACTURA_ATTR_COLUMNS = [
  "documento_docfc",
  "id_terc",
  "nombre_terc",
  "id_caja",
  "vend_cc",
  "vend_cc_desc",
] as const;

/**
 * Verifica que el roll tenga attrs de factura (cliente/caja/vendedor/doc).
 * Si faltan: hay que aplicar migraciones y refrescar el roll.
 */
export const assertMargenRollFacturaAttrs = async (
  client: PoolClient,
  tableName: string = "margen_final_roll",
): Promise<void> => {
  const result = await client.query<{ column_name: string }>(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
      AND column_name = ANY($2::text[])
    `,
    [tableName, MARGEN_ROLL_FACTURA_ATTR_COLUMNS],
  );
  const present = new Set(result.rows.map((row) => row.column_name));
  const missing = MARGEN_ROLL_FACTURA_ATTR_COLUMNS.filter(
    (column) => !present.has(column),
  );
  if (missing.length === 0) return;
  throw new Error(
    `${tableName} sin columnas de factura: ${missing.join(", ")}. ` +
      (tableName === "margen_dinastia_roll"
        ? `Aplica db/migrations/20260724_margen_dinastia_roll.sql; luego npm run margen:refresh-roll.`
        : `Aplica db/migrations/20260721_margen_factura_cliente.sql y ` +
          `db/migrations/20260722_margen_factura_caja_vendedor.sql; luego npm run margen:refresh-roll.`),
  );
};

export const resolveMargenDataSource = async (
  client: PoolClient,
  options?: { kind?: "default" | "dinastia" },
): Promise<MargenDataTable> => {
  if (options?.kind === "dinastia") {
    const exists = await client.query<{ ok: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'margen_dinastia'
      ) AS ok
    `);
    if (!exists.rows[0]?.ok) {
      throw new Error(
        "Tabla margen_dinastia no disponible. Aplica db/migrations/20260723_dinastia_tenant_tables.sql y carga datos.",
      );
    }

    if (process.env.MARGEN_FORCE_RAW === "1") return MARGEN_DINASTIA_TABLE;
    if (dinastiaRollAvailable === true) return MARGEN_DINASTIA_ROLL_TABLE;
    if (dinastiaRollAvailable === false) return MARGEN_DINASTIA_TABLE;

    const rollExists = await client.query<{ ok: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'margen_dinastia_roll'
      ) AS ok
    `);
    if (!rollExists.rows[0]?.ok) {
      dinastiaRollAvailable = false;
      return MARGEN_DINASTIA_TABLE;
    }

    const populated = await client.query<{ ok: boolean }>(`
      SELECT EXISTS (SELECT 1 FROM margen_dinastia_roll LIMIT 1) AS ok
    `);
    if (!populated.rows[0]?.ok) {
      return MARGEN_DINASTIA_TABLE;
    }

    await assertMargenRollFacturaAttrs(client, "margen_dinastia_roll");
    dinastiaRollAvailable = true;
    return MARGEN_DINASTIA_ROLL_TABLE;
  }

  if (process.env.MARGEN_FORCE_RAW === "1") return MARGEN_RAW_TABLE;
  if (rollTableAvailable === true) return MARGEN_ROLL_TABLE;
  if (rollTableAvailable === false) return MARGEN_RAW_TABLE;

  const result = await client.query<{ ok: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'margen_final_roll'
    ) AS ok
  `);
  if (!result.rows[0]?.ok) {
    rollTableAvailable = false;
    return MARGEN_RAW_TABLE;
  }

  const populated = await client.query<{ ok: boolean }>(`
    SELECT EXISTS (SELECT 1 FROM margen_final_roll LIMIT 1) AS ok
  `);
  if (!populated.rows[0]?.ok) {
    return MARGEN_RAW_TABLE;
  }

  await assertMargenRollFacturaAttrs(client);
  rollTableAvailable = true;
  return MARGEN_ROLL_TABLE;
};

/** Preferido por /informe-variacion: item/dia sin factura (mas pequeño que margen_final_roll). */
export const resolveInformeMargenDataSource = async (
  client: PoolClient,
  options?: { kind?: "default" | "dinastia" },
): Promise<MargenDataTable> => {
  if (options?.kind === "dinastia") {
    return resolveMargenDataSource(client, { kind: "dinastia" });
  }
  if (process.env.MARGEN_FORCE_RAW === "1") return MARGEN_RAW_TABLE;

  if (itemDiaRollAvailable === false) {
    return resolveMargenDataSource(client);
  }

  if (itemDiaRollAvailable === null) {
    const result = await client.query<{ ok: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'margen_item_dia_roll'
      ) AS ok
    `);
    if (!result.rows[0]?.ok) {
      itemDiaRollAvailable = false;
      return resolveMargenDataSource(client);
    }
    itemDiaRollAvailable = true;
  }

  const populated = await client.query<{ ok: boolean }>(`
    SELECT EXISTS (SELECT 1 FROM margen_item_dia_roll LIMIT 1) AS ok
  `);
  if (populated.rows[0]?.ok) return MARGEN_ITEM_DIA_ROLL_TABLE;
  return resolveMargenDataSource(client);
};

export const resetMargenDataSourceCache = () => {
  rollTableAvailable = null;
  dinastiaRollAvailable = null;
  itemDiaRollAvailable = null;
};

export const mercadoTipoSql = (table: MargenDataTable): string =>
  isRollTable(table)
    ? `id_tipo = '${KPI_MERCADO_TIPO}'`
    : `TRIM(COALESCE(id_tipo::text, '')) = '${KPI_MERCADO_TIPO}'`;

/**
 * Normaliza fecha_dcto a YYYYMMDD para comparar con filtros compactos.
 * margen_dinastia a veces llega como ISO (`2026-07-21`) en vez de `20260721`.
 */
export const fechaDctoCompactSql = (table: MargenDataTable): string => {
  if (isRollTable(table)) return "fecha_dcto";
  return `regexp_replace(left(fecha_dcto::text, 10), '[^0-9]', '', 'g')`;
};

/** Dinastia no usa el mismo catalogo de id_tipo; no forzar Mercado (4). */
export const shouldSkipMercadoTipoDefault = (table: MargenDataTable): boolean =>
  table === MARGEN_DINASTIA_TABLE || table === MARGEN_DINASTIA_ROLL_TABLE;

export const buildMargenWhereForTable = (
  filters: MargenQueryFilters,
  params: unknown[],
  table: MargenDataTable,
): string => {
  const parts = ["fecha_dcto IS NOT NULL"];
  const fechaExpr = fechaDctoCompactSql(table);

  if (filters.fechas.length > 0) {
    params.push(filters.fechas);
    parts.push(`${fechaExpr} = ANY($${params.length}::text[])`);
  } else {
    params.push(filters.fromCompact, filters.toCompact);
    parts.push(
      `${fechaExpr} BETWEEN $${params.length - 1} AND $${params.length}`,
    );
  }

  if (isRollTable(table)) {
    if (filters.empresas.length > 0) {
      params.push(filters.empresas);
      parts.push(`empresa_norm = ANY($${params.length}::text[])`);
    }

    if (filters.sedes.length > 0) {
      const sedePairs = filters.sedes
        .map(parseSedeKey)
        .filter((pair): pair is { empresa: string; idCo: string } => pair !== null);
      if (sedePairs.length > 0) {
        const empresaList = sedePairs.map((pair) => pair.empresa);
        const coList = sedePairs.map((pair) => pair.idCo);
        params.push(empresaList, coList);
        parts.push(
          `(empresa_norm, id_co_norm) IN (
            SELECT * FROM UNNEST($${params.length - 1}::text[], $${params.length}::text[]) AS t(empresa, id_co)
          )`,
        );
      }
    }

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

    return parts.join(" AND ");
  }

  if (filters.empresas.length > 0) {
    params.push(filters.empresas);
    parts.push(
      `LOWER(TRIM(COALESCE(empresa, ''))) = ANY($${params.length}::text[])`,
    );
  }

  if (filters.sedes.length > 0) {
    const sedePairs = filters.sedes
      .map(parseSedeKey)
      .filter((pair): pair is { empresa: string; idCo: string } => pair !== null);
    if (sedePairs.length > 0) {
      const empresaList = sedePairs.map((pair) => pair.empresa);
      const coList = sedePairs.map((pair) => pair.idCo);
      params.push(empresaList, coList);
      parts.push(
        `(LOWER(TRIM(COALESCE(empresa, ''))), LPAD(TRIM(COALESCE(id_co, '')), 3, '0')) IN (
          SELECT * FROM UNNEST($${params.length - 1}::text[], $${params.length}::text[]) AS t(empresa, id_co)
        )`,
      );
    }
  }

  if (filters.categorias.length > 0) {
    params.push(filters.categorias);
    parts.push(`TRIM(COALESCE(id_tipo::text, '')) = ANY($${params.length}::text[])`);
  }
  if (filters.excludedCategorias && filters.excludedCategorias.length > 0) {
    params.push(filters.excludedCategorias);
    parts.push(
      `NOT (TRIM(COALESCE(id_tipo::text, '')) = ANY($${params.length}::text[]))`,
    );
  }
  if (filters.lineas.length > 0) {
    params.push(filters.lineas);
    parts.push(`TRIM(COALESCE(id_linea1::text, '')) = ANY($${params.length}::text[])`);
  }
  if (filters.sublineas.length > 0) {
    params.push(filters.sublineas);
    parts.push(`TRIM(COALESCE(id_linea2::text, '')) = ANY($${params.length}::text[])`);
  }
  if (filters.items.length > 0) {
    params.push(filters.items);
    parts.push(`TRIM(COALESCE(id_item::text, '')) = ANY($${params.length}::text[])`);
  }

  return parts.join(" AND ");
};

export const sedeSelectSql = (table: MargenDataTable) =>
  isRollTable(table)
    ? `empresa_norm AS empresa, id_co_norm AS id_co`
    : `LOWER(TRIM(COALESCE(empresa, ''))) AS empresa, LPAD(TRIM(COALESCE(id_co, '')), 3, '0') AS id_co`;

/**
 * Atributos de factura (pasajeros vía MAX, no cambian GROUP BY):
 * cliente, documento POS, caja y vendedor.
 */
export const clienteSelectSql = (table: MargenDataTable) => {
  if (table === MARGEN_ITEM_DIA_ROLL_TABLE) {
    return [
      "NULL::text AS nombre_terc",
      "NULL::text AS id_terc",
      "NULL::text AS documento_docfc",
      "NULL::text AS id_caja",
      "NULL::text AS vend_cc",
      "NULL::text AS vend_cc_desc",
    ].join(", ");
  }

  if (isFacturaItemRollTable(table)) {
    return [
      `MAX(NULLIF(nombre_terc, '')) AS nombre_terc`,
      `MAX(NULLIF(id_terc, '')) AS id_terc`,
      `MAX(NULLIF(documento_docfc, '')) AS documento_docfc`,
      `MAX(NULLIF(id_caja, '')) AS id_caja`,
      `MAX(NULLIF(vend_cc, '')) AS vend_cc`,
      `MAX(NULLIF(vend_cc_desc, '')) AS vend_cc_desc`,
    ].join(", ");
  }

  return [
    `MAX(NULLIF(TRIM(nombre_terc), '')) AS nombre_terc`,
    `MAX(NULLIF(TRIM(id_terc), '')) AS id_terc`,
    `MAX(NULLIF(TRIM(documento_docfc), '')) AS documento_docfc`,
    `MAX(NULLIF(TRIM(id_caja), '')) AS id_caja`,
    `MAX(NULLIF(TRIM(vend_cc), '')) AS vend_cc`,
    `MAX(NULLIF(TRIM(vend_cc_desc), '')) AS vend_cc_desc`,
  ].join(", ");
};

/** Clave de cliente para GROUP BY / filtros (vacío = sin tercero identificado). */
export const idTercExpr = (table: MargenDataTable) => {
  if (table === MARGEN_ITEM_DIA_ROLL_TABLE) return `''`;
  if (isFacturaItemRollTable(table)) {
    return `COALESCE(NULLIF(id_terc, ''), '')`;
  }
  return `COALESCE(NULLIF(TRIM(id_terc), ''), '')`;
};

export const nombreTercExpr = (table: MargenDataTable) => {
  if (table === MARGEN_ITEM_DIA_ROLL_TABLE) return `NULL::text`;
  if (isFacturaItemRollTable(table)) {
    return `NULLIF(nombre_terc, '')`;
  }
  return `NULLIF(TRIM(nombre_terc), '')`;
};

/** Clave de vendedor para GROUP BY / filtros (vacío = sin vendedor identificado). */
export const vendCcExpr = (table: MargenDataTable) => {
  if (table === MARGEN_ITEM_DIA_ROLL_TABLE) return `''`;
  if (isFacturaItemRollTable(table)) {
    return `COALESCE(NULLIF(vend_cc, ''), '')`;
  }
  return `COALESCE(NULLIF(TRIM(vend_cc), ''), '')`;
};

export const vendCcDescExpr = (table: MargenDataTable) => {
  if (table === MARGEN_ITEM_DIA_ROLL_TABLE) return `NULL::text`;
  if (isFacturaItemRollTable(table)) {
    return `NULLIF(vend_cc_desc, '')`;
  }
  return `NULLIF(TRIM(vend_cc_desc), '')`;
};

/** Expresión de sede para COUNT(DISTINCT ...) en agregaciones. */
export const sedeDistinctKeySql = (table: MargenDataTable) =>
  isRollTable(table)
    ? `(empresa_norm, id_co_norm)`
    : `(LOWER(TRIM(COALESCE(empresa, ''))), LPAD(TRIM(COALESCE(id_co, '')), 3, '0'))`;

export type FacturaSedeRef = {
  empresa?: string;
  idCo?: string;
};

/** Acota una factura a una sede cuando el número de documento se repite entre sedes. */
export const facturaSedeSqlFilters = (
  factura: FacturaSedeRef,
  params: unknown[],
  table: MargenDataTable,
): string[] => {
  const empresa = factura.empresa?.trim();
  const idCo = factura.idCo?.trim();
  if (!empresa || !idCo) return [];

  params.push(empresa, idCo);
  if (isRollTable(table)) {
    return [
      `empresa_norm = $${params.length - 1}`,
      `id_co_norm = $${params.length}`,
    ];
  }
  return [
    `LOWER(TRIM(COALESCE(empresa, ''))) = $${params.length - 1}`,
    `LPAD(TRIM(COALESCE(id_co, '')), 3, '0') = $${params.length}`,
  ];
};
