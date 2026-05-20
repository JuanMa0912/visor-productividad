import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
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
    process.env[key] = value;
  }
}

loadEnv(path.join(root, ".env.local"));
loadEnv(path.join(root, ".env"));

const client = new pg.Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

await client.connect();

try {
  const cols = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'rotacion_v4' ORDER BY ordinal_position`,
  );
  console.log("--- columns (rotacion_v4) ---");
  for (const r of cols.rows) console.log(`${r.column_name}\t${r.data_type}`);

  const idx = await client.query(
    `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'rotacion_v4' ORDER BY indexname`,
  );
  console.log("\n--- indexes (rotacion_v4) ---");
  for (const r of idx.rows) console.log(`${r.indexname}\t${r.indexdef}`);

  const cnt = await client.query(`SELECT COUNT(*) AS n FROM rotacion_v4`);
  console.log(`\nrotacion_v4 row count: ${cnt.rows[0]?.n}`);
} finally {
  await client.end();
}
