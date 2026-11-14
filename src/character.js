/**
 * Character rig driver: procedural walk / run / jump / swim / punch animation on the
 * rigid-part glTF characters, plus weapon mounting, aiming and shooting.
 */
import * as THREE from 'three';
import { instance, getTemplate } from './assets.js';

/**
 * Realistic (rigged) character support.
 *
 * The foundry characters are rigid-part models with named joints, animated by the
 * procedural cycle below. GLBs that ship a real skeleton (the rigged sample avatars,
 * plus anything the player hot-swaps in) are driven instead by retargeting a
 * procedural walk/run cycle onto their bones by NAME — no external animation
 * files, and it works on Mixamo, three.js and VRM rigs alike.
 */
const BONE_ALIASES = {
  hips: ['hips', 'Hips', 'mixamorigHips', 'pelvis', 'root'],
  spine: ['spine', 'Spine', 'mixamorigSpine', 'spine_01'],
  chest: ['chest', 'Chest', 'mixamorigSpine1', 'spine2', 'spine_02'],
  neck: ['neck', 'Neck', 'mixamorigNeck'],
  head: ['head', 'Head', 'mixamorigHead'],
  shoulderL: ['leftshoulder', 'LeftShoulder', 'mixamorigLeftShoulder', 'clavicle_l'],
  shoulderR: ['rightshoulder', 'RightShoulder', 'mixamorigRightShoulder', 'clavicle_r'],
  armL: ['leftarm', 'LeftArm', 'mixamorigLeftArm', 'upperarm_l', 'LeftUpperArm'],
  armR: ['rightarm', 'RightArm', 'mixamorigRightArm', 'upperarm_r', 'RightUpperArm'],
  foreArmL: ['leftforearm', 'LeftForeArm', 'mixamorigLeftForeArm', 'lowerarm_l', 'LeftLowerArm'],
  foreArmR: ['rightforearm', 'RightForeArm', 'mixamorigRightForeArm', 'lowerarm_r', 'RightLowerArm'],
  handL: ['lefthand', 'LeftHand', 'mixamorigLeftHand', 'hand_l'],
  handR: ['righthand', 'RightHand', 'mixamorigRightHand', 'hand_r'],
  thighL: ['leftupleg', 'LeftUpLeg', 'mixamorigLeftUpLeg', 'thigh_l', 'LeftUpperLeg'],
  thighR: ['rightupleg', 'RightUpLeg', 'mixamorigRightUpLeg', 'thigh_r', 'RightUpperLeg'],
  shinL: ['leftleg', 'LeftLeg', 'mixamorigLeftLeg', 'calf_l', 'LeftLowerLeg'],
  shinR: ['rightleg', 'RightLeg', 'mixamorigRightLeg', 'calf_r', 'RightLowerLeg'],
  footL: ['leftfoot', 'LeftFoot', 'mixamorigLeftFoot', 'foot_l', 'LeftFoot'],
  footR: ['rightfoot', 'RightFoot', 'mixamorigRightFoot', 'foot_r', 'RightFoot'],
};

/** local axis each bone rotates about for a swing, per rig family */
function detectBoneMap(root) {
  const found = {};
  const byLower = new Map();
  root.traverse((o) => {
    if (o.isBone) byLower.set(o.name.toLowerCase(), o);
  });
  for (const [key, aliases] of Object.entries(BONE_ALIASES)) {
    for (const a of aliases) {
      const bone = byLower.get(a.toLowerCase());
      if (bone) { found[key] = bone; break; }
    }
  }
  return { bones: found, isMixamo: Object.values(found).some((b) => /mixamorig/i.test(b.name)) };
}

