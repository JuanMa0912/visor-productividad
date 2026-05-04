import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const projectDir = process.cwd();
const nextBin =
  process.platform === "win32"
    ? path.join(projectDir, "node_modules", ".bin", "next.cmd")
    : path.join(projectDir, "node_modules", ".bin", "next");

function clampInt(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parsePositiveInt(raw, fallback) {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Heuristic heap cap (MB) from total RAM so small Linux hosts do not get OOM-killed.
 * Override with NEXT_BUILD_MEMORY_MB. If NODE_OPTIONS already sets --max-old-space-size
 * and NEXT_BUILD_MEMORY_MB is unset, the existing limit is left unchanged.
 */
function hostHeapLimitMb() {
  const totalMb = Math.floor(os.totalmem() / (1024 * 1024));
  if (totalMb < 1800) {
    return clampInt(Math.floor(totalMb * 0.38), 512, 1024);
  }
  if (totalMb < 6000) {
    return clampInt(Math.floor(totalMb * 0.22), 768, 2048);
  }
  return clampInt(Math.floor(totalMb * 0.18), 1536, 4096);
}

function resolveBuildHeapMb() {
  const raw = process.env.NEXT_BUILD_MEMORY_MB;
  if (raw !== undefined && String(raw).trim().length > 0) {
    return clampInt(parsePositiveInt(raw, 1024), 256, 16384);
  }
  if (/--max-old-space-size=\d+/u.test(process.env.NODE_OPTIONS ?? "")) {
    return null;
  }
  return hostHeapLimitMb();
}

function withMaxOldSpaceSize(nodeOptions, memoryMb) {
  const flag = `--max-old-space-size=${memoryMb}`;
  const trimmed = (nodeOptions ?? "").trim();
  if (!trimmed) {
    return flag;
  }
  if (/--max-old-space-size=\d+/u.test(trimmed)) {
    return trimmed.replace(/--max-old-space-size=\d+/gu, flag);
  }
  return `${trimmed} ${flag}`;
}

const env = { ...process.env };

const heapMb = resolveBuildHeapMb();
if (heapMb !== null) {
  env.NODE_OPTIONS = withMaxOldSpaceSize(env.NODE_OPTIONS, heapMb);
}

if (env.NEXT_TELEMETRY_DISABLED === undefined) {
  env.NEXT_TELEMETRY_DISABLED = "1";
}

if (process.env.NEXT_BUILD_LOG_LIMITS === "1") {
  const totalMb = Math.floor(os.totalmem() / (1024 * 1024));
  const line =
    heapMb === null
      ? `[build] heap: using existing NODE_OPTIONS (total RAM ~${totalMb} MB)`
      : `[build] heap: --max-old-space-size=${heapMb} (total RAM ~${totalMb} MB; set NEXT_BUILD_MEMORY_MB or NODE_OPTIONS to override)`;
  console.error(line);
}

const child =
  process.platform === "win32"
    ? spawn("cmd.exe", ["/c", nextBin, "build"], {
        stdio: "inherit",
        env,
      })
    : spawn(nextBin, ["build"], {
        stdio: "inherit",
        env,
      });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
