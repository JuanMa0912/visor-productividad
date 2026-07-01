import pg from "pg";
import { resolvePgClientConfig } from "./db-client-config.mjs";

const client = new pg.Client(resolvePgClientConfig());

await client.connect();
try {
  const result = await client.query(
    `
    UPDATE app_user_sessions
    SET revoked_at = now()
    WHERE revoked_at IS NULL
    RETURNING id
    `,
  );
  console.log(`Revoked ${result.rowCount ?? 0} active session(s).`);
} finally {
  await client.end();
}
