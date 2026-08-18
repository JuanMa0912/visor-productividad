/**
 * Extrae corteza + cerebelo del atlas Z-Anatomy y escribe puntos de superficie.
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KEEP = new Set(["Temporal lobe", "Brain", "Cerebellum"]);
const SAMPLE_COUNT = 12000;

function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, "package.json")) && existsSync(path.join(dir, "src"))) {
      return dir;
    }
    dir = path.resolve(dir, "..");
  }
  return path.resolve(start, "..");
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 4; j += 1) {
      out[i * 4 + j] =
        a[i * 4] * b[j] +
        a[i * 4 + 1] * b[4 + j] +
        a[i * 4 + 2] * b[8 + j] +
        a[i * 4 + 3] * b[12 + j];
    }
  }
  return out;
}

function transformPoint(m, x, y, z, out, offset) {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  const iw = w !== 0 ? 1 / w : 1;
  out[offset] = (m[0] * x + m[4] * y + m[8] * z + m[12]) * iw;
  out[offset + 1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) * iw;
  out[offset + 2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) * iw;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = findRepoRoot(here);
const src = path.join(root, "tmp", "brain-src.glb");
const destDir = path.join(root, "public", "models");
const dest = path.join(destDir, "brain-points.bin");

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "draco3d.decoder": await draco3d.createDecoderModule(),
  });

const document = await io.read(src);

for (const mesh of document.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const name = prim.getMaterial()?.getName() ?? "";
    if (!KEEP.has(name)) prim.dispose();
  }
}
await document.transform(prune());

const triangles = [];
const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function visit(node, parent) {
  const world = multiply(parent, Float32Array.from(node.getMatrix()));
  const mesh = node.getMesh();
  if (mesh) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      const index = prim.getIndices();
      if (!pos) continue;
      const vertex = new Float32Array(pos.getCount() * 3);
      for (let i = 0; i < pos.getCount(); i += 1) {
        const v = pos.getElement(i, []);
        transformPoint(world, v[0], v[1], v[2], vertex, i * 3);
      }
      const triCount = index ? Math.floor(index.getCount() / 3) : Math.floor(pos.getCount() / 3);
      for (let t = 0; t < triCount; t += 1) {
        const ia = index ? index.getScalar(t * 3) : t * 3;
        const ib = index ? index.getScalar(t * 3 + 1) : t * 3 + 1;
        const ic = index ? index.getScalar(t * 3 + 2) : t * 3 + 2;
        const ax = vertex[ia * 3];
        const ay = vertex[ia * 3 + 1];
        const az = vertex[ia * 3 + 2];
        const bx = vertex[ib * 3];
        const by = vertex[ib * 3 + 1];
        const bz = vertex[ib * 3 + 2];
        const cx = vertex[ic * 3];
        const cy = vertex[ic * 3 + 1];
        const cz = vertex[ic * 3 + 2];
        const abx = bx - ax;
        const aby = by - ay;
        const abz = bz - az;
        const acx = cx - ax;
        const acy = cy - ay;
        const acz = cz - az;
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;
        const area = 0.5 * Math.hypot(nx, ny, nz);
        if (area > 1e-12) {
          triangles.push({ ax, ay, az, bx, by, bz, cx, cy, cz, area });
        }
      }
    }
  }
  for (const child of node.listChildren()) visit(child, world);
}

for (const scene of document.getRoot().listScenes()) {
  for (const child of scene.listChildren()) visit(child, identity);
}

const totalArea = triangles.reduce((sum, tri) => sum + tri.area, 0);
const cdf = new Float64Array(triangles.length);
let acc = 0;
for (let i = 0; i < triangles.length; i += 1) {
  acc += triangles[i].area / totalArea;
  cdf[i] = acc;
}

function pickTriangle(rand) {
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] < rand) lo = mid + 1;
    else hi = mid;
  }
  return triangles[lo];
}

function hash01(seed) {
  const n = Math.sin(seed * 127.1) * 43758.5453;
  return n - Math.floor(n);
}

const raw = new Float32Array(SAMPLE_COUNT * 3);
let minX = Infinity;
let minY = Infinity;
let minZ = Infinity;
let maxX = -Infinity;
let maxY = -Infinity;
let maxZ = -Infinity;
for (let i = 0; i < SAMPLE_COUNT; i += 1) {
  const tri = pickTriangle(hash01(i + 0.13));
  let r1 = hash01(i + 2.7);
  let r2 = hash01(i + 5.1);
  if (r1 + r2 > 1) {
    r1 = 1 - r1;
    r2 = 1 - r2;
  }
  const r3 = 1 - r1 - r2;
  const x = tri.ax * r3 + tri.bx * r1 + tri.cx * r2;
  const y = tri.ay * r3 + tri.by * r1 + tri.cy * r2;
  const z = tri.az * r3 + tri.bz * r1 + tri.cz * r2;
  raw[i * 3] = x;
  raw[i * 3 + 1] = y;
  raw[i * 3 + 2] = z;
  minX = Math.min(minX, x);
  minY = Math.min(minY, y);
  minZ = Math.min(minZ, z);
  maxX = Math.max(maxX, x);
  maxY = Math.max(maxY, y);
  maxZ = Math.max(maxZ, z);
}

const cx = (minX + maxX) * 0.5;
const cy = (minY + maxY) * 0.5;
const cz = (minZ + maxZ) * 0.5;
const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
const scale = 2.05 / span;
const out = new Float32Array(SAMPLE_COUNT * 3);
for (let i = 0; i < SAMPLE_COUNT; i += 1) {
  // Z-Anatomy: Y-up, X left-right. Volcamos a X hemisferios, Y vertical, Z frente.
  out[i * 3] = (raw[i * 3] - cx) * scale;
  out[i * 3 + 1] = (raw[i * 3 + 1] - cy) * scale;
  out[i * 3 + 2] = (raw[i * 3 + 2] - cz) * scale;
}

await mkdir(destDir, { recursive: true });
await writeFile(dest, Buffer.from(out.buffer));
await writeFile(
  path.join(destDir, "ATTRIBUTION.txt"),
  [
    "brain-points.bin se muestreó de un recorte de corteza/cerebelo del modelo",
    "Z-Anatomy (https://www.z-anatomy.com / proyecto brainproject), licencia CC BY-SA 4.0.",
    "https://creativecommons.org/licenses/by-sa/4.0/",
    "",
  ].join("\n"),
);
console.log("triangles", triangles.length, "wrote", dest, "bytes", out.byteLength);
