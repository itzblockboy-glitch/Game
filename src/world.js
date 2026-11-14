/**
 * World: sky dome + sun/moon + day-night cycle, GPU ocean, city map streaming with
 * distance LOD & manual frustum culling, and pooled props.
 */
import * as THREE from 'three';
import { instance, getTemplate } from './assets.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';

export const MAP_CENTER = new THREE.Vector3(-40, 0, -40);
const OCEAN_Y = -0.15;

// ---------------------------------------------------------------- sky
const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const SKY_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunIntensity;
  uniform float uStars;
  void main() {
    float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(clamp(vDir.y, 0.0, 1.0), 0.34));
    col = mix(col, uBottom, pow(clamp(-vDir.y, 0.0, 1.0), 0.5));
    // sun glow
    float sun = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
    col += uSunColor * pow(sun, 700.0) * 4.0 * uSunIntensity;
    col += uSunColor * pow(sun, 14.0) * 0.16 * uSunIntensity;
    // procedural stars (cheap hash, only at night)
    if (uStars > 0.01 && vDir.y > 0.02) {
      vec3 p = floor(normalize(vDir) * 260.0);
      float n = fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
      float star = smoothstep(0.9975, 1.0, n) * uStars;
      col += vec3(star) * (0.6 + 0.4 * sin(n * 90.0));
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------- ocean
const OCEAN_VERT = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  varying float vWave;
  float wave(vec2 p, float t) {
    return sin(p.x * 0.045 + t * 0.9) * 0.55
         + sin(p.y * 0.062 - t * 1.25) * 0.42
         + sin((p.x + p.y) * 0.098 + t * 1.8) * 0.18
         + sin((p.x - p.y) * 0.021 - t * 0.55) * 0.7;
  }
  void main() {
    vec3 p = position;
    vec4 world = modelMatrix * vec4(p, 1.0);
    float w = wave(world.xz, uTime);
    world.y += w;
    vWave = w;
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const OCEAN_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uSkyColor;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunIntensity;
  varying vec3 vWorld;
  varying float vWave;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorld);
    // analytic-ish normal from the same wave function (finite differences)
    float e = 1.6;
    float hx = sin((vWorld.x + e) * 0.045 + uTime * 0.9) * 0.55 - sin((vWorld.x - e) * 0.045 + uTime * 0.9) * 0.55;
    float hz = sin((vWorld.z + e) * 0.062 - uTime * 1.25) * 0.42 - sin((vWorld.z - e) * 0.062 - uTime * 1.25) * 0.42;
    vec3 n = normalize(vec3(-hx * 2.4, 1.0, -hz * 2.4));
    float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 2.4);
    vec3 col = mix(uShallow, uDeep, smoothstep(-1.2, 0.9, vWave));
    col = mix(col, uSkyColor, clamp(fres * 0.85, 0.0, 0.86));
    // specular glitter
    vec3 h = normalize(normalize(uSunDir) + viewDir);
    float spec = pow(max(dot(n, h), 0.0), 300.0) * 1.5;
    col += uSunColor * spec * uSunIntensity;
    // foam near crests + shoreline
    float foam = smoothstep(0.72, 1.05, vWave) * 0.5;
    float shore = smoothstep(6.0, 0.0, vWorld.y + 0.3) * 0.0;
    col += vec3(foam + shore) * vec3(0.9, 0.96, 1.0);
    // sparkle noise
    col += vec3(hash(floor(vWorld.xz * 1.6) + floor(uTime * 2.0)) * 0.05);
    gl_FragColor = vec4(col, 0.94);
  }
