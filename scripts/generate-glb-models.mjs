/**
 * Asset Foundry: generates every .glb the game needs.
 *
 * All 28 Sketchfab references supplied by the user are mapped to a generated,
 * spec-compliant binary glTF 2.0 asset (flat-shaded, vertex-coloured, no textures)
 * plus the runtime manifest. The in-game Asset Hub can hot-swap any of these with a
 * real Sketchfab download at runtime, but the shipped game needs zero external CDNs.
 *
 *   npm run assets
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeGLB, buildGLB } from './lib/glb.mjs';
import { buildCharacter } from './lib/characters.mjs';
import { buildCity, buildStuntPark, COLLIDERS } from './lib/world.mjs';
import {
  buildSportsCar,
  buildPoliceCar,
  buildLamborghiniPolice,
  buildFerrari,
  buildMustang,
  buildPorsche911,
  buildMissionX,
  buildF1,
  buildUralTruck,
  buildAirplane,
  buildKingAirDeck,
  buildHelicopter,
  buildHandgun,
  buildSMG,
  buildRifle,
} from './lib/vehicles.mjs';
import {
  buildFerrari as buildFerrariHD,
  buildMissionX as buildMissionXHD,
  buildPorsche911 as buildPorsche911HD,
  buildMustang as buildMustangHD,
  buildPoliceCar as buildPoliceCarHD,
  buildLamborghiniPolice as buildLamborghiniPoliceHD,
  buildF1 as buildF1HD,
  buildUralTruck as buildUralTruckHD,
  buildSportBike,
} from './lib/vehicles2.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../public/models');
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// 28 Sketchfab references from the user
// ---------------------------------------------------------------------------
const SKETCHFAB = {
  aeroplane: 'https://skfb.ly/pPHRF',
  police_car: 'https://skfb.ly/pONP7',
  ural_4320_truck: 'https://skfb.ly/pPRBQ',
  ka350_flight_deck: 'https://skfb.ly/pPpVS',
  ferrari_daytona_sp3: 'https://skfb.ly/pPznn',
  redbull_rb22: 'https://skfb.ly/pOvxI',
  mustang_roush_1996: 'https://skfb.ly/pPwvM',
  police_lambo_diablo: 'https://skfb.ly/pPxRQ',
  porsche_911_gt3r: 'https://skfb.ly/pPEQ6',
  little_bird_helicopter: 'https://skfb.ly/pPDEE',
  porsche_mission_x: 'https://skfb.ly/pPE7K',
  weapon_g17_handgun: 'https://skfb.ly/pOAnq',
  weapon_pp19_vityaz: 'https://skfb.ly/pPMDw',
  weapon_akmn_rifle: 'https://skfb.ly/pOJzF',
  npc_woman_pose_v13: 'https://skfb.ly/pPFxM',
  npc_mai_shiranui: 'https://skfb.ly/pN79q',
  npc_woman_standing_v33: 'https://skfb.ly/pNHZp',
  npc_woman_ballet: 'https://skfb.ly/pOSEA',
  npc_woman_standing_v12: 'https://skfb.ly/pO8FT',
  npc_female_cowgirl: 'https://skfb.ly/pOnQA',
  npc_office_worker_male: 'https://skfb.ly/oKUMr',
  npc_psx_male_1: 'https://skfb.ly/pruMw',
  npc_male_suit: 'https://skfb.ly/pzrBP',
  npc_male_ps1: 'https://skfb.ly/o7JPX',
  npc_cartoon_male_2: 'https://skfb.ly/p9LxB',
  player_jason: 'https://skfb.ly/pLoCM',
  player_lucia: 'https://skfb.ly/pzB9n',
  map_los_santos: 'https://skfb.ly/oXqAw',
};

const TITLES = {
  aeroplane: 'Aeroplane',
  police_car: 'Police car',
  ural_4320_truck: 'URAL-4320 (soviet-army truck)',
  ka350_flight_deck: 'KA350 King Air Flight Deck',
  ferrari_daytona_sp3: 'Ferrari Daytona SP3',
  redbull_rb22: '2026 Redbull RB22',
  mustang_roush_1996: '1996 Jack Roush Edition Ford Mustang',
  police_lambo_diablo: '1995 Lamborghini Diablo SV - Police',
  porsche_911_gt3r: 'Porsche 911 GT3 R Rennsport',
  little_bird_helicopter: 'MH-6 Little Bird [Low Poly]',
  porsche_mission_x: '2023 Porsche Mission X Concept',
  weapon_g17_handgun: 'G17 Gen 5 Handgun + Olight - NSW',
  weapon_pp19_vityaz: 'PP-19-01 Vityaz SMG',
  weapon_akmn_rifle: 'AKMN Assault Rifle',
  npc_woman_pose_v13: 'Woman Pose V13',
  npc_mai_shiranui: 'Mai Shiranui | Street Fighter',
  npc_woman_standing_v33: 'Woman Standing V33',
  npc_woman_ballet: 'Woman Ballet',
  npc_woman_standing_v12: 'Woman Standing V12',
  npc_female_cowgirl: 'Female Cowgirl V4',
  npc_office_worker_male: '158 Office Worker (Male) MUA',
  npc_psx_male_1: 'PSX PS1 Male Character 1 (updated)',
  npc_male_suit: 'Male Character in Suit',
  npc_male_ps1: 'Male Character PS1-Style',
  npc_cartoon_male_2: 'Cartoonish Male Character_2',
  player_jason: 'GTA 6 Jason',
  player_lucia: 'GTA 6 Lucia',
  map_los_santos: 'Indian Bike Driving 3D Map',
};

const manifest = { generatedAt: new Date().toISOString(), models: [], colliders: {} };

function emit(kind, id, model, meta = {}) {
  const r = writeGLB(model, OUT);
  let tris = 0;
  for (const n of model.nodes) for (const g of n.groups.values()) tris += g.idx.length / 3;
  manifest.models.push({
    id,
    kind,
    file: `/models/${path.basename(r.file)}`,
    bytes: r.bytes,
    triangles: tris,
    title: TITLES[id] || meta.title || id,
    sketchfab: SKETCHFAB[id] || null,
    ...meta,
  });
  console.log(
    `  ✓ ${path.basename(r.file).padEnd(34)} ${(r.bytes / 1024).toFixed(0).padStart(6)} KB  ${String(Math.round(tris)).padStart(6)} tris`
  );
  return r;
}

console.log('Building city + stunt maps …');
const city = buildCity();
emit('map', 'map_los_santos', city, { scale: 1, spawn: [-40, 0.4, -40] });
manifest.colliders.map_los_santos = COLLIDERS.map((c) => ({ ...c }));

const stunt = buildStuntPark();
emit('map', 'map_indian_bike_stunt', stunt, { scale: 1, spawn: [0, 0, 120] });

console.log('\nBuilding playable characters …');
emit('player', 'player_jason', buildCharacter({
  name: 'player_jason',
  height: 1.84,
  skin: 'tan',
  hair: 'brown',
  hairStyle: 'short',
  topStyle: 'hoodie',
  top: [0.2, 0.3, 0.46],
  bottom: [0.18, 0.26, 0.42],
  shoes: [0.96, 0.96, 0.96],
  build: 'athletic',
  accessories: { backpack: false, belt: true },
}), { scale: 1 });

emit('player', 'player_lucia', buildCharacter({
  name: 'player_lucia',
  height: 1.72,
  skin: 'tan',
  hair: 'black',
  hairStyle: 'ponytail',
  topStyle: 'tank',
  top: [0.9, 0.35, 0.4],
  bottomStyle: 'jeans',
  bottom: [0.16, 0.24, 0.36],
  shoes: [0.92, 0.92, 0.94],
  build: 'petite',
  feminine: true,
  accessories: { belt: true },
}), { scale: 1 });

console.log('\nBuilding NPC archetypes …');
const NPC_DEFS = [
  ['npc_woman_pose_v13', { skin: 'light', hair: 'blonde', hairStyle: 'long', topStyle: 'dress', top: [0.9, 0.4, 0.6], bottomStyle: 'skirt', bottom: [0.9, 0.4, 0.6], shoes: [0.95, 0.3, 0.5], build: 'slim', feminine: true }],
  ['npc_mai_shiranui', { skin: 'light', hair: 'black', hairStyle: 'long', topStyle: 'tank', top: [0.75, 0.1, 0.15], bottomStyle: 'skirt', bottom: [0.6, 0.1, 0.15], shoes: [0.9, 0.9, 0.9], build: 'slim', feminine: true, accessories: { belt: true } }],
  ['npc_woman_standing_v33', { skin: 'tan', hair: 'brown', hairStyle: 'bun', topStyle: 'shirt', top: [0.95, 0.92, 0.86], bottomStyle: 'jeans', bottom: [0.2, 0.2, 0.24], shoes: [0.2, 0.2, 0.22], build: 'slim', feminine: true }],
  ['npc_woman_ballet', { skin: 'fair', hair: 'brown', hairStyle: 'bun', topStyle: 'dress', top: [0.95, 0.7, 0.8], bottomStyle: 'skirt', bottom: [0.95, 0.7, 0.8], shoes: [0.98, 0.85, 0.9], build: 'petite', feminine: true }],
  ['npc_woman_standing_v12', { skin: 'olive', hair: 'black', hairStyle: 'long', topStyle: 'coat', top: [0.16, 0.16, 0.2], bottomStyle: 'jeans', bottom: [0.14, 0.16, 0.22], shoes: [0.1, 0.1, 0.12], build: 'slim', feminine: true }],
  ['npc_female_cowgirl', { skin: 'light', hair: 'ginger', hairStyle: 'pigtails', topStyle: 'shirt', top: [0.75, 0.3, 0.2], bottomStyle: 'jeans', bottom: [0.28, 0.34, 0.5], shoes: [0.35, 0.22, 0.14], build: 'athletic', feminine: true, hat: 'cap', hatColor: [0.85, 0.75, 0.55] }],
  ['npc_office_worker_male', { skin: 'light', hair: 'brown', hairStyle: 'short', topStyle: 'uniform', top: [0.9, 0.9, 0.93], bottomStyle: 'suit', bottom: [0.16, 0.2, 0.3], shoes: [0.12, 0.12, 0.14], build: 'athletic', accessories: { glasses: true } }],
  ['npc_psx_male_1', { skin: 'tan', hair: 'black', hairStyle: 'short', topStyle: 'tshirt', top: [0.3, 0.6, 0.4], bottomStyle: 'cargo', bottom: [0.35, 0.33, 0.28], shoes: [0.9, 0.9, 0.9], build: 'slim' }],
  ['npc_male_suit', { skin: 'brown', hair: 'black', hairStyle: 'fade', topStyle: 'suit', top: [0.12, 0.14, 0.2], bottomStyle: 'suit', bottom: [0.12, 0.14, 0.2], shoes: [0.08, 0.08, 0.1], build: 'athletic', accessories: { glasses: true } }],
  ['npc_male_ps1', { skin: 'fair', hair: 'brown', hairStyle: 'mohawk', topStyle: 'tank', top: [0.2, 0.2, 0.24], bottomStyle: 'shorts', bottom: [0.2, 0.2, 0.24], shoes: [0.85, 0.2, 0.2], build: 'heavy', accessories: { vest: true } }],
  ['npc_cartoon_male_2', { skin: 'light', hair: 'blonde', hairStyle: 'afro', topStyle: 'hoodie', top: [0.85, 0.6, 0.2], bottomStyle: 'jeans', bottom: [0.2, 0.26, 0.4], shoes: [0.2, 0.2, 0.22], build: 'heavy' }],
  ['npc_chef', { skin: 'olive', hair: 'black', hairStyle: 'short', topStyle: 'uniform', top: [0.95, 0.95, 0.97], bottomStyle: 'suit', bottom: [0.18, 0.18, 0.2], shoes: [0.1, 0.1, 0.1], build: 'athletic', accessories: { apron: true } }],
  ['npc_cop', { skin: 'fair', hair: 'grey', hairStyle: 'short', topStyle: 'uniform', top: [0.14, 0.18, 0.34], bottomStyle: 'suit', bottom: [0.14, 0.18, 0.34], shoes: [0.08, 0.08, 0.1], build: 'athletic', hat: 'cap', hatColor: [0.1, 0.14, 0.3], accessories: { vest: true } }],
  ['npc_jogger', { skin: 'deep', hair: 'black', hairStyle: 'afro', topStyle: 'tank', top: [0.95, 0.95, 0.3], bottomStyle: 'shorts', bottom: [0.15, 0.2, 0.3], shoes: [0.98, 0.98, 0.98], build: 'athletic', accessories: { glasses: true } }],
];
for (const [id, opts] of NPC_DEFS) {
  emit('npc', id, buildCharacter({ name: id, ...opts }), { scale: 1, archetype: id });
}

console.log('\nBuilding vehicles …');
// high-detail generations (smooth lofts, lathed wheels, clear-coat paint)
emit('vehicle', 'ferrari_daytona_sp3', buildFerrariHD(), { scale: 1, seats: 2, topSpeed: 118, handling: 0.94, mass: 1450, drivetrain: 'RWD' });
emit('vehicle', 'porsche_mission_x', buildMissionXHD(), { scale: 1, seats: 2, topSpeed: 124, handling: 0.96, mass: 1500, drivetrain: 'AWD' });
emit('vehicle', 'porsche_911_gt3r', buildPorsche911HD(), { scale: 1, seats: 2, topSpeed: 106, handling: 0.99, mass: 1300, drivetrain: 'RWD' });
emit('vehicle', 'mustang_roush_1996', buildMustangHD(), { scale: 1, seats: 4, topSpeed: 88, handling: 0.74, mass: 1600, drivetrain: 'RWD' });
emit('vehicle', 'police_car', buildPoliceCarHD(), { scale: 1, seats: 4, topSpeed: 82, handling: 0.76, mass: 1700, siren: true, drivetrain: 'RWD' });
emit('vehicle', 'police_lambo_diablo', buildLamborghiniPoliceHD(), { scale: 1, seats: 2, topSpeed: 116, handling: 0.92, mass: 1500, siren: true, drivetrain: 'AWD' });
emit('vehicle', 'redbull_rb22', buildF1HD(), { scale: 1, seats: 1, topSpeed: 152, handling: 1.0, mass: 800, drivetrain: 'RWD' });
emit('vehicle', 'ural_4320_truck', buildUralTruckHD(), { scale: 1, seats: 3, topSpeed: 44, handling: 0.5, mass: 8000, heavy: true, drivetrain: '6x6' });
emit('vehicle', 'kawasaki_ninja_h2', buildSportBike('kawasaki_ninja_h2', [0.06, 0.33, 0.15]), { scale: 1, seats: 1, topSpeed: 142, handling: 1.04, mass: 260, type: 'bike', drivetrain: 'RWD' });
emit('vehicle', 'bmw_s1000rr', buildSportBike('bmw_s1000rr', [0.75, 0.12, 0.1]), { scale: 1, seats: 1, topSpeed: 138, handling: 1.02, mass: 250, type: 'bike', drivetrain: 'RWD' });

console.log('\nBuilding aircraft …');
emit('aircraft', 'aeroplane', buildAirplane(), { scale: 1, seats: 4, topSpeed: 105, lift: 1.0, cockpit: false });
emit('aircraft', 'ka350_flight_deck', buildKingAirDeck(), { scale: 1, interior: true });
emit('aircraft', 'little_bird_helicopter', buildHelicopter(), { scale: 1, seats: 4, topSpeed: 88, lift: 1.15, rotor: true });

console.log('\nBuilding weapons …');
emit('weapon', 'weapon_g17_handgun', buildHandgun(), { scale: 1, damage: 24, rpm: 320, range: 90, ammo: 17, mode: 'semi', grip: [0, -0.02, -0.1] });
emit('weapon', 'weapon_pp19_vityaz', buildSMG(), { scale: 1, damage: 18, rpm: 700, range: 120, ammo: 30, mode: 'auto', grip: [0, -0.02, -0.12] });
emit('weapon', 'weapon_akmn_rifle', buildRifle(), { scale: 1, damage: 34, rpm: 600, range: 220, ammo: 30, mode: 'auto', grip: [0, -0.02, -0.12] });

// ---------------------------------------------------------------------------
// Bonus: real upstream .glb files already downloaded (used as high-detail stand-ins)
// ---------------------------------------------------------------------------
const EXTRAS = [
  ['ferrari_highpoly', 'vehicle', 'Ferrari 488 (three.js sample, detailed)'],
  ['soldier_rigged', 'npc', 'Soldier (rigged, three.js sample)'],
  ['xbot_rigged', 'npc', 'Xbot (rigged, three.js sample)'],
  ['michelle_rigged', 'npc', 'Michelle (rigged, three.js sample)'],
  ['readyplayer_urban', 'npc', 'ReadyPlayerMe urban avatar'],
  ['kira_character', 'npc', 'Kira character'],
  ['cesium_man', 'npc', 'CesiumMan (rigged sample)'],
  ['cesium_truck', 'vehicle', 'Cesium Milk Truck'],
  ['dewoitine_plane', 'aircraft', 'Dewoitine D520 fighter'],
  ['collision_world', 'map', 'three.js collision test world'],
];
for (const [base, kind, title] of EXTRAS) {
  const f = path.join(OUT, `${base}.glb`);
  if (!fs.existsSync(f)) continue;
  manifest.models.push({
    id: base,
    kind,
    file: `/models/${base}.glb`,
    bytes: fs.statSync(f).size,
    title,
    sketchfab: null,
    upstream: true,
  });
}

// ---------------------------------------------------------------------------
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
fs.writeFileSync(
  path.join(OUT, 'map_los_santos.colliders.json'),
  JSON.stringify({ colliders: manifest.colliders.map_los_santos })
);
fs.writeFileSync(
  path.join(OUT, 'map_indian_bike_stunt.colliders.json'),
  JSON.stringify({ colliders: manifest.colliders.map_indian_bike_stunt || [] })
);

const total = manifest.models.reduce((a, m) => a + m.bytes, 0);
console.log(`\n${manifest.models.length} models · ${(total / 1024 / 1024).toFixed(2)} MB total · manifest.json written`);
