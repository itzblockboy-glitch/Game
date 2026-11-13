/**
 * Arcade vehicle + aircraft physics for the glTF vehicles.
 * Wheels, rotors and sirens are driven on the named nodes emitted by the asset foundry.
 */
import * as THREE from 'three';
import { instance, getTemplate } from './assets.js';

const _v = new THREE.Vector3();
const _lean = new THREE.Quaternion();
const _axisZ = new THREE.Vector3(0, 0, 1);

/**
 * Performance tiers — each vehicle has a genuinely different top speed, launch,
 * braking, grip and steering response, grouped so the player can feel the steps:
 *
 *   bike  > hyper > race > super > sport > muscle > police > truck
 *
 * `top` is m/s (×3.6 for km/h). `accel` m/s², `brake` m/s², `grip` lateral
 * damping, `steer` rad/s at low speed, `mass` kg (drives inertia + turn rate).
 */
export const VEHICLE_DEFS = {
  // ---- hypercars (300+ km/h)
  porsche_mission_x: { name: 'Porsche Mission X', top: 92, accel: 34, brake: 42, grip: 3.9, steer: 2.0, mass: 1500, type: 'car', tier: 'hyper', kmh: 331, drive: 'AWD' },
  ferrari_daytona_sp3: { name: 'Ferrari Daytona SP3', top: 87, accel: 31, brake: 40, grip: 3.7, steer: 1.95, mass: 1450, type: 'car', tier: 'hyper', kmh: 313, drive: 'RWD' },
  // ---- race cars
  redbull_rb22: { name: 'Red Bull RB22', top: 105, accel: 44, brake: 62, grip: 5.4, steer: 2.5, mass: 800, type: 'car', tier: 'race', kmh: 378, drive: 'RWD' },
  porsche_911_gt3r: { name: 'Porsche 911 GT3 R', top: 79, accel: 27, brake: 40, grip: 4.4, steer: 2.15, mass: 1300, type: 'car', tier: 'race', kmh: 284, drive: 'RWD' },
  // ---- supercars / sports
  police_lambo_diablo: { name: 'Diablo SV — Police', top: 84, accel: 26, brake: 34, grip: 3.3, steer: 1.9, mass: 1500, type: 'car', tier: 'super', kmh: 302, siren: true, drive: 'AWD' },
  mustang_roush_1996: { name: '1996 Roush Mustang', top: 63, accel: 19, brake: 26, grip: 2.7, steer: 1.6, mass: 1600, type: 'car', tier: 'muscle', kmh: 227, drive: 'RWD' },
  police_car: { name: 'Police Cruiser', top: 57, accel: 15, brake: 28, grip: 2.9, steer: 1.7, mass: 1750, type: 'car', tier: 'police', kmh: 205, siren: true, drive: 'RWD' },
  // ---- bikes (fastest in a straight line, weakest braking)
  kawasaki_ninja_h2: { name: 'Kawasaki Ninja H2', top: 100, accel: 46, brake: 30, grip: 2.6, steer: 2.3, mass: 260, type: 'bike', tier: 'bike', kmh: 360, drive: 'RWD' },
  bmw_s1000rr: { name: 'BMW S1000RR', top: 94, accel: 41, brake: 31, grip: 2.7, steer: 2.35, mass: 250, type: 'bike', tier: 'bike', kmh: 338, drive: 'RWD' },
  // ---- utility + aircraft
  ural_4320_truck: { name: 'URAL-4320', top: 22, accel: 5.5, brake: 14, grip: 1.9, steer: 1.05, mass: 8000, type: 'truck', tier: 'truck', kmh: 79, drive: '6x6' },
  aeroplane: { name: 'Aeroplane', top: 105, accel: 12, brake: 14, grip: 2.0, steer: 1.1, mass: 3000, type: 'plane' },
  little_bird_helicopter: { name: 'MH-6 Little Bird', top: 88, accel: 14, brake: 16, grip: 2.4, steer: 1.6, mass: 1200, type: 'heli' },
};

