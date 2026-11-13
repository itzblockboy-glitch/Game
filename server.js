/**
 * LOS SANTOS — unified game server.
 *  • static hosting for the built client (and raw public/ assets)
 *  • room-based multiplayer relay with compact binary snapshots (≈12 B/player/tick)
 *  • WebRTC signalling for Opus voice chat
 *  • tiny HTTP telemetry endpoint for the "Data Saver" HUD
 */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

const DIST = path.join(__dirname, 'dist');
const PUBLIC = path.join(__dirname, 'public');
const hasDist = fs.existsSync(path.join(DIST, 'index.html'));

const app = express();
app.use(compression({ threshold: 512 }));
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
});

// longest-lived cache for immutable, content-hashed model payloads
const MODEL_MAX_AGE = 'public, max-age=604800, immutable';
app.use('/models', (req, res, next) => {
  res.setHeader('Cache-Control', MODEL_MAX_AGE);
  next();
});
app.use('/draco', (req, res, next) => {
  res.setHeader('Cache-Control', MODEL_MAX_AGE);
  next();
});

if (hasDist) app.use(express.static(DIST, { maxAge: '1h', extensions: ['html'] }));
app.use(express.static(PUBLIC, { maxAge: '1h' }));

app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.size, players: playerCount() }));

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api') || req.path.startsWith('/models')) return next();
  const indexFile = path.join(hasDist ? DIST : PUBLIC, 'index.html');
  if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
  res.status(404).send('Client bundle not built yet — run `npm run build`.');
});

const server = http.createServer(app);

// ---------------------------------------------------------------- multiplayer
const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: false });

/** @type {Map<string, Room>} */
const rooms = new Map();

let nextPlayerId = 1;

function playerCount() {
  let n = 0;
  for (const r of rooms.values()) n += r.clients.size;
  return n;
}

class Room {
  constructor(code) {
    this.code = code;
    this.clients = new Map(); // id -> ws
    this.states = new Map(); // id -> {x,y,z,yaw,flags,vehicle,speed}
    this.lastSnapshot = Buffer.alloc(0);
    this.tickHandle = setInterval(() => this.tick(), 66); // 15 Hz
    this.created = Date.now();
  }

  join(ws, player) {
    this.clients.set(player.id, ws);
    ws.player = player;
    ws.room = this;
    this.broadcastJSON({ t: 'join', id: player.id, name: player.name, players: this.roster() });
    for (const [id, other] of this.clients) {
      if (id === player.id) continue;
      other.send(JSON.stringify({ t: 'join', id: player.id, name: player.name, players: null }));
    }
    console.log(`[room ${this.code}] +${player.name}#${player.id} (${this.clients.size})`);
  }

  roster() {
    return [...this.clients.values()].map((ws) => ({ id: ws.player.id, name: ws.player.name }));
  }

  leave(ws) {
    const p = ws.player;
    if (!p) return;
    this.clients.delete(p.id);
    this.states.delete(p.id);
    this.broadcastJSON({ t: 'leave', id: p.id });
    console.log(`[room ${this.code}] -${p.name}#${p.id} (${this.clients.size})`);
    if (this.clients.size === 0) {
      clearInterval(this.tickHandle);
      rooms.delete(this.code);
      console.log(`[room ${this.code}] closed`);
    }
  }

  broadcastJSON(obj) {
    const data = JSON.stringify(obj);
    for (const ws of this.clients.values()) {
      if (ws.readyState === 1) ws.send(data);
    }
  }

  broadcastRaw(buf, skipId) {
    for (const [id, ws] of this.clients) {
      if (id === skipId) continue;
      if (ws.readyState === 1) ws.send(buf);
    }
  }

  /**
   * Snapshot packet (little endian):
   *   u8 magic 0xA5 | u8 type 0x01 | u8 count |
   *   count × [ u8 id | i16 x | i16 y | i16 z | u8 yaw | u8 flags | u8 vehicle | u8 speed ]
   *  ≈ 12 bytes per player per 66 ms  =>  ~1.5 kbit/s per player
   */
  tick() {
    const ids = [...this.states.keys()];
    if (!ids.length) return;
    const buf = Buffer.alloc(3 + ids.length * 12);
    let o = 0;
    buf.writeUInt8(0xa5, o++);
    buf.writeUInt8(0x01, o++);
    buf.writeUInt8(Math.min(ids.length, 60), o++);
    let written = 0;
    for (const id of ids) {
      if (written >= 60) break;
      const s = this.states.get(id);
      buf.writeUInt8(id & 0xff, o++);
      buf.writeInt16LE(clamp16(s.x * 50), o); o += 2; // 2 cm resolution over ±655 m x
      buf.writeInt16LE(clamp16(s.z * 50), o); o += 2;
      buf.writeInt16LE(clamp16(s.y * 50), o); o += 2;
      buf.writeUInt8((s.yaw * 256) & 0xff, o++);
      buf.writeUInt8(s.flags & 0xff, o++);
      buf.writeUInt8(s.vehicle & 0xff, o++);
      buf.writeUInt8(Math.min(255, Math.abs(s.speed | 0)), o++);
      written++;
    }
    this.lastSnapshot = buf;
    this.broadcastRaw(buf);
  }
}

