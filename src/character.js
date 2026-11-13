/**
 * Character rig driver: procedural walk / run / jump / swim / punch animation on the
 * rigid-part glTF characters, plus weapon mounting, aiming and shooting.
 */
import * as THREE from 'three';
import { instance, getTemplate } from './assets.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export const WEAPONS = {
  fists: { id: 'fists', name: 'Fists', damage: 14, rate: 2.6, range: 2.1, ammo: Infinity, auto: false, kind: 'melee' },
  weapon_g17_handgun: { id: 'weapon_g17_handgun', name: 'G17 Gen 5', damage: 24, rpm: 320, range: 90, ammo: 17, auto: false, kind: 'gun', grip: [0.055, -0.06, -0.16], muzzle: [0, 0.06, 0.28], scale: 0.85 },
  weapon_pp19_vityaz: { id: 'weapon_pp19_vityaz', name: 'PP-19 Vityaz', damage: 18, rpm: 700, range: 120, ammo: 30, auto: true, kind: 'gun', grip: [0.06, -0.08, -0.2], muzzle: [0, 0.02, 0.5], scale: 0.85 },
  weapon_akmn_rifle: { id: 'weapon_akmn_rifle', name: 'AKMN', damage: 34, rpm: 600, range: 220, ammo: 30, auto: true, kind: 'gun', grip: [0.06, -0.09, -0.22], muzzle: [0, 0.03, 0.68], scale: 0.85 },
};

export class Character {
  /**
   * @param {string} modelId glTF id (player_jason, npc_*)
   * @param {object} opts { isPlayer, onShoot }
   */
  constructor(modelId, opts = {}) {
    this.modelId = modelId;
    this.isPlayer = !!opts.isPlayer;
    this.onShoot = opts.onShoot || (() => {});

    const root = instance(modelId);
    this.root = new THREE.Group();
    this.root.name = `char:${modelId}`;
    if (root) this.root.add(root);
    this.model = root;

    // joints (named nodes emitted by the asset foundry)
    this.joints = {};
    const names = ['hips', 'torso', 'head', 'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'upperLegL', 'upperLegR', 'lowerLegL', 'lowerLegR', 'footL', 'footR'];
    for (const n of names) {
      const node = root?.getObjectByName(n);
      if (node) {
        node.userData.rest = node.rotation.clone();
        this.joints[n] = node;
      }
    }

    // physics state
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.targetYaw = 0;
    this.onGround = true;
    this.height = 1.8;
    this.radius = 0.42;
    this.speed = 0;
    this.moveState = 'idle'; // idle|walk|run|sprint|jump|fall|swim|punch|drive
    this.health = 100;
    this.armor = 0;
    this.animPhase = 0;
    this.aimPitch = 0;
    this.aiming = false;
    this.weapon = 'fists';
    this.WATERLINE = -0.92;
    this.ammo = {};
    this.weaponModels = new Map();
    this.muzzleFlash = null;
    this.punchTimer = 0;
    this.fireCooldown = 0;
    this.recoil = 0;
    this.driveVehicle = null;
    this.vehicleYaw = 0;
    this.moving = false;
    this.sprinting = false;
    this.cheat = false;

    this._buildMuzzleFlash();
    this.setWeapon('fists');
  }

  _buildMuzzleFlash() {
    const geo = new THREE.SphereGeometry(0.09, 6, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0 });
    this.muzzleFlash = new THREE.Mesh(geo, mat);
    this.muzzleFlash.visible = false;
    this.root.add(this.muzzleFlash);
  }

  setWeapon(id) {
    this.weapon = id;
    // detach old
    if (this._weaponObj) {
      this._weaponObj.parent?.remove(this._weaponObj);
      this._weaponObj = null;
    }
    if (id === 'fists') return;
    const def = WEAPONS[id];
    const tpl = getTemplate(id);
    const holder = new THREE.Group();
    if (tpl) {
      const m = instance(id);
      m.scale.multiplyScalar(def?.scale ?? 1);
      holder.add(m);
    }
    // fall back to a chunky placeholder if the asset has not loaded yet
    const rightHand = this.joints.foreArmR || this.joints.upperArmR || this.root;
    rightHand.add(holder);
    holder.position.set(0, -0.34, 0.12);
    holder.rotation.set(Math.PI, 0, 0);
    this._weaponObj = holder;
    if (this.ammo[id] === undefined && def) this.ammo[id] = def.ammo;
  }

