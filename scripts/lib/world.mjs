/**
 * Los Santos-inspired coastal city + Indian Bike Driving 3D stunt park asset foundry.
 * Emits a single .glb city plus a tiny JSON collider sidecar the runtime uses for
 * character/vehicle/bullet collision (far cheaper than raycasting the whole city).
 */
import {
  Model,
  mat,
  boxGeo,
  frustumGeo,
  cylinderGeo,
  sphereGeo,
  prismGeo,
  PAL,
  Geo,
} from './glb.mjs';
import * as THREE from 'three';
import { withUV } from './textures.mjs';

// deterministic PRNG so the city is identical every load (and matches colliders)
function rng(seed = 1337) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const rnd = rng(20251112);
const R = (a, b) => a + rnd() * (b - a);
const RI = (a, b) => Math.floor(R(a, b + 1));

export const COLLIDERS = [];

const BUILDING_COLORS = [
  [1.0, 0.96, 0.88], [0.96, 0.94, 0.98], [1.0, 0.9, 0.78], [0.88, 0.94, 1.0],
  [0.86, 0.82, 0.74], [0.78, 0.8, 0.84], [0.9, 0.87, 0.8], [0.7, 0.74, 0.8],
  [0.82, 0.74, 0.66], [0.62, 0.66, 0.72], [0.93, 0.9, 0.84], [0.55, 0.6, 0.68],
  [0.88, 0.78, 0.7], [0.75, 0.72, 0.78],
];
const NEON = [[1, 0.35, 0.5], [0.35, 0.85, 1], [1, 0.8, 0.3], [0.65, 0.4, 1], [0.4, 1, 0.7]];

const GRID = 110; // block pitch
const ROAD = 22;
const CITY = 6; // blocks per side from centre

const roadAt = (v) => {
  const m = ((v % GRID) + GRID) % GRID;
  return m < ROAD / 2 || m > GRID - ROAD / 2;
};

const zoneOf = (x, z) => {
  if (x < -GRID * 4) return 'beach';
  if (x < 0 && z > -GRID * 2) return 'suburb';
  if (z < -GRID * 2) return 'industrial';
  if (x > GRID * 2 && z > GRID * 1.5) return 'airport';
  return 'downtown';
};

