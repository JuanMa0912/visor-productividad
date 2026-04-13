import { promises as fs } from "fs";
import path from "path";

/** Raíz del proyecto en tiempo de ejecución (Next `process.cwd()`). */
export const AGENT_DEBUG_LOG_PATH = path.join(
  process.cwd(),
  "debug-068c63.log",
);

export async function appendAgentDebugLog(
  payload: Record<string, unknown>,
): Promise<void> {
  if (process.env.NODE_ENV === "production") return;
  const line =
    JSON.stringify({
      sessionId: "068c63",
      timestamp: Date.now(),
      ...payload,
    }) + "\n";
  await fs.appendFile(AGENT_DEBUG_LOG_PATH, line, "utf-8").catch((err) => {
    console.error("[agent-debug] append failed", AGENT_DEBUG_LOG_PATH, err);
  });
}
