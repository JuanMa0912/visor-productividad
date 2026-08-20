import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const bin = readFileSync(path.join(root, "public", "models", "brain-points.bin"));
const out = path.join(root, "src", "components", "portal", "brain-points.ts");
const b64 = bin.toString("base64");
writeFileSync(
  out,
  `/** Puntos de corteza muestreados. No editar a mano. */\nexport const BRAIN_POINTS_B64 = "${b64}";\n`,
);
console.log("wrote", out, "bytes", b64.length);
