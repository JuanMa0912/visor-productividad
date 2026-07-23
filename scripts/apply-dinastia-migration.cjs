const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (k && !process.env[k]) process.env[k] = v;
  }
}

const host = process.env.DB_HOST || "192.168.35.232";
const ssl = ["localhost", "127.0.0.1", "::1"].includes(host)
  ? false
  : { rejectUnauthorized: false };
const sql = fs.readFileSync(
  "db/migrations/20260723_dinastia_tenant_tables.sql",
  "utf8",
);

(async () => {
  const c = new Client({
    host,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl,
  });
  await c.connect();
  await c.query(sql);
  const t = await c.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name LIKE '%dinastia%'
     ORDER BY 1`,
  );
  console.log(
    "tables:",
    t.rows.map((r) => r.table_name).join(", "),
  );
  const col = await c.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name='app_users' AND column_name='allowed_empresas'`,
  );
  console.log("allowed_empresas:", col.rows.length > 0);
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
