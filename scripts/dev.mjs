import { execFileSync, spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const projectDir = process.cwd();
const lockPath = path.join(projectDir, ".next", "dev", "lock");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killStaleNextDevWindows() {
  const escapedDir = projectDir.replace(/'/g, "''");
  const command = `
    $projectDir = '${escapedDir}'
    $currentPid = ${process.pid}
    $processes = Get-CimInstance Win32_Process |
      Where-Object {
        $_.ProcessId -ne $currentPid -and
        $_.CommandLine -like "*$projectDir*" -and
        (
          $_.CommandLine -match 'next dev' -or
          $_.CommandLine -match 'npm-cli\\.js" run dev'
        )
      } | Select-Object -ExpandProperty ProcessId

    $processes | ConvertTo-Json -Compress
  `;

  const rawOutput = execFileSync("powershell", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
  }).trim();

  if (!rawOutput) {
    return;
  }

  const pids = JSON.parse(rawOutput);
  const pidList = Array.isArray(pids) ? pids : [pids];

  for (const pid of pidList) {
    if (!pid || pid === process.pid) {
      continue;
    }

    try {
      execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], {
        stdio: "ignore",
      });
    } catch {
      // Ignore races where the target process exits before taskkill runs.
    }
  }
}

async function start() {
  if (process.platform === "win32") {
    killStaleNextDevWindows();
    await sleep(1000);
  }

  if (existsSync(lockPath)) {
    rmSync(lockPath, { force: true });
  }

  const nextBin =
    process.platform === "win32"
      ? path.join(projectDir, "node_modules", ".bin", "next.cmd")
      : path.join(projectDir, "node_modules", ".bin", "next");

  const child =
    process.platform === "win32"
      ? spawn("cmd.exe", ["/c", nextBin, "dev", "--port", "0"], {
          stdio: "inherit",
          env: process.env,
        })
      : spawn(nextBin, ["dev", "--port", "0"], {
          stdio: "inherit",
          env: process.env,
        });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
