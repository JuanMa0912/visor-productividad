import type { PoolClient } from "pg";
import type { MargenQueryFilters } from "@/lib/margenes/margen-final-query";
import { parseSedeKey } from "@/lib/margenes/margen-final-query";
import { KPI_MERCADO_TIPO } from "@/lib/margenes/metrics";

export type MargenDataTable = "margen_final" | "margen_final_roll";

export const MARGEN_ROLL_TABLE: MargenDataTable = "margen_final_roll";
export const MARGEN_RAW_TABLE: MargenDataTable = "margen_final";

let rollTableAvailable: boolean | null = null;

export const isRollTable = (table: MargenDataTable): boolean =>
  table === MARGEN_ROLL_TABLE;

export const resolveMargenDataSource = async (
  client: PoolClient,
): Promise<MargenDataTable> => {
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
  rollTableAvailable = Boolean(populated.rows[0]?.ok);
  return rollTableAvailable ? MARGEN_ROLL_TABLE : MARGEN_RAW_TABLE;
};

export const resetMargenDataSourceCache = () => {
  rollTableAvailable = null;
};

export const mercadoTipoSql = (table: MargenDataTable): string =>
  isRollTable(table) ? `id_tipo = '${KPI_MERCADO_TIPO}'` : `TRIM(COALESCE(id_tipo::text, '')) = '${KPI_MERCADO_TIPO}'`;

export const buildMargenWhereForTable = (
  filters: MargenQueryFilters,
  params: unknown[],
  table: MargenDataTable,
): string => {
  const parts = ["fecha_dcto IS NOT NULL"];

  if (filters.fechas.length > 0) {
    params.push(filters.fechas);
    parts.push(`fecha_dcto = ANY($${params.length}::text[])`);
  } else {
    params.push(filters.fromCompact, filters.toCompact);
    parts.push(`fecha_dcto BETWEEN $${params.length - 1} AND $${params.length}`);
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

/** Expresión de sede para COUNT(DISTINCT ...) en agregaciones. */
export const sedeDistinctKeySql = (table: MargenDataTable) =>
  isRollTable(table)
    ? `(empresa_norm, id_co_norm)`
    : `(LOWER(TRIM(COALESCE(empresa, ''))), LPAD(TRIM(COALESCE(id_co, '')), 3, '0'))`;
