/**
 * Minimal, dependency-light binary glTF 2.0 (.glb) writer + low-poly geometry kit.
 * Everything is authored with flat-shaded vertex colours so one material covers
 * an entire model -> tiny files, zero texture downloads, perfect for low-data mobile.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { TEX_PNG as TEX_PNGS } from './textures.mjs';

// ---------------------------------------------------------------- math helpers
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Geometry accumulator: flat-shaded triangles with per-face normals.
 * Uses a hint vector to guarantee outward (CCW) winding.
 */
export class Geo {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.idx = [];
    this.uv = [];
  }

  get count() {
    return this.pos.length / 3;
  }

  _vert(p, n, color) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.col.push(color[0], color[1], color[2]);
    this.uv.push(0, 0);
    return this.count - 1;
  }

  /** tint helper: multiply a geometry's vertex colours by a factor */
  static tintGeo(geo, c) {
    for (let i = 0; i < geo.col.length; i += 3) {
      geo.col[i] *= c[0];
      geo.col[i + 1] *= c[1];
      geo.col[i + 2] *= c[2];
    }
    return geo;
  }

  /** box/triplanar UVs: dominant normal axis decides the projection plane */
  _triplanarUV(i0, i1, i2, scale) {
    const nx = Math.abs(this.nrm[i0 * 3]);
    const ny = Math.abs(this.nrm[i0 * 3 + 1]);
    const nz = Math.abs(this.nrm[i0 * 3 + 2]);
    for (const i of [i0, i1, i2]) {
      const x = this.pos[i * 3];
      const y = this.pos[i * 3 + 1];
      const z = this.pos[i * 3 + 2];
      let u, v;
      if (ny >= nx && ny >= nz) {
        u = x;
        v = z;
      } else if (nx >= nz) {
        u = z;
        v = y;
      } else {
        u = x;
        v = y;
      }
      this.uv[i * 2] = u * scale;
      this.uv[i * 2 + 1] = v * scale;
    }
  }

  /** triangle with supplied flat normal, auto-corrected winding */
  tri(a, b, c, hint, color) {
    let n = cross3(
      [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
      [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    );
    let len = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / len, n[1] / len, n[2] / len];
    if (hint && n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) {
      const t = b;
      b = c;
      c = t;
      n = [-n[0], -n[1], -n[2]];
    }
    const i0 = this._vert(a, n, color);
    const i1 = this._vert(b, n, color);
    const i2 = this._vert(c, n, color);
    this.idx.push(i0, i1, i2);
    if (this.uvScale) this._triplanarUV(i0, i1, i2, this.uvScale);
    return this;
  }

  quad(a, b, c, d, hint, color) {
    this.tri(a, b, c, hint, color);
    this.tri(a, c, d, hint, color);
    return this;
  }

  /** append another Geo, transformed by matrix */
  merge(geo, matrix, colorMul) {
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const base = this.count;
    const hasUV = geo.uv && geo.uv.length === geo.pos.length * (2 / 3);
    for (let i = 0; i < geo.pos.length; i += 3) {
      p.set(geo.pos[i], geo.pos[i + 1], geo.pos[i + 2]).applyMatrix4(matrix);
      n.set(geo.nrm[i], geo.nrm[i + 1], geo.nrm[i + 2]).applyMatrix3(nm).normalize();
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(n.x, n.y, n.z);
      const vi = i / 3;
      this.uv.push(hasUV ? geo.uv[vi * 2] : 0, hasUV ? geo.uv[vi * 2 + 1] : 0);
      const r = geo.col[i] * (colorMul ? colorMul[0] : 1);
      const g = geo.col[i + 1] * (colorMul ? colorMul[1] : 1);
      const b = geo.col[i + 2] * (colorMul ? colorMul[2] : 1);
      this.col.push(r, g, b);
    }
    for (const i of geo.idx) this.idx.push(base + i);
    return this;
  }
}

// ---------------------------------------------------------------- primitives
const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const C = (c) => (Array.isArray(c) ? c : new THREE.Color(c).toArray());

export function boxGeo(w, h, d, color, m, texScale) {
  const g = new Geo();
  if (texScale) g.uvScale = texScale;
  const col = C(color);
  const x = w / 2,
    y = h / 2,
    z = d / 2;
  const P = [
    [-x, -y, -z],
    [x, -y, -z],
    [x, y, -z],
    [-x, y, -z],
    [-x, -y, z],
    [x, -y, z],
    [x, y, z],
    [-x, y, z],
  ];
  g.quad(P[4], P[5], P[6], P[7], [0, 0, 1], col); // +z
  g.quad(P[1], P[0], P[3], P[2], [0, 0, -1], col); // -z
  g.quad(P[5], P[1], P[2], P[6], [1, 0, 0], col); // +x
  g.quad(P[0], P[4], P[7], P[3], [-1, 0, 0], col); // -x
  g.quad(P[3], P[7], P[6], P[2], [0, 1, 0], col); // +y
  g.quad(P[0], P[1], P[5], P[4], [0, -1, 0], col); // -y
  if (m) g.applyMatrix(m);
  return g;
}

