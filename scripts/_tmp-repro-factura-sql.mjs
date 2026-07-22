import pg from "pg";
import { resolvePgClientConfig } from "./db-client-config.mjs";
import {
  resolveMargenDataSource,
  resetMargenDataSourceCache,
  clienteSelectSql,
  sedeSelectSql,
} from "../src/lib/margenes/margen-data-source.ts";
import { metricsSqlFor } from "../src/lib/margenes/metrics.ts";

resetMargenDataSourceCache();
const c = new pg.Client(resolvePgClientConfig());
await c.connect();
const table = await resolveMargenDataSource(c);
const sql = `
SELECT
  documento_fc AS documento,
  id_tipdoc_fc AS tipdoc,
  ${sedeSelectSql(table)},
  ${clienteSelectSql(table)},
  ${metricsSqlFor(table)}
FROM ${table}
WHERE fecha_dcto = '20260713' AND id_item = '005806' AND empresa_norm = 'bogota' AND id_co_norm = '001'
  AND documento_fc <> ''
GROUP BY 1, 2, 3, 4
LIMIT 1
`;
const r = await c.query(sql);
console.log("keys", Object.keys(r.rows[0]));
console.log("row", r.rows[0]);
await c.end();
