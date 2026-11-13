/**
 * Asset pipeline.
 *  • fetches /models/manifest.json once
 *  • streams .glb files through a persistent IndexedDB cache (Cache API fallback)
 *  • converts flat-shaded vertex-colour geometry into instanced-ready templates
 *  • exposes hot-swapping (drag & drop a .glb, or a Sketchfab download URL)
 */
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { DRACOLoader } from './vendor/DRACOLoader.js';
import * as THREE from 'three';

const DB_NAME = 'losSantos';
const STORE = 'glb-v1';

export const manifest = { models: [], colliders: {} };
export const templates = new Map(); // id -> { scene, clips, meta, nodes, bytes }
export const listeners = { progress: [], done: [] };

// --------------------------------------------------------------- IndexedDB
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(() => null);
  return dbPromise;
}

async function cacheGet(key) {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function cachePut(key, value) {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

export async function clearCache() {
  const db = await openDB();
  if (!db) return;
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).clear();
  return new Promise((r) => (tx.oncomplete = r));
}

export async function cacheSize() {
  const db = await openDB();
  if (!db) return 0;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result || []).reduce((a, b) => a + (b?.byteLength || 0), 0));
    req.onerror = () => resolve(0);
  });
}

// --------------------------------------------------------------- loader
const draco = new DRACOLoader();
draco.setDecoderPath('/draco/');
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

/** bytes fetched vs served from cache — powers the Data Saver HUD */
export const netStats = { fetched: 0, cached: 0, requests: 0, cacheHits: 0 };

export async function fetchModelBuffer(url, key = url) {
  netStats.requests++;
  const cached = await cacheGet(key);
  if (cached && cached.byteLength) {
    netStats.cached += cached.byteLength;
    netStats.cacheHits++;
    return cached;
  }
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  netStats.fetched += buf.byteLength;
  cachePut(key, buf);
  return buf;
}

function parseGLB(buffer) {
  return new Promise((resolve, reject) => {
    loader.parse(buffer, '', resolve, reject);
  });
}

/** Normalise a loaded glTF into a template we can clone cheaply */
function makeTemplate(gltf, meta) {
  const scene = gltf.scene;
  scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        m.vertexColors = m.vertexColors || (o.geometry.attributes.color !== undefined);
        m.envMapIntensity = 0.85;
        if (m.emissiveIntensity === 1 && m.emissive && m.emissive.getHex() !== 0) {
          m.emissiveIntensity = m.userData.emissiveStrength || 1.6;
        }
      }
      o.frustumCulled = true;
    }
  });
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  return {
    scene,
    clips: gltf.animations || [],
    meta,
    boundingBox: box,
    size,
    nodes: collectNodes(scene),
  };
}

function collectNodes(root) {
  const map = new Map();
  root.traverse((o) => {
    if (o.name) map.set(o.name, o);
  });
  return map;
}

export function onProgress(fn) {
  listeners.progress.push(fn);
}
export function onReady(fn) {
  listeners.done.push(fn);
}

function emitProgress(p) {
  for (const fn of listeners.progress) fn(p);
}

/** preload a list of manifest ids (in parallel, bounded) */
export async function loadModels(ids, { concurrency = 6 } = {}) {
  const results = [];
  const queue = [...ids];
  let done = 0;
  const total = queue.length;
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      const entry = manifest.models.find((m) => m.id === id);
      if (!entry) continue;
      try {
        const tpl = templates.get(id) || (await loadOne(entry));
        results.push([id, tpl]);
      } catch (err) {
        console.warn(`model ${id} failed`, err);
      }
      done++;
      emitProgress({ done, total, id, pct: done / total });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  return new Map(results);
}

export async function loadOne(entry) {
  if (templates.has(entry.id)) return templates.get(entry.id);
  const buffer = await fetchModelBuffer(entry.file, entry.file);
  const gltf = await parseGLB(buffer);
  const tpl = makeTemplate(gltf, entry);
  templates.set(entry.id, tpl);
  return tpl;
}

export function getTemplate(id) {
  return templates.get(id);
}

/** clone a template scene with shared geometry/material (cheap instances) */
export function instance(id) {
  const tpl = templates.get(id);
  if (!tpl) return null;
  const clone = tpl.scene.clone(true);
  clone.userData.modelId = id;
  // clone() keeps geometry+material references shared — exactly what we want
  return clone;
}

// --------------------------------------------------------------- hot swap
/**
 * Replace a live asset with user-provided binary glTF. Used by the in-game
 * Asset Hub (drag & drop of a downloaded Sketchfab .glb, or a direct URL).
 */
export async function hotSwap(id, source) {
  const buffer = typeof source === 'string' ? await fetchModelBuffer(source, `swap:${id}:${source}`) : source;
  const gltf = await parseGLB(buffer);
  const entry = manifest.models.find((m) => m.id === id) || { id, title: id, kind: 'npc' };
  const tpl = makeTemplate(gltf, entry);
  templates.set(id, tpl);
  await cachePut(`swap:${id}`, buffer);
  return tpl;
}

export async function loadManifest() {
  const res = await fetch('/models/manifest.json', { cache: 'no-cache' });
  const data = await res.json();
  manifest.models = data.models;
  manifest.colliders = data.colliders || {};
  return manifest;
}

/** city collider list (static AABBs, avoids raycasting the whole city) */
export async function loadColliders(mapId = 'map_los_santos') {
  try {
    const res = await fetch(`/models/${mapId}.colliders.json`, { cache: 'force-cache' });
    const data = await res.json();
    return data.colliders || [];
  } catch {
    return [];
  }
}
