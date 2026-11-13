/**
 * Procedural, tileable 128×128 PNG textures written straight into the .glb binary
 * chunk (no external image requests → nothing extra to download, nothing to atlas).
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { Geo, boxGeo } from './glb.mjs';

const SIZE = 128;

// ---------------------------------------------------------------- PNG encoder
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePNG(rgba, w = SIZE, h = SIZE) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- generators
/**
 * Periodic value noise: the lattice wraps in both axes, so every texture tiles
 * seamlessly (no visible grid lines when repeated across the terrain).
 */
function periodicNoise(size, period, seed) {
  const lattice = new Float32Array(period * period);
  let s = seed * 9781 + 1;
  for (let i = 0; i < lattice.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    lattice[i] = s / 4294967296;
  }
  const at = (ix, iy) => lattice[((iy % period) + period) % period * period + (((ix % period) + period) % period)];
  const smooth = (t) => t * t * (3 - 2 * t);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * period;
      const fy = (y / size) * period;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = smooth(fx - x0);
      const ty = smooth(fy - y0);
      const a = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      const b = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      out[y * size + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

/** combine octaves of periodic noise, all wrapping at `size` */
function fbm(size, seed) {
  const o1 = periodicNoise(size, 8, seed);
  const o2 = periodicNoise(size, 16, seed + 1);
  const o3 = periodicNoise(size, 32, seed + 2);
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = o1[i] * 0.5 + o2[i] * 0.32 + o3[i] * 0.18;
  return out;
}

function make(cb) {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b, a = 255] = cb(x, y);
      const i = (y * SIZE + x) * 4;
      buf[i] = Math.max(0, Math.min(255, r));
      buf[i + 1] = Math.max(0, Math.min(255, g));
      buf[i + 2] = Math.max(0, Math.min(255, b));
      buf[i + 3] = a;
    }
  }
  return buf;
}

const fA = fbm(SIZE, 7);
const fB = fbm(SIZE, 23);
const fC = fbm(SIZE, 41);
const pixel = (f, x, y) => f[((y % SIZE) + SIZE) % SIZE * SIZE + (((x % SIZE) + SIZE) % SIZE)];

/**
 * Office curtain wall: 32 px tile = 4 m, so a 3 m storey reads as ~3 window rows.
 * Every window is a spandrel (opaque panel) + vision glass with a soft sky gradient,
 * a frame and a lit/unlit variation — reads as architecture even at close range.
 */
export const texFacade = () =>
  make((x, y) => {
    const TILE = 32;
    const tx = x % TILE;
    const ty = y % TILE;
    const col = Math.floor(x / TILE);
    const row = Math.floor(y / TILE);
    const frame = tx < 3 || ty < 4 || tx > TILE - 3;
    const spandrel = ty > TILE * 0.68;
    if (frame) return [176, 174, 168];
    if (spandrel) {
      const n = pixel(fA, x, y) * 12;
      return [138 + n, 134 + n, 126 + n];
    }
    const lit = pixel(fB, col * TILE, row * TILE) > 0.62;
    const shade = 0.72 + (ty / TILE) * 0.4;
    if (lit) {
      const warm = pixel(fB, x, y) * 14;
      return [(238 - warm) * shade, (224 - warm) * shade, (186 - warm) * shade];
    }
    // cool sky reflection with a vertical gradient + grime at the sill
    const g = 104 + (ty / TILE) * 52;
    const sill = ty > TILE * 0.6 ? -14 : 0;
    return [g * 0.82 + sill, g * 0.95 + sill, g * 1.04 + sill];
  });

/** concrete panels */
export const texConcrete = () =>
  make((x, y) => {
    const n = pixel(fA, x, y) * 26 + pixel(fB, x * 2, y * 2) * 16;
    const joint = x % 32 < 1 || y % 32 < 1 ? -26 : 0;
    const v = 138 + n + joint;
    return [v, v - 2, v - 6];
  });

export const texRoad = () =>
  make((x, y) => {
    const n = pixel(fA, x, y) * 30 + pixel(fB, x * 3, y * 3) * 14;
    const v = 66 + n;
    return [v, v + 1, v + 4];
  });

export const texRoof = () =>
  make((x, y) => {
    const row = Math.floor(y / 16) % 2;
    const off = row ? 8 : 0;
    const tile = (x + off) % 16 < 1 || y % 16 < 1;
    const n = pixel(fA, x, y) * 16;
    const base = 128 + n - row * 6;
    return tile ? [base - 42, base - 46, base - 50] : [base, base - 6, base - 14];
  });

export const texSand = () => {
  // three octaves: wind ripples + coarse grain + per-grain speckle
  const g0 = fbm(SIZE, 61), g1 = fbm(SIZE, 97);
  return make((x, y) => {
    const rip = Math.sin(((x + Math.sin((y / SIZE) * Math.PI * 2) * 9) / SIZE) * Math.PI * 22) * 6;
    const coarse = pixel(fA, x + 40, y + 11) * 22;
    const speck = pixel(g0, x * 2, y * 2) * 16 + pixel(g1, x * 3, y * 3) * 10;
    return [206 + rip + coarse * 0.5 + speck, 186 + rip + coarse * 0.46 + speck * 0.92, 142 + rip + coarse * 0.4 + speck * 0.74];
  });
};

export const texGrass = () => {
  // layered: macro patches, mid clumps, and single-pixel blade strokes
  const m1 = fbm(SIZE, 11), m2 = fbm(SIZE, 29);
  return make((x, y) => {
    const macro = pixel(fA, x, y);
    const mid = pixel(m1, x, y);
    const micro = pixel(fC, x, y);
    const blade = pixel(m2, x * 2, y * 2) > 0.55 ? 1 : 0;
    // damp/shadow patches read as uneven lawn rather than a flat green plate
    const damp = pixel(m2, x + 64, y + 32);
    const v = 0.5 + macro * 0.3 + mid * 0.14 + micro * 0.22 - damp * 0.1;
    return [
      88 * v + blade * 30 + damp * 8,
      124 * v + blade * 40 + macro * 10,
      62 * v + blade * 18 + damp * 6,
    ];
  });
};

export const TEX = {
  facade: texFacade,
  concrete: texConcrete,
  road: texRoad,
  roof: texRoof,
  sand: texSand,
  grass: texGrass,
};

export const TEX_PNG = {};
for (const [k, fn] of Object.entries(TEX)) TEX_PNG[k] = encodePNG(fn());

/** copy a Geo, giving every triangle triplanar UVs at `scale` world units per tile */
export function withUV(geo, scale) {
  const out = new Geo();
  out.uvScale = scale;
  for (let t = 0; t < geo.idx.length; t += 3) {
    const a = geo.idx[t] * 3;
    const b = geo.idx[t + 1] * 3;
    const c = geo.idx[t + 2] * 3;
    out.tri(
      [geo.pos[a], geo.pos[a + 1], geo.pos[a + 2]],
      [geo.pos[b], geo.pos[b + 1], geo.pos[b + 2]],
      [geo.pos[c], geo.pos[c + 1], geo.pos[c + 2]],
      [geo.nrm[a], geo.nrm[a + 1], geo.nrm[a + 2]],
      [geo.col[a], geo.col[a + 1], geo.col[a + 2]]
    );
  }
  return out;
}
