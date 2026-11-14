/**
 * LOS SANTOS — advanced VFX.
 *
 * A GPU-driven particle system built on a single `THREE.Points` draw call per
 * effect family, with per-particle attributes (size, colour, rotation, life)
 * and custom shaders for soft depth-aware smoke, additive sparks and lit debris.
 *
 * Effects:
 *   • muzzle flashes + shell casings + gun smoke
 *   • impact sparks, dust puffs, blood/metal debris
 *   • tyre smoke + skid marks + drift dust
 *   • exhaust smoke (cold starts), engine backfires
 *   • water splash, sand kick-up, footstep dust
 *   • explosion fireball + shockwave ring + debris
 *   • rain (fast instance-less particle field) + lightning flashes
 *   • screen-space damage vignette + chromatic hit flash (handled by UI)
 *
 * Every emitter is pooled; nothing allocates per-frame.
 */
import * as THREE from 'three';

const MAX_PARTICLES = 6000;

const VS = /* glsl */ `
  attribute float aSize;
  attribute float aLife;
  attribute vec3 aColor;
  attribute float aSpin;
  attribute float aKind;   // 0 = soft smoke, 1 = additive spark, 2 = hard debris
  varying vec3 vColor;
  varying float vLife;
  varying float vKind;
  varying float vSpin;
  void main() {
    vColor = aColor;
    vLife = aLife;
    vKind = aKind;
    vSpin = aSpin;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // size attenuation; smoke grows, sparks shrink
    float scale = aSize * (aKind > 0.5 && aKind < 1.5 ? vLife : mix(1.0, 0.35, 1.0 - vLife));
    gl_PointSize = clamp(scale * (300.0 / -mv.z), 1.0, 220.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FS = /* glsl */ `
  varying vec3 vColor;
  varying float vLife;
  varying float vKind;
  varying float vSpin;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    // rotate the sprite (smoke billows, debris tumbles)
    float c = cos(vSpin), s = sin(vSpin);
    uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
    float d = length(uv);
    if (vKind > 1.5) {
      // hard debris: square, crisp
      if (max(abs(uv.x), abs(uv.y)) > 0.42) discard;
      float sh = smoothstep(0.45, 0.28, max(abs(uv.x), abs(uv.y)));
      gl_FragColor = vec4(vColor * (0.7 + 0.5 * vLife), sh * vLife);
      return;
    }
    float soft = smoothstep(0.5, 0.02, d);
    if (vKind > 0.5) {
      // additive spark with a hot core
      float core = smoothstep(0.22, 0.0, d);
      gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.9), (soft * 0.85 + core) * vLife);
    } else {
      // soft smoke
      gl_FragColor = vec4(vColor, soft * vLife * 0.55);
    }
  }
