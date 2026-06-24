import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { resolvePgClientConfig } from "./db-client-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const migrationFile = process.argv[2];
if (!migrationFile) {
  console.error("Usage: node scripts/apply-migration-file.mjs <path-to-sql>");
  process.exit(1);
}

const sqlPath = path.isAbsolute(migrationFile)
  ? migrationFile
  : path.join(root, migrationFile);
const sql = fs.readFileSync(sqlPath, "utf8");

const client = new pg.Client(resolvePgClientConfig());

await client.connect();
try {
  await client.query(sql);
  console.log(`Applied: ${migrationFile}`);
} finally {
  await client.end();
}
