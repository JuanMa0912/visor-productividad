"use client";

/* Three.js muta buffers/uniforms en cada frame; hay helpers de geometría
 * que quedaron de iteraciones del cerebro y no se montan en la escena final. */
/* eslint-disable react-hooks/immutability */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { Canvas, useFrame } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import { EffectComposer, Vignette } from "@react-three/postprocessing";
import {
  createContext,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { BRAIN_POINTS_B64 } from "@/components/portal/brain-points";

function decodeBrainPoints(b64: string) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const aligned = bytes.byteLength - (bytes.byteLength % 4);
  if (aligned < 12) return new Float32Array(0);
  return new Float32Array(bytes.buffer, bytes.byteOffset, aligned / 4);
}

function compactBrainShell(src: Float32Array) {
  const total = Math.floor(src.length / 3);
  if (total < 32) return src;

  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < total; i += 1) {
    cx += src[i * 3];
    cy += src[i * 3 + 1];
    cz += src[i * 3 + 2];
  }
  cx /= total;
  cy /= total;
  cz /= total;

  const radius = new Float32Array(total);
  let maxR = 0;
  for (let i = 0; i < total; i += 1) {
    const dx = src[i * 3] - cx;
    const dy = src[i * 3 + 1] - cy;
    const dz = src[i * 3 + 2] - cz;
    const r = Math.hypot(dx, dy, dz);
    radius[i] = r;
    if (r > maxR) maxR = r;
  }

  const compact = 0.88;
  const floorY = -maxR * compact * 0.68;
  const raw: number[] = [];
  const rawR: number[] = [];
  let maxX = 0;
  let maxRc = 0;
  for (let i = 0; i < total; i += 1) {
    const x = (src[i * 3] - cx) * compact;
    const y = (src[i * 3 + 1] - cy) * compact;
    const z = (src[i * 3 + 2] - cz) * compact;
    if (y < floorY) continue;
    const r = Math.hypot(x, y, z);
    raw.push(x, y, z);
    rawR.push(r);
    maxX = Math.max(maxX, Math.abs(x));
    maxRc = Math.max(maxRc, r);
  }

  const fissure = maxX * 0.046;
  const medialMax = maxX * 0.2;
  const outerR = maxRc * 0.56;
  const innerR = maxRc * 0.3;
  const kept: number[] = [];
  for (let k = 0, p = 0; k < raw.length; k += 3, p += 1) {
    const x = raw[k];
    const y = raw[k + 1];
    const z = raw[k + 2];
    if (Math.abs(x) < fissure) continue;
    const r = rawR[p];
    const outer = r >= outerR;
    const medialWall =
      r >= innerR &&
      r < outerR &&
      Math.abs(x) <= medialMax &&
      y > -maxX * 0.08;
    if (medialWall && hash01(p + 0.37) > 0.42) continue;
    if (!outer && !medialWall) continue;
    kept.push(x, y, z);
  }
  if (kept.length < 2400) return src;
  return new Float32Array(kept);
}

const EMBEDDED_BRAIN_POINTS = compactBrainShell(decodeBrainPoints(BRAIN_POINTS_B64));

const NODE_COUNT = 88;

type IntroClock = { value: number };
const IntroCtx = createContext<IntroClock>({ value: 1 });

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function span(value: number, start: number, end: number) {
  return clamp01((value - start) / Math.max(end - start, 0.0001));
}

function smooth(value: number) {
  return value * value * (3 - 2 * value);
}

function hash01(seed: number) {
  const n = Math.sin(seed * 127.1) * 43758.5453;
  return n - Math.floor(n);
}