/** Tapered box: bottom w/d and top w/d -> classic low-poly car/hull shapes */
export function frustumGeo(wb, db, wt, dt, h, color, m, yOff = 0, texScale) {
  const g = new Geo();
  if (texScale) g.uvScale = texScale;
  const col = C(color);
  const b = [
    [-wb / 2, yOff, -db / 2],
    [wb / 2, yOff, -db / 2],
    [wb / 2, yOff, db / 2],
    [-wb / 2, yOff, db / 2],
  ];
  const t = [
    [-wt / 2, yOff + h, -dt / 2],
    [wt / 2, yOff + h, -dt / 2],
    [wt / 2, yOff + h, dt / 2],
    [-wt / 2, yOff + h, dt / 2],
  ];
  g.quad(t[0], t[1], t[2], t[3], [0, 1, 0], col);
  g.quad(b[0], b[1], b[2], b[3], [0, -1, 0], col);
  g.quad(b[1], b[2], t[2], t[1], [1, 0, 0], col);
  g.quad(b[3], b[0], t[0], t[3], [-1, 0, 0], col);
  g.quad(b[2], b[3], t[3], t[2], [0, 0, 1], col);
  g.quad(b[0], b[1], t[1], t[0], [0, 0, -1], col);
  if (m) g.applyMatrix(m);
  return g;
}

export function cylinderGeo(rTop, rBot, h, seg, color, m, cap = true, texScale) {
  const g = new Geo();
  if (texScale) g.uvScale = texScale;
  const col = C(color);
  const y = h / 2;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(a0),
      s0 = Math.sin(a0),
      c1 = Math.cos(a1),
      s1 = Math.sin(a1);
    const bt0 = [c0 * rBot, -y, s0 * rBot];
    const bt1 = [c1 * rBot, -y, s1 * rBot];
    const tp0 = [c0 * rTop, y, s0 * rTop];
    const tp1 = [c1 * rTop, y, s1 * rTop];
    const hint = [(c0 + c1) / 2, 0, (s0 + s1) / 2];
    g.quad(bt0, bt1, tp1, tp0, hint, col);
    if (cap) {
      if (rTop > 0.0001) g.tri([0, y, 0], tp0, tp1, [0, 1, 0], col);
      if (rBot > 0.0001) g.tri([0, -y, 0], bt0, bt1, [0, -1, 0], col);
    }
  }
  if (m) g.applyMatrix(m);
  return g;
}

export function sphereGeo(r, segW, segH, color, m) {
  const g = new Geo();
  const col = C(color);
  for (let j = 0; j < segH; j++) {
    const p0 = (j / segH) * Math.PI;
    const p1 = ((j + 1) / segH) * Math.PI;
    for (let i = 0; i < segW; i++) {
      const t0 = (i / segW) * Math.PI * 2;
      const t1 = ((i + 1) / segW) * Math.PI * 2;
      const pt = (p, t) => [Math.sin(p) * Math.cos(t) * r, Math.cos(p) * r, Math.sin(p) * Math.sin(t) * r];
      const a = pt(p0, t0),
        b = pt(p0, t1),
        c = pt(p1, t1),
        d = pt(p1, t0);
      const hint = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
      if (j === 0) g.tri(a, c, d, hint, col);
      else if (j === segH - 1) g.tri(a, b, c, hint, col);
      else g.quad(a, b, c, d, hint, col);
    }
  }
  if (m) g.applyMatrix(m);
  return g;
}

/** Extruded prism from a 2D polygon in XY, depth along Z */
export function prismGeo(points, depth, color, m) {
  const g = new Geo();
  const col = C(color);
  const z = depth / 2;
  const front = points.map(([x, y]) => [x, y, z]);
  const back = points.map(([x, y]) => [x, y, -z]);
  const cen = points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]).map((v) => v / points.length);
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    g.tri([cen[0], cen[1], z], front[i], front[j], [0, 0, 1], col);
    g.tri([cen[0], cen[1], -z], back[i], back[j], [0, 0, -1], col);
    const hint = [
      (points[i][0] + points[j][0]) / 2 - cen[0],
      (points[i][1] + points[j][1]) / 2 - cen[1],
      0,
    ];
    g.quad(back[i], back[j], front[j], front[i], hint, col);
  }
  if (m) g.applyMatrix(m);
  return g;
}