  /** weapon world-space muzzle position + direction */
  getMuzzle(outPos, outDir) {
    const def = WEAPONS[this.weapon] || WEAPONS.fists;
    const off = def.muzzle || [0, 0, 0.3];
    _v.set(off[0], off[1], off[2]);
    if (this._weaponObj) this._weaponObj.localToWorld(outPos.copy(_v).multiplyScalar(0));
    // compute from the right forearm for a stable forward axis
    const hand = this.joints.foreArmR;
    if (hand) {
      hand.getWorldPosition(outPos);
      outDir.set(0, 0, 1).applyQuaternion(this.root.quaternion);
      outDir.y += Math.sin(this.aimPitch) * 0.9;
      outDir.normalize();
      outPos.addScaledVector(outDir, 0.4);
    } else {
      outPos.copy(this.position).add(_v2.set(0, 1.3, 0));
      outDir.set(0, 0, 1).applyQuaternion(this.root.quaternion);
    }
    return { pos: outPos, dir: outDir };
  }

  reset(pos, yaw = 0) {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.targetYaw = yaw;
    this.health = 100;
    this.root.position.copy(pos);
    this.root.rotation.y = yaw;
    this.moveState = 'idle';
    this.driveVehicle = null;
  }

  /**
   * @param {number} dt seconds
   * @param {object} input { forward, right, sprint, jump, attack, aim, yaw }
   * @param {World} world
   */
  update(dt, input, world) {
    if (this.driveVehicle) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;

    const wish = _v.set(input.right || 0, 0, input.forward || 0);
    const wishLen = Math.min(1, wish.length());
    if (wishLen > 0.001) wish.normalize();

    // camera-relative movement basis
    const camYaw = input.yaw ?? 0;
    const sin = Math.sin(camYaw);
    const cos = Math.cos(camYaw);
    const dirX = wish.x * cos + wish.z * sin;
    const dirZ = -wish.x * sin + wish.z * cos;

    const wantSprint = !!input.sprint && wishLen > 0.1;
    this.sprinting = wantSprint;
    this.moving = wishLen > 0.1;
    const baseSpeed = wantSprint ? 8.6 : this.aiming ? 2.4 : 4.4;
    const accel = this.onGround ? 34 : 9;
    const targetVX = dirX * baseSpeed * wishLen;
    const targetVZ = dirZ * baseSpeed * wishLen;
    this.velocity.x += (targetVX - this.velocity.x) * Math.min(1, accel * dt * 0.5);
    this.velocity.z += (targetVZ - this.velocity.z) * Math.min(1, accel * dt * 0.5);
    // friction when idle
    if (wishLen < 0.05 && this.onGround) {
      this.velocity.x *= Math.max(0, 1 - 12 * dt);
      this.velocity.z *= Math.max(0, 1 - 12 * dt);
    }

    // gravity + jump (skipped while floating)
    const inWater = this.position.y < this.WATERLINE + 0.05;
    if (!inWater) this.velocity.y -= 26 * dt;
    else this.velocity.y = Math.max(this.velocity.y, -1.2);
    if (input.jump && this.onGround) {
      this.velocity.y = 9.2;
      this.onGround = false;
    }

    // integrate
    this.position.addScaledVector(this.velocity, dt);

    // ground / water
    const swimming = this.position.y < -0.2;
    if (swimming) {
      // buoyancy: settle at the waterline, head above the surface
      this.velocity.y += (this.WATERLINE - this.position.y) * 260 * dt;
      this.velocity.y *= Math.pow(0.05, dt);
      this.position.y = THREE.MathUtils.clamp(this.position.y, -2.2, this.WATERLINE);
      this.onGround = false;
      this.moveState = 'swim';
      if (this.moving) {
        this.velocity.x += dirX * 3.2 * dt * 12;
        this.velocity.z += dirZ * 3.2 * dt * 12;
        this.velocity.x = THREE.MathUtils.clamp(this.velocity.x, -2.6, 2.6);
        this.velocity.z = THREE.MathUtils.clamp(this.velocity.z, -2.6, 2.6);
      }
    } else if (this.position.y <= 0.02) {
      const wasAir = !this.onGround;
      this.position.y = 0.02;
      if (wasAir && this.velocity.y < -12) {
        this.landedImpact = Math.min(1, -this.velocity.y / 22);
      }
      this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // building collision
    if (world) {
      const hit = world.resolveCollision(this.position, this.radius);
      if (hit) {
        // kill horizontal velocity into the wall
        this.velocity.x *= 0.35;
        this.velocity.z *= 0.35;
      }
    }

    // facing
    if (this.moving) this.targetYaw = Math.atan2(this.velocity.x, this.velocity.z);
    if (this.aiming) this.targetYaw = camYaw + Math.PI;
    let dYaw = this.targetYaw - this.yaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    this.yaw += dYaw * Math.min(1, 14 * dt);

    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;

    // speed & state
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.speed = horizSpeed;
    if (swimming) this.moveState = 'swim';
    else if (!this.onGround) this.moveState = this.velocity.y > 0 ? 'jump' : 'fall';
    else if (this.punchTimer > 0) this.moveState = 'punch';
    else if (horizSpeed > 6.4) this.moveState = 'sprint';
    else if (horizSpeed > 2.6) this.moveState = 'run';
    else if (horizSpeed > 0.28) this.moveState = 'walk';
    else this.moveState = 'idle';

    // combat
    this.aimPitch = (input.pitch || 0);
    this.aiming = !!input.aim;
    this.fireCooldown -= dt;
    if (input.attack) this.tryAttack();
    if (this.punchTimer > 0) this.punchTimer -= dt;
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 7);

    this.animate(dt, horizSpeed);
  }