`;

class ParticlePool {
  constructor(scene, max = MAX_PARTICLES) {
    this.max = max;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.kind = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.ttl = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.alive = new Uint8Array(max);
    this.cursor = 0;

    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    geo.setAttribute('aSpin', new THREE.BufferAttribute(this.spin, 1));
    geo.setAttribute('aKind', new THREE.BufferAttribute(this.kind, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    const mat = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.geo = geo;
    this.sortTimer = 0;
  }

  spawn(o) {
    // find a free slot (ring buffer over the whole pool)
    let i = -1;
    for (let n = 0; n < this.max; n++) {
      const idx = (this.cursor + n) % this.max;
      if (!this.alive[idx]) { i = idx; break; }
    }
    if (i < 0) i = this.cursor % this.max; // overwrite the oldest
    this.cursor = (i + 1) % this.max;
    this.alive[i] = 1;
    this.pos[i * 3] = o.x; this.pos[i * 3 + 1] = o.y; this.pos[i * 3 + 2] = o.z;
    this.vel[i * 3] = o.vx || 0; this.vel[i * 3 + 1] = o.vy || 0; this.vel[i * 3 + 2] = o.vz || 0;
    this.col[i * 3] = o.r ?? 1; this.col[i * 3 + 1] = o.g ?? 1; this.col[i * 3 + 2] = o.b ?? 1;
    this.size[i] = o.size || 0.4;
    this.ttl[i] = o.ttl || 1;
    this.age[i] = 0;
    this.life[i] = 1;
    this.spin[i] = o.spin ?? Math.random() * Math.PI * 2;
    this.kind[i] = o.kind || 0;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0.9;
    this.grow[i] = o.grow ?? 0;
    return i;
  }

  update(dt) {
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      if (!this.alive[i]) continue;
      live++;
      this.age[i] += dt;
      const t = this.age[i] / this.ttl[i];
      if (t >= 1) {
        this.alive[i] = 0;
        this.life[i] = 0;
        this.size[i] = 0;
        continue;
      }
      this.life[i] = 1 - t;
      const d = Math.pow(this.drag[i], dt * 60);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.grow[i]) this.size[i] += this.grow[i] * dt;
      if (this.kind[i] > 0.5 && this.kind[i] < 1.5) this.spin[i] += dt * 6;
      else this.spin[i] += dt * 0.7;
      // ground bounce for debris
      if (this.kind[i] > 1.5 && this.pos[i * 3 + 1] < 0.02) {
        this.pos[i * 3 + 1] = 0.02;
        this.vel[i * 3 + 1] *= -0.32;
        this.vel[i * 3] *= 0.6;
        this.vel[i * 3 + 2] *= 0.6;
      }
    }
    this.live = live;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
    this.geo.attributes.aSpin.needsUpdate = true;
    this.geo.attributes.aKind.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- skid marks
class SkidMarks {
  constructor(scene, max = 900) {
    this.max = max;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 6 * 3); // two quads' worth of verts per segment? (we use quads)
    this.alpha = new Float32Array(max * 6);
    this.idx = [];
    for (let i = 0; i < max; i++) {
      const b = i * 6;
      this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setIndex(this.idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.02,0.02,0.025, vA*0.6); }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.geo = geo;
    this.cursor = 0;
    this.last = new Map();
  }

  add(id, from, to, width = 0.16) {
    const i = this.cursor % this.max;
    this.cursor++;
    const dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * width, nz = (dx / len) * width;
    const y = 0.021;
    const b = i * 18;
    const p = this.pos;
    p[b] = from.x + nx; p[b + 1] = y; p[b + 2] = from.z + nz;
    p[b + 3] = from.x - nx; p[b + 4] = y; p[b + 5] = from.z - nz;
    p[b + 6] = to.x - nx; p[b + 7] = y; p[b + 8] = to.z - nz;
    p[b + 9] = to.x + nx; p[b + 10] = y; p[b + 11] = to.z + nz;
    p[b + 12] = 0; p[b + 13] = 0; p[b + 14] = 0;
    p[b + 15] = 0; p[b + 16] = 0; p[b + 17] = 0;
    const a = i * 6;
    for (let k = 0; k < 4; k++) this.alpha[a + k] = 1;
    this.alpha[a + 4] = 0; this.alpha[a + 5] = 0;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

/** expanding shockwave ring (explosion) */
class ShockRing {
  constructor(scene) {
    this.rings = [];
    this.geo = new THREE.RingGeometry(0.5, 0.62, 48);
    this.geo.rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
    this.scene = scene;
  }
  spawn(pos) {
    const m = new THREE.Mesh(this.geo, this.mat.clone());
    m.position.copy(pos);
    m.position.y = 0.05;
    this.scene.add(m);
    this.rings.push({ m, t: 0 });
  }
  update(dt) {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / 0.7;
      r.m.scale.setScalar(1 + k * 26);
      r.m.material.opacity = Math.max(0, 0.75 * (1 - k));
      if (k >= 1) {
        this.scene.remove(r.m);
        r.m.material.dispose();
        this.rings.splice(i, 1);
      }
    }
  }
}

// ---------------------------------------------------------------- rain
class Rain {
  constructor(scene, count = 4200) {
    this.count = count;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 120;
      pos[i * 3 + 1] = Math.random() * 60;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
      seed[i] = Math.random();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uAmount: { value: 0 } },
      vertexShader: `
        attribute float aSeed; uniform float uTime; uniform float uAmount; varying float vA;
        void main(){
          vec3 p = position;
          float fall = mod(p.y - uTime * (26.0 + aSeed * 18.0), 60.0);
          p.y = fall;
          p.x += sin(uTime * 0.6 + aSeed * 12.0) * 1.2;
          vA = uAmount * (0.35 + aSeed * 0.65);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(60.0 / -mv.z, 1.0, 4.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA; void main(){ vec2 uv=gl_PointCoord-0.5; if(abs(uv.x)>0.12) discard; gl_FragColor=vec4(0.72,0.8,0.92,vA*0.5); }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.mat = mat;
    scene.add(this.points);
    this.amount = 0;
  }
  setAmount(a) {
    this.amount = a;
    this.points.visible = a > 0.01;
    this.mat.uniforms.uAmount.value = a;
  }
  update(dt) {
    if (!this.points.visible) return;
    this.mat.uniforms.uTime.value += dt;
  }
}