Geo.prototype.applyMatrix = function (matrix) {
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nm = new THREE.Matrix3().getNormalMatrix(matrix);
  for (let i = 0; i < this.pos.length; i += 3) {
    p.set(this.pos[i], this.pos[i + 1], this.pos[i + 2]).applyMatrix4(matrix);
    n.set(this.nrm[i], this.nrm[i + 1], this.nrm[i + 2]).applyMatrix3(nm).normalize();
    this.pos[i] = p.x;
    this.pos[i + 1] = p.y;
    this.pos[i + 2] = p.z;
    this.nrm[i] = n.x;
    this.nrm[i + 1] = n.y;
    this.nrm[i + 2] = n.z;
  }
  return this;
};

// ---------------------------------------------------------------- transforms
export function mat({ pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ')),
    new THREE.Vector3(...scale)
  );
}

// ---------------------------------------------------------------- model builder
export class Model {
  constructor(name) {
    this.name = name;
    this.materials = [];
    this.nodes = []; // { name, parent, matrix, groups: Map<matIndex, Geo> }
    this.root = this.addNode('root');
    this._node = this.root;
  }

  addMaterial(material) {
    this.materials.push(material);
    return this.materials.length - 1;
  }

  addNode(name, matrix, parentName) {
    let parent = this.root;
    if (parentName) parent = this.nodes.find((n) => n.name === parentName) || this.root;
    const node = {
      name,
      parent,
      matrix: matrix || new THREE.Matrix4(),
      groups: new Map(),
    };
    this.nodes.push(node);
    this._node = node;
    return node;
  }

  use(name) {
    const found = this.nodes.find((n) => n.name === name);
    if (!found) throw new Error(`node ${name} missing`);
    this._node = found;
    return this;
  }

  /** add geometry to current node under material index (default 0) */
  add(geo, matIndex = 0) {
    const node = this._node;
    if (!node.groups.has(matIndex)) node.groups.set(matIndex, new Geo());
    node.groups.get(matIndex).merge(geo, new THREE.Matrix4());
    return this;
  }


  /** convenience: box with material index */
  box(w, h, d, color, m, matIndex = 0) {
    return this.add(boxGeo(w, h, d, color, m), matIndex);
  }
}

// ---------------------------------------------------------------- GLB writer
const COMP = { FLOAT: 5126, U16: 5123, U32: 5125, BYTE: 5120, UBYTE: 5121 };

function pad4(n) {
  return (4 - (n % 4)) % 4;
}

