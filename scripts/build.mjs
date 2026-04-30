import path from "node:path";
import { spawn } from "node:child_process";

const projectDir = process.cwd();
const nextBin =
  process.platform === "win32"
    ? path.join(projectDir, "node_modules", ".bin", "next.cmd")
    : path.join(projectDir, "node_modules", ".bin", "next");

const env = { ...process.env };

if (!env.NEXT_BUILD_CPUS) {
  env.NEXT_BUILD_CPUS = "2";
}

if (!env.NODE_OPTIONS || env.NODE_OPTIONS.trim().length === 0) {
  env.NODE_OPTIONS = "--max-old-space-size=2048";
} else if (!/--max-old-space-size=\d+/u.test(env.NODE_OPTIONS)) {
  env.NODE_OPTIONS = `${env.NODE_OPTIONS} --max-old-space-size=2048`;
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
