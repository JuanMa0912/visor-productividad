import type { Pool } from "pg";

/** Código de empresa en query `empresa=` y prefijo de variables de entorno. */
export type ExcelDianDbEmpresa = "mtodo" | "mio" | "bgt";

const ENV_PREFIX: Record<ExcelDianDbEmpresa, string> = {
  mtodo: "EXCEL_DIAN_MTDO",
  mio: "EXCEL_DIAN_MIO",
  bgt: "EXCEL_DIAN_BGT",
};

const EMPRESA_HUMAN: Record<ExcelDianDbEmpresa, string> = {
  mtodo: "Comercializadora (mtodo)",
  mio: "Mercamio (mio)",
  bgt: "Merkmios (bgt)",
};

/**
 * Código contable de empresa (`id_emp`) dentro de cada base DIAN. No es '01' en
 * todas: Mercamio contabiliza bajo '02'. Se usa para filtrar `cgmovimiento_contable`.
 */
export const EXCEL_DIAN_ID_EMP: Record<ExcelDianDbEmpresa, string> = {
  mtodo: "01",
  mio: "02",
  bgt: "01",
};

type RequiredEnvSuffix = "DB_HOST" | "DB_NAME" | "DB_USER" | "DB_PASSWORD";

const resolveRequiredEnv = (
  empresa: ExcelDianDbEmpresa,
  prefix: string,
  suffix: RequiredEnvSuffix,
) => {
  const key = `${prefix}_${suffix}`;
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(
      `Falta ${key} en el entorno para la conexion DIAN (${EMPRESA_HUMAN[empresa]}).`,
    );
  }
  return value;
};

const resolvePort = (empresa: ExcelDianDbEmpresa, prefix: string) => {
  const key = `${prefix}_DB_PORT`;
  const raw = process.env[key]?.trim() || "5432";
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(
      `${key} debe ser un puerto valido (${EMPRESA_HUMAN[empresa]}).`,
    );
  }
  return port;
};

const resolveSchema = (empresa: ExcelDianDbEmpresa, prefix: string) => {
  const key = `${prefix}_DB_SCHEMA`;
  const schema = process.env[key]?.trim() || "public";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error(
      `${key} contiene un identificador invalido (${EMPRESA_HUMAN[empresa]}).`,
    );
  }
  return schema;
};

const poolByEmpresa: Partial<Record<ExcelDianDbEmpresa, Pool>> = {};

export const getExcelDianPool = async (
  empresa: ExcelDianDbEmpresa,
): Promise<Pool> => {
  const existing = poolByEmpresa[empresa];
  if (existing) return existing;

  const prefix = ENV_PREFIX[empresa];
  const { Pool } = await import("pg");
  const schema = resolveSchema(empresa, prefix);
  const pool = new Pool({
    host: resolveRequiredEnv(empresa, prefix, "DB_HOST"),
    port: resolvePort(empresa, prefix),
    database: resolveRequiredEnv(empresa, prefix, "DB_NAME"),
    user: resolveRequiredEnv(empresa, prefix, "DB_USER"),
    password: resolveRequiredEnv(empresa, prefix, "DB_PASSWORD"),
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
    options: `-c search_path=${schema} -c statement_timeout=600000`,
  });
  pool.on("error", (err: Error) => {
    console.error(
      `[excel-dian] PostgreSQL pool (${empresa}) client error:`,
      err.message,
    );
  });
  poolByEmpresa[empresa] = pool;
  return pool;
};

/** @deprecated Usar getExcelDianPool("mtodo"). */
export const getMtodoExcelDianPool = (): Promise<Pool> =>
  getExcelDianPool("mtodo");