`;

export class World {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.timeOfDay = 10.5; // hours
    this.timeScale = 0.22; // game-hours per real second (~ (24h/0.22) ≈ 109 s full cycle)
    this.paused = false;
    this.lodDistance = 420;
    this.mergeCity = true;
    this.chunks = [];
    this.mapRoot = null;
    this.activeMap = null;
    this.colliders = [];

    this._buildSky();
    this._buildOcean();
    this._buildLights();
    this._buildEnvironment();
    this._buildClouds();
    this._buildProps();
  }

  // -------------------------------------------------------------- sky
  _buildSky() {
    this.skyUniforms = {
      uTop: { value: new THREE.Color(0x2f7dd6) },
      uBottom: { value: new THREE.Color(0x9fc3d8) },
      uHorizon: { value: new THREE.Color(0xcfe6f5) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.2) },
      uSunColor: { value: new THREE.Color(0xfff3d0) },
      uSunIntensity: { value: 1 },
      uStars: { value: 0 },
    };
    const geo = new THREE.SphereGeometry(3000, 24, 16);
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -100;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.FogExp2(0xbfd8ea, 0.00155);
  }

  // -------------------------------------------------------------- ocean
  _buildOcean() {
    const geo = new THREE.PlaneGeometry(6000, 6000, 160, 160);
    geo.rotateX(-Math.PI / 2);
    this.oceanUniforms = {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color(0x2fb3a4) },
      uDeep: { value: new THREE.Color(0x0b3f63) },
      uSkyColor: { value: new THREE.Color(0x9fc3d8) },
      uSunDir: this.skyUniforms.uSunDir,
      uSunColor: this.skyUniforms.uSunColor,
      uSunIntensity: this.skyUniforms.uSunIntensity,
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: OCEAN_VERT,
      fragmentShader: OCEAN_FRAG,
      uniforms: this.oceanUniforms,
      transparent: true,
      fog: false,
    });
    this.ocean = new THREE.Mesh(geo, mat);
    this.ocean.position.set(-1500, OCEAN_Y, 0);
    this.ocean.frustumCulled = false;
    this.ocean.renderOrder = 2;
    this.scene.add(this.ocean);
  }

  // -------------------------------------------------------------- lights
  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0xcfe4ff, 0x6b6248, 1.15);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff2d5, 2.4);
    this.sun.position.set(120, 180, 80);
    this.sun.castShadow = true;
    const size = this.renderer.capabilities.maxTextureSize > 4096 ? 2048 : 1024;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 260;
    this.sun.shadow.camera.left = -58;
    this.sun.shadow.camera.right = 58;
    this.sun.shadow.camera.top = 58;
    this.sun.shadow.camera.bottom = -58;
    this.sun.shadow.bias = -0.0016;
    this.sun.shadow.normalBias = 0.085;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.moon = new THREE.DirectionalLight(0x9fb6ff, 0.0);
    this.scene.add(this.moon);
    this.moon.target = this.sun.target;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.34));
  }

  /** cheap PMREM probe baked once from the sky shader (no downloads, ~2 ms) */
  _buildEnvironment() {
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      pmrem.compileEquirectangularShader();
      const tmp = new THREE.Scene();
      const skyClone = new THREE.Mesh(this.sky.geometry, this.sky.material.clone());
      skyClone.material.uniforms = this.skyUniforms;
      skyClone.material.side = THREE.BackSide;
      skyClone.material.depthWrite = false;
      tmp.add(skyClone);
      const rt = pmrem.fromScene(tmp, 0, 1, 2000);
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = 0.55;
      this.envRT = rt;
      pmrem.dispose();
    } catch (e) {
      console.warn('env probe skipped', e.message);
    }
  }

  _buildClouds() {
    // pooled billboard-ish cloud puffs; cheap and animated by wind
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.92, fog: false });
    this.clouds = new THREE.InstancedMesh(geo, mat, 90);
    this.clouds.frustumCulled = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    this.cloudData = [];
    for (let i = 0; i < 90; i++) {
      const cluster = Math.floor(i / 6);
      const base = new THREE.Vector3(
        Math.cos(cluster * 1.7) * (420 + (i % 6) * 55) + Math.random() * 40,
        190 + Math.random() * 70,
        Math.sin(cluster * 1.7) * (420 + (i % 6) * 55) + Math.random() * 40
      );
      this.cloudData.push({ base, speed: 1.2 + Math.random() * 0.8 });
      s.setScalar(26 + Math.random() * 34);
      s.y *= 0.5;
      m.compose(base, q, s);
      this.clouds.setMatrixAt(i, m);
    }
    this.clouds.instanceMatrix.needsUpdate = true;
    this.scene.add(this.clouds);
  }

  // -------------------------------------------------------------- props (pooled)
  _buildProps() {
    this.propPool = new THREE.Group();
    this.propPool.name = 'pool';
    this.scene.add(this.propPool);
    this._propTemplates = new Map();
  }

  /** pooled decorative prop (traffic cones, benches...) */
  spawnProp(key, factory, position, rotation = 0) {
    let list = this._propTemplates.get(key);
    if (!list) {
      list = { free: [], used: [] };
      this._propTemplates.set(key, list);
    }
    let obj = list.free.pop();
    if (!obj) {
      obj = factory();
      this.propPool.add(obj);
    }
    obj.position.copy(position);
    obj.rotation.y = rotation;
    obj.visible = true;
    list.used.push(obj);
    return obj;
  }

  releaseProp(key, obj) {
    const list = this._propTemplates.get(key);
    if (!list) return;
    obj.visible = false;
    const i = list.used.indexOf(obj);
    if (i >= 0) list.used.splice(i, 1);
    list.free.push(obj);
  }

  // -------------------------------------------------------------- map
  loadMap(mapId, { position = new THREE.Vector3(), scale = 1 } = {}) {
    if (this.mapRoot) {
      this.scene.remove(this.mapRoot);
    }
    this.activeMap = mapId;
    const tpl = getTemplate(mapId);
    if (!tpl) return null;
    const root = instance(mapId);
    root.position.copy(position);
    root.scale.setScalar(scale);
    this.mapRoot = root;
    this.mapRoot.name = 'mapRoot';
    this.scene.add(root);

    root.updateMatrixWorld(true);
    // Index the ground while the primitives still carry their names — merging
    // below replaces them with unnamed city buckets.
    this._indexTerrain(root);
    // Merge the map's primitives into ~220 m spatial buckets, one mesh per
    // (bucket, material). Keeps frustum culling granular but drops draw calls by ~5x.
    this.chunks = [];
    if (this.mergeCity) {
      const buckets = new Map();
      const toRemove = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        toRemove.push(o);
        const p = new THREE.Vector3();
        o.getWorldPosition(p);
        const key = `${Math.round(p.x / 220)}_${Math.round(p.z / 220)}_${o.material?.uuid || 'none'}`;
        let b = buckets.get(key);
        if (!b) {
          b = { material: o.material, geometries: [] };
          buckets.set(key, b);
        }
        const g = o.geometry.clone();
        g.applyMatrix4(o.matrixWorld);
        if (!g.attributes.color && b.geometries[0]?.attributes.color) {
          // keep attributes consistent for merging
        }
        b.geometries.push(g);
      });
      for (const o of toRemove) o.parent?.remove(o);
      for (const b of buckets.values()) {
        let merged = null;
        try {
          merged = b.geometries.length === 1 ? b.geometries[0] : mergeGeometries(b.geometries, false);
        } catch {
          merged = b.geometries[0];
        }
        if (!merged) continue;
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, b.material);
        mesh.matrixAutoUpdate = false;
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        this.mapRoot.add(mesh);
        this.chunks.push({
          mesh,
          center: new THREE.Vector3(),
          radius: merged.boundingSphere?.radius || 20,
          visible: true,
          tris: (merged.index ? merged.index.count : merged.attributes.position.count) / 3,
        });
      }
      for (const c of this.chunks) {
        c.center.copy(c.mesh.geometry.boundingSphere.center).applyMatrix4(c.mesh.matrixWorld);
      }
      return root;
    }
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.receiveShadow = true;
      o.castShadow = false; // city self-shadowing is baked into vertex colours
      o.geometry.computeBoundingSphere();
      this.chunks.push({
        mesh: o,
        center: new THREE.Vector3(),
        radius: o.geometry.boundingSphere?.radius || 10,
        lowDetail: null,
        visible: true,
      });
    });
    for (const c of this.chunks) {
      c.center.copy(c.mesh.geometry.boundingSphere.center).applyMatrix4(c.mesh.matrixWorld);
      c.tris = (c.mesh.geometry.index ? c.mesh.geometry.index.count : c.mesh.geometry.attributes.position.count) / 3;
    }
    return root;
  }

  /**
   * Index the map's ground so the character controller knows where the floor is.
   * The city mesh is flat at y≈0 but dips below the ocean surface (y=-0.15) out
   * to sea, so "solid ground" cannot be a constant — it has to be sampled.
   * Buckets triangles on a 40 m grid and only keeps the top surface.
   */
  _indexTerrain(root) {
    this.terrain = new Map();
    this.terrainCell = 40;
    this.groundY = 0.02;
    const CELL = this.terrainCell;
    const push = (key, tri) => {
      let b = this.terrain.get(key);
      if (!b) this.terrain.set(key, (b = []));
      b.push(tri);
    };
    const a = new THREE.Vector3(), b2 = new THREE.Vector3(), c = new THREE.Vector3();
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const n = (o.name || '').toLowerCase();
      const mat = (o.material?.name || '').toLowerCase();
      if (!/terrain|beach|ground|sand|road|street|sidewalk|asphalt/.test(n + ' ' + mat)) return;
      const g = o.geometry;
      const pos = g.attributes.position;
      const idx = g.index;
      const count = idx ? idx.count : pos.count;
      for (let i = 0; i < count; i += 3) {
        const i0 = idx ? idx.getX(i) : i;
        const i1 = idx ? idx.getX(i + 1) : i + 1;
        const i2 = idx ? idx.getX(i + 2) : i + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
        b2.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
        c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
        const x0 = Math.floor(Math.min(a.x, b2.x, c.x) / CELL);
        const x1 = Math.floor(Math.max(a.x, b2.x, c.x) / CELL);
        const z0 = Math.floor(Math.min(a.z, b2.z, c.z) / CELL);
        const z1 = Math.floor(Math.max(a.z, b2.z, c.z) / CELL);
        // a triangle spanning many cells is rare here; register it in each so a
        // sample never falls through a seam
        for (let ix = x0; ix <= x1; ix++) {
          for (let iz = z0; iz <= z1; iz++) {
            push(`${ix},${iz}`, [a.x, a.y, a.z, b2.x, b2.y, b2.z, c.x, c.y, c.z]);
          }
        }
      }
    });
  }

  /**
   * Ground height at (x, z). Returns the highest terrain surface under the point,
   * or null when the point is outside the map (open sea / off-world).
   */
  groundAt(x, z) {
    if (!this.terrain || !this.terrain.size) return null;
    const CELL = this.terrainCell;
    const list = this.terrain.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (!list) return null;
    let best = null;
    for (const t of list) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = t;
      const d0 = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d0) < 1e-9) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d0;
      const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d0;
      const l3 = 1 - l1 - l2;
      if (l1 < -0.002 || l2 < -0.002 || l3 < -0.002) continue;
      const y = l1 * ay + l2 * by + l3 * cy;
      if (best === null || y > best) best = y;
    }
    return best;
  }

  setColliders(list) {
    this.colliders = list || [];
    // spatial hash for cheap AABB lookup
    this.colliderGrid = new Map();
    const CELL = 60;
    for (const c of this.colliders) {
      const x0 = Math.floor((c.x - c.w) / CELL);
      const x1 = Math.floor((c.x + c.w) / CELL);
      const z0 = Math.floor((c.z - c.d) / CELL);
      const z1 = Math.floor((c.z + c.d) / CELL);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const key = `${ix},${iz}`;
          if (!this.colliderGrid.has(key)) this.colliderGrid.set(key, []);
          this.colliderGrid.get(key).push(c);
        }
      }
    }
  }

  /** AABB push-out for a capsule/box mover of radius r */
  resolveCollision(pos, radius = 0.45) {
    if (!this.colliderGrid) return false;
    const CELL = 60;
    const key = `${Math.floor(pos.x / CELL)},${Math.floor(pos.z / CELL)}`;
    const list = this.colliderGrid.get(key);
    if (!list) return false;
    let hit = false;
    for (const c of list) {
      if (pos.y > c.h + 0.2) continue;
      const dx = pos.x - c.x;
      const dz = pos.z - c.z;
      const px = c.w + radius - Math.abs(dx);
      const pz = c.d + radius - Math.abs(dz);
      if (px > 0 && pz > 0) {
        hit = true;
        if (px < pz) pos.x += Math.sign(dx || 1) * px;
        else pos.z += Math.sign(dz || 1) * pz;
      }
    }
    return hit;
  }

  /** quick ray test against building AABBs, used for camera + bullets */
  raycastAABB(origin, dir, maxDist = 60) {
    if (!this.colliderGrid) return null;
    const CELL = 60;
    let best = maxDist;
    let bestHit = null;
    const steps = Math.min(24, Math.ceil(maxDist / CELL) + 2);
    const seen = new Set();
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps) * maxDist;
      const px = origin.x + dir.x * t;
      const pz = origin.z + dir.z * t;
      const key = `${Math.floor(px / CELL)},${Math.floor(pz / CELL)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const list = this.colliderGrid.get(key);
      if (!list) continue;
      for (const c of list) {
        const py = origin.y + dir.y * t;
        if (py > c.h) continue;
        const hit = rayBox(origin, dir, c);
        if (hit !== null && hit < best) {
          best = hit;
          bestHit = c;
        }
      }
    }
    return bestHit ? { distance: best, collider: bestHit } : null;
  }

  // -------------------------------------------------------------- time
  setTimeOfDay(hours) {
    this.timeOfDay = ((hours % 24) + 24) % 24;
  }

  get sunDirection() {
    const a = ((this.timeOfDay - 6) / 24) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * 0.75, Math.sin(a), Math.sin(a * 0.6) * 0.35 + 0.32).normalize();
  }

  update(dt, cameraTarget) {
    if (!this.paused) this.timeOfDay = (this.timeOfDay + dt * this.timeScale) % 24;
    const tod = this.timeOfDay;

    // ---- sun / moon
    const sunDir = this.sunDirection;
    const sunUp = Math.max(0, sunDir.y);
    const day = THREE.MathUtils.smoothstep(sunUp, -0.05, 0.28);
    const dusk = Math.exp(-Math.pow((sunUp - 0.03) * 9, 2)); // sunset/sunrise bloom
    const night = 1 - THREE.MathUtils.smoothstep(sunUp, -0.18, 0.08);

    const sunPos = sunDir.clone().multiplyScalar(130);
    this.sun.position.copy(sunPos).add(cameraTarget || new THREE.Vector3());
    this.sun.target.position.copy(cameraTarget || new THREE.Vector3());
    this.sun.intensity = 3.1 * day * THREE.MathUtils.smoothstep(sunUp, 0.0, 0.22);
    const warm = new THREE.Color(0xff9a4d);
    const noon = new THREE.Color(0xfff3da);
    this.sun.color.copy(noon).lerp(warm, dusk * 0.85);

    this.moon.intensity = 0.42 * night;
    this.moon.position.copy(cameraTarget || new THREE.Vector3()).add(new THREE.Vector3(-sunDir.x, Math.abs(sunDir.y) + 0.3, -sunDir.z).multiplyScalar(160));

    this.hemi.intensity = 0.42 + 0.86 * day;
    this.hemi.color.setHex(0xbfd8ff).lerp(new THREE.Color(0x5a5f8a), night);
    this.hemi.groundColor.setHex(0x6b6248).lerp(new THREE.Color(0x1b1c26), night);

    // ---- sky palette
    const skyTopDay = new THREE.Color(0x2f7dd6);
    const skyTopDusk = new THREE.Color(0x2a4a7a);
    const skyTopNight = new THREE.Color(0x050a1c);
    const horizDay = new THREE.Color(0xcfe6f5);
    const horizDusk = new THREE.Color(0xffc9a0);
    const horizNight = new THREE.Color(0x0b1226);
    // sunrise/sunset only warms the sky while the sun is still up; after dark it fades
    const warmth = dusk * THREE.MathUtils.smoothstep(sunUp, -0.02, 0.1);
    const top = skyTopNight.clone().lerp(skyTopDay, day).lerp(skyTopDusk, warmth * 0.55);
    const horiz = horizNight.clone().lerp(horizDay, day).lerp(horizDusk, warmth * 0.85);
    this.skyUniforms.uTop.value.copy(top);
    this.skyUniforms.uHorizon.value.copy(horiz);
    this.skyUniforms.uBottom.value.copy(horiz.clone().multiplyScalar(0.7));
    this.skyUniforms.uSunDir.value.copy(sunDir);
    this.skyUniforms.uSunColor.value.copy(this.sun.color);
    this.skyUniforms.uSunIntensity.value = 0.18 + day * 1.1 + dusk * 0.5;
    this.skyUniforms.uStars.value = night;

    // ---- fog follows the horizon colour
    this.scene.fog.color.copy(horiz).lerp(top, 0.35);
    this.scene.fog.density = 0.0013 + night * 0.0011;

    // ---- ocean shading reacts to the same palette
    this.oceanUniforms.uTime.value += dt;
    this.oceanUniforms.uSkyColor.value.copy(horiz);
    this.oceanUniforms.uShallow.value.setHex(0x2fb3a4).multiplyScalar(0.28 + day * 0.85);
    this.oceanUniforms.uDeep.value.setHex(0x0b3f63).multiplyScalar(0.3 + day * 0.8);
    this.oceanUniforms.uSunIntensity.value = 0.2 + day;

    // ---- clouds drift + tint
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < this.cloudData.length; i++) {
      const c = this.cloudData[i];
      c.base.x += c.speed * dt;
      if (c.base.x > 900) c.base.x = -900;
      p.copy(c.base);
      s.setScalar(26 + ((i * 37) % 34));
      s.y *= 0.5;
      m.compose(p, q, s);
      this.clouds.setMatrixAt(i, m);
    }
    this.clouds.instanceMatrix.needsUpdate = true;
    if (this.clouds.material) {
      this.clouds.material.color.copy(new THREE.Color(0xffffff)).lerp(new THREE.Color(0x2b3355), night).lerp(new THREE.Color(0xffdcb4), dusk * 0.55);
      this.clouds.material.opacity = 0.55 + day * 0.4;
    }

    // ---- refresh the reflection probe when the sky has changed meaningfully
    this._envTimer = (this._envTimer || 0) + dt;
    if (this._envTimer > 8) {
      this._envTimer = 0;
      this._refreshEnvironment();
    }

    // ---- manual culling + distance LOD for the city chunks
    this._cullChunks(cameraTarget);
  }

  _refreshEnvironment() {
    if (!this._pmrem) this._pmrem = new THREE.PMREMGenerator(this.renderer);
    try {
      const tmp = new THREE.Scene();
      const skyClone = new THREE.Mesh(this.sky.geometry, this.sky.material.clone());
      skyClone.material.uniforms = this.skyUniforms;
      skyClone.material.side = THREE.BackSide;
      tmp.add(skyClone);
      const rt = this._pmrem.fromScene(tmp, 0, 1, 2000);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
    } catch {}
  }

  _cullChunks(target) {
    if (!this.chunks.length) return;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
    );
    const sphere = new THREE.Sphere();
    const maxD = this.lodDistance;
    for (const c of this.chunks) {
      sphere.set(c.center, c.radius * 1.35);
      const inFrustum = frustum.intersectsSphere(sphere);
      const dist = target ? c.center.distanceTo(target) : 0;
      const visible = inFrustum && dist < maxD * 2.6;
      if (c.mesh.visible !== visible) c.mesh.visible = visible;
      // far chunks skip shadow reception -> cheaper fragment work
      if (visible) c.mesh.receiveShadow = dist < 140;
    }
  }

  stats() {
    let tris = 0;
    for (const c of this.chunks) if (c.mesh.visible) tris += c.tris || 0;
    return { chunks: this.chunks.length, visible: this.chunks.filter((c) => c.mesh.visible).length, tris };
  }
}

function rayBox(origin, dir, c) {
  const minX = c.x - c.w, maxX = c.x + c.w;
  const minY = 0, maxY = c.h;
  const minZ = c.z - c.d, maxZ = c.z + c.d;
  let tmin = 0, tmax = Infinity;
  for (const [o, d, mn, mx] of [
    [origin.x, dir.x, minX, maxX],
    [origin.y, dir.y, minY, maxY],
    [origin.z, dir.z, minZ, maxZ],
  ]) {
    if (Math.abs(d) < 1e-6) {
      if (o < mn || o > mx) return null;
    } else {
      let t1 = (mn - o) / d;
      let t2 = (mx - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}