export function buildGLB(model) {
  const json = {
    asset: { version: '2.0', generator: 'Arena LowPoly Asset Foundry' },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    materials: model.materials.map((m) => {
      const out = {
        name: m.name,
        pbrMetallicRoughness: {
          // every primitive carries COLOR_0, so the material tint stays white and the
          // per-vertex colour (already linear) does the work — no double darkening.
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: m.metallic ?? 0.1,
          roughnessFactor: m.roughness ?? 0.75,
        },
        doubleSided: !!m.doubleSided,
      };
      if (m.emissive) {
        out.emissiveFactor = [toLinear(m.emissive[0]), toLinear(m.emissive[1]), toLinear(m.emissive[2])];
        out.extensions = { KHR_materials_emissive_strength: { emissiveStrength: m.emissiveStrength ?? 1 } };
      }
      if (m.texture) out.pbrMetallicRoughness.baseColorTexture = { index: 0, texCoord: 0 };
      if (m.transmission !== undefined) {
        out.extensions = out.extensions || {};
        out.extensions.KHR_materials_transmission = { transmissionFactor: m.transmission };
      }
      return out;
    }),
    accessors: [],
    bufferViews: [],
    buffers: [{ byteLength: 0 }],
  };
  const extensionsUsed = new Set(['KHR_mesh_quantization']);
  const extensionsRequired = new Set(['KHR_mesh_quantization']);
  if (model.materials.some((m) => m.emissive)) extensionsUsed.add('KHR_materials_emissive_strength');
  if (model.materials.some((m) => m.transmission !== undefined)) extensionsUsed.add('KHR_materials_transmission');
  json.extensionsUsed = [...extensionsUsed];
  json.extensionsRequired = [...extensionsRequired];

  const chunks = [];
  let byteOffset = 0;

  // ---- embedded PNG textures (one shared sampler)
  const texMaterials = model.materials
    .map((m, i) => ({ m, i }))
    .filter((x) => x.m.texture && TEX_PNGS[x.m.texture]);
  if (texMaterials.length) {
    json.images = [];
    json.textures = [];
    json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
    const indexForTexture = {};
    for (const { m, i } of texMaterials) {
      const name = m.texture;
      let texIndex = indexForTexture[name];
      if (texIndex === undefined) {
        const png = TEX_PNGS[name];
        const pad = pad4(byteOffset);
        if (pad) {
          chunks.push(Buffer.alloc(pad));
          byteOffset += pad;
        }
        json.bufferViews.push({ buffer: 0, byteOffset, byteLength: png.length });
        byteOffset += png.length;
        chunks.push(png);
        json.images.push({ bufferView: json.bufferViews.length - 1, mimeType: 'image/png', name });
        json.textures.push({ sampler: 0, source: json.images.length - 1 });
        texIndex = json.textures.length - 1;
        indexForTexture[name] = texIndex;
      }
      json.materials[i].pbrMetallicRoughness.baseColorTexture = { index: texIndex, texCoord: 0 };
    }
  }

  const pushBufferView = (buffer, target) => {
    const pad = pad4(byteOffset);
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      byteOffset += pad;
    }
    const view = { buffer: 0, byteOffset, byteLength: buffer.length, target };
    byteOffset += buffer.length;
    chunks.push(buffer);
    json.bufferViews.push(view);
    return json.bufferViews.length - 1;
  };

  function addAccessor(array, type, componentType, minMax, normalized, stride4) {
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    let data = array;
    let byteStride = 0;
    if (stride4 && array.BYTES_PER_ELEMENT === 1 && comps % 4 !== 0) {
      // pad each vertex element to a 4-byte boundary (required for vertex attributes)
      const count = array.length / comps;
      const padded = new Uint8Array(count * 4);
      for (let i = 0; i < count; i++) {
        for (let c = 0; c < comps; c++) padded[i * 4 + c] = array[i * comps + c];
      }
      data = padded;
      byteStride = 4;
    }
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const pad = pad4(byteOffset);
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      byteOffset += pad;
    }
    const view = { buffer: 0, byteOffset, byteLength: buf.length, target: 34962 };
    if (byteStride) view.byteStride = byteStride;
    byteOffset += buf.length;
    chunks.push(buf);
    json.bufferViews.push(view);
    const acc = {
      bufferView: json.bufferViews.length - 1,
      componentType,
      count: array.length / comps,
      type,
    };
    if (normalized) acc.normalized = true;
    if (minMax) {
      const min = new Array(comps).fill(Infinity);
      const max = new Array(comps).fill(-Infinity);
      for (let i = 0; i < array.length; i += comps) {
        for (let c = 0; c < comps; c++) {
          const v = array[i + c];
          if (v < min[c]) min[c] = v;
          if (v > max[c]) max[c] = v;
        }
      }
      acc.min = min;
      acc.max = max;
    }
    json.accessors.push(acc);
    return json.accessors.length - 1;
  }

  // ---- build node hierarchy (every model node becomes a glTF node, parents preserved)
  const indexOf = new Map();
  for (const node of model.nodes) {
    const def = { name: node.name };
    if (!node.matrix.equals(new THREE.Matrix4())) def.matrix = node.matrix.toArray();
    json.nodes.push(def);
    indexOf.set(node, json.nodes.length - 1);
  }
  const sceneRoots = [];
  for (const node of model.nodes) {
    const idx = indexOf.get(node);
    if (node.parent && indexOf.has(node.parent)) {
      const pIdx = indexOf.get(node.parent);
      const parentDef = json.nodes[pIdx];
      parentDef.children = parentDef.children || [];
      parentDef.children.push(idx);
    } else {
      sceneRoots.push(idx);
    }
    if (node.groups.size === 0) continue;
    const primitives = [];
    for (const [matIndex, geo] of node.groups) {
      if (geo.idx.length === 0) continue;
      const mtl = model.materials[matIndex];
      if (mtl && mtl.baseColor && !(mtl.baseColor[0] === 1 && mtl.baseColor[1] === 1 && mtl.baseColor[2] === 1)) {
        Geo.tintGeo(geo, [mtl.baseColor[0], mtl.baseColor[1], mtl.baseColor[2]]);
      }
      const positions = new Float32Array(geo.pos);
      const useShort = geo.count < 65536;
      const indices = useShort ? new Uint16Array(geo.idx) : new Uint32Array(geo.idx);
      const aPos = addAccessor(positions, 'VEC3', COMP.FLOAT, true);
      const wantsUV = !!model.materials[matIndex]?.texture;
      let aUV = -1;
      if (wantsUV) {
        const uvs = new Float32Array(geo.uv.length ? geo.uv : new Array(geo.count * 2).fill(0));
        aUV = addAccessor(uvs, 'VEC2', COMP.FLOAT, false);
      }
      // normals + colours packed as signed/unsigned bytes (18 B/vertex instead of 36 B)
      const normals = new Int8Array(geo.nrm.length);
      for (let i = 0; i < geo.nrm.length; i++) normals[i] = Math.max(-127, Math.min(127, Math.round(geo.nrm[i] * 127)));
      const colors = new Uint8Array(geo.col.length);
      for (let i = 0; i < geo.col.length; i++) colors[i] = Math.max(0, Math.min(255, Math.round(toLinear(Math.min(1, Math.max(0, geo.col[i]))) * 255)));
      const aNrm = addAccessor(normals, 'VEC3', COMP.BYTE, false, true, true);
      const aCol = addAccessor(colors, 'VEC3', COMP.UBYTE, false, true, true);
      const pad = pad4(byteOffset);
      if (pad) {
        chunks.push(Buffer.alloc(pad));
        byteOffset += pad;
      }
      const ibuf = Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength);
      json.bufferViews.push({ buffer: 0, byteOffset, byteLength: ibuf.length, target: 34963 });
      byteOffset += ibuf.length;
      chunks.push(ibuf);
      json.accessors.push({
        bufferView: json.bufferViews.length - 1,
        componentType: useShort ? COMP.U16 : COMP.U32,
        count: indices.length,
        type: 'SCALAR',
      });
      const attributes = { POSITION: aPos, NORMAL: aNrm, COLOR_0: aCol };
      if (aUV >= 0) attributes.TEXCOORD_0 = aUV;
      primitives.push({
        attributes,
        indices: json.accessors.length - 1,
        material: matIndex,
      });
    }
    if (!primitives.length) continue;
    json.meshes.push({ name: node.name, primitives });
    json.nodes[idx].mesh = json.meshes.length - 1;
  }
  const nodeIndices = sceneRoots;
  json.scenes[0].nodes = nodeIndices;
  json.buffers[0].byteLength = byteOffset;

  // ---- assemble
  let jsonStr = JSON.stringify(json);
  while (Buffer.byteLength(jsonStr) % 4 !== 0) jsonStr += ' ';
  const jsonBuf = Buffer.from(jsonStr, 'utf8');
  const binLen = byteOffset;
  const binPad = pad4(binLen);
  const total = 12 + 8 + jsonBuf.length + 8 + binLen + binPad;
  const out = Buffer.alloc(total);
  let o = 0;
  out.writeUInt32LE(0x46546c67, o); o += 4;
  out.writeUInt32LE(2, o); o += 4;
  out.writeUInt32LE(total, o); o += 4;
  out.writeUInt32LE(jsonBuf.length, o); o += 4;
  out.writeUInt32LE(0x4e4f534a, o); o += 4;
  jsonBuf.copy(out, o); o += jsonBuf.length;
  out.writeUInt32LE(binLen + binPad, o); o += 4;
  out.writeUInt32LE(0x004e4942, o); o += 4;
  for (const c of chunks) {
    c.copy(out, o);
    o += c.length;
  }
  return out;
}

