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

/** Lee un entero no-negativo de env con fallback; ignora valores invalidos. */
const intEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
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

  const host = process.env.DB_HOST ?? "192.168.35.232";

  const sslEnv = (process.env.DB_SSL ?? "").trim().toLowerCase();
  let ssl: false | { rejectUnauthorized: boolean };
  if (sslEnv === "true" || sslEnv === "1" || sslEnv === "require") {
    ssl = { rejectUnauthorized: false };
  } else if (sslEnv === "false" || sslEnv === "0" || sslEnv === "disable") {
    ssl = false;
  } else {
    // Default seguro: SSL ON salvo loopback (Cloud SQL siempre exige SSL).
    const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(host);
    ssl = isLoopback ? false : { rejectUnauthorized: false };
  }

  return {
    host,
    port,
    database: process.env.DB_NAME ?? "produXdia",
    user: process.env.DB_USER ?? "postgres",
    password,
    schema,
    ssl,
  };
};

let pool: import("pg").Pool | null = null;

export const getDbPool = async (): Promise<import("pg").Pool> => {
  if (!pool) {
    const dbConfig = resolveDbConfig();
    try {
      const { Pool } = await import("pg");

      // Endurecimiento del pool. Idea clave: separar "adquirir conexion" (acotable
      // sin riesgo, no es la query) de "duracion de query" (techo generoso para no
      // matar las pesadas como rotacion). Todo configurable por env con defaults
      // seguros. Sin esto, connectionTimeoutMillis=0 hace que pool.connect() espere
      // para siempre cuando el pool se agota => servidor "pegado" hasta pm2 restart.
      const statementTimeoutMs = intEnv("DB_STATEMENT_TIMEOUT_MS", 800_000);
      const idleTxTimeoutMs = intEnv("DB_IDLE_TX_TIMEOUT_MS", 60_000);
      const optionParts = [`-c search_path=${dbConfig.schema}`];
      // Techo alto (800s): solo aborta queries trabadas "para siempre" (conexion
      // zombi); rotacion/exports reales terminan muy por debajo. 0 = desactivado.
      if (statementTimeoutMs > 0) {
        optionParts.push(`-c statement_timeout=${statementTimeoutMs}`);
      }
      // Solo dispara en transacciones OCIOSas; no toca una query en ejecucion.
      if (idleTxTimeoutMs > 0) {
        optionParts.push(
          `-c idle_in_transaction_session_timeout=${idleTxTimeoutMs}`,
        );
      }

      const next = new Pool({
        host: dbConfig.host,
        port: dbConfig.port,
        database: dbConfig.database,
        user: dbConfig.user,
        password: dbConfig.password,
        options: optionParts.join(" "),
        application_name: "visor-productividad",
        keepAlive: true,
        ssl: dbConfig.ssl,
        // Adquirir un client: falla rapido en vez de colgar para siempre cuando
        // el pool se agota (causa raiz del "pegado"). NO afecta la duracion de queries.
        max: intEnv("DB_POOL_MAX", 15),
        connectionTimeoutMillis: intEnv("DB_POOL_CONN_TIMEOUT_MS", 10_000),
        idleTimeoutMillis: intEnv("DB_POOL_IDLE_TIMEOUT_MS", 30_000),
        // Recicla conexiones zombi (Cloud SQL/NAT cierran sockets ociosos). La
        // eviccion ocurre al liberar/estar idle, nunca a mitad de una query.
        maxLifetimeSeconds: intEnv("DB_POOL_MAX_LIFETIME_SEC", 1_800),
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

/**
 * Ejecuta fn con un cliente del pool y libera correctamente; si falla, descarta el
 * cliente (no reutiliza conexion rota).
 *
 * `statementTimeoutMs` (Fase 2, opcional y ADITIVO): aplica un statement_timeout mas
 * corto SOLO a este client mientras esta fuera del pool, y lo restablece al techo
 * global con RESET al terminar. Pensado para endpoints LIVIANOS (auth, heartbeat,
 * presencia, listados admin). Las rutas pesadas (rotacion, margenes, exports) no lo
 * usan y conservan el techo generoso del pool.
 */
export const withPoolClient = async <T>(
  fn: (client: import("pg").PoolClient) => Promise<T>,
  opts?: { statementTimeoutMs?: number },
): Promise<T> => {
  const poolInstance = await getDbPool();
  const client = await poolInstance.connect();
  const overrideMs = opts?.statementTimeoutMs;
  const applyOverride = typeof overrideMs === "number" && overrideMs >= 0;
  try {
    if (applyOverride) {
      await client.query(`SET statement_timeout = ${Math.floor(overrideMs)}`);
    }
    const result = await fn(client);
    // RESET restaura el statement_timeout configurado en la conexion (el techo
    // global), evitando que el override se filtre al siguiente uso del client.
    if (applyOverride) {
      await client.query("RESET statement_timeout");
    }
    client.release();
    return result;
  } catch (err) {
    client.release(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
};

/** Estadisticas del pool para health checks/observabilidad. */
export const getPoolStats = async (): Promise<{
  total: number;
  idle: number;
  waiting: number;
}> => {
  const poolInstance = await getDbPool();
  return {
    total: poolInstance.totalCount,
    idle: poolInstance.idleCount,
    waiting: poolInstance.waitingCount,
  };
};

export const testDbConnection = async () => {
  await withPoolClient(async (client) => {
    await client.query("SELECT 1");
  });
};