function clamp16(v) {
  return Math.max(-32767, Math.min(32767, Math.round(v)));
}

function sanitizeName(raw) {
  const name = String(raw ?? '').replace(/[^\w \-.]/g, '').slice(0, 16).trim();
  return name || `Rider${Math.floor(Math.random() * 900 + 100)}`;
}

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('error', () => {});

  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      handleJSON(ws, msg);
      return;
    }
    // -------------------------------------------------- binary client state
    const room = ws.room;
    if (!room || !ws.player) return;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (buf.length < 10 || buf[0] !== 0xa5) return;
    const flags = buf.readUInt8(1);
    const x = buf.readInt16LE(2) / 50;
    const z = buf.readInt16LE(4) / 50;
    const y = buf.readInt16LE(6) / 50;
    const yaw = buf.readUInt8(8) / 256;
    const vehicle = buf.readUInt8(9);
    const speed = buf.length > 10 ? buf.readUInt8(10) : 0;
    room.states.set(ws.player.id, { x, y, z, yaw, flags, vehicle, speed });
    ws.player.lastSeen = Date.now();
    ws.bytesIn = (ws.bytesIn || 0) + buf.length;
  });

  ws.on('close', () => {
    if (ws.room) ws.room.leave(ws);
  });
});

function handleJSON(ws, msg) {
  switch (msg.t) {
    case 'ping':
      safeSend(ws, { t: 'pong', ts: msg.ts });
      break;
    case 'join': {
      if (ws.room) ws.room.leave(ws);
      const code = String(msg.room || 'PUBLIC').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PUBLIC';
      if (!rooms.has(code)) rooms.set(code, new Room(code));
      const room = rooms.get(code);
      if (room.clients.size >= 24) {
        safeSend(ws, { t: 'error', msg: 'Room full (24 players max)' });
        return;
      }
      ws.player = {
        id: nextPlayerId++ & 0xff || 1,
        name: sanitizeName(msg.name),
        joined: Date.now(),
      };
      // avoid id collisions inside the room
      while (room.clients.has(ws.player.id)) ws.player.id = (ws.player.id + 1) & 0xff || 1;
      room.join(ws, ws.player);
      safeSend(ws, { t: 'joined', id: ws.player.id, room: code, tick: 66 });
      break;
    }
    // ------------------------------------------------- WebRTC signalling relay
    case 'voice-ready':
    case 'offer':
    case 'answer':
    case 'ice':
      relayTo(ws, msg);
      break;
    case 'mute':
      relayTo(ws, msg);
      break;
    case 'chat':
      if (ws.room && typeof msg.text === 'string') {
        ws.room.broadcastJSON({
          t: 'chat',
          id: ws.player?.id,
          name: ws.player?.name,
          text: msg.text.slice(0, 200),
        });
      }
      break;
    case 'typing':
      relayTo(ws, msg);
      break;
    default:
      break;
  }
}

function relayTo(ws, msg) {
  const room = ws.room;
  if (!room || !ws.player) return;
  const payload = JSON.stringify({ ...msg, from: ws.player.id, name: ws.player.name });
  if (msg.target) {
    const target = room.clients.get(msg.target);
    if (target && target.readyState === 1) target.send(payload);
  } else {
    for (const [id, client] of room.clients) {
      if (id !== ws.player.id && client.readyState === 1) client.send(payload);
    }
  }
}

function safeSend(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

// prune players that stopped sending state (tab suspended / crashed) so the
// roster never fills up with ghosts
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const [id, ws] of room.clients) {
      if (!ws.player) continue;
      const last = ws.player.lastSeen || ws.player.joined;
      if (now - last > 45000) {
        try {
          ws.close();
        } catch {}
        room.leave(ws);
      }
    }
  }
}, 20000);

// heartbeat: drop dead sockets
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} busy — set PORT=<port> and retry.`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`\n  LOS SANTOS server running:`);
  console.log(`    local    http://localhost:${PORT}`);
  console.log(`    mobile   http://<your-lan-ip>:${PORT}`);
  console.log(`    ws       /ws   (binary snapshots @15 Hz + voice signalling)`);
  console.log(`    client   ${hasDist ? 'dist/ (production build)' : 'public/ (dev, unbundled!)'}\n`);
});
