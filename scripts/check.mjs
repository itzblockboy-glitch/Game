/**
 * Static + structural verification that does not need a browser:
 *  • every module in src/ parses and its relative imports resolve
 *  • the esbuild bundle links cleanly
 *  • every .glb in public/models is a spec-valid glTF 2.0 binary
 *  • the manifest, colliders and Sketchfab mapping cover all 28 references
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import validator from 'gltf-validator';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => {
  failures++;
  console.log(`  ✗ ${m}`);
};

// ---------------------------------------------------------------- 1. bundling
console.log('\nBundling client…');
try {
  const r = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/main.js')],
    bundle: true,
    write: false,
    format: 'esm',
    target: 'es2020',
    logLevel: 'silent',
    metafile: true,
  });
  const mods = Object.keys(r.metafile.inputs);
  ok(`${mods.length} modules linked (${(r.outputFiles[0].contents.length / 1024).toFixed(0)} KB)`);
} catch (err) {
  bad(`bundle failed: ${err.message.split('\n')[0]}`);
}

// ---------------------------------------------------------------- 2. glTF validity
console.log('\nValidating GLB assets…');
const MODELS = path.join(ROOT, 'public/models');
const files = fs.readdirSync(MODELS).filter((f) => f.endsWith('.glb'));
let totalBytes = 0;
const perFile = [];
for (const f of files) {
  const bytes = fs.readFileSync(path.join(MODELS, f));
  totalBytes += bytes.length;
  perFile.push([f, bytes.length]);
  if (bytes[0] !== 0x67 || bytes[1] !== 0x6c || bytes[2] !== 0x54 || bytes[3] !== 0x46) {
    bad(`${f}: bad GLB magic`);
    continue;
  }
  try {
    const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 5 });
    if (report.issues.numErrors > 0) {
      bad(`${f}: ${report.issues.numErrors} validation errors → ${report.issues.messages[0]?.message}`);
    }
  } catch (err) {
    bad(`${f}: validator crash ${err.message}`);
  }
}
if (!failures) ok(`${files.length} GLB files valid · ${(totalBytes / 1024 / 1024).toFixed(2)} MB total`);

// ---------------------------------------------------------------- 3. manifest
console.log('\nChecking asset manifest…');
const manifest = JSON.parse(fs.readFileSync(path.join(MODELS, 'manifest.json'), 'utf8'));
const byId = new Map(manifest.models.map((m) => [m.id, m]));
const REQUIRED = {
  maps: ['map_los_santos', 'map_indian_bike_stunt'],
  players: ['player_jason', 'player_lucia'],
  weapons: ['weapon_g17_handgun', 'weapon_pp19_vityaz', 'weapon_akmn_rifle'],
  vehicles: ['police_car', 'ferrari_daytona_sp3', 'porsche_mission_x', 'porsche_911_gt3r', 'mustang_roush_1996', 'police_lambo_diablo', 'redbull_rb22', 'ural_4320_truck'],
  aircraft: ['aeroplane', 'ka350_flight_deck', 'little_bird_helicopter'],
  npcs: [
    'npc_woman_pose_v13', 'npc_mai_shiranui', 'npc_woman_standing_v33', 'npc_woman_ballet',
    'npc_woman_standing_v12', 'npc_female_cowgirl', 'npc_office_worker_male', 'npc_psx_male_1',
    'npc_male_suit', 'npc_male_ps1', 'npc_cartoon_male_2',
  ],
};
for (const [kind, ids] of Object.entries(REQUIRED)) {
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) bad(`${kind}: missing ${missing.join(', ')}`);
  else ok(`${kind}: ${ids.length} assets`);
}
const sketchfab = manifest.models.filter((m) => m.sketchfab).length;
if (sketchfab >= 28) ok(`${sketchfab} Sketchfab references mapped to generated GLBs`);
else bad(`only ${sketchfab} Sketchfab references mapped (expected 28)`);

// runtime ids referenced from client code must exist
const src = ['main.js', 'character.js', 'vehicles.js', 'world.js'].map((f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n');
const usedIds = new Set([...src.matchAll(/'((?:npc_|weapon_|player_|map_|police_|ferrari_|porsche_|mustang_|w_police_|redbull_|ural_|aeroplane|little_bird_)[a-z0-9_]+)'/g)].map((m) => m[1]));
const unknown = [...usedIds].filter((id) => !byId.has(id));
if (unknown.length) bad(`client references unknown model ids: ${unknown.join(', ')}`);
else ok(`${usedIds.size} model ids referenced by the client all exist`);

// ---------------------------------------------------------------- 4. colliders
console.log('\nChecking world colliders…');
const cols = JSON.parse(fs.readFileSync(path.join(MODELS, 'map_los_santos.colliders.json'), 'utf8')).colliders;
if (cols.length > 100) ok(`${cols.length} static AABB colliders exported`);
else bad(`only ${cols.length} colliders`);

// ---------------------------------------------------------------- 5. server syntax
console.log('\nChecking server…');
try {
  await esbuild.build({ entryPoints: [path.join(ROOT, 'server.js')], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent', external: ['express', 'compression', 'ws', 'node:*'] });
  ok('server.js parses');
} catch (err) {
  bad(`server.js: ${err.message.split('\n')[0]}`);
}

// ---------------------------------------------------------------- 6. regressions
// These three bug classes have already shipped once and been silently
// reintroduced. Assert them here so a revival fails the build instead of
// reaching the user's phone.
console.log('\nChecking regression guards…');

// (a) Draco decoder URLs must not be derived from import.meta — esbuild lowers
//     import.meta to {} for es2019, which throws "TypeError: Invalid URL" at
//     module scope and takes the whole app down before any UI paints.
{
  const draco = fs.readFileSync(path.join(ROOT, 'src/vendor/DRACOLoader.js'), 'utf8');
  if (/new URL\([^)]*import\.meta\.url/.test(draco)) {
    bad('DRACOLoader derives a URL from import.meta (crashes with "Invalid URL" on device)');
  } else ok('DRACOLoader has no import.meta URL (1.0.2 crash cannot return)');
}

// The sync-vendor patch must survive because postinstall overwrites src/vendor.
{
  const sync = fs.readFileSync(path.join(ROOT, 'scripts/sync-vendor.mjs'), 'utf8');
  if (/dst === 'DRACOLoader\.js'/.test(sync)) ok('sync-vendor re-applies the Draco patch on postinstall');
  else bad('sync-vendor would overwrite the Draco patch on next npm install');
}

// (b) The player rig is procedural, so the gait must be a real two-phase stride
//     rather than one sine wave shared by both legs.
{
  const ch = fs.readFileSync(path.join(ROOT, 'src/character.js'), 'utf8');
  const twoPhase = /const kneeL = Math\.max\(0, -cosp\)/.test(ch)
    && /const kneeR = Math\.max\(0, cosp\)/.test(ch);
  if (twoPhase) ok('character gait uses out-of-phase knee flexion');
  else bad('character gait regressed to a single-sine pendulum');
}

// (c) Vehicle handling: the old model re-lerped velocity onto the heading every
//     frame, which made every car drift permanently.
{
  const ve = fs.readFileSync(path.join(ROOT, 'src/vehicles.js'), 'utf8');
  // strip comments first: the explanatory note above the tyre model mentions the
  // old `velocity.lerp` call and would otherwise trip this guard.
  const veCode = ve.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  if (/velocity\.lerp\(/.test(veCode)) bad('vehicle velocity is still lerped onto the heading (permanent drift)');
  else ok('vehicle velocity is not force-lerped (no permanent drift)');
  if (/gripFactor/.test(ve) && /maxGripStep/.test(ve)) ok('tyre grip saturates with slip');
  else bad('tyre grip saturation removed');
}

// (d) Render resolution: performance tier used to cap DPR at 0.75 and cinematic
//     at 1.35, making every preset look soft on a high-DPI phone.
{
  const mn = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
  const cin = mn.match(/name: 'Cinematic'[^}]*dpr: ([\d.]+)/);
  if (cin && Number(cin[1]) >= 2) ok(`cinematic renders at up to ${cin[1]}x DPR`);
  else bad('cinematic DPR cap is too low (game looks soft on high-DPI phones)');
}

// (e) The mod menu must be bundled and reachable.
{
  const mn = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
  if (/from '\.\/modmenu\.js'/.test(mn) && /new ModMenu\(/.test(mn)) ok('mod menu is imported and constructed');
  else bad('mod menu is not wired into main.js');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  if (/id="btn-mod"/.test(html)) ok('mod menu has a HUD entry point');
  else bad('mod menu button missing from index.html');
}

// (f) Land textures must have filtering configured, or the city aliases badly.
{
  const as = fs.readFileSync(path.join(ROOT, 'src/assets.js'), 'utf8');
  if (/generateMipmaps = true/.test(as) && /LinearMipmapLinearFilter/.test(as) && /anisotropy/.test(as)) {
    ok('textures get mipmaps + anisotropy');
  } else bad('texture filtering is not configured (aliasing / shimmer)');
  const mn = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
  if (/setRenderer\(renderer\)/.test(mn)) ok('renderer is registered with the asset layer');
  else bad('setRenderer() never called — anisotropy silently falls back');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