// the ocean mesh surface (see OCEAN_Y in world.js) — terrain below this is water
const OCEAN_LEVEL = -0.15;

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

    // rigged skinning? then drive bones instead of the rigid-part joint set
    const rig = root ? detectBoneMap(root) : { bones: {} };
    this.bones = rig.bones;
    this.rigged = Object.keys(rig.bones).length >= 8;
    // rest pose captured once, so every frame is an offset from it
    for (const b of Object.values(this.bones)) b.userData.restQ = b.quaternion.clone();
    this.rigScale = 1;
    if (this.rigged && root) {
      // three.js sample avatars are authored in cm and/or ~1.8x too large
      const box = new THREE.Box3().setFromObject(root);
      const h = box.max.y - box.min.y;
      if (h > 3.2) this.rigScale = 1.8 / h;
      root.scale.multiplyScalar(this.rigScale);
      root.position.y = -box.min.y * this.rigScale;
      // these avatars ship in a T-pose: drop the arms to the sides
      const drop = (b, sign) => {
        if (!b) return;
        b.userData.restQ = b.userData.restQ.clone();
        b.rotateZ(sign * 1.15);
        b.userData.restQ = b.quaternion.clone();
      };
      drop(this.bones.armL, 1);
      drop(this.bones.armR, -1);
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
    // Defensive: the controller is integrated explicitly, so a stalled frame
    // (tab backgrounded, GC pause, first frame after load) must never hand it a
    // huge step. Without this a single 300 ms frame drops a standing player
    // straight through the ground clamp and into the water band.
    dt = Math.min(0.05, Math.max(0, dt || 0));
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

    // ------------------------------------------------------ surface sample
    // The floor is not a constant: the city sits a few cm above y=0 while the
    // terrain dips under the sea surface (OCEAN_LEVEL) out at the west shoreline,
    // and off the map edge there is no ground at all. Sample it rather than
    // assuming, so the beach, the shallows and open water all behave.
    const groundY = world && typeof world.groundAt === 'function'
      ? world.groundAt(this.position.x, this.position.z)
      : 0.02;
    const inWater = groundY === null || groundY < OCEAN_LEVEL;
    this._surface = inWater ? 'water' : 'land';
    this._waterY = groundY;

    // jump (must be read before the land clamp below clears velocity.y)
    if (input.jump && this.onGround && !inWater) {
      this.velocity.y = 9.2;
      this.onGround = false;
    }

    if (inWater) {
      // buoyancy owns vertical motion: a damped spring toward the waterline, so
      // the character bobs with their head at the surface instead of sinking.
      const target = this.WATERLINE;
      this.velocity.y += (target - this.position.y) * 32 * dt;
      this.velocity.y *= Math.pow(0.12, dt);
      this.velocity.y = THREE.MathUtils.clamp(this.velocity.y, -3, 2.4);
      this.position.y += this.velocity.y * dt;
      this.position.y = Math.min(this.position.y, this.WATERLINE + 0.06); // never ride up onto the surface
      this.position.y = Math.max(this.position.y, -2.2);                   // sea floor
      this.position.addScaledVector({ x: this.velocity.x, y: 0, z: this.velocity.z }, dt);
      this.onGround = false;
      if (this.moving) {
        this.velocity.x += dirX * 3.2 * dt * 12;
        this.velocity.z += dirZ * 3.2 * dt * 12;
        this.velocity.x = THREE.MathUtils.clamp(this.velocity.x, -2.6, 2.6);
        this.velocity.z = THREE.MathUtils.clamp(this.velocity.z, -2.6, 2.6);
      }
    } else {
      const wasAir = !this.onGround;
      this.velocity.y -= 26 * dt;
      this.position.addScaledVector(this.velocity, dt);
      if (this.position.y <= groundY + 0.02) {
        // a jump fired this frame must not be swallowed by the floor snap
        const rising = this.velocity.y > 0;
        this.position.y = groundY + 0.02;
        if (!rising) {
          if (wasAir && this.velocity.y < -12) {
            this.landedImpact = Math.min(1, -this.velocity.y / 22);
          }
          this.velocity.y = 0;
          this.onGround = true;
        } else {
          this.onGround = false;
        }
      } else {
        this.onGround = false;
      }
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
    if (this._surface === 'water') this.moveState = 'swim';
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
    if (this.rigged) {
      this.animateRig(dt, speed);
      return;
    }
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

  // ---------------------------------------------------------------- rigged pose
  /**
   * Procedural retarget: rotates the actual bones by an offset from their rest
   * quaternion. Runs for any skeleton with recognisable bone names.
   */
  animateRig(dt, speed) {
    const b = this.bones;
    if (!this.rigged) return;
    const st = this.moveState;
    const rate = st === 'idle' ? 1.6 : 2.4 + speed * 0.75;
    this.rigPhase = (this.rigPhase || 0) + dt * rate;
    const s = Math.sin(this.rigPhase);
    const c = Math.cos(this.rigPhase);
    const swing = st === 'sprint' ? 0.95 : st === 'run' ? 0.72 : st === 'walk' ? 0.45 : 0.1;
    const _e = new THREE.Euler();
    const _q = new THREE.Quaternion();
    const rot = (bone, x, y, z) => {
      if (!bone) return;
      _e.set(x, y, z, 'XYZ');
      _q.setFromEuler(_e);
      bone.quaternion.copy(bone.userData.restQ).multiply(_q);
    };
    if (st === 'swim') {
      rot(b.armL, 0, 0, -1.4 + s * 0.9);
      rot(b.armR, 0, 0, 1.4 - s * 0.9);
      rot(b.thighL, -s * 0.3, 0, 0);
      rot(b.thighR, s * 0.3, 0, 0);
      return;
    }
    if (st === 'jump' || st === 'fall') {
      const t = THREE.MathUtils.clamp(-this.velocity.y / 12, -1, 1);
      rot(b.armL, 0, 0, -0.7 - t * 0.5);
      rot(b.armR, 0, 0, 0.7 + t * 0.5);
      rot(b.thighL, st === 'fall' ? 0.5 : -0.3, 0, 0.05);
      rot(b.thighR, st === 'fall' ? 0.15 : -0.5, 0, -0.05);
      rot(b.shinL, 0.7, 0, 0);
      rot(b.shinR, 0.4, 0, 0);
      rot(b.spine, 0.12, 0, 0);
      return;
    }
    if (st === 'idle') {
      const breathe = Math.sin(this.rigPhase) * 0.05;
      rot(b.spine, breathe * 0.5, 0, 0);
      rot(b.chest, breathe * 0.4, 0, 0);
      rot(b.head, -breathe * 0.3, Math.sin(this.rigPhase * 0.3) * 0.14, 0);
      rot(b.armL, 0, 0, -0.06 - breathe * 0.3);
      rot(b.armR, 0, 0, 0.06 + breathe * 0.3);
      rot(b.thighL, 0, 0, 0);
      rot(b.thighR, 0, 0, 0);
      rot(b.shinL, 0.03, 0, 0);
      rot(b.shinR, 0.03, 0, 0);
      return;
    }
    // walk / run / sprint
    rot(b.thighL, s * swing, 0, 0);
    rot(b.thighR, -s * swing, 0, 0);
    rot(b.shinL, Math.max(0, -s) * swing * 1.6 + 0.08, 0, 0);
    rot(b.shinR, Math.max(0, s) * swing * 1.6 + 0.08, 0, 0);
    rot(b.footL, -Math.max(0, -s) * 0.35, 0, 0);
    rot(b.footR, -Math.max(0, s) * 0.35, 0, 0);
    const lean = st === 'sprint' ? 0.24 : st === 'run' ? 0.13 : 0.05;
    rot(b.spine, lean, -s * 0.05, 0);
    rot(b.head, -lean * 0.6, s * 0.03, 0);
    if (this.aiming && this.weapon !== 'fists') {
      rot(b.armR, -1.3 + (this.aimPitch || 0) * 0.8, -0.2, 0.12);
      rot(b.foreArmR, -0.25, 0, 0);
      rot(b.armL, -1.1 + (this.aimPitch || 0) * 0.5, 0.4, -0.2);
    } else {
      rot(b.armL, -s * swing * 0.85, 0, -0.1);
      rot(b.armR, s * swing * 0.85, 0, 0.1);
      rot(b.foreArmL, 0.3 + Math.max(0, -s) * 0.5, 0, 0);
      rot(b.foreArmR, 0.3 + Math.max(0, s) * 0.5, 0, 0);
    }
    rot(b.hips, 0, s * 0.06, 0);
    if (this.punchTimer > 0 && this.weapon === 'fists') {
      const t = 1 - this.punchTimer / 0.34;
      const punch = Math.sin(Math.min(1, t * 1.4) * Math.PI);
      rot(b.armR, 0, -punch * 1.4, 0);
      rot(b.foreArmR, -punch * 0.8, 0, 0);
      rot(b.chest, 0, -punch * 0.3, 0);
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
