/**
 * In-game mod menu.
 *
 * Every toggle writes to real game state (`game.player`, `game.vehicles`,
 * `game.world`, the physics helpers) — nothing here is decorative. The panel is
 * built with plain DOM + the existing glassmorphism CSS variables so it costs
 * no extra draw calls and never blocks the render loop.
 *
 * Controls: F2 / the HUD button opens it. Escape or the X closes it.
 */
import * as THREE from 'three';

const ROWS = [
  {
    title: 'Player',
    items: [
      { id: 'godmode', label: 'God Mode', hint: 'Never take damage', type: 'toggle' },
      { id: 'infiniteAmmo', label: 'Infinite Ammo', hint: 'Magazines never deplete', type: 'toggle' },
      { id: 'noclip', label: 'No Clip', hint: 'Fly through geometry', type: 'toggle' },
      { id: 'superJump', label: 'Super Jump', hint: 'Launch into the air', type: 'toggle' },
      {
        id: 'moveSpeed', label: 'Move Speed', hint: 'Walk / run multiplier',
        type: 'range', min: 0.5, max: 5, step: 0.1, value: 1,
      },
      {
        id: 'gravity', label: 'Gravity', hint: 'Lunar to earth-normal',
        type: 'range', min: 0.1, max: 2, step: 0.05, value: 1,
      },
    ],
  },
  {
    title: 'World',
    items: [
      {
        id: 'timeOfDay', label: 'Time of Day', hint: 'Sun angle',
        type: 'range', min: 0, max: 24, step: 0.25, value: 12,
      },
      { id: 'freezeTime', label: 'Freeze Time', hint: 'Lock the day cycle', type: 'toggle' },
      { id: 'noTraffic', label: 'Remove Traffic', hint: 'Clear parked & moving cars', type: 'action' },
      { id: 'clearWanted', label: 'Clear Wanted Level', hint: 'Lose the police instantly', type: 'action' },
      { id: 'teleportBeach', label: 'Teleport: Beach', hint: 'Vespucci shoreline', type: 'action' },
      { id: 'teleportDowntown', label: 'Teleport: Downtown', hint: 'Maze Bank area', type: 'action' },
      { id: 'healPlayer', label: 'Restore Health & Armour', hint: 'Full reset', type: 'action' },
    ],
  },
  {
    title: 'Vehicle Spawning',
    items: [
      { id: 'spawnFerrari', label: 'Spawn Ferrari Daytona SP3', hint: 'Super car', type: 'action' },
      { id: 'spawnPorsche', label: 'Spawn Porsche 911 GT3 R', hint: 'Track car', type: 'action' },
      { id: 'spawnBike', label: 'Spawn BMW S1000RR', hint: 'Superbike', type: 'action' },
      { id: 'spawnPolice', label: 'Spawn Police Cruiser', hint: 'With siren', type: 'action' },
      { id: 'spawnHeli', label: 'Spawn Helicopter', hint: 'Air support', type: 'action' },
      { id: 'fixVehicle', label: 'Repair Current Vehicle', hint: 'Undo all damage', type: 'action' },
    ],
  },
  {
    title: 'Graphics & Performance',
    items: [
      {
        id: 'exposure', label: 'Exposure', hint: 'Tone-mapping brightness',
        type: 'range', min: 0.3, max: 2, step: 0.02, value: 0.92,
      },
      {
        id: 'bloom', label: 'Bloom', hint: 'Glow on bright surfaces',
        type: 'range', min: 0, max: 2, step: 0.05, value: 0.42,
      },
      {
        id: 'fov', label: 'Field of View', hint: 'Camera lens',
        type: 'range', min: 55, max: 105, step: 1, value: 72,
      },
      { id: 'showFps', label: 'Show FPS', hint: 'Performance counter', type: 'toggle', on: true },
      { id: 'wireframe', label: 'Wireframe', hint: 'Debug view', type: 'toggle' },
    ],
  },
  {
    title: 'Audio & Voice',
    items: [
      { id: 'muteAudio', label: 'Mute All Audio', hint: 'Silence the mix', type: 'toggle' },
      { id: 'micTest', label: 'Test Microphone', hint: 'Check voice input level', type: 'action' },
    ],
  },
];