export function buildCity() {
  const M = new Model('map_los_santos');
  COLLIDERS.length = 0;

  // spatial chunking -> one mesh node per 2x2 city blocks, giving the client real
  // frustum-culling + distance-LOD granularity (and keeping draw calls modest).
  let _chunk = null;
  const chunkAt = (x, z, kind = 'city') => {
    const name = `${kind}_${Math.round(x / (GRID * 2))}_${Math.round(z / (GRID * 2))}`;
    if (!M.nodes.some((n) => n.name === name)) {
      M.addNode(name);
      M._node.chunk = true;
    }
    M.use(name);
    return name;
  };

  const mGround = M.addMaterial({ name: 'ground', baseColor: [1, 1, 1, 1], roughness: 0.95, texture: 'grass' });
  const mRoad = M.addMaterial({ name: 'road', baseColor: [1, 1, 1, 1], roughness: 0.9, texture: 'road' });
  const mLine = M.addMaterial({ name: 'roadline', baseColor: [0.85, 0.84, 0.6, 1], roughness: 0.8 });
  const mSand = M.addMaterial({ name: 'sand', baseColor: [1, 1, 1, 1], roughness: 0.95, texture: 'sand' });
  const mConcrete = M.addMaterial({ name: 'concrete', baseColor: [1, 1, 1, 1], roughness: 0.9, texture: 'concrete' });
  const mFacade = M.addMaterial({ name: 'facade', baseColor: [1, 1, 1, 1], roughness: 0.85, texture: 'facade' });
  const mWindows = M.addMaterial({ name: 'windows', baseColor: [0.42, 0.52, 0.62, 1], metallic: 0.25, roughness: 0.3, emissive: [0.95, 0.85, 0.55], emissiveStrength: 0.0 });
  const mGlassTower = M.addMaterial({ name: 'glasstower', baseColor: [0.86, 0.93, 1.0, 1], metallic: 0.15, roughness: 0.45, texture: 'facade' });
  const mRoof = M.addMaterial({ name: 'roof', baseColor: [1, 1, 1, 1], roughness: 0.9, texture: 'roof' });
  const mPalmTrunk = M.addMaterial({ name: 'palmtrunk', baseColor: [0.38, 0.28, 0.18, 1], roughness: 0.92 });
  const mPalmLeaf = M.addMaterial({ name: 'palmleaf', baseColor: [0.2, 0.46, 0.19, 1], roughness: 0.8 });
  const mNeon = M.addMaterial({ name: 'neon', baseColor: [0.9, 0.3, 0.6, 1], emissive: [1.0, 0.35, 0.65], emissiveStrength: 2.4 });
  const mMetal = M.addMaterial({ name: 'metal', baseColor: [0.4, 0.42, 0.45, 1], metallic: 0.75, roughness: 0.35 });
  const mWater = M.addMaterial({ name: 'poolwater', baseColor: [0.15, 0.55, 0.72, 1], metallic: 0.25, roughness: 0.06, transmission: 0.4 });
  const mGrass = M.addMaterial({ name: 'parkgrass', baseColor: [1, 1, 1, 1], roughness: 0.95, texture: 'grass' });
  const mAirfield = M.addMaterial({ name: 'airfield', baseColor: [0.94, 0.94, 0.96, 1], roughness: 0.92, texture: 'road' });
  const mRed = M.addMaterial({ name: 'signalred', baseColor: [0.75, 0.15, 0.12, 1], roughness: 0.7 });

  // ================================================================ terrain
  M.addNode('terrain');
  const HALF = GRID * CITY + 240; // ~900
  // one flat surface per zone (a single plane instead of thousands of tiles → no seams)
  M.add(new Geo(), mGround); // keep node alive even if empty
  {
    const g = boxGeo(HALF * 2, 0.6, HALF * 2, [1.06, 1.05, 0.98], mat({ pos: [0, -0.3, 0] }), 0.26);
    M.add(g, mGround);
  }
  // beach strip west of the city
  M.add(boxGeo(300, 0.7, HALF * 2, [1.05, 1.0, 0.92], mat({ pos: [-HALF - 20, -0.32, 0] }), 0.12), mSand);
  // airport apron / runway base
  {
    const apX = GRID * 2.5 + 55;
    const apZ = GRID * 2.6 + 55;
    M.add(boxGeo(320, 0.66, 520, [0.7, 0.71, 0.72], mat({ pos: [apX - 60, -0.31, apZ] }), 0.2), mAirfield);
  }
  // ocean floor shelf going out west (the animated water surface is a shader in the client)
  M.add(boxGeo(1200, 6, HALF * 2 + 600, [0.1, 0.28, 0.34], mat({ pos: [-HALF - 900, -3.4, 0] })), mGround);

  // ================================================================ roads
  M.addNode('roads');
  const roadExtent = GRID * CITY + 60;
  for (let i = -CITY; i <= CITY; i++) {
    const p = i * GRID;
    // north-south road
    M.add(boxGeo(ROAD, 0.14, roadExtent * 2, [1, 1, 1], mat({ pos: [p, 0.07, 0] }), 0.28), mRoad);
    // east-west road
    M.add(boxGeo(roadExtent * 2, 0.14, ROAD, [1, 1, 1], mat({ pos: [0, 0.07, p] }), 0.28), mRoad);
  }
  // dashed centre lines + sidewalks
  M.addNode('markings');
  for (let i = -CITY; i <= CITY; i++) {
    const p = i * GRID;
    for (let z = -roadExtent; z < roadExtent; z += 34) {
      M.add(boxGeo(0.55, 0.06, 13, [1, 1, 1], mat({ pos: [p, 0.16, z + 8] })), mLine);
    }
    for (let x = -roadExtent; x < roadExtent; x += 34) {
      M.add(boxGeo(13, 0.06, 0.55, [1, 1, 1], mat({ pos: [x + 8, 0.16, p] })), mLine);
    }
  }
  // block paving: a sidewalk ring with a green / plaza interior per district
  M.addNode('sidewalks');
  for (let ix = -CITY; ix < CITY; ix++) {
    for (let iz = -CITY; iz < CITY; iz++) {
      const bx = ix * GRID + GRID / 2;
      const bz = iz * GRID + GRID / 2;
      const size = GRID - ROAD;
      const zone = zoneOf(bx, bz);
      const inner = size - 9;
      // interior surface
      if (zone === 'suburb') {
        M.add(boxGeo(inner, 0.26, inner, [1, 1, 1], mat({ pos: [bx, 0.13, bz] }), 0.2), mGrass);
      } else if (zone === 'beach') {
        M.add(boxGeo(inner, 0.26, inner, [1, 1, 1], mat({ pos: [bx, 0.13, bz] }), 0.12), mSand);
      } else if (zone === 'industrial' || zone === 'airport') {
        M.add(boxGeo(inner, 0.26, inner, [0.7, 0.7, 0.72], mat({ pos: [bx, 0.13, bz] }), 0.16), mRoad);
      } else {
        M.add(boxGeo(inner, 0.26, inner, [0.66 + rnd() * 0.1, 0.66 + rnd() * 0.1, 0.67 + rnd() * 0.1], mat({ pos: [bx, 0.13, bz] }), 0.34), mConcrete);
      }
      // sidewalk ring
      const half = size / 2;
      const w = 4.5;
      const tint = [0.86 + rnd() * 0.12, 0.86 + rnd() * 0.12, 0.87 + rnd() * 0.1];
      M.add(boxGeo(size, 0.32, w, tint, mat({ pos: [bx, 0.16, bz + half - w / 2] }), 0.3), mConcrete);
      M.add(boxGeo(size, 0.32, w, tint, mat({ pos: [bx, 0.16, bz - half + w / 2] }), 0.3), mConcrete);
      M.add(boxGeo(w, 0.32, size, tint, mat({ pos: [bx + half - w / 2, 0.16, bz] }), 0.3), mConcrete);
      M.add(boxGeo(w, 0.32, size, tint, mat({ pos: [bx - half + w / 2, 0.16, bz] }), 0.3), mConcrete);
    }
  }


  /** thin dark-glass window bands on each facade (cheap, no enclosing box) */
  const addWindowBands = (bx, bz, w, d, h, bands = 3, yStart = 0.28) => {
    const step = h / (bands + 1);
    for (let b = 1; b <= bands; b++) {
      const y = yStart + b * step;
      const bh = Math.min(2.2, step * 0.3);
      M.add(boxGeo(w * 0.9, bh, d * 1.014, [1, 1, 1], mat({ pos: [bx, y, bz] })), mWindows);
      M.add(boxGeo(w * 1.014, bh, d * 0.9, [1, 1, 1], mat({ pos: [bx, y, bz] })), mWindows);
    }
  };

  // ================================================================ buildings
  const addBuilding = (bx, bz, w, d, h, opts = {}) => {
    chunkAt(bx, bz, 'bld');
    M.add(frustumGeo(w, d, w * R(0.88, 0.97), d * R(0.88, 0.97), h, [1, 1, 1], mat({ pos: [bx, 0.28, bz] }), 0, 0.2), opts.material ?? mFacade);
    if (h > 6) addWindowBands(bx, bz, w, d, h, Math.min(4, Math.max(1, Math.floor(h / 7))));
    if (h > 40) {
      // rooftop details
      M.add(boxGeo(w * 0.4, 3, d * 0.4, [1, 1, 1], mat({ pos: [bx, h + 1.8, bz] })), mRoof);
      if (rnd() > 0.55) {
        M.add(cylinderGeo(0.5, 0.5, R(8, 22), 6, [0.6, 0.6, 0.62], mat({ pos: [bx + w * 0.2, h + 6, bz] })), mMetal);
        M.add(sphereGeo(0.6, 6, 4, [0.9, 0.2, 0.2], mat({ pos: [bx + w * 0.2, h + 16, bz] })), mRed);
      }
    } else if (rnd() > 0.6) {
      M.add(boxGeo(w * 0.55, 1.6, d * 0.5, [1, 1, 1], mat({ pos: [bx, h + 1.1, bz] })), mRoof);
    }
    COLLIDERS.push({ x: +bx.toFixed(1), z: +bz.toFixed(1), w: +(w / 2).toFixed(1), d: +(d / 2).toFixed(1), h: +h.toFixed(1), t: 'building' });
  };

  const addHouse = (bx, bz, w, d) => {
    chunkAt(bx, bz, 'house');
    const h = R(4.2, 7.5);
    M.add(frustumGeo(w, d, w * 0.96, d * 0.96, h, [1, 1, 1], mat({ pos: [bx, 0.3, bz] }), 0, 0.24), mFacade);
    // hip roof
    M.add(frustumGeo(w * 1.08, d * 1.08, w * 0.16, d * 0.16, R(1.6, 2.6), [1, 1, 1], mat({ pos: [bx, 0.3 + h, bz] }), 0, 0.3), mRoof);
    // windows + door
    M.add(boxGeo(w * 0.6, h * 0.3, 0.16, [1, 1, 1], mat({ pos: [bx, 0.3 + h * 0.58, bz + d / 2] })), mWindows);
    M.add(boxGeo(w * 0.28, h * 0.28, 0.16, [1, 1, 1], mat({ pos: [bx - w * 0.22, 0.3 + h * 0.58, bz - d / 2] })), mWindows);
    M.add(boxGeo(w * 0.18, h * 0.42, 0.2, [0.4, 0.26, 0.16], mat({ pos: [bx + w * 0.26, 0.3 + h * 0.21, bz + d / 2] })), mPalmTrunk);
    // front yard fence
    M.add(boxGeo(w * 1.1, 0.9, 0.12, [0.9, 0.9, 0.9], mat({ pos: [bx, 0.75, bz + d / 2 + 3] })), mConcrete);
    COLLIDERS.push({ x: +bx.toFixed(1), z: +bz.toFixed(1), w: +(w / 2).toFixed(1), d: +(d / 2).toFixed(1), h: +h.toFixed(1), t: 'building' });
  };

  const addTower = (bx, bz, w, d, h) => {
    chunkAt(bx, bz, 'tower');
    // curtain-wall volume
    M.add(frustumGeo(w, d, w * 0.9, d * 0.9, h, [1, 1, 1], mat({ pos: [bx, 0.3, bz] }), 0, 0.2), mGlassTower);
    // corner piers only (0.9 m) so the facade texture stays visible
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        M.add(boxGeo(0.9, h, 0.9, [0.92, 0.9, 0.86], mat({ pos: [bx + (sx * w) / 2, 0.3 + h / 2, bz + (sz * d) / 2] })), mConcrete);
      }
    }
    // setback crown + neon band
    M.add(frustumGeo(w * 0.9, d * 0.9, w * 0.42, d * 0.42, 6, [0.94, 0.92, 0.88], mat({ pos: [bx, 0.3 + h, bz] })), mConcrete);
    M.add(boxGeo(w * 0.93, 0.7, d * 0.93, [1, 1, 1], mat({ pos: [bx, 0.3 + h - 3.2, bz] })), mNeon);
    if (rnd() > 0.5) {
      M.add(cylinderGeo(0.35, 0.45, R(10, 26), 5, [0.72, 0.72, 0.75], mat({ pos: [bx + w * 0.18, 0.3 + h + 16, bz] })), mMetal);
      M.add(sphereGeo(0.45, 5, 3, [0.95, 0.25, 0.2], mat({ pos: [bx + w * 0.18, 0.3 + h + 30, bz] })), mRed);
    }
    COLLIDERS.push({ x: +bx.toFixed(1), z: +bz.toFixed(1), w: +(w / 2).toFixed(1), d: +(d / 2).toFixed(1), h: +h.toFixed(1), t: 'building' });
  };

  M.addNode('buildings');
  for (let ix = -CITY; ix < CITY; ix++) {
    for (let iz = -CITY; iz < CITY; iz++) {
      const bx = ix * GRID + GRID / 2;
      const bz = iz * GRID + GRID / 2;
      const zone = zoneOf(bx, bz);
      if (zone === 'beach' || zone === 'airport') continue;
      if (Math.abs(ix) === CITY - 1 && Math.abs(iz) === CITY - 1) continue;

      if (zone === 'downtown') {
        const n = rnd() > 0.62 ? 2 : 1;
        if (n === 1) {
          const w = R(30, 52), d = R(30, 52);
          const dist = Math.hypot(bx - GRID * 2.5, bz + GRID * 2.5);
          const h = R(22, 46) + Math.max(0, 120 - dist * 0.14) * R(0.4, 1.1);
          addTower(bx, bz, w, d, h);
        } else {
          for (const [ox, oz] of [[-22, -22], [22, 22]]) {
            addBuilding(bx + ox, bz + oz, R(22, 34), R(22, 34), R(12, 34));
          }
        }
      } else if (zone === 'suburb') {
        for (const [ox, oz] of [[-24, -24], [24, -24], [-24, 24], [24, 24]]) {
          addHouse(bx + ox + R(-3, 3), bz + oz + R(-3, 3), R(13, 19), R(13, 20));
        }
      } else {
        // industrial: wide low halls + warehouses
        addBuilding(bx, bz, R(40, 62), R(40, 62), R(8, 18), { material: mRoof });
        if (rnd() > 0.6) addBuilding(bx + R(-16, 16), bz + R(-16, 16), R(14, 22), R(14, 22), R(6, 12), { material: mConcrete });
      }
    }
  }

  // ================================================================ beachfront
  M.addNode('beach');
  const beachX = -GRID * 4 - 40;
  // promenade
  M.add(boxGeo(28, 0.5, GRID * CITY * 2, [0.78, 0.75, 0.7], mat({ pos: [beachX + 55, 0.25, 0] })), mConcrete);
  for (let z = -GRID * CITY; z < GRID * CITY; z += 60) {
    // lifeguard tower
    M.add(boxGeo(4, 3.4, 4, [0.95, 0.9, 0.78], mat({ pos: [beachX + 14, 1.7, z + 12] })), mFacade);
    M.add(boxGeo(4.6, 0.3, 4.6, [0.85, 0.4, 0.35], mat({ pos: [beachX + 14, 3.5, z + 12] })), mRed);
    M.add(boxGeo(3.2, 1.6, 0.2, [1, 1, 1], mat({ pos: [beachX + 14, 2.2, z + 14] })), mWindows);
    COLLIDERS.push({ x: beachX + 14, z: z + 12, w: 2, d: 2, h: 3.4, t: 'building' });
    // beach umbrellas
    for (let i = 0; i < 3; i++) {
      const ux = beachX - R(2, 28);
      const uz = z + R(-20, 20);
      M.add(cylinderGeo(0.08, 0.08, 2.4, 5, [0.9, 0.9, 0.9], mat({ pos: [ux, 1.2, uz] })), mConcrete);
      M.add(cylinderGeo(1.6, 0.1, 0.7, 8, [[1, 0.4, 0.35], [0.35, 0.7, 1], [1, 0.9, 0.4]][i], mat({ pos: [ux, 2.5, uz] })), mRed);
      // towel
      M.add(boxGeo(1.2, 0.04, 2.2, [[0.2, 0.6, 0.9], [0.9, 0.3, 0.5], [0.95, 0.85, 0.4]][i], mat({ pos: [ux + 1.6, 0.06, uz + 0.6] })), mGrass);
    }
    // palm row along the promenade
    for (let i = 0; i < 2; i++) {
      const px = beachX + 45 + i * 18;
      addPalm(M, px, z + 34, R(0.9, 1.2), mPalmTrunk, mPalmLeaf, chunkAt(px, z + 34, 'palm'));
    }
  }
  // pier
  M.addNode('pier');
  M.add(boxGeo(14, 0.6, 150, [0.62, 0.5, 0.36], mat({ pos: [beachX - 70, 1.4, -60] })), mPalmTrunk);
  for (let i = 0; i < 12; i++) {
    for (const s of [-1, 1]) {
      M.add(cylinderGeo(0.5, 0.5, 5.4, 6, [0.45, 0.36, 0.26], mat({ pos: [beachX - 70 + s * 6, -1.2, -60 - 70 + i * 13] })), mPalmTrunk);
    }
  }
  M.add(boxGeo(10, 4, 10, [0.85, 0.7, 0.5], mat({ pos: [beachX - 70, 3.6, -125] })), mFacade);

  // ================================================================ park + palms
  M.addNode('parks');
  for (const [px, pz] of [[-GRID * 2 + 55, GRID * 2 + 55], [GRID * 3 + 55, GRID * 2 + 55], [GRID + 55, GRID * 3 + 55]]) {
    M.add(boxGeo(72, 0.24, 72, [1, 1, 1], mat({ pos: [px, 0.36, pz] })), mGrass);
    // fountain
    M.add(cylinderGeo(4.2, 4.6, 0.9, 12, [0.8, 0.78, 0.74], mat({ pos: [px, 0.9, pz] })), mConcrete);
    M.add(cylinderGeo(4.0, 4.0, 0.1, 12, [1, 1, 1], mat({ pos: [px, 1.32, pz] })), mWater);
    M.add(cylinderGeo(0.6, 0.9, 2.2, 8, [0.85, 0.83, 0.8], mat({ pos: [px, 1.6, pz] })), mConcrete);
    // benches
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const bxx = px + Math.cos(a) * 12;
      const bzz = pz + Math.sin(a) * 12;
      M.add(boxGeo(2.4, 0.16, 0.7, [0.55, 0.36, 0.2], mat({ pos: [bxx, 0.9, bzz], rot: [0, -a, 0] })), mPalmTrunk);
      M.add(boxGeo(2.4, 0.7, 0.14, [0.55, 0.36, 0.2], mat({ pos: [bxx, 1.25, bzz], rot: [0, -a, 0] })), mPalmTrunk);
    }
    for (let i = 0; i < 7; i++) {
      addPalm(M, px + R(-30, 30), pz + R(-30, 30), R(0.85, 1.25), mPalmTrunk, mPalmLeaf, chunkAt(px, pz, 'palm'));
    }
  }

  // street palms along suburban avenues
  M.addNode('suburb_palms');
  for (let iz = -1; iz <= CITY; iz++) {
    for (let ix = -CITY; ix <= 0; ix++) {
      const bx = ix * GRID + GRID / 2;
      const bz = iz * GRID + GRID / 2;
      if (zoneOf(bx, bz) !== 'suburb') continue;
      for (const s of [-1, 1]) {
        addPalm(M, bx + s * (GRID / 2 - 4), bz + R(-30, 30), R(0.8, 1.15), mPalmTrunk, mPalmLeaf, chunkAt(bx, bz, 'palm'));
      }
    }
  }

  // ================================================================ vegetation
  M.addNode('vegetation');
  const mLeafA = M.addMaterial({ name: 'leafA', baseColor: [0.18, 0.42, 0.16, 1], roughness: 0.9 });
  const mLeafB = M.addMaterial({ name: 'leafB', baseColor: [0.3, 0.52, 0.2, 1], roughness: 0.9 });
  const mBush = M.addMaterial({ name: 'bush', baseColor: [0.22, 0.4, 0.18, 1], roughness: 0.92 });
  const addTree = (x, z, sc) => {
    chunkAt(x, z, 'veg');
    const th = 3.2 * sc;
    M.add(cylinderGeo(0.18 * sc, 0.3 * sc, th, 5, [0.3, 0.22, 0.14], mat({ pos: [x, th / 2, z] })), mPalmTrunk);
    M.add(sphereGeo(1.5 * sc, 7, 5, [1, 1, 1], mat({ pos: [x, th + 1.0 * sc, z], scale: [1, 0.85, 1] })), rnd() > 0.5 ? mLeafA : mLeafB);
    M.add(sphereGeo(1.0 * sc, 6, 4, [1, 1, 1], mat({ pos: [x + 0.7 * sc, th + 1.9 * sc, z - 0.4 * sc] })), mLeafB);
    M.add(sphereGeo(0.9 * sc, 6, 4, [1, 1, 1], mat({ pos: [x - 0.8 * sc, th + 1.6 * sc, z + 0.5 * sc] })), mLeafA);
  };
  const addBush = (x, z, sc) => {
    chunkAt(x, z, 'veg');
    M.add(sphereGeo(0.9 * sc, 6, 4, [1, 1, 1], mat({ pos: [x, 0.55 * sc, z], scale: [1.3, 0.8, 1.3] })), mBush);
  };
  for (let ix = -CITY; ix < CITY; ix++) {
    for (let iz = -CITY; iz < CITY; iz++) {
      const bx = ix * GRID + GRID / 2;
      const bz = iz * GRID + GRID / 2;
      const zone = zoneOf(bx, bz);
      if (zone === 'suburb') {
        for (let i = 0; i < 5; i++) {
          const tx = bx + R(-38, 38);
          const tz = bz + R(-38, 38);
          if (rnd() > 0.35) addBush(tx + R(-3, 3), tz + R(-3, 3), R(0.7, 1.1));
          else addTree(tx, tz, R(0.8, 1.3));
        }
      } else if (zone === 'downtown' && rnd() > 0.62) {
        for (let i = 0; i < 3; i++) addTree(bx + R(-40, 40), bz + R(-40, 40), R(0.7, 1.0));
      } else if (zone === 'beach') {
        for (let i = 0; i < 6; i++) addBush(bx + R(-40, 40), bz + R(-40, 40), R(0.5, 0.9));
      }
    }
  }

  // ================================================================ highway loop
  M.addNode('highway');
  const HR = GRID * CITY - 12; // ~648
  const hSegs = 44;
  const hw = 17;
  const hY = 7.5;
  for (let i = 0; i < hSegs; i++) {
    const a0 = (i / hSegs) * Math.PI * 2;
    const a1 = ((i + 1) / hSegs) * Math.PI * 2;
    const x0 = Math.cos(a0) * HR, z0 = Math.sin(a0) * HR;
    const x1 = Math.cos(a1) * HR, z1 = Math.sin(a1) * HR;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ang = Math.atan2(x1 - x0, z1 - z0);
    // deck
    M.add(boxGeo(hw, 0.9, len * 1.06, [1, 1, 1], mat({ pos: [cx, hY, cz], rot: [0, ang, 0] })), mRoad);
    // guard rails
    for (const s of [-1, 1]) {
      const ox = Math.cos(ang) * (hw / 2 - 0.4) * s;
      const oz = -Math.sin(ang) * (hw / 2 - 0.4) * s;
      M.add(boxGeo(0.4, 1.1, len * 1.06, [0.8, 0.8, 0.82], mat({ pos: [cx + ox, hY + 0.95, cz + oz], rot: [0, ang, 0] })), mMetal);
    }
    // centre dashes
    if (i % 2 === 0) M.add(boxGeo(0.5, 0.12, len * 0.6, [1, 1, 1], mat({ pos: [cx, hY + 0.5, cz], rot: [0, ang, 0] })), mLine);
    // support pillars
    if (i % 2 === 0) {
      M.add(cylinderGeo(1.5, 1.9, hY, 8, [0.5, 0.5, 0.5], mat({ pos: [cx, hY / 2, cz] })), mConcrete);
      COLLIDERS.push({ x: +cx.toFixed(1), z: +cz.toFixed(1), w: 1.9, d: 1.9, h: hY, t: 'building' });
    }
  }
  // on/off ramps toward downtown
  for (const [a, dir] of [[0.35, 1], [Math.PI + 0.35, -1], [Math.PI / 2 + 0.2, 1], [-Math.PI / 2 - 0.2, -1]]) {
    const sx = Math.cos(a) * HR;
    const sz = Math.sin(a) * HR;
    for (let i = 0; i < 10; i++) {
      const t = i / 9;
      const x = sx - Math.cos(a) * dist(t) * dir;
      const z = sz - Math.sin(a) * dist(t) * dir;
      const y = hY * (1 - t);
      M.add(boxGeo(hw, 0.7, 12, [1, 1, 1], mat({ pos: [x, y, z], rot: [0, -a - dir * 0.18, 0] })), mRoad);
      if (i % 3 === 0) M.add(cylinderGeo(1.0, 1.2, Math.max(0.4, y), 6, [0.6, 0.6, 0.58], mat({ pos: [x, y / 2, z] })), mConcrete);
    }
  }
  function dist(t) {
    return t * 150;
  }

  // ================================================================ airport
  M.addNode('airport');
  const apX = GRID * 2.5 + 55;
  const apZ = GRID * 2.6 + 55;
  // runway
  M.add(boxGeo(70, 0.24, 420, [0.24, 0.25, 0.26], mat({ pos: [apX, 0.26, apZ] })), mAirfield);
  // runway markings
  for (let i = -8; i <= 8; i++) {
    M.add(boxGeo(1.6, 0.06, 16, [1, 1, 1], mat({ pos: [apX, 0.4, apZ + i * 24] })), mLine);
  }
  for (const s of [-1, 1]) {
    M.add(boxGeo(1.2, 0.06, 380, [1, 1, 1], mat({ pos: [apX + s * 31, 0.4, apZ] })), mLine);
  }
  // taxiway + apron
  M.add(boxGeo(120, 0.22, 44, [0.3, 0.31, 0.32], mat({ pos: [apX - 95, 0.25, apZ - 130] })), mAirfield);
  M.add(boxGeo(150, 0.2, 120, [0.32, 0.33, 0.34], mat({ pos: [apX - 120, 0.25, apZ - 240] })), mAirfield);
  // terminal
  M.add(boxGeo(70, 16, 46, [0.84, 0.85, 0.87], mat({ pos: [apX - 150, 8, apZ - 190] })), mFacade);
  M.add(boxGeo(72, 5, 48, [0.2, 0.3, 0.4], mat({ pos: [apX - 150, 9, apZ - 190] })), mWindows);
  M.add(boxGeo(76, 0.8, 52, [0.75, 0.77, 0.8], mat({ pos: [apX - 150, 16.4, apZ - 190] })), mRoof);
  COLLIDERS.push({ x: apX - 150, z: apZ - 190, w: 35, d: 23, h: 16, t: 'building' });
  // control tower
  M.add(cylinderGeo(3.2, 4.2, 34, 10, [0.86, 0.86, 0.88], mat({ pos: [apX - 60, 17, apZ - 150] })), mFacade);
  M.add(cylinderGeo(7.4, 6.4, 7, 10, [0.25, 0.4, 0.5], mat({ pos: [apX - 60, 37, apZ - 150] })), mWindows);
  M.add(cylinderGeo(7.8, 7.8, 1.2, 10, [0.75, 0.76, 0.78], mat({ pos: [apX - 60, 40.8, apZ - 150] })), mRoof);
  COLLIDERS.push({ x: apX - 60, z: apZ - 150, w: 4.2, d: 4.2, h: 34, t: 'building' });
  // hangars
  for (let i = 0; i < 2; i++) {
    const hx = apX - 210 - i * 62;
    M.add(cylinderGeo(22, 22, 52, 12, [0.6, 0.62, 0.65], mat({ pos: [hx, 4, apZ - 300], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.5] }), false), mMetal);
    M.add(boxGeo(46, 22, 4, [0.2, 0.22, 0.25], mat({ pos: [hx, 11, apZ - 275] })), mWindows);
  }
  // helipad on the beachfront + one downtown rooftop pad
  const heliPads = [
    [apX - 100, 0.5, apZ + 30, 0],
    [-GRID * 4 - 10, 0.4, GRID * 1.2, 0],
    [-GRID * 4 - 10, 0.4, -GRID * 1.2, 0],
  ];
  M.addNode('helipads');
  for (const [hx, hy, hz] of heliPads) {
    M.add(cylinderGeo(11, 11, 0.5, 16, [0.28, 0.29, 0.3], mat({ pos: [hx, hy, hz] })), mRoad);
    M.add(cylinderGeo(10.2, 10.2, 0.52, 16, [0.95, 0.9, 0.3], mat({ pos: [hx, hy + 0.01, hz] })), mLine);
    M.add(cylinderGeo(9.2, 9.2, 0.54, 16, [0.28, 0.29, 0.3], mat({ pos: [hx, hy + 0.02, hz] })), mRoad);
    M.add(boxGeo(1.2, 0.1, 9, [1, 1, 1], mat({ pos: [hx, hy + 0.06, hz] })), mLine);
    M.add(boxGeo(1.2, 0.1, 9, [1, 1, 1], mat({ pos: [hx + 6, hy + 0.06, hz] })), mLine);
    M.add(boxGeo(1.2, 0.1, 9, [1, 1, 1], mat({ pos: [hx - 6, hy + 0.06, hz] })), mLine);
    M.add(boxGeo(12, 0.1, 1.2, [1, 1, 1], mat({ pos: [hx, hy + 0.06, hz] })), mLine);
  }

  // ================================================================ street furniture
  M.addNode('props');
  for (let i = -CITY; i <= CITY; i++) {
    for (let j = -CITY; j <= CITY; j++) {
      if (i % 2 !== 0 || j % 2 !== 0) continue;
      const px = i * GRID + ROAD / 2 + 2;
      const pz = j * GRID + ROAD / 2 + 2;
      chunkAt(px, pz, 'prop');
      // street light
      M.add(cylinderGeo(0.16, 0.22, 7.2, 5, [0.42, 0.44, 0.46], mat({ pos: [px, 3.6, pz] })), mMetal);
      M.add(boxGeo(2.6, 0.16, 0.16, [0.42, 0.44, 0.46], mat({ pos: [px + 1.2, 7.2, pz] })), mMetal);
      M.add(boxGeo(1.0, 0.18, 0.5, [0.9, 0.9, 0.8], mat({ pos: [px + 2.4, 7.05, pz] })), mLine);
      // traffic light at the corner
      if (i !== j) {
        M.add(boxGeo(0.3, 3.4, 0.3, [0.2, 0.21, 0.23], mat({ pos: [px - 1, 1.7, pz - 1] })), mMetal);
        M.add(boxGeo(0.34, 0.9, 0.34, [0.15, 0.16, 0.17], mat({ pos: [px - 1, 4.2, pz - 1] })), mMetal);
        M.add(sphereGeo(0.11, 6, 4, [1, 0.2, 0.15], mat({ pos: [px - 1, 4.5, pz - 1.2] })), mNeon);
      }
    }
  }
  // billboards along the highway
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const bx = Math.cos(a) * (HR + 34);
    const bz = Math.sin(a) * (HR + 34);
    const col = NEON[i % NEON.length];
    M.add(cylinderGeo(0.5, 0.6, 15, 6, [0.3, 0.31, 0.33], mat({ pos: [bx, 7.5, bz] })), mMetal);
    M.add(boxGeo(16, 8, 0.6, col, mat({ pos: [bx, 18, bz], rot: [0, -a + Math.PI / 2, 0] })), mNeon);
    M.add(boxGeo(17, 0.5, 0.9, [0.2, 0.2, 0.22], mat({ pos: [bx, 22.2, bz], rot: [0, -a + Math.PI / 2, 0] })), mMetal);
  }
  // downtown pier ferris wheel (landmark)
  const fw = { x: -GRID * 4 + 40, z: -GRID * 3 - 40 };
  M.addNode('ferris');
  for (const s of [-1, 1]) {
    M.add(boxGeo(0.9, 30, 0.9, [0.75, 0.76, 0.78], mat({ pos: [fw.x + s * 6, 15, fw.z + s * 3], rot: [0.3 * s, 0, 0.1 * s] })), mMetal);
  }
  M.add(cylinderGeo(17, 17, 1.4, 20, [0.9, 0.35, 0.5], mat({ pos: [fw.x, 31, fw.z], rot: [Math.PI / 2, 0, 0] }), false), mNeon);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    M.add(boxGeo(3.2, 2.6, 4.0, NEON[i % NEON.length], mat({ pos: [fw.x + Math.cos(a) * 15.5, 31 + Math.sin(a) * 15.5, fw.z] })), mNeon);
    M.add(boxGeo(0.3, 15.5, 0.3, [0.8, 0.8, 0.82], mat({ pos: [fw.x + Math.cos(a) * 7.75, 31 + Math.sin(a) * 7.75, fw.z], rot: [0, 0, a] })), mMetal);
  }
  COLLIDERS.push({ x: fw.x, z: fw.z, w: 8, d: 8, h: 30, t: 'building' });

  return M;
}

