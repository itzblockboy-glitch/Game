/**
 * LOS SANTOS — entry point.
 * Boots the renderer, streams the GLB asset pack, wires input (keyboard, mouse, touch),
 * the third-person camera, NPC traffic, weapons, multiplayer + voice, and the HUD.
 */
import * as THREE from 'three';
import {
  manifest,
  loadManifest,
  loadModels,
  loadColliders,
  getTemplate,
  instance,
  hotSwap,
  netStats,
  cacheSize,
  clearCache,
} from './assets.js';
import { World, MAP_CENTER } from './world.js';
import { Character, WEAPONS } from './character.js';
import { Vehicle, VEHICLE_DEFS } from './vehicles.js';
import { Network, FLAG } from './network.js';
import { VoiceChat } from './voice.js';
import { UI } from './ui.js';
import { audio } from './sound.js';
import { VFX } from './vfx.js';
import { RenderPass } from './vendor/RenderPass.js';
import { EffectComposer } from './vendor/EffectComposer.js';
import { UnrealBloomPass } from './vendor/UnrealBloomPass.js';
import { OutputPass } from './vendor/OutputPass.js';
import { ShaderPass } from './vendor/ShaderPass.js';
import { showFatal, humanize, describe, BootAbort } from './boot-error.js';

// ---------------------------------------------------------------- quality tiers
const QUALITY = [
  { name: 'Performance', dpr: 0.75, shadow: false, shadowMap: 1024, fog: 0.0022, lod: 300, targetFps: 30, post: false, bloom: 0, msaa: 0 },
  { name: 'Balanced', dpr: 1.0, shadow: true, shadowMap: 2048, fog: 0.0016, lod: 380, targetFps: 60, post: true, bloom: 0.32, msaa: 2 },
  { name: 'Cinematic', dpr: 1.35, shadow: true, shadowMap: 3024, fog: 0.0012, lod: 620, targetFps: 60, post: true, bloom: 0.52, msaa: 4 },
];

const isTouch = matchMedia('(pointer: coarse)').matches;
const state = {
  quality: isTouch ? 0 : 1,
  dataSaver: true,
  shadows: true,
  photoMode: false,
  paused: true,
  started: false,
  inVehicle: false,
  nearVehicle: null,
  cockpit: false,
  elapsed: 0,
};

// The bundle is executing: tell the inline guard not to report "did not start".
window.__bootStarted = true;

function removeSplash() {
  const splash = document.getElementById('boot-splash');
  if (splash) splash.remove();
}

// ---------------------------------------------------------------- WebGL 2 gate
// three r187 is WebGL2-only and constructs its context eagerly. If that throws,
// module evaluation aborts — and with no UI built yet the player sees a black
// screen. Fail with an explanation instead.
const canvas = document.getElementById('scene');
let renderer = null;
let rendererError = null;
// Try progressively more conservative context attributes. A hard
// `high-performance` request is refused outright by some mobile GPU drivers even
// though the device renders the game perfectly well with 'default'.
const RENDERER_OPTIONS = [
  { antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false, depth: true },
  { antialias: false, powerPreference: 'default', alpha: false, stencil: false, depth: true },
  { antialias: false, alpha: false, stencil: false, depth: true, failIfMajorPerformanceCaveat: false },
  { antialias: false, alpha: false },
];
for (const opts of RENDERER_OPTIONS) {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, ...opts });
    break;
  } catch (err) {
    rendererError = err;
  }
}
if (!renderer) {
  // Stop cleanly rather than rethrowing: a throw here aborts module evaluation,
  // so nothing below runs and the guard can only report a raw stack trace.
  removeSplash();
  const info = humanize(rendererError);
  showFatal(info.title, info.detail, describe(rendererError));
  throw new BootAbort(rendererError);
}
if (rendererError) console.warn('renderer: fell back to default context attributes', rendererError);
renderer.setClearColor(0xbfd8ea);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// ACES + a slightly filmic exposure is the biggest single "realism" lever
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = true;
renderer.info.autoReset = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.25, 3200);

// ---------------------------------------------------------------- cinematic render pipeline
// HDR (half-float) render target → bloom → ACES tone map → sRGB output.
// Quality tiers switch post off entirely for low-end devices.
// Some mobile GL drivers refuse a half-float + multisampled render target. That
// must degrade to a plain LDR target rather than killing the whole boot.
let composer;
try {
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: 2,
  }));
} catch (err) {
  console.warn('HDR composer unavailable, falling back to LDR', err);
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType }));
}
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.62, 0.86);
composer.addPass(bloomPass);
const outputPass = new OutputPass();
composer.addPass(outputPass);
composer.setSize(innerWidth, innerHeight);