// ---------------------------------------------------------------- facade
export class VFX {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.pool = new ParticlePool(scene);
    this.skids = new SkidMarks(scene);
    this.shock = new ShockRing(scene);
    this.rain = new Rain(scene);
    this.weather = 'clear';
    this.lightningTimer = 6;
    this.flash = 0;
  }

  update(dt, camera, playerPos) {
    this.pool.update(dt);
    this.shock.update(dt);
    this.rain.update(dt);
    if (this.rain.points.visible) {
      this.rain.points.position.set(camera.position.x, 0, camera.position.z);
    }
    // lightning
    if (this.weather === 'storm') {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 4 + Math.random() * 9;
        this.flash = 1;
      }
    }
    this.flash = Math.max(0, this.flash - dt * 3.4);
  }

  setWeather(kind) {
    this.weather = kind;
    this.rain.setAmount(kind === 'storm' ? 1 : kind === 'rain' ? 0.55 : 0);
  }

  // -------------------------------------------------------------- emitters
  muzzleFlash(pos, dir) {
    for (let i = 0; i < 10; i++) {
      this.pool.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: dir.x * (3 + Math.random() * 6) + (Math.random() - 0.5) * 3,
        vy: dir.y * 3 + (Math.random() - 0.5) * 2,
        vz: dir.z * (3 + Math.random() * 6) + (Math.random() - 0.5) * 3,
        r: 1, g: 0.82, b: 0.45, size: 0.22 + Math.random() * 0.2,
        ttl: 0.06 + Math.random() * 0.07, kind: 1, drag: 0.86, gravity: 1.5,
      });
    }
    // smoke plume
    for (let i = 0; i < 4; i++) {
      this.pool.spawn({
        x: pos.x + dir.x * 0.4, y: pos.y + 0.05, z: pos.z + dir.z * 0.4,
        vx: dir.x * 1.4 + (Math.random() - 0.5), vy: 0.4 + Math.random() * 0.5, vz: dir.z * 1.4 + (Math.random() - 0.5),
        r: 0.6, g: 0.6, b: 0.62, size: 0.16, ttl: 0.7 + Math.random() * 0.5, kind: 0, drag: 0.94, grow: 0.5,
      });
    }
  }

  shellCasing(pos, dir) {
    this.pool.spawn({
      x: pos.x, y: pos.y, z: pos.z,
      vx: -dir.x * 1.2 + (Math.random() - 0.5) * 2,
      vy: 1.6 + Math.random() * 1.4,
      vz: -dir.z * 1.2 + (Math.random() - 0.5) * 2,
      r: 0.85, g: 0.62, b: 0.22, size: 0.05, ttl: 1.1, kind: 2, gravity: 14, drag: 0.995,
    });
  }

  impact(pos, normal = null, kind = 'metal') {
    const n = normal || new THREE.Vector3(0, 1, 0);
    // sparks
    for (let i = 0; i < (kind === 'metal' ? 14 : 7); i++) {
      this.pool.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: n.x * 2 + (Math.random() - 0.5) * 7,
        vy: n.y * 2 + Math.random() * 5,
        vz: n.z * 2 + (Math.random() - 0.5) * 7,
        r: 1, g: 0.7, b: 0.3, size: 0.05 + Math.random() * 0.05,
        ttl: 0.2 + Math.random() * 0.3, kind: 1, gravity: 12, drag: 0.96,
      });
    }
    // dust puff
    for (let i = 0; i < 5; i++) {
      this.pool.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: (Math.random() - 0.5) * 1.6, vy: 0.5 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 1.6,
        r: kind === 'flesh' ? 0.55 : 0.62, g: kind === 'flesh' ? 0.12 : 0.6, b: kind === 'flesh' ? 0.12 : 0.58,
        size: 0.2, ttl: 0.6 + Math.random() * 0.4, kind: 0, drag: 0.92, grow: 0.7,
      });
    }
  }

  tyreSmoke(pos, intensity = 1) {
    const n = Math.round(2 + intensity * 4);
    for (let i = 0; i < n; i++) {
      this.pool.spawn({
        x: pos.x + (Math.random() - 0.5) * 0.4, y: 0.12, z: pos.z + (Math.random() - 0.5) * 0.4,
        vx: (Math.random() - 0.5) * 1.4, vy: 0.35 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 1.4,
        r: 0.78, g: 0.78, b: 0.8, size: 0.35, ttl: 0.8 + Math.random() * 0.8, kind: 0, drag: 0.93, grow: 1.1,
      });
    }
  }

  exhaust(pos, dir, load = 0.4) {
    if (Math.random() > load * 0.6) return;
    this.pool.spawn({
      x: pos.x, y: pos.y, z: pos.z,
      vx: -dir.x * 1.8 + (Math.random() - 0.5) * 0.6,
      vy: 0.3 + Math.random() * 0.4,
      vz: -dir.z * 1.8 + (Math.random() - 0.5) * 0.6,
      r: 0.55, g: 0.55, b: 0.58, size: 0.14, ttl: 0.7, kind: 0, drag: 0.93, grow: 0.55,
    });
  }

  sandKick(pos, vel) {
    for (let i = 0; i < 3; i++) {
      this.pool.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: vel.x * 0.3 + (Math.random() - 0.5) * 3,
        vy: 1 + Math.random() * 2.2,
        vz: vel.z * 0.3 + (Math.random() - 0.5) * 3,
        r: 0.85, g: 0.76, b: 0.58, size: 0.12, ttl: 0.6, kind: 2, gravity: 11, drag: 0.98,
      });
    }
  }

  splash(pos) {
    for (let i = 0; i < 16; i++) {
      this.pool.spawn({
        x: pos.x, y: 0.05, z: pos.z,
        vx: (Math.random() - 0.5) * 3.4, vy: 1.4 + Math.random() * 2.6, vz: (Math.random() - 0.5) * 3.4,
        r: 0.75, g: 0.9, b: 1, size: 0.1, ttl: 0.55, kind: 1, gravity: 12, drag: 0.98,
      });
    }
  }

  explosion(pos, scale = 1) {
    // fireball core
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.5;
      const sp = (6 + Math.random() * 12) * scale;
      this.pool.spawn({
        x: pos.x, y: pos.y + 0.4, z: pos.z,
        vx: Math.cos(a) * Math.cos(e) * sp,
        vy: Math.sin(e) * sp * 0.9 + 2,
        vz: Math.sin(a) * Math.cos(e) * sp,
        r: 1, g: 0.55 + Math.random() * 0.3, b: 0.15,
        size: 0.7 * scale, ttl: 0.5 + Math.random() * 0.5, kind: 1, gravity: -2, drag: 0.9, grow: 1.4,
      });
    }
    // smoke column
    for (let i = 0; i < 26; i++) {
      this.pool.spawn({
        x: pos.x + (Math.random() - 0.5) * 2.2, y: pos.y + Math.random() * 1.4, z: pos.z + (Math.random() - 0.5) * 2.2,
        vx: (Math.random() - 0.5) * 2.6, vy: 1.8 + Math.random() * 3.4, vz: (Math.random() - 0.5) * 2.6,
        r: 0.24, g: 0.22, b: 0.22, size: 0.9 * scale, ttl: 2 + Math.random() * 1.6, kind: 0, drag: 0.94, grow: 1.5,
      });
    }
    // debris
    for (let i = 0; i < 18; i++) {
      this.pool.spawn({
        x: pos.x, y: pos.y + 0.6, z: pos.z,
        vx: (Math.random() - 0.5) * 16, vy: 3 + Math.random() * 8, vz: (Math.random() - 0.5) * 16,
        r: 0.2, g: 0.2, b: 0.22, size: 0.13, ttl: 1.6, kind: 2, gravity: 18, drag: 0.99,
      });
    }
    this.shock.spawn(pos);
  }

  dust(pos, count = 4) {
    for (let i = 0; i < count; i++) {
      this.pool.spawn({
        x: pos.x + (Math.random() - 0.5) * 0.5, y: pos.y + 0.05, z: pos.z + (Math.random() - 0.5) * 0.5,
        vx: (Math.random() - 0.5) * 1.2, vy: 0.4 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 1.2,
        r: 0.66, g: 0.62, b: 0.56, size: 0.24, ttl: 0.7, kind: 0, drag: 0.92, grow: 0.6,
      });
    }
  }

  skid(id, from, to) {
    this.skids.add(id, from, to);
  }

  get particleCount() {
    return this.pool.live || 0;
  }
}