/** u,v en 0..1. z+ = frente, x = hemisferios. Silueta clásica de cerebro. */
function brainSurface(u: number, v: number) {
  const lon = u * Math.PI * 2;
  const lat = (v - 0.5) * Math.PI;
  let x = Math.cos(lat) * Math.sin(lon);
  let y = Math.sin(lat);
  let z = Math.cos(lat) * Math.cos(lon);

  const hemi = x >= 0 ? 1 : -1;
  x = hemi * (Math.abs(x) * 0.78 + 0.24);

  x *= 1.38;
  y *= 0.92;
  z *= 1.18;

  const front = Math.max(0, z);
  x *= 1 - 0.16 * front;
  y *= 1 - 0.1 * front;
  const back = Math.max(0, -z);
  x *= 1 + 0.1 * back;
  y *= 1 + 0.06 * back;

  if (z < -0.22 && y < 0.02) {
    const c = clamp01((-0.22 - z) * 1.8) * clamp01(0.12 - y);
    y -= 0.22 * c;
    z -= 0.14 * c;
    x *= 1 - 0.28 * c;
  }

  y += 0.08 * (1 - Math.abs(x / 1.4)) * Math.max(0, y);

  const gyri =
    0.18 * Math.sin(lon * 10 + lat * 16) +
    0.14 * Math.sin(lon * 18 - lat * 13 + hemi * 2.4) +
    0.1 * Math.sin(Math.abs(x) * 22 + z * 20 + lat * 9) +
    0.08 * Math.sin(lon * 28 + y * 26 + hemi) +
    0.06 * Math.sin(lat * 22 - lon * 7) +
    0.045 * Math.sin(lon * 36 + lat * 8 + hemi * 5);
  const radius = 0.88 * (1 + gyri);
  return new THREE.Vector3(x * radius, y * radius, z * radius);
}

function brainCloud(count: number) {
  const points: THREE.Vector3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const yN = 1 - (i / Math.max(count - 1, 1)) * 2;
    const theta = golden * i;
    const u = ((theta / (Math.PI * 2)) % 1 + 1) % 1;
    const v = clamp01((yN + 1) / 2);
    const p = brainSurface(u, v);
    p.x += (hash01(i + 0.3) - 0.5) * 0.02;
    p.y += (hash01(i + 1.7) - 0.5) * 0.016;
    p.z += (hash01(i + 2.9) - 0.5) * 0.02;
    points.push(p);
  }
  return points;
}

function buildCortexGeometry() {
  const segU = 56;
  const segV = 32;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let v = 0; v <= segV; v += 1) {
    for (let u = 0; u <= segU; u += 1) {
      const p = brainSurface(u / segU, v / segV);
      positions.push(p.x, p.y, p.z);
    }
  }
  const cols = segU + 1;
  for (let v = 0; v < segV; v += 1) {
    for (let u = 0; u < segU; u += 1) {
      const a = v * cols + u;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function sampleArc(a: THREE.Vector3, b: THREE.Vector3, bulge: number, steps = 36) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a);
  const binormal = new THREE.Vector3(0, 1, 0).cross(dir);
  if (binormal.lengthSq() < 0.0001) binormal.set(1, 0, 0).cross(dir);
  binormal.normalize();
  const control = mid.add(binormal.multiplyScalar(bulge));
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    pts.push(
      a
        .clone()
        .multiplyScalar(u * u)
        .add(control.clone().multiplyScalar(2 * u * t))
        .add(b.clone().multiplyScalar(t * t)),
    );
  }
  return pts;
}

function IntroDriver({
  reduced,
  children,
}: {
  reduced: boolean;
  children: ReactNode;
}) {
  const clock = useMemo<IntroClock>(() => ({ value: reduced ? 1 : 0 }), [reduced]);
  useFrame((_, delta) => {
    if (reduced) {
      clock.value = 1;
      return;
    }
    clock.value = Math.min(1, clock.value + delta / 3.15);
  });
  return <IntroCtx.Provider value={clock}>{children}</IntroCtx.Provider>;
}

const FIBER_VERT = /* glsl */ `
uniform float uTime;
varying float vU;
void main() {
  vU = uv.x;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FIBER_FRAG = /* glsl */ `
uniform float uTime;
uniform float uReveal;
varying float vU;
void main() {
  if (vU > uReveal) discard;
  float head = 1.0 - smoothstep(uReveal - 0.08, uReveal, vU);
  float pulse = pow(fract(vU * 1.7 - uTime * 0.2), 4.2);
  vec3 cool = vec3(0.12, 0.42, 0.58);
  vec3 hot = vec3(0.72, 0.94, 1.0);
  vec3 col = mix(cool, hot, max(pulse * 0.65, head * 0.5));
  float alpha = (0.12 + pulse * 0.22 + head * 0.28) * smoothstep(0.0, 0.1, uReveal);
  gl_FragColor = vec4(col, alpha);
}
`;

function auroraColor(p: THREE.Vector3) {
  const t = clamp01((p.y + 1.15) / 2.25);
  const violet = new THREE.Color("#5b21b6");
  const blue = new THREE.Color("#2563eb");
  const teal = new THREE.Color("#5eead4");
  const color =
    t < 0.45
      ? violet.clone().lerp(blue, t / 0.45)
      : blue.clone().lerp(teal, (t - 0.45) / 0.55);
  const hot = clamp01(p.y * 0.45 + p.z * 0.25);
  color.lerp(new THREE.Color("#a5f3fc"), hot * 0.18);
  return color;
}

const AURORA_VERT = /* glsl */ `
attribute vec3 aColor;
uniform float uSize;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * (42.0 / max(-mv.z, 0.2));
  gl_Position = projectionMatrix * mv;
}
`;

const AURORA_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = length(p);
  float alpha = 1.0 - smoothstep(0.72, 0.84, d);
  if (alpha < 0.08) discard;
  gl_FragColor = vec4(vColor, alpha);
}
`;