// subtle cinematic grade: warm highlights, cool shadows, vignette, film grain
const gradePass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.34 },
    uGrain: { value: 0.035 },
    uTime: { value: 0 },
    uWarmth: { value: 0.06 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform float uGrain; uniform float uTime; uniform float uWarmth;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // split-tone: lift warm mids, cool the shadows a touch
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c, c * vec3(1.0 + uWarmth, 1.0 + uWarmth * 0.2, 1.0 - uWarmth * 0.6), smoothstep(0.15, 0.85, l));
      c = mix(c, c * vec3(0.94, 0.97, 1.06), 1.0 - smoothstep(0.02, 0.35, l));
      // gentle contrast curve
      c = pow(c, vec3(1.03));
      // vignette
      vec2 q = vUv - 0.5;
      float vig = smoothstep(0.9, 0.28, length(q) * 1.25);
      c *= mix(1.0, vig, uVignette);
      // film grain
      float g = hash(vUv * 1024.0 + uTime) - 0.5;
      c += g * uGrain;
      gl_FragColor = vec4(c, 1.0);
    }`,
});
composer.addPass(gradePass);

const world = new World(renderer, scene, camera);
const ui = new UI();
const network = new Network();
const voice = new VoiceChat(network, {
  onPeers: (n) => ui.setVoicePeers(buildVoicePeers()),
  onVad: (speaking) => updateVoiceBadge(speaking),
});

// ---------------------------------------------------------------- game entities
const game = {
  world,
  ui,
  network,
  voice,
  player: null,
  remotePlayers: new Map(),
  vehicles: [],
  npcs: [],
  bullets: [],
  timeScale: 1,
  colliders: [],
};

const vfx = new VFX(scene, renderer);
let player = null;
let activeVehicle = null;
let vehicles = [];
let npcs = [];
let remoteAvatars = new Map();
let mapId = 'map_los_santos';

// ---------------------------------------------------------------- camera controller
const cam = {
  yaw: 0,
  pitch: 0.16,
  dist: 5.4,
  targetDist: 5.4,
  smoothPos: new THREE.Vector3(0, 3, -6),
  smoothLook: new THREE.Vector3(),
  shake: 0,
  fov: 64,
  collision: 0,
};

// ---------------------------------------------------------------- input
const input = {
  forward: 0,
  right: 0,
  sprint: false,
  jump: false,
  attack: false,
  aim: false,
  up: 0,
  down: 0,
  steer: 0,
  throttle: 0,
  brake: 0,
  handbrake: false,
  keys: new Set(),
  mouseDown: false,
  rightDown: false,
  touchMove: { x: 0, y: 0 },
};

const KEYMAP = {
  KeyW: 'fwd',
  ArrowUp: 'fwd',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyE: 'use',
  KeyF: 'use',
  KeyR: 'reload',
  KeyQ: 'wheel',
  KeyV: 'voice',
  KeyH: 'help',
  KeyP: 'photo',
  KeyT: 'time',
  KeyC: 'cockpit',
  Escape: 'pause',
  KeyM: 'map',
};

addEventListener('keydown', (e) => {
  if (ui.el.chatWrap && !ui.el.chatWrap.classList.contains('hidden')) return;
  if (e.code === 'Enter') {
    openChat();
    return;
  }
  const act = KEYMAP[e.code];
  if (!act) return;
  e.preventDefault();
  if (input.keys.has(e.code)) return;
  input.keys.add(e.code);
  onKeyAction(act, true, e);
});

addEventListener('keyup', (e) => {
  input.keys.delete(e.code);
  const act = KEYMAP[e.code];
  if (act === 'voice' && voice.pushToTalk) voice.setHoldPTT(false);
  if (act === 'jump') input.jump = false;
});

function onKeyAction(act, down, e) {
  switch (act) {
    case 'jump':
      input.jump = down;
      break;
    case 'sprint':
      input.sprint = down;
      break;
    case 'use':
      if (down) toggleVehicle();
      break;
    case 'reload':
      if (down && activeVehicle && activeVehicle.def.siren) {
        const on = activeVehicle.toggleSiren();
        audio.siren(on && vehNearby(activeVehicle));
        ui.toast(on ? 'Siren ON' : 'Siren OFF', 'info');
        break;
      }
      if (down && player) {
        player.reload();
        audio.ui('click');
        ui.toast(`Reloaded ${WEAPONS[player.weapon]?.name || ''}`, 'good');
      }
      break;
    case 'wheel':
      if (down) cycleWeapon();
      break;
    case 'voice':
      if (down) {
        if (voice.pushToTalk) voice.setHoldPTT(true);
        else ui.toast(voice.enabled ? 'Voice is already open — hold V for PTT' : 'Voice chat is off', 'warn');
      }
      break;
    case 'help':
      if (down) ui.toggleControls(ui.el.controls.classList.contains('hidden'));
      break;
    case 'pause':
      if (down) setPaused(!state.paused);
      break;
    case 'photo':
      if (down) togglePhotoMode();
      break;
    case 'time':
      if (down) {
        world.setTimeOfDay((world.timeOfDay + 3) % 24);
        ui.toast(`Time ${formatClock(world.timeOfDay)}`, 'info');
      }
      break;
    case 'cockpit':
      if (down && activeVehicle?.type === 'plane') {
        state.cockpit = !state.cockpit;
        ui.toast(state.cockpit ? 'Cockpit view' : 'Chase view');
      }
      break;
    case 'map':
      if (down) switchMap();
      break;
    default:
      break;
  }
  // numeric weapon select
  if (/^Digit[1-4]$/.test(e.code)) selectWeaponByIndex(Number(e.code.slice(5)) - 1);
}

addEventListener('mousedown', (e) => {
  if (state.paused || !state.started) return;
  if (e.button === 0) input.attack = true;
  if (e.button === 2) input.rightDown = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) input.attack = false;
  if (e.button === 2) input.rightDown = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());

// pointer-lock-free mouse look: drag or raw movement on the canvas
let dragging = false;
const unlockAudio = () => {
  if (audio.unlock()) {
    audio.startMusic();
    document.removeEventListener('pointerdown', unlockAudio);
    document.removeEventListener('keydown', unlockAudio);
    document.removeEventListener('touchstart', unlockAudio);
  }
};
document.addEventListener('pointerdown', unlockAudio);
document.addEventListener('keydown', unlockAudio);
document.addEventListener('touchstart', unlockAudio);

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') return;
  dragging = true;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', () => (dragging = false));
addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  if (!dragging && !input.keys.has('KeyZ') && !input.rightDown) return;
  if (state.paused) return;
  cam.yaw -= e.movementX * 0.0026;
  cam.pitch = THREE.MathUtils.clamp(cam.pitch - e.movementY * 0.0019, -0.42, 1.02);
});

// ---------------------------------------------------------------- touch controls
function setupTouch() {
  const stick = ui.el.stick;
  const knob = ui.el.knob;
  let active = false;
  let id = null;
  let cx = 0;
  let cy = 0;
  const radius = 46;

  const start = (e) => {
    const t = e.changedTouches ? e.changedTouches[0] : e;
    id = t.identifier ?? 0;
    active = true;
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    move(e);
  };
  const move = (e) => {
    if (!active) return;
    const list = e.changedTouches ? [...e.changedTouches] : [e];
    const t = list.find((x) => (x.identifier ?? 0) === id) || list[0];
    if (!t) return;
    let dx = t.clientX - cx;
    let dy = t.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > radius) {
      dx = (dx / len) * radius;
      dy = (dy / len) * radius;
    }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    input.touchMove.x = dx / radius;
    input.touchMove.y = dy / radius;
    if (e.cancelable) e.preventDefault();
  };
  const end = () => {
    active = false;
    input.touchMove.x = 0;
    input.touchMove.y = 0;
    knob.style.transform = 'translate(-50%, -50%)';
  };

  stick.addEventListener('touchstart', start, { passive: false });
  stick.addEventListener('touchmove', move, { passive: false });
  stick.addEventListener('touchend', end);
  stick.addEventListener('touchcancel', end);

  ui.el.touch.querySelectorAll('.tbtn').forEach((btn) => {
    const act = btn.dataset.act;
    const down = (e) => {
      e.preventDefault();
      btn.classList.add('active');
      if (act === 'attack') input.attack = true;
      if (act === 'jump') input.jump = true;
      if (act === 'sprint') input.sprint = true;
      if (act === 'aim') input.rightDown = true;
      if (act === 'interact') toggleVehicle();
      if (act === 'voice') voice.setHoldPTT(true);
    };
    const up = (e) => {
      e.preventDefault();
      btn.classList.remove('active');
      if (act === 'attack') input.attack = false;
      if (act === 'jump') input.jump = false;
      if (act === 'sprint') input.sprint = false;
      if (act === 'aim') input.rightDown = false;
      if (act === 'voice') voice.setHoldPTT(false);
    };
    btn.addEventListener('touchstart', down, { passive: false });
    btn.addEventListener('touchend', up, { passive: false });
    btn.addEventListener('touchcancel', up, { passive: false });
    btn.addEventListener('mousedown', down);
    btn.addEventListener('mouseup', up);
  });

  // touch look: drag on the right 55% of the canvas
  let lookId = null;
  let lx = 0;
  let ly = 0;
  canvas.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    if (t.clientX < innerWidth * 0.42) return;
    lookId = t.identifier;
    lx = t.clientX;
    ly = t.clientY;
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== lookId) continue;
      cam.yaw -= (t.clientX - lx) * 0.006;
      cam.pitch = THREE.MathUtils.clamp(cam.pitch - (t.clientY - ly) * 0.004, -0.4, 1.0);
      lx = t.clientX;
      ly = t.clientY;
    }
  }, { passive: true });
  canvas.addEventListener('touchend', () => (lookId = null));
}

// ---------------------------------------------------------------- boot
async function boot() {
  ui.setLoading(0.04, 'Connecting to asset server…');
  try {
    await loadManifest();
  } catch (err) {
    ui.setLoading(0.08, 'Manifest missing — run `npm run assets`');
    console.error(err);
  }

  ui.setLoading(0.12, 'Streaming city geometry…');
  const essential = [
    mapId,
    'player_jason',
    'player_lucia',
    'police_car',
    'ferrari_daytona_sp3',
    'porsche_911_gt3r',
    'mustang_roush_1996',
    'police_lambo_diablo',
    'porsche_mission_x',
    'redbull_rb22',
    'ural_4320_truck',
    'aeroplane',
    'little_bird_helicopter',
    'ka350_flight_deck',
    'weapon_g17_handgun',
    'weapon_pp19_vityaz',
    'weapon_akmn_rifle',
    'readyplayer_urban',
    'michelle_rigged',
    'npc_office_worker_male',
    'npc_cop',
    'npc_jogger',
    'npc_chef',
    'npc_male_suit',
  ];
  await loadModels(essential, { concurrency: isTouch ? 3 : 6 });
  ui.setLoading(0.62, 'Placing pedestrians & traffic…');

  // background: remaining NPCs
  const rest = manifest.models
    .filter((m) => !essential.includes(m.id) && m.kind === 'npc' && !m.upstream)
    .map((m) => m.id);
  loadModels(rest, { concurrency: 2 }).then(() => ui.setLoading(1, 'All assets ready'));

  game.colliders = await loadColliders(mapId);
  world.loadMap(mapId, { position: new THREE.Vector3() });
  world.setColliders(game.colliders);
  world.setTimeOfDay(10.4);

  ui.setLoading(0.74, 'Waking up the city…');
  spawnPlayer();
  spawnVehicles();
  spawnNPCs();
  setupCamera();
  runCamera(0, true);

  ui.setLoading(0.9, 'Tuning renderer for your device…');
  applyQuality(state.quality);

  const params = new URLSearchParams(location.search);
  const urlRoom = (params.get('room') || '').toUpperCase().slice(0, 8);
  const urlName = (params.get('name') || '').slice(0, 16);

  ui.setLoading(1, 'Ready');
  setTimeout(() => {
    ui.hideLoading();
    ui.showMenu(true);
    ui.el.inputName.value = urlName || localStorage.getItem('ls:name') || '';
    ui.el.inputRoom.value = urlRoom || localStorage.getItem('ls:room') || '';
    ui.buildHubCards(manifest.models, onHotSwap);
    setupHubDropZone();
    if (urlRoom) {
      // shared invite link → straight into the friend's room
      const name = urlName || localStorage.getItem('ls:name') || `Rider${Math.floor(Math.random() * 900 + 100)}`;
      network.name = name;
      ui.el.inputName.value = name;
      startGame({ multiplayer: true, name, room: urlRoom });
    }
  }, 420);

  // click handlers
  ui.el.menu.addEventListener('click', onMenuClick);
  ui.el.hub.addEventListener('click', onHubClick);
  ui.el.pause.addEventListener('click', onPauseClick);
  ui.el.controls.addEventListener('click', (e) => {
    if (e.target.id === 'btn-controls-close' || e.target.id === 'controls') ui.toggleControls(false);
  });
  ui.root.querySelector('#btn-menu').addEventListener('click', () => setPaused(true));
  ui.root.querySelector('#btn-assets').addEventListener('click', () => ui.toggleHub(true));
  ui.root.querySelector('#btn-photo').addEventListener('click', togglePhotoMode);
  ui.root.querySelectorAll('.ww-item').forEach((el) => {
    el.addEventListener('click', () => selectWeapon(el.dataset.w));
  });
  ui.el.chatInput.addEventListener('keydown', (e) => {
    if (e.code === 'Enter') {
      const text = ui.el.chatInput.value.trim();
      if (text) network.sendChat(text);
      ui.closeChat();
    } else if (e.code === 'Escape') ui.closeChat();
    e.stopPropagation();
  });

  network.on('chat', (msg) => ui.chat(msg.name || 'Rider', msg.text));
  network.on('join', (msg) => {
    if (msg.id === network.myId) return;
    ui.systemChat(`${msg.name} joined the room`);
    ui.toast(`${msg.name} joined`, 'good');
  });
  network.on('leave', (msg) => {
    ui.systemChat(`Player left`);
    const av = remoteAvatars.get(msg.id);
    if (av) {
      scene.remove(av.root);
      remoteAvatars.delete(msg.id);
    }
  });
  network.on('status', (s) => {
    if (s.connected !== undefined) {
      ui.setNet({ connected: s.connected, players: network.players.size + 1, room: network.room });
      ui.toast(s.connected ? `Connected to room ${network.room}` : 'Disconnected', s.connected ? 'good' : 'bad');
    }
    if (s.latency !== undefined) ui.setNet({ latency: s.latency });
  });
  network.on('error', (m) => ui.toast(String(m), 'bad'));
  network.on('welcome', (w) => {
    ui.setNet({ connected: true, players: 1, room: w.room });
    if (voice.enabled) voice._announceReady();
  });

  network.setStateProvider(() => {
    if (!player) return null;
    const p = activeVehicle ? activeVehicle.position : player.position;
    const yaw = activeVehicle ? activeVehicle.yaw : player.yaw;
    const moving = activeVehicle ? Math.abs(activeVehicle.speed) > 1 : player.moving;
    return {
      x: p.x,
      y: p.y,
      z: p.z,
      yaw,
      speed: activeVehicle ? Math.abs(activeVehicle.speed) : player.speed,
      vehicle: activeVehicle ? vehicleIndex(activeVehicle.id) + 1 : 0,
      flags:
        (moving ? FLAG.MOVING : 0) |
        (player.sprinting ? FLAG.SPRINT : 0) |
        (input.rightDown ? FLAG.AIM : 0) |
        (player.moveState === 'swim' ? FLAG.SWIM : 0) |
        (!player.onGround ? FLAG.AIR : 0) |
        (voice.speaking ? FLAG.SPEAK : 0),
    };
  });

  setTimeout(() => runChromeCheck(), 2500);
}

function runChromeCheck() {
  // keep the UI honest about the data budget
  const saved = netStats.fetched + netStats.cached > 0 ? (netStats.cached / (netStats.fetched + netStats.cached)) * 100 : 0;
  ui.setDataSaver({ savedPct: saved });
}

// ---------------------------------------------------------------- spawn
function spawnPlayer() {
  // the realistic rigged avatar is the playable body; the foundry model is the fallback
  const heroId = getTemplate('readyplayer_urban') ? 'readyplayer_urban' : 'player_jason';
  player = new Character(heroId, {
    isPlayer: true,
    onShoot: onPlayerShoot,
  });
  const spawn = new THREE.Vector3(6, 0.05, 26);
  player.reset(spawn, -0.6);
  scene.add(player.root);
  game.player = player;
  cam.yaw = -0.6;
}

function spawnVehicles() {
  const spots = [
    ['police_car', -40, 12, 0.0],
    ['ferrari_daytona_sp3', 14, 20, 0.3],
    ['porsche_911_gt3r', 40, 10, -0.4],
    ['mustang_roush_1996', -90, 60, 1.2],
    ['police_lambo_diablo', 72, 74, 0.8],
    ['porsche_mission_x', -130, 16, 2.0],
    ['redbull_rb22', 8, 128, 1.6],
    ['ural_4320_truck', -166, -44, 0.4],
    ['police_car', 128, -128, 2.6],
    ['mustang_roush_1996', -44, -166, 1.0],
    ['kawasaki_ninja_h2', 46, 22, -1.3],
    ['bmw_s1000rr', -58, 4, 1.9],
  ];
  vehicles = spots.map(([id, x, z, yaw]) => {
    const v = new Vehicle(id, id);
    v.place(new THREE.Vector3(x, 0, z), yaw);
    scene.add(v.root);
    return v;
  });

  // aircraft on the airport apron / helipads
  const planes = [
    ['aeroplane', 400, -390, -0.3],
    ['little_bird_helicopter', -60, 372, 0.8],
    ['little_bird_helicopter', 330, 300, 2.2],
  ];
  for (const [id, x, z, yaw] of planes) {
    if (!getTemplate(id)) continue;
    const v = new Vehicle(id, id);
    const y = id === 'little_bird_helicopter' ? 0.5 : 0.8;
    v.place(new THREE.Vector3(x, y, z), yaw);
    v.position.y = y;
    scene.add(v.root);
    vehicles.push(v);
  }
  game.vehicles = vehicles;
}

function vehicleIndex(id) {
  const order = Object.keys(VEHICLE_DEFS);
  const idx = order.indexOf(id);
  return idx < 0 ? 0 : idx;
}

function spawnNPCs() {
  // realistic rigged pedestrians where available, foundry archetypes for variety
  const riggedPeds = ['michelle_rigged', 'readyplayer_urban'].filter((id) => getTemplate(id));
  const npcIds = [
    ...manifest.models
      .filter((m) => m.kind === 'npc' && !m.upstream && getTemplate(m.id))
      .map((m) => m.id),
  ];
  const pedPool = [...riggedPeds, ...riggedPeds, ...npcIds];
  if (!npcIds.length) return;

  // pedestrians
  for (let i = 0; i < 12; i++) {
    const id = pedPool[i % pedPool.length];
    const ch = new Character(id, { onShoot: () => {} });
    const angle = (i / 12) * Math.PI * 2;
    const r = 24 + (i % 5) * 14;
    ch.reset(new THREE.Vector3(-40 + Math.cos(angle) * r, 0.05, -40 + Math.sin(angle) * r), angle);
    ch.isNPC = true;
    ch.wanderAngle = angle;
    ch.wanderTimer = Math.random() * 4;
    ch.speedLimit = 1.2 + Math.random() * 1.6;
    scene.add(ch.root);
    npcs.push(ch);
  }
  // ambient traffic
  const trafficIds = ['police_car', 'mustang_roush_1996', 'ferrari_daytona_sp3', 'porsche_911_gt3r', 'bmw_s1000rr', 'kawasaki_ninja_h2'];
  for (let i = 0; i < 6; i++) {
    const id = trafficIds[i % trafficIds.length];
    if (!getTemplate(id)) continue;
    const v = new Vehicle(id, id);
    const lane = (Math.floor(i / 2) - 1) * 110;
    v.place(new THREE.Vector3(lane + 6, 0, -300 + i * 90), i % 2 ? 0 : Math.PI);
    v.isTraffic = true;
    v.trafficDir = i % 2 ? 1 : -1;
    scene.add(v.root);
    vehicles.push(v);
  }
  game.npcs = npcs;
}

// ---------------------------------------------------------------- camera
function setupCamera() {
  camera.fov = cam.fov;
  camera.updateProjectionMatrix();
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    applyQuality(state.quality);
  });
}

function runCamera(dt, immediate = false) {
  const focusEntity = activeVehicle || player;
  if (!focusEntity) return;
  if (state.freeCamera) return;

  const focusPos = activeVehicle
    ? activeVehicle.position.clone().add(new THREE.Vector3(0, activeVehicle.isAircraft ? 1.6 : 1.3, 0))
    : player.position.clone().add(new THREE.Vector3(0, 1.5, 0));

  // auto-align behind movement (GTA-style) when not aiming and not manually dragging
  const speed = activeVehicle ? Math.abs(activeVehicle.speed) : player.speed;
  if (!input.rightDown && speed > 3.2 && !dragging) {
    const moveYaw = activeVehicle ? activeVehicle.yaw + Math.PI : player.yaw + Math.PI;
    let d = moveYaw - cam.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    cam.yaw += d * Math.min(1, dt * (activeVehicle ? 1.6 : 2.2));
  }

  const pitch = cam.pitch;
  const dist = cam.targetDist;
  const heightBoost = activeVehicle ? (activeVehicle.isAircraft ? 3.4 : 1.5) : 0;

  // desired camera position (spherical)
  const dir = new THREE.Vector3(
    Math.sin(cam.yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(cam.yaw) * Math.cos(pitch)
  );
  let want = focusPos.clone().addScaledVector(dir, dist + heightBoost);

  // cockpit view
  if (state.cockpit && activeVehicle?.type === 'plane') {
    const cockpitPos = activeVehicle.position.clone().add(new THREE.Vector3(0, 1.65, 2.3).applyQuaternion(activeVehicle.quaternion));
    camera.position.copy(cockpitPos);
    const look = activeVehicle.position.clone().addScaledVector(
      new THREE.Vector3(0, 0, 1).applyQuaternion(activeVehicle.quaternion),
      40
    );
    camera.lookAt(look);
    camera.fov = 74;
    camera.updateProjectionMatrix();
    return;
  }

  // camera collision against buildings
  const dirNorm = want.clone().sub(focusPos).normalize();
  const hit = world.raycastAABB(focusPos, dirNorm, dist + heightBoost + 0.6);
  const allowed = hit ? Math.max(1.1, hit.distance - 0.45) : dist + heightBoost;
  want = focusPos.clone().addScaledVector(dir, allowed);

  // keep above ground
  want.y = Math.max(0.5, want.y);

  const lerpAmt = immediate ? 1 : Math.min(1, dt * 9);
  cam.smoothPos.lerp(want, lerpAmt);
  cam.smoothLook.lerp(focusPos.clone().addScaledVector(new THREE.Vector3(0, 0, 0), 0), Math.min(1, dt * 12));

  // shake (landing / gunfire)
  if (cam.shake > 0.001) {
    cam.shake *= Math.pow(0.0016, dt);
    cam.smoothPos.x += (Math.random() - 0.5) * cam.shake;
    cam.smoothPos.y += (Math.random() - 0.5) * cam.shake;
    cam.smoothPos.z += (Math.random() - 0.5) * cam.shake;
  }

  camera.position.copy(cam.smoothPos);
  camera.lookAt(cam.smoothLook);

  const targetFov = input.rightDown ? 52 : activeVehicle && Math.abs(activeVehicle.speed) > 40 ? 72 : 64;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- vehicles
function nearestVehicle() {
  if (!player) return null;
  let best = null;
  let bestD = 6.2;
  for (const v of vehicles) {
    if (v.isTraffic) continue;
    const d = v.position.distanceTo(player.position);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

function toggleVehicle() {
  if (state.paused) return;
  if (activeVehicle) {
    // exit
    const exitPos = activeVehicle.position
      .clone()
      .add(new THREE.Vector3(activeVehicle.type === 'truck' ? 3.2 : 2.4, 0.05, 0))
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), activeVehicle.yaw);
    if (activeVehicle.isAircraft) exitPos.add(new THREE.Vector3(0, Math.max(0.1, activeVehicle.position.y - 0.4), 0));
    player.position.copy(exitPos);
    player.root.visible = true;
    player.driveVehicle = null;
    activeVehicle = null;
    state.inVehicle = false;
    ui.showSpeedo(false);
    audio.stopEngine();
    audio.ui('click');
    ui.toast('Exited vehicle');
    return;
  }
  const v = nearestVehicle();
  if (!v) return;
  activeVehicle = v;
  player.driveVehicle = v;
  player.root.visible = false;
  player.position.copy(v.position);
  state.inVehicle = true;
  ui.showSpeedo(true);
  ui.setVehicleHUd(v.def.name, v.isAircraft ? 'W/S throttle · A/D bank · ↑/↓ climb · C cockpit' : 'W/S throttle · A/D steer · Space handbrake · R siren');
  audio.ui('success');
  audio.startEngine();
  vfx.dust(v.position, 5);
  ui.toast(`Entered ${v.def.name}`, 'good');
}

/** is a siren vehicle close enough to the camera to be audible? */
function vehNearby(v) {
  const d = Math.hypot(v.position.x - camera.position.x, v.position.z - camera.position.z);
  return d < 90;
}

function updateVehicles(dt) {
  const inCar = !!activeVehicle;
  if (inCar) {
    input.throttle = (input.keys.has('KeyW') || input.keys.has('ArrowUp') ? 1 : 0) - (input.keys.has('KeyS') || input.keys.has('ArrowDown') ? 1 : 0);
    input.brake = input.keys.has('KeyS') || input.keys.has('ArrowDown') ? 1 : 0;
    if (input.touchMove.y < -0.2) input.throttle = 1;
    if (input.touchMove.y > 0.2) {
      input.throttle = 0;
      input.brake = 1;
    }
    let steer = (input.keys.has('KeyD') || input.keys.has('ArrowRight') ? 1 : 0) - (input.keys.has('KeyA') || input.keys.has('ArrowLeft') ? 1 : 0);
    steer += input.touchMove.x;
    input.steer = THREE.MathUtils.clamp(steer, -1, 1);
    input.handbrake = input.keys.has('Space');
    input.up = input.keys.has('ShiftLeft') || input.keys.has('ArrowUp') ? 1 : 0;
    input.down = input.keys.has('ControlLeft') ? 1 : 0;
    // aircraft vertical keys
    if (activeVehicle.isAircraft) {
      input.up = input.keys.has('Space') ? 1 : input.keys.has('ShiftLeft') ? 1 : 0;
      input.down = input.keys.has('ControlLeft') || input.keys.has('KeyX') ? 1 : 0;
    }
    // thumbstick throttle on touch
    if (!activeVehicle.isAircraft) {
      const kmh = Math.abs(activeVehicle.speed) * 3.6;
      ui.setSpeed(kmh, activeVehicle.def.name, '[F] exit · [Space] drift');
    } else {
      const alt = Math.max(0, activeVehicle.position.y);
      ui.setSpeed(Math.abs(activeVehicle.speed) * 3.6, `${activeVehicle.def.name} · ${alt.toFixed(0)} m`);
    }
  }

  for (const v of vehicles) {
    if (v === activeVehicle) {
      v.update(dt, input, world);
      continue;
    }
    if (v.isTraffic) {
      // simple lane cruise
      v.update(dt, { throttle: 0.42, brake: 0, steer: Math.sin(performance.now() * 0.0004 + v.position.z * 0.01) * 0.15 }, world);
      if (v.speed < 1) v.speed = 6;
      continue;
    }
    if (!v.isAircraft) {
      // idle vehicles settle
      v.update(dt, { throttle: 0, brake: 0, steer: 0 }, world);
    } else {
      v.update(dt, { throttle: 0, brake: 0, steer: 0, up: 0, down: 0 }, world);
    }
  }
}

// ---------------------------------------------------------------- weapons / combat
const weaponOrder = ['fists', 'weapon_g17_handgun', 'weapon_pp19_vityaz', 'weapon_akmn_rifle'];

function selectWeapon(id) {
  if (!player || !WEAPONS[id]) return;
  player.setWeapon(id);
  ui.highlightWeapon(id);
  ui.setAmmo(WEAPONS[id].kind === 'melee' ? '' : `— / ${player.ammo[id] ?? WEAPONS[id].ammo}`);
  ui.toast(`${WEAPONS[id].name} equipped`, 'info');
}

function cycleWeapon() {
  const i = weaponOrder.indexOf(player?.weapon);
  selectWeapon(weaponOrder[(i + 1) % weaponOrder.length]);
}

function selectWeaponByIndex(i) {
  if (weaponOrder[i]) selectWeapon(weaponOrder[i]);
}

function onPlayerShoot(payload) {
  if (payload.type === 'melee') {
    // hit nearby NPCs / remote players
    for (const n of npcs) {
      if (n.position.distanceTo(player.position) < 2.4) {
        n.health -= payload.damage;
        if (n.health <= 0) {
          n.root.rotation.z = Math.PI / 2;
          n.dead = true;
          ui.toast('Pedestrian down', 'bad');
        }
      }
    }
    cam.shake = Math.max(cam.shake, 0.12);
    return;
  }
  if (payload.type === 'empty') {
    audio.dryFire();
    ui.toast('Out of ammo — press R', 'warn');
    return;
  }
  if (payload.type !== 'shot') return;
  cam.shake = Math.max(cam.shake, 0.22);
  const def = WEAPONS[payload.weapon];
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  player.getMuzzle(origin, dir);
  spawnBulletVisual(origin, dir, def.range);
  const gunKind = payload.weapon === 'weapon_akmn_rifle' ? 'rifle' : payload.weapon === 'weapon_pp19_vityaz' ? 'smg' : 'pistol';
  audio.gunshot(gunKind);
  vfx.muzzleFlash(origin, dir);
  vfx.shellCasing(origin, dir);

  // raycast against colliders + entities
  const hit = world.raycastAABB(origin, dir, def.range);
  let bestT = hit ? hit.distance : def.range;
  let hitTarget = null;
  for (const n of npcs) {
    if (n.dead) continue;
    const t = raySphere(origin, dir, n.position.clone().add(new THREE.Vector3(0, 1, 0)), 0.7);
    if (t !== null && t < bestT) {
      bestT = t;
      hitTarget = n;
    }
  }
  for (const av of remoteAvatars.values()) {
    const t = raySphere(origin, dir, av.root.position.clone().add(new THREE.Vector3(0, 1, 0)), 0.7);
    if (t !== null && t < bestT) {
      bestT = t;
      hitTarget = av;
    }
  }
  if (hitTarget) {
    if (hitTarget.health !== undefined) hitTarget.health -= def.damage;
    const hitPos = origin.clone().addScaledVector(dir, bestT);
    spawnImpact(hitPos);
    vfx.impact(hitPos, dir.clone().negate(), 'flesh');
    audio.impact('flesh', hitPos);
    if (hitTarget.health !== undefined && hitTarget.health <= 0 && !hitTarget.dead) {
      hitTarget.dead = true;
      if (hitTarget.root) hitTarget.root.rotation.z = Math.PI / 2;
    }
  } else if (hit) {
    const hitPos = origin.clone().addScaledVector(dir, hit.distance);
    spawnImpact(hitPos);
    vfx.impact(hitPos, hit.normal || dir.clone().negate(), 'metal');
    audio.impact('metal', hitPos);
  }
}

function raySphere(origin, dir, center, radius) {
  const oc = center.clone().sub(origin);
  const t = oc.dot(dir);
  if (t < 0) return null;
  const d2 = oc.lengthSq() - t * t;
  if (d2 > radius * radius) return null;
  return t - Math.sqrt(Math.max(0, radius * radius - d2));
}

const bulletPool = [];
const tracerPool = [];
function spawnBulletVisual(origin, dir, range) {
  let tracer = tracerPool.pop();
  if (!tracer) {
    const geo = new THREE.CylinderGeometry(0.017, 0.017, 1, 4, 1, true);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.95 });
    tracer = new THREE.Mesh(geo, mat);
    tracer.visible = false;
    scene.add(tracer);
  }
  tracer.visible = true;
  tracer.position.copy(origin).addScaledVector(dir, 2.2);
  tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  tracer.scale.set(1, 1, 4.4);
  tracer.userData.life = 0.055;
  tracerPool.length = Math.min(tracerPool.length, 24);
  bulletPool.push(tracer);
}

function spawnImpact(pos) {
  let spark = tracerPool.pop();
  if (!spark) {
    const geo = new THREE.SphereGeometry(0.14, 5, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffc06a, transparent: true, opacity: 1 });
    spark = new THREE.Mesh(geo, mat);
    scene.add(spark);
  }
  spark.visible = true;
  spark.position.copy(pos);
  spark.userData.life = 0.18;
  spark.scale.setScalar(1.6);
  bulletPool.push(spark);
}

function updateBullets(dt) {
  for (let i = bulletPool.length - 1; i >= 0; i--) {
    const b = bulletPool[i];
    b.userData.life -= dt;
    if (b.userData.life <= 0) {
      b.visible = false;
      tracerPool.push(b);
      bulletPool.splice(i, 1);
    } else {
      b.material.opacity = Math.max(0, b.userData.life / 0.18);
      if (b.geometry.type === 'SphereGeometry') b.scale.multiplyScalar(1 + dt * 6);
    }
  }
}

// ---------------------------------------------------------------- NPC brains
const _npcVel = new THREE.Vector3();
function updateNPCs(dt) {
  if (!player) return;
  for (const n of npcs) {
    if (n.dead) continue;
    n.wanderTimer -= dt;
    if (n.wanderTimer <= 0) {
      n.wanderTimer = 3 + Math.random() * 5;
      n.wanderAngle += (Math.random() - 0.5) * 2.2;
    }
    const near = n.position.distanceTo(player.position) < 9;
    if (near && !n.fleeUntil) {
      n.fleeUntil = performance.now() + 2600;
      n.wanderAngle = Math.atan2(n.position.x - player.position.x, n.position.z - player.position.z);
      n.wanderTimer = 2.6;
    }
    const fleeing = n.fleeUntil && performance.now() < n.fleeUntil;
    const speed = fleeing ? 5.4 : n.speedLimit;
    const dir = _npcVel.set(Math.sin(n.wanderAngle) * speed, 0, Math.cos(n.wanderAngle) * speed);

    // lightweight mover: no gravity/ground jitter for ambient peds
    n.position.x += dir.x * dt;
    n.position.z += dir.z * dt;
    n.position.y = 0.02;
    world.resolveCollision(n.position, 0.4);
    n.yaw = n.wanderAngle;
    n.root.position.copy(n.position);
    n.root.rotation.y = n.yaw;
    const spd = Math.hypot(dir.x, dir.z);
    const prevState = n.moveState;
    n.moveState = spd > 4 ? 'run' : spd > 0.4 ? 'walk' : 'idle';
    n.root.userData.animSpeed = spd;
    n.animate(dt, spd);
    if (Math.abs(n.position.x) > 690 || Math.abs(n.position.z) > 690) n.wanderAngle += Math.PI;
  }
}

// ---------------------------------------------------------------- remote players
function updateRemotePlayers(dt) {
  for (const [id, net] of network.players) {
    let av = remoteAvatars.get(id);
    if (!av) {
      const modelCandidates = manifest.models.filter((m) => m.kind === 'npc' && getTemplate(m.id));
      const pick = modelCandidates[id % modelCandidates.length];
      if (!pick) continue;
      const ch = new Character(pick.id, {});
      ch.isRemote = true;
      ch.label = makeLabel(net.name);
      ch.root.add(ch.label);
      scene.add(ch.root);
      av = ch;
      av.netId = id;
      remoteAvatars.set(id, av);
      ui.systemChat(`${net.name} spawned`);
    }
    const s = net.state;
    if (!s || !s.t) continue;
    av.position.lerp(new THREE.Vector3(s.x, s.y, s.z), Math.min(1, dt * 12));
    av.root.position.copy(av.position);
    let dy = s.yaw - av.root.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    av.root.rotation.y += dy * Math.min(1, dt * 10);
    const moving = (s.flags & FLAG.MOVING) !== 0;
    const spd = moving ? Math.max(1.4, s.speed || 3) : 0;
    av.moveState = !moving ? 'idle' : (s.flags & FLAG.SPRINT) ? 'sprint' : spd > 3.6 ? 'run' : 'walk';
    if (s.flags & FLAG.SWIM) av.moveState = 'swim';
    av.animate(dt, spd);
    av.root.position.y = s.y;
    if (av.label) {
      av.label.quaternion.copy(camera.quaternion);
      const speaking = (s.flags & FLAG.SPEAK) !== 0;
      av.label.element.classList.toggle('speaking', speaking);
    }
    if (s.vehicle) av.root.visible = false;
    else av.root.visible = true;
  }
  // prune
  for (const [id, av] of remoteAvatars) {
    if (!network.players.has(id)) {
      scene.remove(av.root);
      remoteAvatars.delete(id);
    }
  }
}

function makeLabel(name) {
  const canvasEl = document.createElement('canvas');
  canvasEl.width = 256;
  canvasEl.height = 64;
  const ctx = canvasEl.getContext('2d');
  ctx.fillStyle = 'rgba(8,12,20,0.72)';
  ctx.roundRect?.(0, 0, 256, 64, 14);
  ctx.fill();
  ctx.font = 'bold 28px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(name.slice(0, 14), 128, 42);
  const tex = new THREE.CanvasTexture(canvasEl);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(1.8, 0.45, 1);
  sprite.position.y = 2.15;
  const holder = new THREE.Group();
  holder.element = canvasEl;
  holder.add(sprite);
  holder.sprite = sprite;
  return holder;
}

function buildVoicePeers() {
  const list = [];
  for (const [id, net] of network.players) {
    list.push({ name: net.name, speaking: false, muted: false });
  }
  if (voice.speaking) list.unshift({ name: 'You', speaking: true, muted: voice.muted });
  return list;
}

function updateVoiceBadge(speaking) {
  ui.el.voicePeers.querySelectorAll('.vp').forEach((el) => {
    if (el.textContent.includes('You')) el.classList.toggle('speaking', speaking);
  });
}

// ---------------------------------------------------------------- per-frame update of the player
function updatePlayer(dt) {
  if (!player) return;
  if (activeVehicle) {
    player.position.copy(activeVehicle.position);
    player.yaw = activeVehicle.yaw;
    return;
  }
  let f = (input.keys.has('KeyW') || input.keys.has('ArrowUp') ? 1 : 0) - (input.keys.has('KeyS') || input.keys.has('ArrowDown') ? 1 : 0);
  let r = (input.keys.has('KeyD') || input.keys.has('ArrowRight') ? 1 : 0) - (input.keys.has('KeyA') || input.keys.has('ArrowLeft') ? 1 : 0);
  f = THREE.MathUtils.clamp(f - input.touchMove.y * (isTouch ? 1 : 0), -1, 1);
  r = THREE.MathUtils.clamp(r + input.touchMove.x * (isTouch ? 1 : 0), -1, 1);
  const wasGround = player.onGround;
  const wasPos = player.position.clone();
  player.update(dt, {
    forward: f,
    right: r,
    sprint: input.sprint,
    jump: input.jump,
    attack: input.attack && !state.inVehicle,
    aim: input.rightDown,
    pitch: (cam.pitch - 0.16) * 1.4,
    yaw: cam.yaw + Math.PI,
  }, world);
  // ---- footsteps + dust
  const moved = Math.hypot(player.position.x - wasPos.x, player.position.z - wasPos.z);
  if (player.onGround && moved > 0.004) {
    player._stepAcc = (player._stepAcc || 0) + moved;
    if (player._stepAcc > (input.sprint ? 1.5 : 2.0)) {
      player._stepAcc = 0;
      const surface = player.position.y < 0.2 && world.isSand?.(player.position) ? 'sand' : 'concrete';
      audio.footstep(surface, input.sprint);
      if (input.sprint) vfx.dust(player.position, 2);
    }
  }
  if (wasGround && !player.onGround && player.velocity.y > 2) audio.jump();
  if (!wasGround && player.onGround) {
    const impact = player.landedImpact || 0;
    if (impact > 0.25) {
      cam.shake = Math.max(cam.shake, impact * 0.5);
      audio.land(Math.min(1, impact / 2));
      vfx.dust(player.position, 4);
      player.landedImpact = 0;
    }
  }
  // swimming splash
  if (player.position.y < -0.6 && Math.random() < 0.08) vfx.splash(player.position);
  if (player.position.y < -3) {
    player.reset(new THREE.Vector3(-40, 0.1, 34), cam.yaw);
    ui.toast('Respawned', 'warn');
  }

  // weapon HUD
  const def = WEAPONS[player.weapon];
  if (def.kind === 'melee') ui.setAmmo('');
  else ui.setAmmo(`${player.ammo[player.weapon] ?? 0} / ${def.ammo}`);
  ui.setCrosshairVisible(input.rightDown || (def.kind === 'gun' && !state.inVehicle));
}

// ---------------------------------------------------------------- minimap + hud refresh
let hudTimer = 0;
function updateHUD(dt, fps, tris) {
  hudTimer += dt;
  ui.drawMinimap(
    { x: (activeVehicle || player).position.x, z: (activeVehicle || player).position.z, yaw: cam.yaw },
    vehicles,
    [...network.players.values()].map((p) => p.state).filter((s) => s && s.x !== undefined),
    world
  );
  ui.setTime(formatClock(world.timeOfDay));
  if (hudTimer < 0.25) return;
  hudTimer = 0;
  ui.setFps(fps);
  ui.setVitals(player.health, player.armor);

  // data saver HUD
  const total = netStats.fetched + netStats.cached;
  const saved = total > 0 ? (netStats.cached / total) * 100 : 0;
  const netStatsNow = network.stats();
  const rateKbps = ((netStatsNow.bytesIn + netStatsNow.bytesOut) * 8) / 1000 / Math.max(1, state.elapsed);
  ui.setDataSaver({
    rateKbps: (network.connected ? (11 * 8 * 20 + 27 * 8 * 15) / 1000 : 0),
    totalKb: (netStats.fetched + netStats.cached) / 1024,
    savedPct: saved,
    tris,
    voice: voice.enabled ? `${voice.stats().peers}p · 16k` : 'off',
  });
  ui.setNet({ players: network.players.size + 1, room: network.room });
  if (voice.enabled) ui.setVoicePeers(buildVoicePeers());

  const zoneName = zoneLabel((activeVehicle || player).position);
  ui.setLocation(zoneName, `${formatClock(world.timeOfDay)} · ${network.connected ? `ROOM ${network.room}` : 'SOLO'}`);

  const prompt = !activeVehicle && nearestVehicle() ? `Press F to enter the ${nearestVehicle().def.name}` : '';
  ui.setPrompt(prompt);
}

function zoneLabel(pos) {
  const { x, z } = pos;
  if (x < -420) return 'VESPUCCI BEACH';
  if (z > 600 || x > 600) return 'LOS SANTOS INTL';
  if (z < -400) return 'LA MESA DOCKS';
  if (x < 40) return 'DEL PERRO';
  if (x > 260) return 'PILLBOX HILL';
  return 'DOWNTOWN VINEWOOD';
}

function formatClock(h) {
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- menu wiring
function onMenuClick(e) {
  const id = e.target.id;
  if (id === 'btn-play' || id === 'btn-multi') {
    const name = ui.el.inputName.value.trim() || `Rider${Math.floor(Math.random() * 900 + 100)}`;
    const room = (ui.el.inputRoom.value.trim() || 'PUBLIC').toUpperCase();
    localStorage.setItem('ls:name', name);
    localStorage.setItem('ls:room', room);
    network.name = name;
    startGame({ multiplayer: id === 'btn-multi', name, room });
  } else if (id === 'btn-voice') {
    toggleVoice();
  } else if (id === 'btn-hub') {
    ui.toggleHub(true);
  } else if (id === 'btn-controls') {
    ui.toggleControls(true);
  } else if (id === 'btn-share') {
    shareRoom();
  } else if (id === 'btn-map') {
    switchMap();
    startGame({ multiplayer: false, name: 'Rider', room: 'PUBLIC', keepRoom: true });
  }
  if (e.target.id === 'set-quality') return;
  if (e.target.id === 'set-datasaver' || e.target.id === 'set-shadows' || e.target.id === 'set-ptt') {
    return;
  }
}

async function toggleVoice() {
  const btn = ui.el.btnVoice || ui.root.querySelector('#btn-voice');
  if (voice.enabled) {
    voice.disable();
    btn?.classList.remove('accent');
    if (btn) btn.textContent = '🎙 VOICE CHAT: OFF';
    ui.toast('Voice chat off');
    return;
  }
  const ok = await voice.enable();
  btn.textContent = ok ? '🎙 VOICE CHAT: ON' : '🎙 MIC BLOCKED';
  if (ok) {
    ui.toast('Voice chat live — Opus @16 kbps', 'good');
    if (network.connected) voice._announceReady();
  } else {
    ui.toast('Microphone permission denied', 'bad');
  }
}

function startGame({ multiplayer, name, room }) {
  state.started = true;
  state.paused = false;
  hudTimer = 0.3; // force a HUD refresh on the very first playable frame
  ui.showMenu(false);
  ui.showHUD(true);
  ui.setNet({ connected: network.connected, players: 1, room: network.room });
  ui.toast(multiplayer ? `Joining room ${room}…` : 'Free roam — press Esc for menu', 'good');
  if (multiplayer) {
    network.connect({ room, name });
    ui.systemChat(`Joined room ${room}. Share this code with friends.`);
    if (voice.enabled) setTimeout(() => voice._announceReady(), 800);
  } else {
    ui.systemChat('Solo session — open MENU → PLAY WITH FRIENDS to invite a friend');
  }
}

function shareRoom() {
  const room = network.room || 'PUBLIC';
  const name = network.name || 'Rider';
  const url = `${location.origin}/?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}`;
  const done = () => ui.toast('Invite link copied — send it to your friends', 'good');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(done).catch(() => ui.systemChat(url));
  } else {
    ui.systemChat(url);
  }
  return url;
}

/**
 * Android hardware back button (wired in android/.../MainActivity): close the
 * chat, then the asset hub, then unpause — only exit the app when nothing is open.
 * Returns true when the press was consumed by the game.
 */
window.__onAndroidBack = () => {
  const visible = (el) => el && !el.classList.contains('hidden');
  if (visible(ui.el.chatWrap)) { ui.closeChat(); return true; }
  if (visible(ui.el.hub)) { ui.toggleHub(false); return true; }
  if (state.paused) { setPaused(false); return true; }
  if (state.started) { setPaused(true); return true; }
  return false;
};

function setPaused(p) {
  state.paused = p;
  ui.togglePause(p, `FPS ${lastFps.toFixed(0)} · ${world.stats().visible}/${world.stats().chunks} chunks · ${(
    renderer.info.render.triangles / 1000
  ).toFixed(0)}k tris · net ${(((network.bytesIn + network.bytesOut) * 8) / 1024).toFixed(1)} kb`);
  if (p) ui.closeChat();
}

function onPauseClick(e) {
  if (e.target.id === 'btn-resume' || e.target.id === 'pause') setPaused(false);
  if (e.target.id === 'btn-share' || e.target.id === 'btn-pause-share') shareRoom();
  if (e.target.id === 'btn-pause-hub') {
    ui.toggleHub(true);
  }
  if (e.target.id === 'btn-pause-menu') {
    state.started = false;
    ui.togglePause(false);
    ui.showMenu(true);
    ui.showHUD(false);
    network.disconnect();
    for (const [id, av] of remoteAvatars) {
      scene.remove(av.root);
      remoteAvatars.delete(id);
    }
  }
}

function onHubClick(e) {
  if (e.target.id === 'btn-hub-close') ui.toggleHub(false);
  if (e.target.id === 'drop-zone') ui.el.hub.querySelector('#file-glb').click();
}

function setupHubDropZone() {
  const zone = ui.el.dropZone;
  const fileInput = ui.el.fileGlb;
  if (fileInput) {
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const target = prompt('Hot-swap which asset id? (e.g. player_jason, police_car, weapon_akmn_rifle)', 'player_jason');
      if (!target) return;
      await onHotSwap(target, await file.arrayBuffer());
    });
  }
  if (!zone) return;
  ['dragenter', 'dragover'].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add('over');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.remove('over');
    })
  );
  zone.addEventListener('drop', async (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const target = prompt('Hot-swap which asset id?', 'police_car');
    if (target) await onHotSwap(target, await file.arrayBuffer());
  });
}

async function onHotSwap(id, buffer) {
  try {
    ui.toast(`Hot-swapping ${id}…`, 'info');
    await hotSwap(id, buffer);
    rebuildInstancesFor(id);
    ui.toast(`${id} swapped live`, 'good');
  } catch (err) {
    console.error(err);
    ui.toast(`Swap failed: ${err.message}`, 'bad');
  }
}

function rebuildInstancesFor(id) {
  // player / vehicles / npcs get re-instantiated on the fly
  if (player && player.modelId === id) {
    const pos = player.position.clone();
    scene.remove(player.root);
    player = new Character(id, { isPlayer: true, onShoot: onPlayerShoot });
    player.reset(pos, cam.yaw);
    scene.add(player.root);
  }
  for (const v of vehicles) {
    if (v.modelId === id) {
      scene.remove(v.root);
      const replacement = new Vehicle(v.id, id);
      replacement.place(v.position, v.yaw);
      if (v === activeVehicle) activeVehicle = replacement;
      v.root = replacement.root;
      v.body = replacement.body;
      v.wheels = replacement.wheels;
      v.rotor = replacement.rotor;
      scene.add(v.root);
    }
  }
}

function switchMap() {
  const next = mapId === 'map_los_santos' ? 'map_indian_bike_stunt' : 'map_los_santos';
  if (!getTemplate(next)) {
    ui.toast('Loading stunt map…', 'info');
    loadModels([next]).then(() => {
      applyMap(next);
    });
    return;
  }
  applyMap(next);
}

async function applyMap(next) {
  mapId = next;
  world.ocean.visible = next === 'map_los_santos';
  world.sky.visible = true;
  world.loadMap(next, { position: new THREE.Vector3() });
  const cols = await loadColliders(next);
  world.setColliders(cols);
  const spawn = next === 'map_los_santos' ? new THREE.Vector3(6, 0.1, 26) : new THREE.Vector3(0, 0.1, 120);
  player.reset(spawn, Math.PI);
  cam.yaw = Math.PI;
  if (activeVehicle) toggleVehicle();
  placeEntitiesForMap(next);
  ui.toast(next === 'map_los_santos' ? 'Los Santos — free roam' : 'Indian Bike Driving 3D stunt park', 'good');
  ui.systemChat(next === 'map_los_santos' ? 'Welcome to Los Santos' : 'Stunt park loaded — ramps, rings and half-pipes ahead');
}

/** teleport (keeps the chase camera) — used by tests and the assets/map tooling */
window.__tp = function tp(x, z, yaw, opts = {}) {
  state.freeCamera = false;
  if (activeVehicle && !opts.keepVehicle) toggleVehicle();
  player.reset(new THREE.Vector3(x, opts.y ?? 0.1, z), yaw ?? Math.PI);
  player.root.visible = true;
  cam.yaw = yaw ?? Math.PI;
  cam.pitch = opts.pitch ?? 0.16;
  runCamera(0, true);
  if (opts.time !== undefined) world.setTimeOfDay(opts.time);
  if (opts.vehicle) {
    const v = vehicles.find((vv) => vv.id === opts.vehicle && !vv.isTraffic) || vehicles[0];
    if (v) {
      player.position.copy(v.position);
      activeVehicle = v;
      player.driveVehicle = v;
      player.root.visible = false;
      state.inVehicle = true;
      ui.showSpeedo(true);
    }
  }
  return [player.position.x, player.position.z];
};

/** debug/verification camera presets: beach, downtown, airport, highway, stunt */
window.__view = function view(name) {
  const presets = {
    skyline: { pos: [-330, 118, 300], look: [200, 34, -140], time: 16.8 },
    beach: { pos: [-560, 20, 40], look: [-120, 6, -120], time: 15.2 },
    pier: { pos: [-470, 14, -60], look: [-190, 8, -140], time: 17.4 },
    airport: { pos: [360, 24, -120], look: [400, 6, -400], time: 13.5 },
    highway: { pos: [700, 30, 260], look: [420, 12, -60], time: 11.0 },
    suburb: { pos: [-120, 26, 300], look: [-140, 4, 40], time: 12.4 },
    sunset: { pos: [-620, 26, 300], look: [160, 12, -140], time: 17.7 },
    night: { pos: [200, 46, 360], look: [180, 22, -160], time: 21.5 },
  };
  const p = presets[name];
  if (!p) return null;
  if (state.inVehicle) toggleVehicle();
  player.reset(new THREE.Vector3(p.pos[0], 0.1, p.pos[2]), Math.atan2(p.look[0] - p.pos[0], p.look[2] - p.pos[2]));
  player.root.visible = false;
  cam.targetDist = 5.4;
  if (p.time !== undefined) world.setTimeOfDay(p.time);
  camera.position.set(p.pos[0], p.pos[1], p.pos[2]);
  const look = new THREE.Vector3(p.look[0], p.look[1], p.look[2]);
  camera.lookAt(look);
  cam.smoothPos.copy(camera.position);
  cam.smoothLook.copy(look);
  state.freeCamera = true;
  return name;
};

function placeEntitiesForMap(map) {
  const stunt = map === 'map_indian_bike_stunt';
  const spots = stunt
    ? [['redbull_rb22', 0, 96, Math.PI], ['ferrari_daytona_sp3', -34, 70, 2.4], ['porsche_911_gt3r', 34, 70, -2.4],
       ['mustang_roush_1996', -30, -20, 1.2], ['police_car', 30, -20, -1.2], ['police_lambo_diablo', 10, -90, 0.2]]
    : [['police_car', -40, 12, 0], ['ferrari_daytona_sp3', 14, 20, 0.3], ['porsche_911_gt3r', 40, 10, -0.4],
       ['mustang_roush_1996', -90, 60, 1.2], ['police_lambo_diablo', 72, 74, 0.8], ['porsche_mission_x', -130, 16, 2.0],
       ['redbull_rb22', 8, 128, 1.6], ['ural_4320_truck', -166, -44, 0.4]];
  let i = 0;
  for (const v of vehicles) {
    if (v.isAircraft || v.isTraffic) continue;
    const s = spots[i % spots.length];
    i++;
    v.place(new THREE.Vector3(s[1] + (i > spots.length ? 8 : 0), 0, s[2]), s[3]);
  }
  for (const n of npcs) {
    const a = Math.random() * Math.PI * 2;
    const r = 30 + Math.random() * 110;
    n.position.set(Math.cos(a) * r, 0.02, (stunt ? 20 : -40) + Math.sin(a) * r);
    n.wanderAngle = a;
  }
}

function togglePhotoMode() {
  state.photoMode = !state.photoMode;
  ui.el.photoFrame.classList.toggle('hidden', !state.photoMode);
  ui.el.hud.style.opacity = state.photoMode ? '0.25' : '1';
  ui.toast(state.photoMode ? 'Photo mode — HUD dimmed' : 'Photo mode off');
}

function applyQuality(level) {
  state.quality = level;
  const q = QUALITY[level];
  bloomPass.enabled = q.post && q.bloom > 0;
  bloomPass.strength = q.bloom;
  if (composer.renderTarget1 && q.msaa !== undefined) {
    composer.renderTarget1.samples = q.msaa;
    composer.renderTarget2.samples = q.msaa;
    composer.renderTarget1.dispose();
    composer.renderTarget2.dispose();
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr) * (state.dataSaver && isTouch ? 0.85 : 1));
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = q.shadow && state.shadows;
  world.sun.castShadow = q.shadow && state.shadows;
  if (world.sun.shadow.map && world.sun.shadow.mapSize.width !== q.shadowMap) {
    world.sun.shadow.map.dispose();
    world.sun.shadow.map = null;
  }
  world.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
  world.lodDistance = q.lod;
  world.scene.fog.density = q.fog;
  const label = ui.root.querySelector('#quality-label');
  if (label) label.textContent = q.name;
  const slider = ui.root.querySelector('#set-quality');
  if (slider) slider.value = String(level);
}

// quality / settings listeners
document.addEventListener('input', (e) => {
  if (e.target.id === 'set-quality') applyQuality(Number(e.target.value));
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'set-datasaver') {
    state.dataSaver = e.target.checked;
    applyQuality(state.quality);
    ui.toast(state.dataSaver ? 'Ultra Data Saver on' : 'Data Saver off', state.dataSaver ? 'good' : 'info');
  }
  if (e.target.id === 'set-shadows') {
    state.shadows = e.target.checked;
    applyQuality(state.quality);
  }
  if (e.target.id === 'set-ptt') {
    voice.setPushToTalk(e.target.checked);
    ui.toast(e.target.checked ? 'Push-to-talk: hold V' : 'Voice always open (VAD)', 'info');
  }
});

// ---------------------------------------------------------------- adaptive quality
const adaptive = { scale: 1, timer: 0, cooldown: 0, low: 0, high: 0 };
function updateAdaptive(dt, fps) {
  if (state.paused || !state.started) return;
  adaptive.timer += dt;
  adaptive.cooldown = Math.max(0, adaptive.cooldown - dt);
  if (adaptive.timer < 1.6) return;
  adaptive.timer = 0;
  if (adaptive.cooldown > 0) return;
  const base = QUALITY[state.quality].dpr * Math.min(window.devicePixelRatio || 1, 2);
  if (fps < 46 && adaptive.scale > 0.62) {
    adaptive.scale = Math.max(0.62, adaptive.scale - 0.12);
    adaptive.cooldown = 2.4;
  } else if (fps > 58 && adaptive.scale < 1) {
    adaptive.scale = Math.min(1, adaptive.scale + 0.06);
    adaptive.cooldown = 3.2;
  } else {
    return;
  }
  renderer.setPixelRatio(base * adaptive.scale);
  renderer.setSize(innerWidth, innerHeight, false);
}

// ---------------------------------------------------------------- main loop
let last = performance.now();
let lastFps = 60;
let lastTris = 0;
let fpsAccum = 0;
let fpsFrames = 0;

/**
 * Headless test hook: `__game.step(ms, n)` advances the simulation without waiting
 * for requestAnimationFrame. Browsers throttle rAF when a page is not visible
 * (headless/shell, background tabs), which otherwise makes automated play tests
 * look like the game is frozen.
 */
let manualMode = false;

function frame(now) {
  if (!manualMode) requestAnimationFrame(frame);
  const rawDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const dt = state.paused ? 0 : rawDt;

  fpsAccum += rawDt;
  fpsFrames++;
  if (fpsAccum > 0.4) {
    lastFps = fpsFrames / fpsAccum;
    fpsAccum = 0;
    fpsFrames = 0;
  }
  if (!state.paused) state.elapsed += dt;

  renderer.info.reset();

  if (state.started) {
    // one physics sub-step per frame, never a giant leap: a backgrounded tab (or a
    // stalled frame) would otherwise hand vehicle physics a huge dt and fling traffic
    updatePlayer(dt);
    updateVehicles(dt);
    updateNPCs(dt);
    updateRemotePlayers(dt);
    updateBullets(dt);
    runCamera(dt);
    updateHUD(dt, lastFps, lastTris);

    // spatial voice
    if (voice.enabled) {
      const peerPositions = new Map();
      for (const [id, av] of remoteAvatars) peerPositions.set(id, av.position);
      voice.updateSpatial(player.position, cam.yaw, peerPositions);
    }
  } else {
    // menu orbit
    cam.yaw += rawDt * 0.06;
    runCamera(rawDt);
  }

  updateAdaptive(rawDt, lastFps);
  world.update(dt || rawDt * (state.started ? 0 : 1), (activeVehicle || player || { position: MAP_CENTER }).position);
  // keep the sun shadow box centred on the action
  world.sky.position.copy(camera.position);
  world.ocean.position.x = camera.position.x - 1500;
  world.ocean.position.z = camera.position.z;

  // ---- audio + VFX housekeeping
  audio.setListener(camera.position, cam.yaw);
  const veh = activeVehicle;
  if (veh && !veh.isAircraft) {
    audio.startEngine();
    const rpm01 = THREE.MathUtils.clamp(Math.abs(veh.speed) / veh.def.top, 0, 1);
    audio.updateEngine(rpm01, Math.abs(input.throttle) || 0, veh.def.type === 'truck' ? 'truck' : veh.def.type === 'bike' ? 'bike' : 'car', veh.position);
    audio.setWind(Math.abs(veh.speed) / 60);
    // gear shift + crash feedback
    const gear = Math.floor(Math.abs(veh.speed) / Math.max(6, veh.def.top / 6));
    if (veh._gear !== undefined && gear !== veh._gear && Math.abs(veh.speed) > 3) audio.gearShift();
    veh._gear = gear;
    if (veh._lastSpeed !== undefined && Math.abs(veh._lastSpeed - Math.abs(veh.speed)) > 6) {
      const f = Math.min(1.5, Math.abs(veh._lastSpeed - Math.abs(veh.speed)) / 18);
      audio.crash(f);
      vfx.impact(veh.position.clone().setY(veh.position.y + 0.6), null, 'metal');
      cam.shake = Math.max(cam.shake, 0.35 * f);
    }
    veh._lastSpeed = Math.abs(veh.speed);
    if (Math.abs(veh.speed) > 4) {
      // tyre smoke + skid marks under heavy braking / drifting
      const slip = Math.abs(veh.steerAngle) * Math.abs(veh.speed);
      if (input.handbrake || (input.brake && Math.abs(veh.speed) > 20) || slip > 0.7) {
        vfx.tyreSmoke(veh.position, Math.min(1, Math.abs(veh.speed) / 40));
        if (veh._skidPrev) {
          for (const side of [-1, 1]) {
            const off = new THREE.Vector3(side * 0.8, 0, -1.2).applyQuaternion(veh.quaternion).add(veh.position);
            vfx.skid(`${veh.id}${side}`, off, off.clone().add(new THREE.Vector3().subVectors(off, veh._skidPrev)));
          }
        }
        veh._skidPrev = veh.position.clone();
      } else {
        veh._skidPrev = null;
      }
    }
  } else if (veh && veh.isAircraft) {
    audio.startEngine();
    audio.updateEngine(Math.abs(veh.speed) / veh.def.top, 1, 'heli', veh.position);
    audio.setWind(0.7);
  } else {
    audio.stopEngine();
    audio.setWind(0);
  }
  audio.updateMusic(rawDt);
  vfx.update(rawDt, camera, player ? player.position : camera.position);
  if (vfx.flash > 0) {
    renderer.toneMappingExposure = 1.0 + vfx.flash * 0.55;
  } else {
    renderer.toneMappingExposure = 1.0;
  }

  if (QUALITY[state.quality].post) {
    gradePass.uniforms.uTime.value = (gradePass.uniforms.uTime.value + rawDt * 12) % 1000;
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
  lastTris = renderer.info.render.triangles;
}

// ---------------------------------------------------------------- go
setupTouch();
window.__bootReady = false;
// A boot that never settles is indistinguishable from a black screen. Give it a
// generous deadline and explain if the device simply cannot load in time.
const bootWatchdog = setTimeout(() => {
  if (window.__bootReady || window.__game?.state?.started) return;
  removeSplash();
  showFatal(
    'Loading is taking much longer than expected',
    'The city has not finished loading on this device. Close other apps to free '
      + 'memory and reopen Los Santos, or try the Performance graphics setting.',
    'boot did not complete within 90s'
  );
}, 90000);

boot()
  .then(() => {
    window.__bootReady = true;
    clearTimeout(bootWatchdog);
    removeSplash();
    requestAnimationFrame(frame);
  })
  .catch((err) => {
    // Without this catch the promise can still be pending forever on a slow
    // device — and any rejection vanishes, leaving a black screen with no clue.
    clearTimeout(bootWatchdog);
    removeSplash();
    const msg = humanize(err);
    showFatal(msg.title, msg.detail, describe(err));
    console.error('boot failed', err);
  });

// expose for debugging / automation
window.__hotswap = onHotSwap;
window.__share = shareRoom;
window.__three = THREE;
window.__game = {
  scene, camera, renderer, world, network, voice, ui,
  get player() { return player; },
  get vehicles() { return vehicles; },
  get fps() { return lastFps; },
  get tris() { return lastTris; },
  state,
  /**
   * Advance N simulated steps of `ms` each (for headless play tests).
   * Each step is clamped to the same 50 ms ceiling the live loop uses — an
   * unclamped step makes vehicle physics explode, which then drags the player
   * along when they are riding.
   */
  step(ms = 16.7, n = 1) {
    manualMode = true;
    const stepMs = Math.min(50, Math.max(1, ms));
    for (let i = 0; i < n; i++) {
      last = performance.now() - stepMs;
      frame(performance.now());
    }
  },
  resume() { manualMode = false; last = performance.now(); requestAnimationFrame(frame); },
};