  tryAttack() {
    const def = WEAPONS[this.weapon] || WEAPONS.fists;
    if (this.fireCooldown > 0) return;
    if (def.kind === 'melee') {
      this.punchTimer = 0.34;
      this.fireCooldown = 1 / def.rate;
      this.onShoot({ type: 'melee', damage: def.damage, weapon: 'fists', pos: this.position.clone() });
      return;
    }
    if ((this.ammo[this.weapon] ?? 0) <= 0) {
      this.onShoot({ type: 'empty', weapon: this.weapon });
      this.fireCooldown = 0.35;
      return;
    }
    this.ammo[this.weapon] = Math.max(0, (this.ammo[this.weapon] ?? 0) - 1);
    this.fireCooldown = 60 / def.rpm;
    this.recoil = 1;
    this.punchTimer = 0.09;
    this.showMuzzleFlash();
    this.onShoot({ type: 'shot', weapon: this.weapon, damage: def.damage, range: def.range });
  }

  showMuzzleFlash() {
    this.muzzleFlash.visible = true;
    this.muzzleFlash.material.opacity = 1;
    this.muzzleFlash.scale.setScalar(0.8 + Math.random() * 0.8);
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => {
      this.muzzleFlash.visible = false;
    }, 45);
  }

  reload() {
    const def = WEAPONS[this.weapon];
    if (!def || def.kind === 'melee') return;
    this.ammo[this.weapon] = def.ammo;
  }

  // ---------------------------------------------------------------- animation
  animate(dt, speed) {
    const j = this.joints;
    if (!j.hips) return;
    const st = this.moveState;
    const swing = st === 'sprint' ? 1.35 : st === 'run' ? 1.0 : 0.6;

    if (st === 'swim') {
      this.animPhase += dt * 5.2;
      const s = Math.sin(this.animPhase);
      this.root.rotation.x = -1.15; // horizontal swimming pose
      this.root.position.y = this.position.y + 0.55;
      this._set('upperArmL', -2.2 + s * 1.1, 0, 0.35);
      this._set('upperArmR', -2.2 - s * 1.1, 0, -0.35);
      this._set('upperLegL', s * 0.5, 0, 0);
      this._set('upperLegR', -s * 0.5, 0, 0);
      this._set('lowerLegL', 0.3, 0, 0);
      this._set('lowerLegR', 0.3, 0, 0);
      return;
    }
    this.root.rotation.x += (0 - this.root.rotation.x) * Math.min(1, dt * 8);

    if (st === 'jump' || st === 'fall') {
      const t = THREE.MathUtils.clamp(-this.velocity.y / 12, -1, 1);
      this._set('upperArmL', -0.5 - t * 0.7, 0, 0.5);
      this._set('upperArmR', -0.5 - t * 0.7, 0, -0.5);
      this._set('upperLegL', st === 'fall' ? 0.55 : -0.35, 0, 0.08);
      this._set('upperLegR', st === 'fall' ? 0.2 : -0.6, 0, -0.08);
      this._set('lowerLegL', 0.7, 0, 0);
      this._set('lowerLegR', 0.35, 0, 0);
      this._set('torso', 0.12, 0, 0);
      this._bob(0);
      return;
    }

    const rate = st === 'idle' ? 1.8 : 2.2 + speed * 0.62;
    this.animPhase += dt * rate;
    const s = Math.sin(this.animPhase);
    const c = Math.cos(this.animPhase * 2);

    if (st === 'idle') {
      const breathe = Math.sin(this.animPhase) * 0.035;
      this._set('upperArmL', 0.08 + breathe, 0, 0.11);
      this._set('upperArmR', 0.08 - breathe, 0, -0.11);
      this._set('foreArmL', 0.22, 0, 0);
      this._set('foreArmR', 0.22, 0, 0);
      this._set('upperLegL', 0.02, 0, 0.04);
      this._set('upperLegR', -0.02, 0, -0.04);
      this._set('lowerLegL', 0.06, 0, 0);
      this._set('lowerLegR', 0.06, 0, 0);
      this._set('torso', breathe * 0.4, 0, 0);
      this._bob(breathe * 0.02);
    } else {
      // walk / run / sprint cycle
      this._set('upperLegL', s * swing, 0, 0.03);
      this._set('upperLegR', -s * swing, 0, -0.03);
      this._set('lowerLegL', Math.max(0, -s) * swing * 1.7 + 0.12, 0, 0);
      this._set('lowerLegR', Math.max(0, s) * swing * 1.7 + 0.12, 0, 0);
      this._set('footL', -Math.max(0, -s) * 0.3, 0, 0);
      this._set('footR', -Math.max(0, s) * 0.3, 0, 0);
      const lean = st === 'sprint' ? 0.26 : st === 'run' ? 0.12 : 0.04;
      this._set('torso', lean, -s * 0.06, 0);
      this._set('head', -lean * 0.7, s * 0.04, 0);

      if (this.aiming && this.weapon !== 'fists') {
        this._set('upperArmR', -1.45 + this.aimPitch * 0.9, -0.25, -0.12);
        this._set('foreArmR', -0.25, 0, 0);
        this._set('upperArmL', -1.2 + this.aimPitch * 0.6, 0.5, 0.25);
        this._set('foreArmL', -0.6, 0, 0);
      } else {
        this._set('upperArmL', -s * swing * 0.85, 0, 0.11);
        this._set('upperArmR', s * swing * 0.85, 0, -0.11);
        this._set('foreArmL', 0.35 + Math.max(0, -s) * 0.5, 0, 0);
        this._set('foreArmR', 0.35 + Math.max(0, s) * 0.5, 0, 0);
      }
      this._bob(Math.abs(c) * 0.035 * (st === 'sprint' ? 1.5 : 1));
    }

    // punch overrides the right arm
    if (this.punchTimer > 0) {
      const t = 1 - this.punchTimer / 0.34;
      const punch = Math.sin(Math.min(1, t * 1.4) * Math.PI);
      if (this.weapon === 'fists') {
        this._set('upperArmR', -1.5 * punch, 0, -0.15);
        this._set('foreArmR', 0.9 * (1 - punch), 0, 0);
        this._set('torso', 0, -punch * 0.35, 0);
      } else {
        this._set('upperArmR', -1.5 + this.recoil * 0.28, -0.25, -0.12);
        this._set('foreArmR', -0.2 - this.recoil * 0.3, 0, 0);
      }
    }
  }

  _set(name, x, y, z) {
    const n = this.joints[name];
    if (!n) return;
    n.rotation.set(x, y, z);
  }

  _bob(amount) {
    if (!this.root.userData.restY) this.root.userData.restY = this.root.position.y;
    this.root.position.y = this.position.y + amount;
  }
}
