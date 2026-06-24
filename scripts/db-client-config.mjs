/**
 * Configuracion de cliente pg alineada con src/lib/db/index.ts (SSL, schema, defaults).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

export function loadEnvFiles() {
  for (const name of [".env.local", ".env"]) {
    const filePath = path.join(root, name);
    if (!fs.existsSync(filePath)) continue;
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

export function resolvePgSsl(host) {
  const sslEnv = (process.env.DB_SSL ?? "").trim().toLowerCase();
  if (sslEnv === "true" || sslEnv === "1" || sslEnv === "require") {
    return { rejectUnauthorized: false };
  }
  if (sslEnv === "false" || sslEnv === "0" || sslEnv === "disable") {
    return false;
  }
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(host);
  return isLoopback ? false : { rejectUnauthorized: false };
}

export function resolvePgClientConfig() {
  loadEnvFiles();

  const password = process.env.DB_PASSWORD ?? "";
  if (!password.trim()) {
    throw new Error(
      "Falta DB_PASSWORD. Define las variables de base de datos en .env.local.",
    );
  }

  const host = process.env.DB_HOST ?? "192.168.35.232";
  const port = Number(process.env.DB_PORT || 5432);
  const schema = process.env.DB_SCHEMA ?? "public";

  return {
    host,
    port,
    database: process.env.DB_NAME ?? "produXdia",
    user: process.env.DB_USER ?? "postgres",
    password,
    ssl: resolvePgSsl(host),
    options: `-c search_path=${schema}`,
  };
}
