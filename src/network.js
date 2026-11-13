/**
 * Multiplayer transport.
 *  • binary 11-byte client state @ 20 Hz  (~1.8 kbit/s)
 *  • binary server snapshots @ 15 Hz      (~12 B/player → ~1.4 kbit/s/player)
 *  • JSON only for join/leave/chat/signalling (never per frame)
 *  • ping/jitter measurement for the Data Saver HUD
 */
const MAGIC = 0xa5;

export class Network {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.room = 'PUBLIC';
    this.myId = 0;
    this.name = '';
    this.players = new Map(); // id -> { name, state }
    this.latency = 0;
    this.handlers = {
      chat: [],
      join: [],
      leave: [],
      signal: [],
      status: [],
      error: [],
      welcome: [],
    };
    this.bytesOut = 0;
    this.bytesIn = 0;
    this.packetsOut = 0;
    this.packetsIn = 0;
    this._sendTimer = null;
    this._pingTimer = null;
    this._stateProvider = null;
  }

  on(evt, fn) {
    if (!this.handlers[evt]) this.handlers[evt] = [];
    this.handlers[evt].push(fn);
    return this;
  }

  _emit(evt, ...args) {
    for (const fn of this.handlers[evt] || []) fn(...args);
  }

  connect({ room = 'PUBLIC', name = 'Player' } = {}) {
    this.room = (room || 'PUBLIC').toUpperCase();
    this.name = name;
    if (this.ws) this.disconnect();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.connected = true;
      this._emit('status', { connected: true });
      this.sendJSON({ t: 'join', room: this.room, name: this.name });
      this._startLoops();
    };

    this.ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        this._handleJSON(JSON.parse(ev.data));
        return;
      }
      this._handleBinary(new DataView(ev.data));
    };

    this.ws.onclose = () => {
      this.connected = false;
      this._stopLoops();
      this._emit('status', { connected: false });
    };

    this.ws.onerror = () => {
      this._emit('error', 'connection');
    };
  }

  disconnect() {
    this._stopLoops();
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.connected = false;
    this.players.clear();
  }

  _startLoops() {
    this._stopLoops();
    // ---- state broadcast @20 Hz
    this._sendTimer = setInterval(() => {
      if (!this.connected || !this._stateProvider) return;
      const s = this._stateProvider();
      if (!s) return;
      const buf = new ArrayBuffer(11);
      const v = new DataView(buf);
      v.setUint8(0, MAGIC);
      v.setUint8(1, s.flags & 0xff);
      v.setInt16(2, clamp16(s.x * 50), true);
      v.setInt16(4, clamp16(s.z * 50), true);
      v.setInt16(6, clamp16(s.y * 50), true);
      v.setUint8(8, (Math.round((s.yaw / (Math.PI * 2)) * 256) + 256) % 256);
      v.setUint8(9, s.vehicle & 0xff);
      v.setUint8(10, Math.min(255, Math.abs(Math.round(s.speed))));
      if (this.ws?.readyState === 1) {
        this.ws.send(buf);
        this.bytesOut += buf.byteLength;
        this.packetsOut++;
      }
    }, 50);

    // ---- ping every 2 s
    this._pingTimer = setInterval(() => {
      this.sendJSON({ t: 'ping', ts: performance.now() });
    }, 2000);
  }

  _stopLoops() {
    clearInterval(this._sendTimer);
    clearInterval(this._pingTimer);
    this._sendTimer = this._pingTimer = null;
  }

  setStateProvider(fn) {
    this._stateProvider = fn;
  }

  sendJSON(obj) {
    if (this.ws?.readyState === 1) {
      const s = JSON.stringify(obj);
      this.ws.send(s);
      this.bytesOut += s.length;
      this.packetsOut++;
    }
  }

  sendChat(text) {
    this.sendJSON({ t: 'chat', text });
  }

  signal(msg) {
    this.sendJSON(msg);
  }

  _handleJSON(msg) {
    switch (msg.t) {
      case 'joined':
        this.myId = msg.id;
        this._emit('welcome', { id: msg.id, room: msg.room });
        break;
      case 'join':
        this.players.set(msg.id, { name: msg.name, state: { x: 0, y: 0, z: 0, yaw: 0, flags: 0, vehicle: 0, speed: 0 } });
        this._emit('join', msg);
        break;
      case 'leave':
        if (this.players.has(msg.id)) this.players.delete(msg.id);
        this._emit('leave', msg);
        break;
      case 'pong':
        this.latency = Math.round(performance.now() - msg.ts);
        this._emit('status', { latency: this.latency });
        break;
      case 'chat':
        this._emit('chat', msg);
        break;
      case 'error':
        this._emit('error', msg.msg);
        break;
      // ---- WebRTC voice signalling
      case 'voice-ready':
      case 'offer':
      case 'answer':
      case 'ice':
      case 'mute':
      case 'typing':
        this._emit('signal', msg);
        break;
      default:
        break;
    }
  }

  _handleBinary(view) {
    this.bytesIn += view.byteLength;
    this.packetsIn++;
    if (view.getUint8(0) !== MAGIC) return;
    const type = view.getUint8(1);
    if (type !== 0x01) return;
    const count = view.getUint8(2);
    let o = 3;
    for (let i = 0; i < count; i++) {
      const id = view.getUint8(o);
      const x = view.getInt16(o + 1, true) / 50;
      const z = view.getInt16(o + 3, true) / 50;
      const y = view.getInt16(o + 5, true) / 50;
      const yaw = (view.getUint8(o + 7) / 256) * Math.PI * 2;
      const flags = view.getUint8(o + 8);
      const vehicle = view.getUint8(o + 9);
      const speed = view.getUint8(o + 10);
      o += 12;
      if (id === this.myId) continue;
      let p = this.players.get(id);
      if (!p) {
        p = { name: `Rider ${id}`, state: {} };
        this.players.set(id, p);
      }
      p.state = { x, y, z, yaw, flags, vehicle, speed, t: performance.now() };
    }
  }

  /** kb/s estimates for the HUD */
  stats() {
    return {
      latency: this.latency,
      players: this.players.size,
      bytesOut: this.bytesOut,
      bytesIn: this.bytesIn,
    };
  }
}

function clamp16(v) {
  return Math.max(-32767, Math.min(32767, Math.round(v)));
}

// flag bits shared with server / remote entities
export const FLAG = {
  MOVING: 1,
  SPRINT: 2,
  AIM: 4,
  SWIM: 8,
  AIR: 16,
  SHOOT: 32,
  SPEAK: 64,
  DEAD: 128,
};
