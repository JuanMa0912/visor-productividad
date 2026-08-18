import pg from "pg";
import { resolvePgClientConfig } from "./db-client-config.mjs";

const c = new pg.Client(resolvePgClientConfig());
await c.connect();
const byEmp = await c.query(`
  SELECT empresa, count(*)::int AS n,
         min(fecha_dcto) AS mn, max(fecha_dcto) AS mx
    FROM orden_compra_linea
   GROUP BY 1
   ORDER BY 1
`);
const tot = await c.query(`SELECT count(*)::int AS n FROM orden_compra_linea`);
console.log(JSON.stringify({ total: tot.rows[0].n, empresas: byEmp.rows }));
await c.end();
