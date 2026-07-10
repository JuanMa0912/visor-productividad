import type { PoolClient } from "pg";
import {
  isRollTable,
  resolveInformeMargenDataSource,
  type MargenDataTable,
} from "@/lib/margenes/margen-data-source";

export type InformeVariacionMeta = {
  ready: boolean;
  maxDate: string | null;
  table: MargenDataTable | null;
  message?: string | null;
};

const buildMetaSedeFilter = (
  table: MargenDataTable,
  allowedSedeKeys: string[] | null,
  params: Array<string | string[]>,
): string => {
  if (!allowedSedeKeys || allowedSedeKeys.length === 0) return "";

  const pairs = allowedSedeKeys
    .map((key) => {
      const [empresa, idCo] = key.split("|");
      if (!empresa || !idCo) return null;
      return { empresa: empresa.toLowerCase(), idCo: idCo.padStart(3, "0") };
    })
    .filter((pair): pair is { empresa: string; idCo: string } => pair !== null);

  if (pairs.length === 0) return "";

  params.push(
    pairs.map((pair) => pair.empresa),
    pairs.map((pair) => pair.idCo),
  );
  const empresaParam = params.length - 1;
  const coParam = params.length;

  if (isRollTable(table)) {
    return `AND (empresa_norm, id_co_norm) IN (
      SELECT * FROM UNNEST($${empresaParam}::text[], $${coParam}::text[]) AS t(empresa_norm, id_co_norm)
    )`;
  }

  return `AND (LOWER(TRIM(COALESCE(empresa, ''))), LPAD(TRIM(COALESCE(id_co::text, '')), 3, '0'))
    IN (SELECT * FROM UNNEST($${empresaParam}::text[], $${coParam}::text[]) AS t(empresa, id_co))`;
};

export const loadInformeVariacionMeta = async (
  client: PoolClient,
  allowedSedeKeys: string[] | null,
): Promise<InformeVariacionMeta> => {
  const tableCheck = await client.query(`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'margen_final'
    LIMIT 1
  `);

  if (!tableCheck.rows?.length) {
    return {
      ready: false,
      maxDate: null,
      table: null,
      message:
        "Tabla margen_final no existe aun. Aplica db/migrations/20260622_margen_final.sql.",
    };
  }

  const table = await resolveInformeMargenDataSource(client);
  const params: Array<string | string[]> = [];
  const sedeFilterSql = buildMetaSedeFilter(table, allowedSedeKeys, params);

  const result = await client.query<{ max_date: string | null; has_rows: boolean }>(
    `
      SELECT
        (
          SELECT MAX(fecha_dcto)
          FROM ${table}
          WHERE fecha_dcto IS NOT NULL
            AND fecha_dcto ~ '^[0-9]{8}$'
            ${sedeFilterSql}
        ) AS max_date,
        EXISTS (
          SELECT 1
          FROM ${table}
          WHERE fecha_dcto IS NOT NULL
            ${sedeFilterSql}
          LIMIT 1
        ) AS has_rows
    `,
    params,
  );

  const row = result.rows[0];
  const hasRows = Boolean(row?.has_rows);
  const maxDate = row?.max_date ?? null;

  return {
    ready: hasRows,
    maxDate,
    table,
    message: hasRows
      ? null
      : "Sin datos en margen_final para las sedes asignadas.",
  };
};