function addPalm(M, x, z, scale, mTrunk, mLeaf, chunkName) {
  const h = 7.5 * scale;
  if (chunkName) M.use(chunkName);
  else M.addNode(`${Math.round(x / 220)}_palm_${Math.round(z / 220)}`);
  // slightly leaning trunk made of 3 tapered segments
  M.add(cylinderGeo(0.22 * scale, 0.34 * scale, h * 0.5, 5, [0.36, 0.26, 0.16], mat({ pos: [0, h * 0.25, 0], rot: [0.04, 0, 0.05] })), mTrunk);
  M.add(cylinderGeo(0.16 * scale, 0.22 * scale, h * 0.55, 5, [0.4, 0.29, 0.18], mat({ pos: [0.16 * scale, h * 0.72, 0], rot: [0.05, 0, 0.1] })), mTrunk);
  const topX = 0.3 * scale;
  const topY = h;
  // coconut cluster
  M.add(sphereGeo(0.26 * scale, 5, 3, [0.28, 0.2, 0.12], mat({ pos: [topX, topY - 0.22 * scale, 0] })), mTrunk);
  // fronds
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const droop = 0.42 + (i % 3) * 0.06;
    M.add(prismGeo([
      [0, 0], [3.4 * scale, -0.9 * scale], [3.0 * scale, -1.5 * scale], [0.1 * scale, -0.5 * scale],
    ], 0.14 * scale, [0.19 + (i % 2) * 0.04, 0.42 + (i % 2) * 0.06, 0.18], mat({ pos: [topX, topY, 0], rot: [0, a, droop] })), mLeaf);
  }
  M.add(sphereGeo(0.3 * scale, 5, 3, [0.24, 0.4, 0.18], mat({ pos: [topX, topY, 0] })), mLeaf);
}