export function writeGLB(model, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const data = buildGLB(model);
  const file = path.join(outDir, `${model.name}.glb`);
  fs.writeFileSync(file, data);
  return { file, bytes: data.length, tris: 0 };
}

// ---------------------------------------------------------------- shared palette
export const PAL = {
  glass: [0.06, 0.1, 0.13],
  tyre: [0.035, 0.035, 0.04],
  chrome: [0.75, 0.77, 0.8],
  darkChrome: [0.2, 0.21, 0.23],
  skinLight: [0.82, 0.62, 0.48],
  skinMed: [0.68, 0.47, 0.33],
  skinDark: [0.42, 0.28, 0.19],
  denim: [0.18, 0.26, 0.42],
  denimDark: [0.12, 0.17, 0.28],
  white: [0.92, 0.92, 0.94],
  black: [0.09, 0.09, 0.1],
  sneaker: [0.95, 0.95, 0.95],
  rubber: [0.05, 0.05, 0.06],
  steel: [0.45, 0.47, 0.5],
  gunmetal: [0.19, 0.2, 0.22],
  wood: [0.34, 0.2, 0.11],
  head: [1.0, 0.96, 0.8],
  tail: [0.9, 0.08, 0.08],
  amber: [1.0, 0.55, 0.08],
  blue: [0.1, 0.3, 0.95],
  red: [0.8, 0.1, 0.1],
};