const SYNAPSE_VERT = /* glsl */ `
attribute float aAlong;
attribute float aSeed;
attribute float aHops;
attribute float aRare;
uniform float uTime;
varying float vAlong;
varying float vSeed;
varying float vHops;
varying float vRare;
void main() {
  vAlong = aAlong;
  vSeed = aSeed;
  vHops = aHops;
  vRare = aRare;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SYNAPSE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uStrength;
varying float vAlong;
varying float vSeed;
varying float vHops;
varying float vRare;
void main() {
  if (uStrength < 0.01) discard;
  float cycle = mix(7.5 + vSeed * 8.5, 10.5 + vSeed * 8.0, vRare);
  float local = mod(uTime * mix(0.72 + vSeed * 0.7, 0.42 + vSeed * 0.35, vRare) + vSeed * 31.0, cycle);
  float oneWay = mix(1.35 + vSeed * 1.55, 3.8 + vSeed * 2.6, vRare);
  float life = mix(oneWay * 2.0, oneWay + 0.28, vRare);
  if (local > life + 0.22) discard;
  float u = local / max(oneWay, 0.001);
  float raw = vRare > 0.5 ? clamp(u, 0.0, 1.0) : (u <= 1.0 ? u : 2.0 - u);
  float hops = max(vHops, 3.0);
  float hopF = raw * hops;
  float hop = floor(hopF);
  float frac = fract(hopF);
  float eased = frac * frac * (3.0 - 2.0 * frac);
  float head = vRare > 0.5 ? raw : (hop + eased) / hops;
  if (vAlong > head + 0.04) discard;
  float pulse = 1.0 - smoothstep(0.0, mix(0.07, 0.045, vRare), abs(vAlong - head));
  float tail = 1.0 - smoothstep(0.0, mix(0.22, 0.12, vRare), head - vAlong);
  float fade = 1.0 - smoothstep(life, life + 0.2, local);
  fade *= smoothstep(0.0, 0.06, local);
  vec3 cool = vec3(0.78, 0.9, 1.0);
  vec3 hot = vec3(0.98, 0.99, 1.0);
  vec3 col = mix(cool, hot, pulse);
  float alpha = (tail * 0.28 + pulse * 0.95) * fade * uStrength;
  if (alpha < 0.03) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

function pickNeuralPaths(brain: Float32Array, count: number) {
  const hubCount = 160;
  const hubs = Array.from({ length: hubCount }, (_, i) =>
    Math.floor((i / hubCount) * count),
  );
  const neighbors: number[][] = Array.from({ length: hubCount }, () => []);
  for (let i = 0; i < hubCount; i += 1) {
    const ia = hubs[i];
    const ax = brain[ia * 3];
    const ay = brain[ia * 3 + 1];
    const az = brain[ia * 3 + 2];
    const scored: Array<{ j: number; d: number }> = [];
    for (let j = 0; j < hubCount; j += 1) {
      if (j === i) continue;
      const ib = hubs[j];
      const dx = ax - brain[ib * 3];
      const dy = ay - brain[ib * 3 + 1];
      const dz = az - brain[ib * 3 + 2];
      scored.push({ j, d: dx * dx + dy * dy + dz * dz });
    }
    scored.sort((a, b) => a.d - b.d);
    neighbors[i] = scored.slice(0, 5).map((s) => s.j);
  }

  const paths: number[][] = [];
  for (let p = 0; p < 24; p += 1) {
    const hops = 5 + Math.floor(hash01(p + 0.31) * 5);
    let cur = Math.floor(hash01(p + 1.7) * hubCount);
    const path = [hubs[cur]];
    const used = new Set<number>([cur]);
    for (let h = 0; h < hops; h += 1) {
      const opts = neighbors[cur].filter((n) => !used.has(n));
      const pool = opts.length > 0 ? opts : neighbors[cur];
      if (pool.length === 0) break;
      const pick = pool[Math.floor(hash01(p * 17.3 + h + 0.4) * pool.length) % pool.length];
      used.add(pick);
      path.push(hubs[pick]);
      cur = pick;
    }
    if (path.length >= 4) paths.push(path);
  }
  return paths;
}

function buildOrbitRings(brain: Float32Array, count: number) {
  let maxR = 0.7;
  for (let i = 0; i < count; i += 1) {
    maxR = Math.max(maxR, Math.hypot(brain[i * 3], brain[i * 3 + 1], brain[i * 3 + 2]));
  }
  const specs = [
    { n: 96, tilt: 0.2, yaw: 0.25, lift: 0.05, scale: 1.2 },
    { n: 96, tilt: 0.58, yaw: 1.35, lift: -0.03, scale: 1.27 },
    { n: 96, tilt: -0.42, yaw: 2.2, lift: 0.07, scale: 1.23 },
  ];
  return specs.map((spec) => {
    const radius = maxR * spec.scale;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < spec.n; k += 1) {
      const a = (k / spec.n) * Math.PI * 2;
      const x0 = Math.cos(a) * radius;
      const y0 = spec.lift * radius;
      const z0 = Math.sin(a) * radius;
      const y1 = y0 * Math.cos(spec.tilt) - z0 * Math.sin(spec.tilt);
      const z1 = y0 * Math.sin(spec.tilt) + z0 * Math.cos(spec.tilt);
      const x2 = x0 * Math.cos(spec.yaw) - z1 * Math.sin(spec.yaw);
      const z2 = x0 * Math.sin(spec.yaw) + z1 * Math.cos(spec.yaw);
      pts.push(new THREE.Vector3(x2, y1, z2));
    }
    pts.push(pts[0].clone());
    return pts;
  });
}

function packWaypointPaths(
  paths: THREE.Vector3[][],
  rare: number,
  seedShift: number,
) {
  const segCount = paths.reduce((sum, path) => sum + Math.max(path.length - 1, 0), 0);
  const positions = new Float32Array(segCount * 6);
  const along = new Float32Array(segCount * 2);
  const seed = new Float32Array(segCount * 2);
  const hops = new Float32Array(segCount * 2);
  const rareAttr = new Float32Array(segCount * 2);
  let cursor = 0;
  paths.forEach((path, pathIndex) => {
    const n = path.length - 1;
    const pathSeed = hash01(pathIndex + seedShift);
    for (let s = 0; s < n; s += 1) {
      const a = path[s];
      const b = path[s + 1];
      const pk = cursor * 6;
      positions[pk] = a.x;
      positions[pk + 1] = a.y;
      positions[pk + 2] = a.z;
      positions[pk + 3] = b.x;
      positions[pk + 4] = b.y;
      positions[pk + 5] = b.z;
      const k = cursor * 2;
      along[k] = n > 0 ? s / n : 0;
      along[k + 1] = n > 0 ? (s + 1) / n : 1;
      seed[k] = pathSeed;
      seed[k + 1] = pathSeed;
      hops[k] = n;
      hops[k + 1] = n;
      rareAttr[k] = rare;
      rareAttr[k + 1] = rare;
      cursor += 1;
    }
  });
  return makeSynapseLines(positions, along, seed, hops, rareAttr);
}

function makeSynapseLines(
  positions: Float32Array,
  along: Float32Array,
  seed: Float32Array,
  hops: Float32Array,
  rare: Float32Array,
) {
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(positions, 3);
  position.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", position);
  geometry.setAttribute("aAlong", new THREE.BufferAttribute(along, 1));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  geometry.setAttribute("aHops", new THREE.BufferAttribute(hops, 1));
  geometry.setAttribute("aRare", new THREE.BufferAttribute(rare, 1));
  const material = new THREE.ShaderMaterial({
    vertexShader: SYNAPSE_VERT,
    fragmentShader: SYNAPSE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uStrength: { value: 0 },
    },
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.visible = false;
  return { geometry, material, lines, positions };
}

function AuroraBrainCloud({
  reduced,
  meshPoints,
}: {
  reduced: boolean;
  meshPoints: Float32Array;
}) {
  const group = useRef<THREE.Group>(null);
  const spin = useRef(0.85);
  const startedAt = useRef<number | null>(null);

  const layouts = useMemo(() => {
    const meshCount = Math.floor(meshPoints.length / 3);
    const useMesh = meshCount >= 800;
    const count = useMesh
      ? Math.min(meshCount, reduced ? 5000 : 10000)
      : reduced
        ? 4200
        : 11000;
    const orb = new Float32Array(count * 3);
    const galaxy = new Float32Array(count * 3);
    const brain = new Float32Array(count * 3);
    const live = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const arms = 3;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i += 1) {
      const yN = 1 - (i / Math.max(count - 1, 1)) * 2;
      const theta = golden * i;
      const u = hash01(i + 0.17);
      const v = 0.04 + hash01(i + 2.4) * 0.92;
      let brainP: THREE.Vector3;
      if (useMesh) {
        const src = i % meshCount;
        brainP = new THREE.Vector3(
          meshPoints[src * 3],
          meshPoints[src * 3 + 1],
          meshPoints[src * 3 + 2],
        );
      } else {
        brainP = brainSurface(u, v).multiplyScalar(0.9 + hash01(i + 4.1) * 0.12);
      }
      brain[i * 3] = brainP.x;
      brain[i * 3 + 1] = brainP.y;
      brain[i * 3 + 2] = brainP.z;

      const phi = Math.acos(Math.min(1, Math.max(-1, yN)));
      const orbR = 0.48 + hash01(i + 8) * 0.07;
      orb[i * 3] = Math.sin(phi) * Math.cos(theta) * orbR;
      orb[i * 3 + 1] = Math.cos(phi) * orbR;
      orb[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * orbR;

      const arm = i % arms;
      const t = i / count;
      const swirl = t * 7.2 + (arm * Math.PI * 2) / arms + hash01(i + 11) * 0.55;
      const radius = 0.1 + Math.pow(t, 0.72) * 1.35;
      galaxy[i * 3] = Math.cos(swirl) * radius;
      galaxy[i * 3 + 1] = (hash01(i + 13) - 0.5) * 0.14 * (1 - t);
      galaxy[i * 3 + 2] = Math.sin(swirl) * radius;

      live[i * 3] = orb[i * 3];
      live[i * 3 + 1] = orb[i * 3 + 1];
      live[i * 3 + 2] = orb[i * 3 + 2];
      const c = auroraColor(brainP);
      colors[i * 3] = Math.min(1, c.r * 0.82);
      colors[i * 3 + 1] = Math.min(1, c.g * 0.82);
      colors[i * 3 + 2] = Math.min(1, c.b * 0.82);
    }
    return { count, orb, galaxy, brain, live, colors };
  }, [meshPoints, reduced]);

  const cloud = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(layouts.live, 3);
    position.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", position);
    geometry.setAttribute("aColor", new THREE.BufferAttribute(layouts.colors, 3));
    geometry.computeBoundingSphere();
    if (geometry.boundingSphere) geometry.boundingSphere.radius = 12;

    const material = new THREE.ShaderMaterial({
      vertexShader: AURORA_VERT,
      fragmentShader: AURORA_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false,
      uniforms: { uSize: { value: 0.38 } },
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return { geometry, material, points };
  }, [layouts]);

  const synapses = useMemo(() => {
    const paths = pickNeuralPaths(layouts.brain, layouts.count);
    const segCount = paths.reduce((sum, path) => sum + Math.max(path.length - 1, 0), 0);
    const positions = new Float32Array(segCount * 6);
    const along = new Float32Array(segCount * 2);
    const seed = new Float32Array(segCount * 2);
    const hops = new Float32Array(segCount * 2);
    const rare = new Float32Array(segCount * 2);
    let cursor = 0;
    paths.forEach((path, pathIndex) => {
      const n = path.length - 1;
      const pathSeed = hash01(pathIndex + 4.2);
      for (let s = 0; s < n; s += 1) {
        const k = cursor * 2;
        along[k] = n > 0 ? s / n : 0;
        along[k + 1] = n > 0 ? (s + 1) / n : 1;
        seed[k] = pathSeed;
        seed[k + 1] = pathSeed;
        hops[k] = n;
        hops[k + 1] = n;
        rare[k] = 0;
        rare[k + 1] = 0;
        cursor += 1;
      }
    });
    return {
      paths,
      trails: makeSynapseLines(positions, along, seed, hops, rare),
      orbits: packWaypointPaths(buildOrbitRings(layouts.brain, layouts.count), 1, 11.4),
    };
  }, [layouts]);

  useFrame(({ clock, pointer }, delta) => {
    if (startedAt.current == null) startedAt.current = clock.elapsedTime;
    const elapsed = clock.elapsedTime - startedAt.current;
    let m = 3;
    if (!reduced) {
      if (elapsed < 1.8) m = elapsed / 1.8;
      else if (elapsed < 4.4) m = 1 + (elapsed - 1.8) / 2.6;
      else if (elapsed < 7.2) m = 2 + (elapsed - 4.4) / 2.8;
      else m = 3;
    }
    cloud.material.uniforms.uSize.value = m < 1.2 ? 0.62 : m < 2.1 ? 0.36 : 0.46;

    const { count, orb, galaxy, brain, live } = layouts;
    let from = orb;
    let to = orb;
    let mix = 0;
    let breathe = 1;
    if (m <= 1) {
      breathe = 1 + 0.1 * Math.sin(clock.elapsedTime * 2.05);
    } else if (m <= 2) {
      from = orb;
      to = galaxy;
      mix = smooth(m - 1);
    } else {
      from = galaxy;
      to = brain;
      mix = smooth(Math.min(1, m - 2));
    }
    for (let i = 0; i < count; i += 1) {
      const k = i * 3;
      live[k] = (from[k] + (to[k] - from[k]) * mix) * breathe;
      live[k + 1] = (from[k + 1] + (to[k + 1] - from[k + 1]) * mix) * breathe;
      live[k + 2] = (from[k + 2] + (to[k + 2] - from[k + 2]) * mix) * breathe;
    }
    const attr = cloud.geometry.getAttribute("position");
    attr.needsUpdate = true;

    const brainReady = reduced ? elapsed > 0.7 : elapsed > 7.35;
    const strength = brainReady ? 1 : 0;
    const t = clock.elapsedTime;
    synapses.trails.lines.visible = strength > 0.02;
    synapses.orbits.lines.visible = strength > 0.02;
    synapses.trails.material.uniforms.uTime.value = t;
    synapses.trails.material.uniforms.uStrength.value = strength;
    synapses.orbits.material.uniforms.uTime.value = t;
    synapses.orbits.material.uniforms.uStrength.value = strength;

    if (strength > 0.01) {
      const pos = synapses.trails.positions;
      let cursor = 0;
      synapses.paths.forEach((path) => {
        for (let s = 0; s < path.length - 1; s += 1) {
          const a = path[s];
          const b = path[s + 1];
          const k = cursor * 6;
          pos[k] = live[a * 3];
          pos[k + 1] = live[a * 3 + 1];
          pos[k + 2] = live[a * 3 + 2];
          pos[k + 3] = live[b * 3];
          pos[k + 4] = live[b * 3 + 1];
          pos[k + 5] = live[b * 3 + 2];
          cursor += 1;
        }
      });
      synapses.trails.geometry.attributes.position.needsUpdate = true;
    }

    if (!group.current) return;
    group.current.scale.setScalar(1.52);
    const mouse = 0.35 + 0.65 * smooth(span(m, 2.2, 3));
    if (!reduced) spin.current += delta * (m < 1.2 ? 0.45 : m < 2.1 ? 0.22 : 0.03);
    const targetY = spin.current + pointer.x * 0.55 * mouse;
    const targetX = 0.22 - pointer.y * 0.28 * mouse;
    const targetZ = pointer.x * 0.14 * mouse;
    group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, targetY, 0.06);
    group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, targetX, 0.06);
    group.current.rotation.z = THREE.MathUtils.lerp(group.current.rotation.z, targetZ, 0.05);
  });

  return (
    <group ref={group} position={[0.28, 0.02, 0]}>
      <primitive object={cloud.points} />
      <primitive object={synapses.trails.lines} />
      <primitive object={synapses.orbits.lines} />
    </group>
  );
}

function MeshSampledBrain({ reduced }: { reduced: boolean }) {
  return <AuroraBrainCloud reduced={reduced} meshPoints={EMBEDDED_BRAIN_POINTS} />;
}

const RIBBON_VERT = /* glsl */ `
uniform float uTime;
varying float vU;
void main() {
  vU = uv.x;
  vec3 p = position;
  p += normal * (0.012 * sin(uTime * 1.2 + uv.x * 12.0));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const RIBBON_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uReveal;
varying float vU;
void main() {
  if (vU > uReveal) discard;
  float pulse = pow(fract(vU * 1.25 - uTime * uSpeed), 3.4);
  vec3 cool = vec3(0.03, 0.22, 0.34);
  vec3 hot = vec3(0.78, 0.97, 1.0);
  vec3 col = mix(cool, hot, pulse);
  gl_FragColor = vec4(col, 0.2 + pulse * 0.75);
}
`;

function DataRibbons({ reduced }: { reduced: boolean }) {
  const materials = useRef<THREE.ShaderMaterial[]>([]);
  const intro = useContext(IntroCtx);
  const curves = useMemo(
    () =>
      Array.from({ length: 3 }, (_, i) => {
        const points = Array.from({ length: 10 }, (__, k) => {
          const t = k / 9;
          return new THREE.Vector3(
            -3.4 + t * 7.8,
            Math.sin(t * 3.4 + i * 1.1) * 0.55 + Math.cos(t * 1.6 + i) * 0.18 - 0.15,
            Math.cos(t * 2.6 + i * 0.7) * 0.85,
          );
        });
        return new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.4);
      }),
    [],
  );

  useFrame(({ clock }) => {
    if (reduced && intro.value < 1) return;
    const reveal = smooth(span(intro.value, 0.28, 0.82));
    materials.current.forEach((material, index) => {
      if (!material) return;
      material.uniforms.uTime.value = clock.elapsedTime;
      material.uniforms.uSpeed.value = 0.14 + index * 0.025;
      material.uniforms.uReveal.value = reveal;
    });
  });

  return (
    <group>
      {curves.map((curve, index) => (
        <mesh key={index}>
          <tubeGeometry args={[curve, 140, 0.006 + (index % 2) * 0.002, 8, false]} />
          <shaderMaterial
            ref={(material) => {
              if (material) materials.current[index] = material;
            }}
            vertexShader={RIBBON_VERT}
            fragmentShader={RIBBON_FRAG}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            uniforms={{
              uTime: { value: 0 },
              uSpeed: { value: 0.16 },
              uReveal: { value: 0 },
            }}
          />
        </mesh>
      ))}
    </group>
  );
}

function FirstFrameReady({ onReady }: { onReady: () => void }) {
  const sent = useRef(false);
  useFrame(() => {
    if (sent.current) return;
    sent.current = true;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => onReady());
    });
  });
  return null;
}

const SPACE_VERT = /* glsl */ `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SPACE_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vPos;
void main() {
  vec3 dir = normalize(vPos);
  float y = dir.y * 0.5 + 0.5;
  vec3 deep = vec3(0.01, 0.014, 0.035);
  vec3 mid = vec3(0.018, 0.024, 0.055);
  vec3 space = mix(deep, mid, y);

  float core = 1.0 - smoothstep(0.16, 0.62, length(vec2(dir.x, dir.y * 0.82)));
  space *= mix(1.0, 0.28, core);

  float n1 = sin(dir.x * 2.3 + dir.z * 1.6 + uTime * 0.035);
  float n2 = sin(dir.x * 4.8 - dir.y * 3.1 + uTime * 0.05);
  float neb = 0.5 + 0.5 * n1 * n2;
  vec3 nebCol = mix(vec3(0.12, 0.04, 0.24), vec3(0.03, 0.1, 0.16), neb);
  space += nebCol * 0.08 * (1.0 - core * 0.85);

  float height = smoothstep(-0.18, 0.22, dir.y) * (1.0 - smoothstep(0.48, 0.95, dir.y));
  float edge = smoothstep(0.22, 0.7, length(vec2(dir.x, dir.y * 0.7)));
  float band = dir.x * 3.1 + dir.z * 0.85;
  float curtain = pow(abs(sin(band + uTime * 0.11)), 1.55);
  curtain *= pow(abs(sin(band * 0.42 - uTime * 0.06)), 1.15);
  curtain *= height * edge;
  vec3 mint = vec3(0.12, 0.48, 0.38);
  vec3 violet = vec3(0.28, 0.14, 0.55);
  vec3 aurora = mix(violet, mint, 0.5 + 0.5 * sin(band * 0.65 + uTime * 0.07));
  space += aurora * curtain * 0.22;

  float band2 = dir.x * 1.55 - dir.z * 1.15;
  float c2 = pow(abs(sin(band2 + uTime * 0.045)), 2.1) * height * edge;
  space += vec3(0.08, 0.18, 0.42) * c2 * 0.12;

  gl_FragColor = vec4(space, 1.0);
}
`;

function SpaceAurora({ reduced }: { reduced: boolean }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  useFrame(({ clock }) => {
    if (!material.current) return;
    material.current.uniforms.uTime.value = reduced ? 8 : clock.elapsedTime;
  });
  return (
    <mesh renderOrder={-20} frustumCulled={false}>
      <sphereGeometry args={[22, 48, 32]} />
      <shaderMaterial
        ref={material}
        vertexShader={SPACE_VERT}
        fragmentShader={SPACE_FRAG}
        side={THREE.BackSide}
        depthWrite={false}
        uniforms={{ uTime: { value: 0 } }}
      />
    </mesh>
  );
}

function StarField({ reduced }: { reduced: boolean }) {
  const points = useMemo(() => {
    const count = reduced ? 420 : 980;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const radius = 10 + hash01(i + 0.2) * 9;
      const theta = hash01(i + 2.1) * Math.PI * 2;
      const phi = Math.acos(2 * hash01(i + 5.4) - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi);
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
      const bright = 0.42 + hash01(i + 9.2) * 0.5;
      const tint = hash01(i + 12.7);
      colors[i * 3] = bright * (tint > 0.78 ? 0.72 : tint < 0.18 ? 0.85 : 0.95);
      colors[i * 3 + 1] = bright * (tint > 0.78 ? 0.82 : 0.94);
      colors[i * 3 + 2] = bright;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.045,
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: false,
    });
    const cloud = new THREE.Points(geometry, material);
    cloud.frustumCulled = false;
    cloud.renderOrder = -15;
    return cloud;
  }, [reduced]);

  return <primitive object={points} />;
}

function CameraRig({ reduced }: { reduced: boolean }) {
  const intro = useContext(IntroCtx);
  useFrame(({ camera, pointer }) => {
    if (reduced) {
      camera.position.set(0.22, 0.18, 5.15);
      camera.lookAt(0.24, 0.02, 0);
      return;
    }
    const remain = 1 - intro.value;
    const ease = 1 - remain * remain * remain;
    const z = THREE.MathUtils.lerp(6.5, 5.15, ease);
    const x = THREE.MathUtils.lerp(0.4, 0.22 + pointer.x * 0.18, ease);
    const y = THREE.MathUtils.lerp(0.12, 0.22 + pointer.y * 0.08, ease);
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, x, 0.07);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, y, 0.07);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, z, 0.07);
    camera.lookAt(0.24, 0.02, 0);
  });
  return null;
}

function Scene({
  reduced,
  onReady,
}: {
  reduced: boolean;
  onReady: () => void;
}) {
  return (
    <IntroDriver reduced={reduced}>
      <color attach="background" args={["#03060d"]} />
      <fog attach="fog" args={["#03060d", 36, 62]} />
      <ambientLight intensity={0.04} />
      <pointLight position={[2.4, 1.8, 3.2]} intensity={0.28} color="#7dd3fc" distance={16} />
      <pointLight position={[-3.2, 0.6, -4]} intensity={0.22} color="#6d28d9" distance={20} />
      <SpaceAurora reduced={reduced} />
      <StarField reduced={reduced} />
      <MeshSampledBrain reduced={reduced} />
      <FirstFrameReady onReady={onReady} />
      <Sparkles
        count={reduced ? 10 : 22}
        scale={[18, 12, 16]}
        size={0.08}
        speed={reduced ? 0 : 0.01}
        opacity={0.1}
        color="#64748b"
      />
      <CameraRig reduced={reduced} />
      <EffectComposer>
        <Vignette eskil={false} offset={0.28} darkness={0.55} />
      </EffectComposer>
    </IntroDriver>
  );
}

export function LoginCinematicScene({ onReady }: { onReady: () => void }) {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <Canvas
      className="h-full w-full"
      flat
      dpr={[1, 1.6]}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      camera={{ position: [0.22, 0.18, 5.6], fov: 40, near: 0.1, far: 60 }}
    >
      <Scene reduced={reduced} onReady={onReady} />
    </Canvas>
  );
}