// ================================================================ stunt park
export function buildStuntPark() {
  const M = new Model('map_indian_bike_stunt');
  const mAsphalt = M.addMaterial({ name: 'asphalt', baseColor: [0.2, 0.21, 0.23, 1], roughness: 0.9 });
  const mRampA = M.addMaterial({ name: 'rampA', baseColor: [0.85, 0.3, 0.2, 1], metallic: 0.4, roughness: 0.4 });
  const mRampB = M.addMaterial({ name: 'rampB', baseColor: [0.95, 0.78, 0.2, 1], metallic: 0.4, roughness: 0.4 });
  const mRampC = M.addMaterial({ name: 'rampC', baseColor: [0.2, 0.6, 0.9, 1], metallic: 0.4, roughness: 0.4 });
  const mLine = M.addMaterial({ name: 'stuntline', baseColor: [0.95, 0.95, 0.95, 1] });
  const mMetal = M.addMaterial({ name: 'stuntmetal', baseColor: [0.45, 0.47, 0.5, 1], metallic: 0.8, roughness: 0.3 });
  const mGrass = M.addMaterial({ name: 'stuntgrass', baseColor: [0.3, 0.5, 0.24, 1], roughness: 0.95 });

  M.addNode('ground');
  M.add(boxGeo(420, 1, 420, [1, 1, 1], mat({ pos: [0, -0.5, 0] })), mGrass);
  M.add(boxGeo(320, 0.3, 320, [1, 1, 1], mat({ pos: [0, -0.2, 0] })), mAsphalt);
  // big painted loop-the-loop track outline
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    M.add(boxGeo(6, 0.12, 16, [1, 1, 1], mat({ pos: [Math.cos(a) * 140, 0.0, Math.sin(a) * 140], rot: [0, -a, 0] })), mLine);
  }

  const ramp = (x, y, z, w, h, d, rot, mi) => {
    M.add(prismGeo([[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h * 0.04]], d, [1, 1, 1], mat({ pos: [x, y, z], rot: [0, rot, 0] })), mi);
  };

  // mega jump ramps
  ramp(0, 0, 40, 26, 14, 34, 0, mRampA);
  ramp(0, 0, -40, 26, 14, 34, Math.PI, mRampB);
  // double loop track
  for (const s of [-1, 1]) {
    ramp(s * 60, 0, 0, 22, 22, 60, Math.PI / 2, mRampC);
    ramp(s * -60, 0, 0, 22, 22, 60, Math.PI / 2, mRampA);
  }
  // stacked platform staircase
  for (let i = 0; i < 7; i++) {
    M.add(boxGeo(30, 2.2, 30, [1, 1, 1], mat({ pos: [-110 + i * 24, 1.1 + i * 2.2, 110 - i * 12] })), i % 2 ? mRampB : mRampC);
  }
  // floating rings to fly through
  for (let i = 0; i < 6; i++) {
    const r = 14;
    for (let s = 0; s < 12; s++) {
      const a = (s / 12) * Math.PI * 2;
      M.add(boxGeo(2.4, 2.4, 2.4, [1, 1, 1], mat({ pos: [40 + i * 40, 26 + Math.sin(a) * r, -80 + Math.cos(a) * r] })), i % 2 ? mRampB : mRampC);
    }
  }
  // half pipes
  for (const s of [-1, 1]) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 0.5;
      M.add(boxGeo(46, 1.4, 7, [1, 1, 1], mat({ pos: [s * (130 + Math.cos(a) * 10), 2 + Math.sin(a) * 12, -140 + i * 8], rot: [0, 0, -s * a] })), mRampB);
    }
  }
  COLLIDERS.push({ x: 0, z: 40, w: 13, d: 17, h: 14, t: 'building' });
  COLLIDERS.push({ x: 0, z: -40, w: 13, d: 17, h: 14, t: 'building' });
  COLLIDERS.push({ x: 60, z: 0, w: 11, d: 30, h: 22, t: 'building' });
  COLLIDERS.push({ x: -60, z: 0, w: 11, d: 30, h: 22, t: 'building' });
  // spectator stands + flags
  for (let i = 0; i < 8; i++) {
    M.add(boxGeo(50, 3 + i * 2.4, 5, [1, 1, 1], mat({ pos: [0, 1.5 + i * 1.2, 175 + i * 5] })), mMetal);
    COLLIDERS.push({ x: 0, z: 175 + i * 5, w: 25, d: 2.5, h: 3 + i * 2.4, t: 'building' });
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    M.add(cylinderGeo(0.3, 0.4, 12, 5, [1, 1, 1], mat({ pos: [Math.cos(a) * 165, 6, Math.sin(a) * 165] })), mMetal);
    M.add(boxGeo(5, 3, 0.2, [[1, 0.4, 0.2], [1, 0.85, 0.2], [0.3, 0.8, 0.4]][i % 3], mat({ pos: [Math.cos(a) * 165 + 2.4, 11, Math.sin(a) * 165] })), mRampA);
  }
  return M;
}

export const CITY_COLLIDERS = COLLIDERS;