export class Vehicle {
  constructor(defId, modelId) {
    this.id = defId;
    this.def = VEHICLE_DEFS[defId] || VEHICLE_DEFS.police_car;
    this.modelId = modelId || defId;
    this.root = new THREE.Group();
    this.body = instance(this.modelId);
    if (this.body) this.root.add(this.body);
    else {
      // placeholder cube until the asset resolves
      const geo = new THREE.BoxGeometry(2, 1.2, 4.4);
      this.body = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xff4444, flatShading: true }));
      this.body.position.y = 0.7;
      this.root.add(this.body);
    }
    this.root.name = `vehicle:${defId}`;

    this.wheels = ['wheelFL', 'wheelFR', 'wheelML', 'wheelMR', 'wheelRL', 'wheelRR']
      .map((n) => this.body.getObjectByName(n))
      .filter(Boolean);
    this.frontWheels = [this.body.getObjectByName('wheelFL'), this.body.getObjectByName('wheelFR')].filter(Boolean);
    this.rotor = this.body.getObjectByName('rotor');
    this.tailRotor = this.body.getObjectByName('tailRotor');
    this.propL = this.body.getObjectByName('propL');
    this.propR = this.body.getObjectByName('propR');
    this.siren = this.body.getObjectByName('siren');
    this.sirenMaterials = [];
    this.body.traverse((o) => {
      if (o.isMesh && Array.isArray(o.material)) return;
      if (o.isMesh && o.material?.emissive && o.userData.sirenLight) this.sirenMaterials.push(o.material);
    });
    if (this.siren) {
      const lights = [];
      this.siren.traverse((o) => {
        if (o.isMesh && o.material && o.material.emissive) lights.push(o.material);
      });
      this.sirenMaterials = lights;
    }

    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.speed = 0;
    this.steerAngle = 0;
    this.wheelSpin = 0;
    this.occupied = false;
    this.driver = null;
    this.health = 100;
    this.sirenOn = false;
    this._sirenPhase = 0;
    this.rotorSpin = 0;
    this.throttle = 0;
    this.airborne = false;
    this.pitch = 0;
    this.roll = 0;
    this.type = this.def.type;
    this.wheelRadius = 0.36;
  }

  get isAircraft() {
    return this.type === 'plane' || this.type === 'heli';
  }

  get isBike() {
    return this.type === 'bike';
  }

  place(pos, yaw = 0) {
    this.position.copy(pos);
    this.yawSet(yaw);
    this.root.position.copy(pos);
    this.root.quaternion.copy(this.quaternion);
  }

  yawSet(yaw) {
    this.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
  }

  get yaw() {
    _v.set(0, 0, 1).applyQuaternion(this.quaternion);
    return Math.atan2(_v.x, _v.z);
  }

  /**
   * @param {object} input { throttle, brake, steer, handbrake, up, down, yawAxis }
   */
  update(dt, input, world) {
    if (this.isAircraft) return this.updateAircraft(dt, input, world);

    const def = this.def;
    const throttle = input.throttle || 0;
    const brake = input.brake || 0;
    const steerIn = input.steer || 0;

    // steering angle (speed sensitive)
    const maxSteer = def.steer * (1 - Math.min(0.72, Math.abs(this.speed) / (def.top * 1.6)));
    this.steerAngle += (steerIn * maxSteer - this.steerAngle) * Math.min(1, dt * 9);

    // longitudinal
    const forward = _v.set(0, 0, 1).applyQuaternion(this.quaternion);
    let accel = 0;
    if (throttle > 0) accel = def.accel * throttle * (1 - Math.min(1, Math.abs(this.speed) / def.top) * 0.82);
    if (brake > 0) accel -= def.brake * brake * (this.speed > 0 ? 1 : 0.4);
    if (throttle === 0 && brake === 0) accel -= Math.sign(this.speed) * 3.6;
    if (input.handbrake) accel -= Math.sign(this.speed) * 12;

    this.speed += accel * dt;
    this.speed = THREE.MathUtils.clamp(this.speed, -def.top * 0.34, def.top);
    if (Math.abs(this.speed) < 0.05 && throttle === 0) this.speed = 0;

    // yaw from steering (bicycle-ish model)
    const turnRate = (this.steerAngle * this.speed) / Math.max(2.4, def.mass / 600);
    if (Math.abs(this.speed) > 0.2) {
      const yawDelta = turnRate * dt * (input.handbrake ? 1.55 : 1);
      this.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawDelta));
    }

    // lateral grip (drift feel)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion);
    const lateral = this.velocity.dot(right);
    this.velocity.addScaledVector(right, -lateral * Math.min(1, def.grip * dt));
    this.velocity.lerp(forward.clone().multiplyScalar(this.speed), Math.min(1, dt * 8));

    this.position.addScaledVector(this.velocity, dt);

    // ground clamp + building collision
    if (this.position.y < 0) {
      this.position.y = 0;
      this.airborne = false;
    }
    if (world) {
      const hit = world.resolveCollision(this.position, this.type === 'truck' ? 1.6 : 1.25);
      if (hit) {
        this.speed *= 0.55;
        this.health = Math.max(0, this.health - 1.5);
      }
    }
    // simple suspension bob
    const bob = Math.sin(this.wheelSpin * 0.5) * Math.min(0.03, Math.abs(this.speed) * 0.001);
    this.root.position.set(this.position.x, this.position.y + bob, this.position.z);
    this.root.quaternion.copy(this.quaternion);

    // wheels
    this.wheelSpin += (this.speed / this.wheelRadius) * dt;
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;
    for (const w of this.frontWheels) w.rotation.y = this.steerAngle * 0.5;

    // body roll + pitch — bikes lean hard into the corner, cars squat/roll gently
    const leanScale = this.isBike ? 0.62 : 0.16;
    if (this.isBike) {
      // keep the wheels planted: roll the whole rig, not just the body shell
      this.roll += (-this.steerAngle * Math.min(1, Math.abs(this.speed) / def.top) * leanScale - this.roll) * Math.min(1, dt * 7);
    }
    const roll = -this.steerAngle * Math.min(1, Math.abs(this.speed) / def.top) * leanScale;
    const pitch = -accel * (this.isBike ? 0.0022 : 0.0035) + (this.isBike ? -Math.min(0.12, Math.abs(this.speed) / def.top * 0.12) : 0);
    if (this.body) {
      this.body.rotation.z += (roll - this.body.rotation.z) * Math.min(1, dt * 6);
      this.body.rotation.x += (pitch - this.body.rotation.x) * Math.min(1, dt * 6);
    }

    this.updateSiren(dt);
  }

  updateAircraft(dt, input, world) {
    const def = this.def;
    const isHeli = this.type === 'heli';
    const throttle = input.throttle || 0;
    const up = input.up || 0;
    const down = input.down || 0;
    const steerIn = input.steer || 0;

    this.throttle += (throttle - this.throttle) * Math.min(1, dt * 4);
    const cruise = def.top;
    let targetSpeed = this.throttle * cruise;
    if (this.throttle < 0.02) targetSpeed = 0;
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * (isHeli ? 1.6 : 1.1));

    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion);
    this.velocity.copy(forward).multiplyScalar(this.speed);

    // lift / altitude control
    let lift = 0;
    if (isHeli) {
      lift = (up - down) * 15 + (this.speed > 2 ? 1.2 : 0) - 9.8 * 0.32;
    } else {
      const minFlySpeed = 26;
      if (this.speed > minFlySpeed) lift = (up - down) * 11 + this.speed * 0.045;
      else lift = -9.8 * 0.55 + (up - down) * 4;
    }
    this.velocity.y += lift * dt * 1.6;
    if (up > 0) this.velocity.y += 7 * dt * up;
    if (down > 0) this.velocity.y -= 7 * dt * down;

    this.position.addScaledVector(this.velocity, dt);
    const groundY = isHeli ? 0.45 : 0.75;
    if (this.position.y < groundY) {
      this.position.y = groundY;
      this.velocity.y = Math.max(0, this.velocity.y);
    }
    this.position.y = Math.min(this.position.y, 520);

    // bank + pitch for feel
    const bankTarget = -steerIn * 0.55;
    this.roll += (bankTarget - this.roll) * Math.min(1, dt * 2.4);
    const pitchTarget = isHeli ? -this.throttle * 0.16 + (up - down) * 0.06 : 0.03 + (up - down) * 0.05;
    this.pitch += (pitchTarget - this.pitch) * Math.min(1, dt * 2.2);
    this.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), steerIn * def.steer * dt * (isHeli ? 0.9 : 0.55)));

    this.root.position.copy(this.position);
    // bikes visibly lean into corners
    if (this.isBike && this.roll) {
      this.root.quaternion.copy(this.quaternion).multiply(_lean.setFromAxisAngle(_axisZ, this.roll));
    } else {
      this.root.quaternion.copy(this.quaternion);
    }
    this.body.rotation.z = this.roll;
    this.body.rotation.x = this.pitch;

    // spinning rotors / props
    if (this.rotor) {
      this.rotorSpin += (22 + this.throttle * 38) * dt;
      this.rotor.rotation.y = this.rotorSpin;
    }
    if (this.tailRotor) this.tailRotor.rotation.x = this.rotorSpin * 1.7;
    if (this.propL) this.propL.rotation.z = (this.propL.rotation.z + (6 + this.throttle * 60) * dt) % (Math.PI * 2);
    if (this.propR) this.propR.rotation.z = (this.propR.rotation.z + (6 + this.throttle * 60) * dt) % (Math.PI * 2);

    // clearance
    if (world && this.position.y < 3) {
      world.resolveCollision(this.position, 3.2);
    }
    this.updateSiren(dt);
  }

  updateSiren(dt) {
    if (!this.def.siren) return;
    this._sirenPhase = (this._sirenPhase + dt * 6) % (Math.PI * 2);
    const on = this.sirenOn;
    const a = on ? Math.max(0, Math.sin(this._sirenPhase)) : 0;
    const b = on ? Math.max(0, Math.sin(this._sirenPhase + Math.PI)) : 0;
    this.sirenMaterials.forEach((mat, i) => {
      if (!mat.emissive) return;
      const v = i % 2 === 0 ? a : b;
      mat.emissiveIntensity = 0.6 + v * 5.5;
      mat.emissive.setRGB(i % 2 === 0 ? 1 : 0.15, i % 2 === 0 ? 0.12 : 0.45, i % 2 === 0 ? 0.1 : 1);
    });
    if (this._sirenLight && this._sirenLight.isPointLight) {
      this._sirenLight.intensity = on ? 2.2 + Math.max(a, b) * 5 : 0;
      this._sirenLight.color.setRGB(a > b ? 1 : 0.2, a > b ? 0.15 : 0.4, a > b ? 0.1 : 1);
    }
  }

  toggleSiren() {
    if (!this.def.siren) return false;
    this.sirenOn = !this.sirenOn;
    return this.sirenOn;
  }

  /** camera target and exit point */
  get enterOffset() {
    return this.type === 'truck' ? 2.6 : this.type === 'plane' ? 4.2 : 2.2;
  }
}
