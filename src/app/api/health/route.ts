import { NextResponse } from "next/server";
import { getPoolStats, withPoolClient } from "@/lib/db";

// Endpoint de salud para watchdog/observabilidad. Publico (el proxy deja pasar
// /api/*); no expone datos sensibles, solo estado de la DB y contadores del pool.
// Sirve para detectar el estado "pegado": si el pool esta agotado, adquirir un
// client falla por connectionTimeoutMillis y este endpoint responde 503, lo que
// permite a un watchdog externo reiniciar el proceso (ver deploy/healthcheck.sh).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = "no-store, private";

export async function GET() {
  const startedAt = Date.now();
  try {
    await withPoolClient(
      async (client) => {
        await client.query("SELECT 1");
      },
      // Sonda liviana: si la DB no responde rapido, se considera caida.
      { statementTimeoutMs: 3_000 },
    );
    const pool = await getPoolStats();
    return NextResponse.json(
      { ok: true, db: "up", latencyMs: Date.now() - startedAt, pool },
      { headers: { "Cache-Control": NO_STORE } },
    );
  } catch (error) {
    console.error("[health] DB check fallo:", error);
    return NextResponse.json(
      { ok: false, db: "down" },
      { status: 503, headers: { "Cache-Control": NO_STORE } },
    );
  }
}
