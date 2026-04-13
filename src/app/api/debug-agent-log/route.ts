import { NextResponse } from "next/server";
import { appendAgentDebugLog, AGENT_DEBUG_LOG_PATH } from "@/lib/agent-debug-log";
import { promises as fs } from "fs";

/**
 * Recibe NDJSON de depuración desde el cliente (misma app, sin localhost:7830).
 * Solo desarrollo.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  let exists = false;
  let size = 0;
  try {
    const st = await fs.stat(AGENT_DEBUG_LOG_PATH);
    exists = true;
    size = st.size;
  } catch {
    /* no file */
  }
  return NextResponse.json({
    cwd: process.cwd(),
    logPath: AGENT_DEBUG_LOG_PATH,
    exists,
    size,
  });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  try {
    const body = (await request.json()) as Record<string, unknown>;
    await appendAgentDebugLog(body);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
}
