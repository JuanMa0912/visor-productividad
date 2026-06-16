/**
 * Next.js standalone no copia .next/static ni public/ al bundle.
 * El servicio systemd corre desde .next/standalone/; sin este paso los chunks dan 404.
 */
import fs from "node:fs";
import path from "node:path";

const projectDir = process.cwd();
const standaloneDir = path.join(projectDir, ".next", "standalone");
const staticSrc = path.join(projectDir, ".next", "static");
const staticDest = path.join(standaloneDir, ".next", "static");
const publicSrc = path.join(projectDir, "public");
const publicDest = path.join(standaloneDir, "public");

function assertDir(dir, label) {
  if (!fs.existsSync(dir)) {
    console.error(`[copy-standalone-assets] Falta ${label}: ${dir}`);
    console.error(
      "[copy-standalone-assets] Ejecuta primero: npm run build:server",
    );
    process.exit(1);
  }
}

function copyRecursive(src, dest) {
  fs.cpSync(src, dest, { recursive: true, force: true });
}

assertDir(standaloneDir, "directorio standalone");
assertDir(staticSrc, ".next/static");
assertDir(publicSrc, "public/");

fs.mkdirSync(path.join(standaloneDir, ".next"), { recursive: true });
copyRecursive(staticSrc, staticDest);
copyRecursive(publicSrc, publicDest);

const chunkCount = fs.readdirSync(path.join(staticDest, "chunks")).length;
console.error(
  `[copy-standalone-assets] OK: ${chunkCount} chunks + public/ -> ${standaloneDir}`,
);
