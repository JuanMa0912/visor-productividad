import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

let localEnvLoaded = false;

const loadLocalEnv = () => {
  if (localEnvLoaded || process.env.DB_PASSWORD?.trim()) return;

  localEnvLoaded = true;
  const envPath = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    ".env.local",
  );
  if (!existsSync(envPath)) return;

  const envContent = readFileSync(envPath, "utf-8");
  envContent.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) return;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key]) return;

    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  });
};

const resolveDbConfig = () => {
  loadLocalEnv();

  const password = process.env.DB_PASSWORD ?? "";
  if (!password.trim()) {
    throw new Error(
      "Falta DB_PASSWORD en el entorno. Define las variables de base de datos antes de iniciar la app.",
    );
  }

  const port = Number(process.env.DB_PORT ?? 5432);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("DB_PORT debe ser un entero valido entre 1 y 65535.");
  }

  const schema = process.env.DB_SCHEMA ?? "public";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error("DB_SCHEMA contiene un identificador invalido.");
  }

  return {
    host: process.env.DB_HOST ?? "192.168.35.232",
    port,
    database: process.env.DB_NAME ?? "produXdia",
    user: process.env.DB_USER ?? "postgres",
    password,
    schema,
  };
};

let pool: import("pg").Pool | null = null;

export const getDbPool = async (): Promise<import("pg").Pool> => {
  if (!pool) {
    const dbConfig = resolveDbConfig();
    try {
      const { Pool } = await import("pg");
      const next = new Pool({
        host: dbConfig.host,
        port: dbConfig.port,
        database: dbConfig.database,
        user: dbConfig.user,
        password: dbConfig.password,
        options: `-c search_path=${dbConfig.schema}`,
        keepAlive: true,
      });
      next.on("error", (err: Error) => {
        console.error("[db] PostgreSQL pool client error:", err.message);
      });
      pool = next;
    } catch {
      throw new Error(
        "No se pudo cargar el cliente de PostgreSQL. Instala la dependencia 'pg' para habilitar la conexion.",
      );
    }
  }
  if (!pool) {
    throw new Error("Pool de PostgreSQL no inicializado.");
  }
  return pool;
};

/** Ejecuta fn con un cliente del pool y libera correctamente; si falla, descarta el cliente (no reutiliza conexion rota). */
export const withPoolClient = async <T>(
  fn: (client: import("pg").PoolClient) => Promise<T>,
): Promise<T> => {
  const poolInstance = await getDbPool();
  const client = await poolInstance.connect();
  try {
    const result = await fn(client);
    client.release();
    return result;
  } catch (err) {
    client.release(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
};

export const testDbConnection = async () => {
  await withPoolClient(async (client) => {
    await client.query("SELECT 1");
  });
};
