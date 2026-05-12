/**
 * Wrapper around `next build`: RAM heuristics, optional standalone output,
 * and (by default) skipping typecheck/lint inside Next — run `npm run typecheck`
 * / `npm run lint` separately or use `--strict`.
 *
 * Extra Next CLI flags: place after script options (e.g. `node scripts/build.mjs --debug`)
 * or after `--` (e.g. `node scripts/build.mjs -- --turbo`).
 */
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { spawn } from "node:child_process";

const projectDir = process.cwd();
const rawArgv = process.argv.slice(2);
const doubleDash = rawArgv.indexOf("--");
const ourArgv = doubleDash === -1 ? rawArgv : rawArgv.slice(0, doubleDash);
const nextPassthrough =
  doubleDash === -1 ? [] : rawArgv.slice(doubleDash + 1);

const SCRIPT_FLAGS = new Set(["--standalone", "--strict", "--help", "-h"]);
const scriptOnlyArgs = ourArgv.filter((a) => SCRIPT_FLAGS.has(a));
/** Flags meant for `next build` (anything in our segment that we do not consume). */
const earlyNextArgs = ourArgv.filter((a) => !SCRIPT_FLAGS.has(a));
const args = new Set(scriptOnlyArgs);
const standaloneBuild = args.has("--standalone");
const strictBuild =
  args.has("--strict") || process.env.NEXT_BUILD_STRICT === "1";

if (args.has("--help") || args.has("-h")) {
  console.log(`Usage: node scripts/build.mjs [options] [-- <next-build-args>]

Options:
  --standalone     Emit standalone output (sets NEXT_BUILD_STANDALONE=1)
  --strict         Run typecheck inside Next (clears NEXT_BUILD_SKIP_*)
  -h, --help       Show this help

Any other flags before -- are forwarded to \`next build\` (e.g. --debug).
After --, additional arguments are appended (e.g. --turbo).

Environment:
  NEXT_BUILD_STRICT=1          Same as --strict
  NEXT_BUILD_MEMORY_MB=<n>     Heap cap in MB for Node (see script source)
  NEXT_BUILD_LOG_LIMITS=1      Log heap / mode to stderr before build
`);
  process.exit(0);
}

const nextBin =
  process.platform === "win32"
    ? path.join(projectDir, "node_modules", ".bin", "next.cmd")
    : path.join(projectDir, "node_modules", ".bin", "next");

if (!fs.existsSync(nextBin)) {
  console.error(
    `[build] missing Next CLI at ${nextBin}. Run npm install in the project root.`,
  );
  process.exit(1);
}

const nextBuildArgs = ["build", ...earlyNextArgs, ...nextPassthrough];

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
if (standaloneBuild) {
  env.NEXT_BUILD_STANDALONE = "1";
}
if (!strictBuild) {
  env.NEXT_BUILD_SKIP_TYPECHECK = "1";
  env.NEXT_BUILD_SKIP_LINT = "1";
}

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
  console.error(
    `[build] mode: ${strictBuild ? "strict (typecheck in Next)" : "fast (NEXT_BUILD_SKIP_TYPECHECK; run npm run typecheck in CI)"}`,
  );
  if (standaloneBuild) {
    console.error("[build] output: standalone server bundle enabled");
  }
  if (nextPassthrough.length > 0 || earlyNextArgs.length > 0) {
    console.error(
      `[build] next args: ${[...earlyNextArgs, ...nextPassthrough].join(" ") || "(none)"}`,
    );
  }
}

const child =
  process.platform === "win32"
    ? spawn("cmd.exe", ["/c", nextBin, ...nextBuildArgs], {
        stdio: "inherit",
        env,
      })
    : spawn(nextBin, nextBuildArgs, {
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
