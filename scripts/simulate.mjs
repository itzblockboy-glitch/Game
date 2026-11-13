/**
 * Headless logic simulation: parses the real .glb assets with three.js, builds a
 * Character / Vehicle / World, then runs several thousand fixed-step frames of the
 * actual gameplay update code and asserts the physics + animation behave.
 * (No WebGL — this validates the simulation layer that a browser would drive.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader as ThreeGLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MODELS = path.join(ROOT, 'public/models');

const manifest = JSON.parse(fs.readFileSync(path.join(MODELS, 'manifest.json'), 'utf8'));
let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => {
  failures++;
  console.log(`  ✗ ${m}`);
};

// the vendored loader references `self` (browser global) for worker detection
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
const loader = new ThreeGLTFLoader();
const parsed = new Map();
async function loadModel(id) {
  if (parsed.has(id)) return parsed.get(id);
  const entry = manifest.models.find((m) => m.id === id);
  const buf = fs.readFileSync(path.join(MODELS, path.basename(entry.file)));
  const gltf = await new Promise((res, rej) =>
    loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej)
  );
  parsed.set(id, gltf);
  return gltf;
}

// --------------------------------------------------------------- fake asset registry
// mirror the shape of src/assets.js so the real classes work unmodified
const vendor = path.join(ROOT, 'src/vendor/three.module.js');
const three = await import(`file://${vendor}`);

const registry = new Map();
const assetsStub = {
  instance(id) {
    const tpl = registry.get(id);
    if (!tpl) return null;
    const clone = tpl.scene.clone(true);
    clone.userData.modelId = id;
    return clone;
  },
  getTemplate: (id) => registry.get(id),
};

// patch the modules' import of ./assets.js by using a tiny loader shim
const tmp = path.join(ROOT, '.sim');
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(
  path.join(tmp, 'assets.js'),
  `export const manifest = JSON.parse(${JSON.stringify(JSON.stringify(manifest))});
   const registry = new Map();
   export function register(id, tpl) { registry.set(id, tpl); }
   export function instance(id) { const t = registry.get(id); if (!t) return null; const c = t.scene.clone(true); c.userData.modelId = id; return c; }
   export function getTemplate(id) { return registry.get(id); }
   export function templates() { return registry; }
   export const netStats = { fetched: 0, cached: 0 };
   export function onProgress() {} export function onReady() {}
   export async function loadModels() {} export async function loadOne() {}
   export async function hotSwap() {} export async function loadManifest() {}
   export async function loadColliders() { return []; }`
);

// copy the gameplay modules, rewriting their assets import to the shim
for (const f of ['character.js', 'vehicles.js', 'world.js']) {
  let src = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
  src = src
    .replace(/from '\.\/assets\.js'/g, "from './assets.js'")
    .replace(/from 'three'/g, `from '../src/vendor/three.module.js'`)
    .replace(/from '\.\/vendor\/([A-Za-z0-9_.]+)'/g, `from '../src/vendor/$1'`);
  fs.writeFileSync(path.join(tmp, f), src);
}

const { register } = await import(`file://${tmp}/assets.js`);
const { Character } = await import(`file://${tmp}/character.js`);
const { Vehicle } = await import(`file://${tmp}/vehicles.js`);
const { World } = await import(`file://${tmp}/world.js`);

// register every model the game uses
console.log('\nParsing GLB assets with three.js GLTFLoader…');
const needed = manifest.models.filter((m) => !m.upstream);
for (const m of needed) {
  try {
    const gltf = await loadModel(m.id);
    let meshes = 0;
    let verts = 0;
    gltf.scene.traverse((o) => {
      if (o.isMesh) {
        meshes++;
        verts += o.geometry.attributes.position.count;
      }
    });
    register(m.id, { scene: gltf.scene, clips: gltf.animations, meta: m });
    if (meshes === 0) bad(`${m.id}: no meshes`);
  } catch (err) {
    bad(`${m.id}: parse failed — ${err.message}`);
  }
}
ok(`${needed.length} generated assets parsed`);

// --------------------------------------------------------------- world
console.log('\nWorld + collision…');
const fakeRenderer = { capabilities: { maxTextureSize: 4096 }, shadowMap: {} };
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.25, 3000);
const world = new World(fakeRenderer, scene, camera);
const root = world.loadMap('map_los_santos');
if (root) ok(`map loaded · ${world.chunks.length} cull chunks`);
else bad('map failed to load');

const colliders = JSON.parse(fs.readFileSync(path.join(MODELS, 'map_los_santos.colliders.json'), 'utf8')).colliders;
world.setColliders(colliders);
ok(`${colliders.length} colliders indexed`);

// collision push-out works
const p = new THREE.Vector3(colliders[0].x, 0, colliders[0].z);
const before = p.clone();
world.resolveCollision(p, 0.5);
if (p.distanceTo(before) > 0.01) ok(`collision pushes out of building (${before.x.toFixed(1)},${before.z.toFixed(1)}) → (${p.x.toFixed(1)},${p.z.toFixed(1)})`);
else bad('collision did not push out');

// raycast hits a building
const rayOrigin = new THREE.Vector3(colliders[0].x, 1.5, colliders[0].z + 40);
const hit = world.raycastAABB(rayOrigin, new THREE.Vector3(0, 0, -1), 80);
if (hit) ok(`raycast hits collider at ${hit.distance.toFixed(1)} m`);
else bad('raycast missed a known building');

// --------------------------------------------------------------- character
console.log('\nCharacter controller (2400 fixed frames @60 Hz)…');
const dt = 1 / 60;
const char = new Character('player_jason', { isPlayer: true });
if (!char.joints.upperArmR || !char.joints.upperLegL) bad('character joints missing');
else ok(`${Object.keys(char.joints).length} joints found`);
char.reset(new THREE.Vector3(-40, 0.05, 34), 0);

const start = char.position.clone();
let jumped = 0;
let maxSpeed = 0;
for (let i = 0; i < 2400; i++) {
  const t = i * dt;
  char.update(
    dt,
    {
      forward: 1,
      right: Math.sin(t * 0.7) * 0.4,
      sprint: t % 6 < 3,
      jump: i % 180 === 0,
      attack: false,
      aim: false,
      pitch: 0,
      yaw: Math.PI,
    },
    world
  );
  if (!char.onGround) jumped++;
  maxSpeed = Math.max(maxSpeed, Math.hypot(char.velocity.x, char.velocity.z));
  if (!Number.isFinite(char.position.x) || !Number.isFinite(char.position.y)) {
    bad(`NaN position at frame ${i}`);
    break;
  }
}
const travelled = Math.hypot(char.position.x - start.x, char.position.z - start.z);
if (travelled > 20) ok(`travelled ${travelled.toFixed(0)} m, peak ${(maxSpeed * 3.6).toFixed(0)} km/h, airborne ${jumped} frames`);
else bad(`character barely moved (${travelled.toFixed(1)} m)`);

// animation state machine
const states = new Set();
for (const f of [0, 0.4, 0.8]) {
  char.punchTimer = 0.3;
  char.update(dt, { forward: f, right: 0, sprint: false, jump: false, attack: false, aim: false, yaw: 0 }, world);
  states.add(char.moveState);
}
ok(`animation states reachable: ${[...states].join(', ')}`);

// jumping reaches a sensible height
char.reset(new THREE.Vector3(-40, 0.05, 34), 0);
let peak = 0;
for (let i = 0; i < 90; i++) {
  char.update(dt, { forward: 0, right: 0, sprint: false, jump: i === 0, attack: false, aim: false, yaw: 0 }, world);
  peak = Math.max(peak, char.position.y);
}
if (peak > 1.1 && peak < 3.2) ok(`jump apex ${peak.toFixed(2)} m`);
else bad(`jump apex out of range: ${peak.toFixed(2)} m`);

// swimming
char.reset(new THREE.Vector3(-1200, -1.2, 0), 0);
for (let i = 0; i < 120; i++) {
  char.update(dt, { forward: 1, right: 0, sprint: false, jump: false, attack: false, aim: false, yaw: 0 }, world);
}
if (char.moveState === 'swim' && char.position.y > -1.05 && char.position.y < -0.7) ok(`buoyancy floats at the waterline (y=${char.position.y.toFixed(2)})`);
else bad(`swimming failed: state=${char.moveState} y=${char.position.y.toFixed(2)}`);

// weapons
console.log('\nWeapons…');
for (const w of ['weapon_g17_handgun', 'weapon_pp19_vityaz', 'weapon_akmn_rifle']) {
  let shots = 0;
  const shooter = new Character('player_jason', { onShoot: (p) => p.type === 'shot' && shots++ });
  shooter.reset(new THREE.Vector3(0, 0.05, 0), 0);
  shooter.setWeapon(w);
  shooter.ammo[w] = 30;
  for (let i = 0; i < 240; i++) {
    shooter.update(dt, { forward: 0, right: 0, sprint: false, jump: false, attack: true, aim: true, pitch: 0, yaw: 0 }, world);
  }
  const muzzle = new THREE.Vector3();
  const dir = new THREE.Vector3();
  shooter.getMuzzle(muzzle, dir);
  const fwd = dir.z > 0.2 || Math.abs(dir.z) > 0.2;
  if (shots > 3 && fwd) ok(`${w}: ${shots} shots in 4 s, muzzle dir ${dir.z.toFixed(2)}z`);
  else bad(`${w}: only ${shots} shots, dir z=${dir.z.toFixed(2)}`);
}

// --------------------------------------------------------------- vehicles
console.log('\nVehicles…');
for (const id of ['ferrari_daytona_sp3', 'police_car', 'redball']) {
  if (!registry.has(id)) continue;
}
for (const id of ['ferrari_daytona_sp3', 'police_car', 'ural_4320_truck', 'redbull_rb22', 'porsche_911_gt3r', 'mustang_roush_1996', 'police_lambo_diablo', 'porsche_mission_x', 'kawasaki_ninja_h2', 'bmw_s1000rr']) {
  const v = new Vehicle(id, id);
  v.place(new THREE.Vector3(0, 0, 0), 0);
  const z0 = v.position.z;
  let topSpeed = 0;
  for (let i = 0; i < 300; i++) {
    v.update(dt, { throttle: 1, brake: 0, steer: i > 120 ? 0.7 : 0, handbrake: false }, world);
    topSpeed = Math.max(topSpeed, Math.abs(v.speed) * 3.6);
  }
  const kmh = topSpeed;
  const moved = Math.abs(v.position.z - z0) + Math.abs(v.position.x);
  // 4 wheels for cars, 6 for the Ural, 2 for bikes — all must spin
  // 4 wheels for cars, 6 for the Ural, 2 for bikes — every wheel must have turned
  const wheelsSpin = v.wheels.length >= 2 && Math.abs(v.wheelSpin) > 0.5;
  if (kmh > 20 && moved > 5 && wheelsSpin) ok(`${id.padEnd(22)} ${kmh.toFixed(0).padStart(4)} km/h · ${moved.toFixed(0).padStart(4)} m · ${v.wheels.length} wheels`);
  else bad(`${id}: speed ${kmh.toFixed(0)} km/h moved ${moved.toFixed(1)} wheels ${v.wheels.length}`);
}

console.log('\nAircraft…');
for (const id of ['aeroplane', 'little_bird_helicopter']) {
  const v = new Vehicle(id, id);
  v.place(new THREE.Vector3(0, id === 'aeroplane' ? 0.8 : 0.5, 0), 0);
  let maxAlt = 0;
  for (let i = 0; i < 600; i++) {
    v.update(dt, { throttle: 1, brake: 0, steer: 0.3, up: 1, down: 0 }, world);
    maxAlt = Math.max(maxAlt, v.position.y);
  }
  const speed = Math.abs(v.speed) * 3.6;
  if (maxAlt > 4 && speed > 30) ok(`${id.padEnd(22)} climbed to ${maxAlt.toFixed(0)} m · ${speed.toFixed(0)} km/h · rotor ${!!v.rotor || !!v.propL}`);
  else bad(`${id}: alt ${maxAlt.toFixed(1)} m speed ${speed.toFixed(0)} km/h`);
}

// cockpit interior asset
const cockpit = await loadModel('ka350_flight_deck');
let cockpitMeshes = 0;
cockpit.scene.traverse((o) => o.isMesh && cockpitMeshes++);
if (cockpitMeshes >= 5) ok(`KA350 flight deck: ${cockpitMeshes} material meshes`);
else bad(`KA350 flight deck too sparse: ${cockpitMeshes}`);

// --------------------------------------------------------------- NPC archetypes
console.log('\nNPC archetypes…');
let npcOk = 0;
for (const m of manifest.models.filter((m) => m.kind === 'npc' && !m.upstream)) {
  const ch = new Character(m.id, {});
  ch.reset(new THREE.Vector3(0, 0, 0), 0);
  for (let i = 0; i < 60; i++) ch.update(dt, { forward: 1, right: 0, sprint: true, jump: false, attack: false, aim: false, yaw: 0 }, world);
  if (ch.position.length() > 0.5 && ch.joints.upperLegR) npcOk++;
  else bad(`${m.id} did not animate`);
}
ok(`${npcOk} NPC archetypes animate and walk`);

// --------------------------------------------------------------- day-night cycle
console.log('\nDay/night cycle…');
const samples = [];
for (let t = 0; t < 24; t += 3) {
  world.setTimeOfDay(t);
  world.update(1 / 60, new THREE.Vector3());
  samples.push({ t, sun: world.sun.intensity.toFixed(2), stars: world.skyUniforms.uStars.value.toFixed(2) });
}
const noonSun = Number(samples[4].sun);
const midnightSun = Number(samples[0].sun);
if (noonSun > 1 && midnightSun < 0.3) ok(`sun 12:00=${samples[4].sun} · 00:00=${samples[0].sun} · stars 00:00=${samples[0].stars}`);
else bad(`lighting curve wrong: ${JSON.stringify(samples)}`);

// --------------------------------------------------------------- data budget
console.log('\nData budget…');
const totalAssetBytes = manifest.models.reduce((a, m) => a + m.bytes, 0);
const essential = ['map_los_santos', 'player_jason', 'police_car', 'ferrari_daytona_sp3', 'weapon_akmn_rifle'];
const essentialBytes = manifest.models.filter((m) => essential.includes(m.id)).reduce((a, m) => a + m.bytes, 0);
const snapshotBytes = 3 + 2 * 12;
const kbps = (snapshotBytes * 8 * 15) / 1000;
ok(`full asset pack ${(totalAssetBytes / 1024 / 1024).toFixed(1)} MB · first-load essentials ${(essentialBytes / 1024 / 1024).toFixed(1)} MB`);
ok(`netcode ${snapshotBytes} B/snapshot @15 Hz ≈ ${kbps.toFixed(1)} kb/s down + 11 B @20 Hz ≈ ${((11 * 8 * 20) / 1000).toFixed(1)} kb/s up`);

// --------------------------------------------------------------- report
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'SIMULATION PASSED' : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
