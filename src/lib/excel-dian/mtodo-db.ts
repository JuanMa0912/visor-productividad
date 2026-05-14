type RequiredMtodoEnvKey =
  | "EXCEL_DIAN_MTDO_DB_HOST"
  | "EXCEL_DIAN_MTDO_DB_NAME"
  | "EXCEL_DIAN_MTDO_DB_USER"
  | "EXCEL_DIAN_MTDO_DB_PASSWORD";

const resolveRequiredEnv = (key: RequiredMtodoEnvKey) => {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(
      `Falta ${key} en el entorno para la conexion DIAN de Comercializadora.`,
    );
  }
  return value;
};

const resolvePort = () => {
  const raw = process.env.EXCEL_DIAN_MTDO_DB_PORT?.trim() || "5432";
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("EXCEL_DIAN_MTDO_DB_PORT debe ser un puerto valido.");
  }
  return port;
};

const resolveSchema = () => {
  const schema = process.env.EXCEL_DIAN_MTDO_DB_SCHEMA?.trim() || "public";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error("EXCEL_DIAN_MTDO_DB_SCHEMA contiene un identificador invalido.");
  }
  return schema;
};

let pool: import("pg").Pool | null = null;

export const getMtodoExcelDianPool = async (): Promise<import("pg").Pool> => {
  if (!pool) {
    const { Pool } = await import("pg");
    const schema = resolveSchema();
    pool = new Pool({
      host: resolveRequiredEnv("EXCEL_DIAN_MTDO_DB_HOST"),
      port: resolvePort(),
      database: resolveRequiredEnv("EXCEL_DIAN_MTDO_DB_NAME"),
      user: resolveRequiredEnv("EXCEL_DIAN_MTDO_DB_USER"),
      password: resolveRequiredEnv("EXCEL_DIAN_MTDO_DB_PASSWORD"),
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
      keepAlive: true,
      options: `-c search_path=${schema} -c statement_timeout=600000`,
    });
    pool.on("error", (err: Error) => {
      console.error("[excel-dian] PostgreSQL pool client error:", err.message);
    });
  }
  return pool;
};
