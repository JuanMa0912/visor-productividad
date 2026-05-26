// Aplica la migration 20260526_user_activity_log.sql contra la BD configurada en .env.local.
// Solo se ejecuta una vez para crear la tabla app_user_activity_log y sus indices.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Pool } from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const envPath = path.join(root, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (k && !process.env[k]) process.env[k] = v;
  }
}

const migrationPath = path.join(
  root,
  "db",
  "migrations",
  "20260526_user_activity_log.sql",
);
const sql = readFileSync(migrationPath, "utf-8");

const pool = new Pool({
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: `-c search_path=${process.env.DB_SCHEMA ?? "public"}`,
});

try {
  console.log(
    `→ Conectando a ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME} (schema ${process.env.DB_SCHEMA ?? "public"})`,
  );
  await pool.query(sql);
  const r = await pool.query(
    "SELECT to_regclass('app_user_activity_log') AS rel",
  );
  console.log("✔ Migration aplicada. Tabla:", r.rows[0]?.rel);
} catch (err) {
  console.error("✗ Error aplicando la migration:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