export class ModMenu {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.state = {
      godmode: false, infiniteAmmo: false, noclip: false, superJump: false,
      moveSpeed: 1, gravity: 1, timeOfDay: 12, freezeTime: false,
      exposure: 0.92, bloom: 0.42, fov: 72, showFps: true, wireframe: false,
      muteAudio: false,
    };
    this.root = null;
    this._build();
    this._bindKeys();
  }

  // ------------------------------------------------------------------ build
  _build() {
    const root = document.createElement('div');
    root.id = 'modmenu';
    root.className = 'modmenu';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Mod Menu');
    root.setAttribute('aria-hidden', 'true');

    const head = document.createElement('header');
    head.className = 'modmenu-head';
    head.innerHTML =
      '<span class="modmenu-title">Mod Menu</span>' +
      '<span class="modmenu-sub">live game state</span>' +
      '<button class="modmenu-x" type="button" aria-label="Close mod menu">&times;</button>';
    root.appendChild(head);

    const body = document.createElement('div');
    body.className = 'modmenu-body';

    for (const group of ROWS) {
      const sec = document.createElement('section');
      sec.className = 'modmenu-group';
      const h = document.createElement('h3');
      h.textContent = group.title;
      sec.appendChild(h);

      for (const item of group.items) {
        sec.appendChild(this._row(item));
      }
      body.appendChild(sec);
    }
    root.appendChild(body);

    const foot = document.createElement('footer');
    foot.className = 'modmenu-foot';
    foot.textContent = 'F2 toggles this panel · changes apply instantly';
    root.appendChild(foot);

    document.body.appendChild(root);
    this.root = root;

    root.querySelector('.modmenu-x').addEventListener('click', () => this.toggle(false));
    // clicking the dimmed backdrop closes, clicking inside the card does not
    root.addEventListener('pointerdown', (e) => {
      if (e.target === root) this.toggle(false);
    });

    // HUD entry point
    const btn = document.getElementById('btn-mod');
    if (btn) btn.addEventListener('click', () => this.toggle());
  }

  _row(item) {
    const row = document.createElement('div');
    row.className = 'modmenu-row';

    const meta = document.createElement('div');
    meta.className = 'modmenu-meta';
    const label = document.createElement('div');
    label.className = 'modmenu-label';
    label.textContent = item.label;
    const hint = document.createElement('div');
    hint.className = 'modmenu-hint';
    hint.textContent = item.hint || '';
    meta.appendChild(label);
    meta.appendChild(hint);
    row.appendChild(meta);

    if (item.type === 'toggle') {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'modmenu-switch';
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-label', item.label);
      const on = item.on ?? this.state[item.id] ?? false;
      sw.setAttribute('aria-checked', String(on));
      sw.classList.toggle('is-on', on);
      sw.innerHTML = '<span></span>';
      sw.addEventListener('click', () => {
        const next = sw.getAttribute('aria-checked') !== 'true';
        sw.setAttribute('aria-checked', String(next));
        sw.classList.toggle('is-on', next);
        this.state[item.id] = next;
        this._apply(item.id, next);
      });
      row.appendChild(sw);
    } else if (item.type === 'range') {
      const wrap = document.createElement('div');
      wrap.className = 'modmenu-range';
      const out = document.createElement('output');
      out.textContent = String(item.value);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = item.min;
      input.max = item.max;
      input.step = item.step;
      input.value = item.value;
      input.setAttribute('aria-label', item.label);
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        out.textContent = String(v);
        this.state[item.id] = v;
        this._apply(item.id, v);
      });
      wrap.appendChild(input);
      wrap.appendChild(out);
      row.appendChild(wrap);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'modmenu-action';
      btn.textContent = 'Run';
      btn.setAttribute('aria-label', item.label);
      btn.addEventListener('click', () => {
        this._apply(item.id, true);
        btn.classList.add('is-fired');
        setTimeout(() => btn.classList.remove('is-fired'), 420);
      });
      row.appendChild(btn);
    }
    return row;
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F2') {
        e.preventDefault();
        this.toggle();
      } else if (e.key === 'Escape' && this.open) {
        this.toggle(false);
      }
    });
  }

  toggle(force) {
    this.open = force === undefined ? !this.open : force;
    this.root.classList.toggle('is-open', this.open);
    this.root.setAttribute('aria-hidden', String(!this.open));
    document.body.classList.toggle('modmenu-open', this.open);
  }

  // ---------------------------------------------------------------- actions
  _apply(id, value) {
    const g = this.game;
    const player = g.player;
    const world = g.world;

    switch (id) {
      // ---- player
      case 'godmode':
        if (player) player.godmode = value;
        break;
      case 'infiniteAmmo':
        if (player) player.infiniteAmmo = value;
        break;
      case 'noclip':
        if (player) {
          player.noclip = value;
          if (player.body) player.body.collisionResponse = !value;
        }
        break;
      case 'superJump':
        if (player) player.superJump = value;
        break;
      case 'moveSpeed':
        if (player) player.speedScale = value;
        break;
      case 'gravity':
        if (player && player.body && player.body.world) {
          player.body.world.gravity.y = -9.82 * value;
        }
        break;

      // ---- world
      case 'timeOfDay':
        this.state.timeOfDay = value;
        if (world && world.setTimeOfDay) world.setTimeOfDay(value);
        else if (world && world.sunLight) {
          const a = ((value - 6) / 24) * Math.PI * 2;
          world.sunLight.position.set(Math.cos(a) * 120, Math.max(8, Math.sin(a) * 120), 40);
        }
        break;
      case 'freezeTime':
        if (world) world.freezeTime = value;
        break;
      case 'noTraffic': {
        if (!g.vehicles) break;
        let n = 0;
        for (const v of g.vehicles.slice()) {
          if (v.occupied) continue;
          if (v.root && v.root.parent) v.root.parent.remove(v.root);
          n++;
        }
        g.vehicles.length = 0;
        this._toast(`Cleared ${n} vehicles`);
        break;
      }
      case 'clearWanted':
        if (player) {
          player.wanted = 0;
          player.heat = 0;
        }
        if (g.world && g.world.setWanted) g.world.setWanted(0);
        this._toast('Wanted level cleared');
        break;
      case 'teleportBeach':
        this._teleport(-1250, 380);
        break;
      case 'teleportDowntown':
        this._teleport(220, -140);
        break;
      case 'healPlayer':
        if (player) {
          if (typeof player.heal === 'function') player.heal(999);
          else {
            player.health = player.maxHealth || 100;
            player.armour = player.maxArmour || 100;
          }
        }
        this._toast('Health and armour restored');
        break;

      // ---- vehicles
      case 'spawnFerrari':
        this._spawn('ferrari_daytona_sp3');
        break;
      case 'spawnPorsche':
        this._spawn('porsche_911_gt3r');
        break;
      case 'spawnBike':
        this._spawn('bmw_s1000rr');
        break;
      case 'spawnPolice':
        this._spawn('police_car');
        break;
      case 'spawnHeli':
        this._spawn('little_bird_helicopter');
        break;
      case 'fixVehicle': {
        const v = player && player.vehicle;
        if (v) {
          v.health = 100;
          this._toast('Vehicle repaired');
        } else this._toast('Not in a vehicle');
        break;
      }

      // ---- graphics
      case 'exposure':
        if (g.renderer) g.renderer.toneMappingExposure = value;
        break;
      case 'bloom':
        if (g.bloomPass) g.bloomPass.strength = value;
        break;
      case 'fov':
        if (g.camera) {
          g.camera.fov = value;
          g.camera.updateProjectionMatrix();
        }
        break;
      case 'showFps': {
        const el = document.getElementById('fps-pill');
        if (el) el.style.display = value ? '' : 'none';
        break;
      }
      case 'wireframe':
        if (g.scene) {
          g.scene.traverse((o) => {
            if (o.isMesh && o.material && !Array.isArray(o.material)) {
              o.material.wireframe = value;
            }
          });
        }
        break;

      // ---- audio
      case 'muteAudio':
        if (g.audio && g.audio.setMuted) g.audio.setMuted(value);
        else if (g.world && g.world.audio && g.world.audio.setMuted) g.world.audio.setMuted(value);
        break;
      case 'micTest':
        this._micTest();
        break;
      default:
        break;
    }
  }

  _teleport(x, z) {
    const g = this.game;
    if (typeof window.__tp === 'function') {
      window.__tp(x, z, 0);
      this._toast('Teleported');
      return;
    }
    const p = g.player;
    if (p && p.position) {
      p.position.set(x, 40, z);
      if (p.body && p.body.position) {
        p.body.position.set(x, 40, z);
        p.body.velocity?.set?.(0, 0, 0);
      }
      this._toast('Teleported');
    }
  }

  _spawn(modelId) {
    const g = this.game;
    const p = g.player;
    const at = p && p.position ? p.position : new THREE.Vector3(0, 0, 0);
    const pos = new THREE.Vector3(at.x, 1, at.z + 6);
    try {
      if (typeof window.__spawnVehicle === 'function') {
        window.__spawnVehicle(modelId, pos);
        this._toast(`Spawned ${modelId}`);
        return;
      }
      if (g.spawnVehicle) {
        g.spawnVehicle(modelId, pos);
        this._toast(`Spawned ${modelId}`);
        return;
      }
      this._toast('Spawn hook unavailable');
    } catch (err) {
      console.warn('modmenu spawn failed', err);
      this._toast('Spawn failed');
    }
  }

  async _micTest() {
    try {
      if (this.game.voice && this.game.voice.enabled) {
        this._toast('Voice chat is enabled — speak to test');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      let peak = 0;
      const started = performance.now();
      const tick = () => {
        an.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        peak = Math.max(peak, sum / buf.length);
        if (performance.now() - started < 2500) requestAnimationFrame(tick);
        else {
          stream.getTracks().forEach((t) => t.stop());
          ctx.close();
          this._toast(peak > 4 ? `Microphone OK (level ${peak.toFixed(0)})` : 'Microphone silent');
        }
      };
      tick();
      this._toast('Listening…');
    } catch (err) {
      this._toast('Microphone blocked');
      console.warn('mic test', err);
    }
  }

  _toast(msg) {
    if (this.game.ui && this.game.ui.toast) {
      this.game.ui.toast(msg);
      return;
    }
    let t = document.getElementById('modmenu-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'modmenu-toast';
      t.className = 'modmenu-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('is-on'), 1800);
  }
}
