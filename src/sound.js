/**
 * LOS SANTOS — procedural audio engine.
 *
 * Everything is synthesised in the WebAudio graph at runtime: no .mp3/.ogg to
 * download, which keeps the data budget intact (the game targets < 1 MB first load).
 *
 *   • engine   — multi-oscillator engine driven by RPM, with exhaust burble + turbo
 *   • sfx      — gunshots, impacts, footsteps, jumps, UI clicks, engine starts
 *   • ambience — city hum, wind that rises with speed, distant traffic
 *   • music    — a generative synthwave loop (bass, pad, arpeggio, drums)
 *   • mixer    — master bus, compressor, per-category gains, mute/pause handling
 *
 * Browsers require a user gesture before audio starts, so `Audio.unlock()` is
 * called from the first click / key press.
 */

const A4 = 440;
const note = (semi) => A4 * Math.pow(2, semi / 12);

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.musicOn = true;
    this.master = 0.0;
    this.buses = {};
    this.engine = null;
    this._musicTimer = 0;
    this._musicStep = 0;
    this._lastFootstep = 0;
    this._ambienceNodes = [];
    this._listener = { x: 0, y: 0, z: 0, fwd: { x: 0, y: 0, z: 1 } };
    this._pending = [];
  }

  // -------------------------------------------------------------- lifecycle
  /** must be called from a user gesture */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    // master chain: bus gains -> compressor -> limiter-ish -> out
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 22;
    comp.ratio.value = 3.2;
    comp.attack.value = 0.008;
    comp.release.value = 0.22;
    const master = ctx.createGain();
    master.gain.value = 0.85;
    comp.connect(master).connect(ctx.destination);
    this.out = comp;

    const bus = (name, gain) => {
      const g = ctx.createGain();
      g.gain.value = gain;
      g.connect(comp);
      this.buses[name] = g;
      return g;
    };
    bus('engine', 0.5);
    bus('sfx', 0.75);
    bus('ambience', 0.22);
    bus('music', 0.3);
    bus('voice', 1.0);

    // shared white-noise buffer (reused by every noise-based effect)
    const len = ctx.sampleRate * 2;
    const nb = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuffer = nb;

    this.ready = true;
    this.startAmbience();
    for (const fn of this._pending.splice(0)) fn(this);
    return true;
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
  setMuted(muted) {
    this.enabled = !muted;
    if (this.out) this.out.gain?.setTargetAtTime?.(muted ? 0 : 1, this.ctx.currentTime, 0.05);
    if (this.ctx) this.out.disconnect();
  }

  get time() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  now(fn) {
    if (!this.ready || !this.ctx) return;
    fn(this);
  }

  // -------------------------------------------------------------- helpers
  _gain(value, target) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    if (target) g.connect(target);
    return g;
  }

  _noise(duration, { type = 'lowpass', freq = 1200, q = 1, gain = 0.3, bus = 'sfx', pan = 0 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + duration);
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.connect(filt);
    if (panner) {
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      filt.connect(g).connect(panner).connect(this.buses[bus]);
    } else {
      filt.connect(g).connect(this.buses[bus]);
    }
    src.start(t);
    src.stop(t + duration + 0.05);
    return { src, filt, g };
  }

  _tone(freq, duration, { type = 'sine', gain = 0.2, bus = 'sfx', bend = 0, pan = 0, attack = 0.005 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const t = ctx.currentTime;
    if (bend) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * bend), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + duration);
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    o.connect(g);
    if (panner) {
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(panner).connect(this.buses[bus]);
    } else {
      g.connect(this.buses[bus]);
    }
    o.start(t);
    o.stop(t + duration + 0.02);
    return o;
  }

  // -------------------------------------------------------------- one-shots
  gunshot(kind = 'pistol') {
    this.now(() => {
      const loud = kind === 'rifle' ? 1.0 : kind === 'smg' ? 0.75 : 0.9;
      // body: filtered noise crack
      this._noise(0.14, { type: 'bandpass', freq: kind === 'rifle' ? 1500 : 2100, q: 0.9, gain: 0.55 * loud });
      // sub thump
      this._tone(kind === 'rifle' ? 95 : 130, 0.16, { type: 'triangle', gain: 0.32 * loud, bend: 0.42 });
      // mechanical click tail
      this._noise(0.05, { type: 'highpass', freq: 3800, gain: 0.16 * loud });
      if (kind === 'rifle') this._noise(0.4, { type: 'lowpass', freq: 700, gain: 0.18 }); // report
    });
  }

  dryFire() {
    this.now(() => {
      this._noise(0.035, { type: 'highpass', freq: 2600, gain: 0.16 });
      this._tone(1800, 0.03, { type: 'square', gain: 0.05 });
    });
  }

  impact(kind = 'metal', pos) {
    this.now(() => {
      const pan = pos ? this._pan(pos) : 0;
      if (kind === 'flesh') {
        this._noise(0.11, { type: 'lowpass', freq: 620, gain: 0.3, pan });
      } else {
        this._noise(0.09, { type: 'bandpass', freq: 2600 + Math.random() * 900, q: 2.4, gain: 0.26, pan });
        this._tone(900 + Math.random() * 500, 0.07, { type: 'square', gain: 0.06, pan, bend: 0.6 });
      }
    });
  }

  footstep(surface = 'concrete', sprint = false) {
    this.now(() => {
      const t = this.ctx.currentTime;
      if (t - this._lastFootstep < 0.18) return;
      this._lastFootstep = t;
      const g = sprint ? 0.2 : 0.13;
      this._noise(0.085, { type: 'bandpass', freq: surface === 'sand' ? 900 : surface === 'grass' ? 1500 : 2400, q: 0.8, gain: g });
      this._tone(70, 0.07, { type: 'sine', gain: g * 0.5, bend: 0.7 });
    });
  }

  jump() {
    this.now(() => {
      this._tone(300, 0.16, { type: 'sine', gain: 0.09, bend: 1.8 });
      this._noise(0.12, { type: 'highpass', freq: 1800, gain: 0.12 });
    });
  }

  land(hardness = 0.5) {
    this.now(() => {
      this._tone(88, 0.2, { type: 'sine', gain: 0.14 + hardness * 0.22, bend: 0.5 });
      this._noise(0.14, { type: 'lowpass', freq: 900, gain: 0.12 + hardness * 0.16 });
    });
  }

  crash(force = 1) {
    this.now(() => {
      const f = Math.min(1.6, force);
      this._noise(0.5 * f, { type: 'lowpass', freq: 1400, gain: 0.42 * f });
      this._noise(0.26, { type: 'bandpass', freq: 3200, q: 1.4, gain: 0.3 * f });
      this._tone(62, 0.5 * f, { type: 'triangle', gain: 0.3 * f, bend: 0.45 });
    });
  }

  gearShift() {
    this.now(() => {
      this._noise(0.06, { type: 'highpass', freq: 3200, gain: 0.12 });
      this._tone(220, 0.05, { type: 'square', gain: 0.05, bend: 1.5 });
    });
  }

  siren(on) {
    this.now(() => {
      if (on && !this._siren) {
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = 620;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 1.6;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 260;
        lfo.connect(lfoGain).connect(o.frequency);
        const g = ctx.createGain();
        g.gain.value = 0.0;
        g.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 0.3);
        o.connect(g).connect(this.buses.sfx);
        o.start();
        lfo.start();
        this._siren = { o, lfo, g };
      } else if (!on && this._siren) {
        const { o, lfo, g } = this._siren;
        g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.2);
        o.stop(this.ctx.currentTime + 0.25);
        lfo.stop(this.ctx.currentTime + 0.25);
        this._siren = null;
      }
    });
  }

  ui(kind = 'click') {
    this.now(() => {
      if (kind === 'hover') this._tone(1200, 0.03, { type: 'sine', gain: 0.03 });
      else if (kind === 'error') this._tone(180, 0.18, { type: 'square', gain: 0.07, bend: 0.6 });
      else if (kind === 'success') {
        this._tone(660, 0.09, { type: 'sine', gain: 0.09 });
        setTimeout(() => this.now(() => this._tone(990, 0.12, { type: 'sine', gain: 0.07 })), 70);
      } else this._tone(880, 0.05, { type: 'sine', gain: 0.05 });
    });
  }

  horn() {
    this.now(() => {
      this._tone(392, 0.5, { type: 'sawtooth', gain: 0.1, bus: 'sfx' });
      this._tone(494, 0.5, { type: 'sawtooth', gain: 0.09, bus: 'sfx' });
    });
  }

  // -------------------------------------------------------------- engine
  /** continuous engine voice; call every frame with rpm 0..1 and throttle 0..1 */
  startEngine() {
    this.now(() => {
      if (this.engine) return;
      const ctx = this.ctx;
      const out = this._gain(0.0, this.buses.engine);
      // two detuned saws + a square sub = a convincing IC engine
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
      const o2 = ctx.createOscillator(); o2.type = 'sawtooth';
      const o3 = ctx.createOscillator(); o3.type = 'square';
      const sub = ctx.createOscillator(); sub.type = 'sine';
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 900;
      filt.Q.value = 3.2;
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        const x = (i / 512) - 1;
        curve[i] = Math.tanh(x * 2.4);
      }
      shaper.curve = curve;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      for (const o of [o1, o2, o3, sub]) {
        const g = ctx.createGain();
        g.gain.value = o === sub ? 0.5 : o === o3 ? 0.18 : 0.34;
        o.connect(g).connect(filt);
      }
      filt.connect(shaper);
      if (pan) shaper.connect(pan).connect(out);
      else shaper.connect(out);
      o1.start(); o2.start(); o3.start(); sub.start();
      this.engine = { o1, o2, o3, sub, filt, out, pan, rpm: 0, load: 0 };
      out.gain.setTargetAtTime(0.5, ctx.currentTime, 0.25);
    });
  }

  stopEngine() {
    this.now(() => {
      if (!this.engine) return;
      const { out, o1, o2, o3, sub } = this.engine;
      const t = this.ctx.currentTime;
      out.gain.setTargetAtTime(0, t, 0.12);
      for (const o of [o1, o2, o3, sub]) o.stop(t + 0.6);
      this.engine = null;
    });
  }

  updateEngine(rpm01, load01, kind = 'car', position) {
    if (!this.ready || !this.engine) return;
    const e = this.engine;
    const t = this.ctx.currentTime;
    const base = kind === 'bike' ? 68 : kind === 'truck' ? 34 : kind === 'heli' ? 120 : 48;
    const f = base + rpm01 * (kind === 'truck' ? 90 : kind === 'bike' ? 300 : 240);
    const lerp = 0.09;
    e.o1.frequency.setTargetAtTime(f, t, lerp);
    e.o2.frequency.setTargetAtTime(f * 1.005, t, lerp);
    e.o3.frequency.setTargetAtTime(f * 0.5, t, lerp);
    e.sub.frequency.setTargetAtTime(f * 0.25, t, lerp);
    e.filt.frequency.setTargetAtTime(420 + rpm01 * 2600 + load01 * 900, t, 0.08);
    e.out.gain.setTargetAtTime(0.16 + load01 * 0.34, t, 0.12);
    if (e.pan && position) e.pan.pan.setTargetAtTime(this._pan(position), t, 0.1);
  }

  // -------------------------------------------------------------- ambience
  startAmbience() {
    const ctx = this.ctx;
    const bus = this.buses.ambience;
    // city hum: two filtered noise beds
    const make = (freq, q, gain, rate) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      src.playbackRate.value = rate;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(f).connect(g).connect(bus);
      src.start();
      return { src, f, g };
    };
    this._hum = make(220, 0.7, 0.16, 0.5);
    this._air = make(1200, 0.5, 0.05, 0.7);
    // subtle wind that rises with vehicle speed
    this._wind = make(600, 0.3, 0.0, 0.9);
  }

  setWind(amount) {
    if (!this._wind || !this.ctx) return;
    this._wind.g.gain.setTargetAtTime(Math.min(0.22, amount * 0.22), this.ctx.currentTime, 0.3);
    this._wind.f.frequency.setTargetAtTime(500 + amount * 1400, this.ctx.currentTime, 0.3);
  }

  // -------------------------------------------------------------- music
  /** generative synthwave: Dm – Bb – F – C, 100 BPM, bass + pad + arp + drums */
  startMusic() {
    if (!this.ready) return;
    this.musicOn = true;
    this._musicStep = 0;
    this._musicTimer = 0;
  }

  stopMusic() {
    this.musicOn = false;
    if (this.buses.music && this.ctx) this.buses.music.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
  }

  updateMusic(dt) {
    if (!this.musicOn || !this.ready) return;
    if (this.buses.music.gain.value < 0.29) this.buses.music.gain.setTargetAtTime(0.3, this.ctx.currentTime, 0.6);
    const stepDur = 60 / 100 / 4; // 16th notes at 100 BPM
    this._musicTimer -= dt;
    if (this._musicTimer > 0) return;
    this._musicTimer += stepDur;
    this._playStep(this._musicStep++);
  }

  _playStep(step) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const bus = this.buses.music;
    const bar = Math.floor(step / 16) % 4;
    const beat = step % 16;
    const roots = [-7, -12, -14, -10]; // D, Bb, F, C as semitone offsets from A4
    const root = roots[bar];
    // ---- pad every bar
    if (beat === 0) {
      for (const iv of [0, 3, 7, 12]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = note(root + iv);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 900;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.045, t + 0.4);
        g.gain.linearRampToValueAtTime(0, t + 16 * (60 / 100 / 4));
        o.connect(f).connect(g).connect(bus);
        o.start(t);
        o.stop(t + 16 * (60 / 100 / 4) + 0.1);
      }
    }
    // ---- bass on 8ths
    if (beat % 2 === 0) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = note(root - 12);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 320;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(f).connect(g).connect(bus);
      o.start(t);
      o.stop(t + 0.24);
    }
    // ---- arpeggio
    const arp = [0, 7, 12, 15, 19, 15, 12, 7];
    if (beat % 1 === 0) {
      const n = arp[(step + bar * 3) % arp.length];
      this._musicArp(root + 12 + n, t, bus);
    }
    // ---- drums
    if (beat === 0 || beat === 8) {
      this._tone(58, 0.22, { type: 'sine', gain: 0.3, bus: 'music', bend: 0.45 });
    }
    if (beat === 4 || beat === 12) {
      this._noise(0.16, { type: 'bandpass', freq: 1900, q: 0.8, gain: 0.16, bus: 'music' });
    }
    if (beat % 2 === 1) {
      this._noise(0.04, { type: 'highpass', freq: 7000, gain: 0.07, bus: 'music' });
    }
  }

  _musicArp(freq, t, bus) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.035, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.2);
  }

  // -------------------------------------------------------------- spatial
  setListener(pos, yaw) {
    this._listener.x = pos.x;
    this._listener.y = pos.y;
    this._listener.z = pos.z;
    this._listener.fwd = { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
  }

  _pan(pos) {
    const l = this._listener;
    const dx = pos.x - l.x;
    const dz = pos.z - l.z;
    const right = { x: l.fwd.z, z: -l.fwd.x };
    const d = Math.hypot(dx, dz) || 1;
    return Math.max(-0.9, Math.min(0.9, (dx * right.x + dz * right.z) / d));
  }

  /** distance attenuation for world sounds (0..1) */
  gainAt(pos, falloff = 40) {
    const l = this._listener;
    const d = Math.hypot(pos.x - l.x, pos.z - l.z);
    return Math.max(0, 1 - d / falloff);
  }
}

export const audio = new GameAudio();
