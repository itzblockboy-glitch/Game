/**
 * Low-poly vehicle / aircraft / weapon asset foundry.
 * Every vehicle exposes named wheel nodes ("wheelFL" ... "wheelRR") so the runtime can
 * spin & steer them, plus optional "siren" / "rotor" nodes for effects.
 */
import {
  Model,
  mat,
  boxGeo,
  frustumGeo,
  cylinderGeo,
  sphereGeo,
  prismGeo,
  PAL,
} from './glb.mjs';
import * as THREE from 'three';

const C = (c) => (Array.isArray(c) ? c : new THREE.Color(c).toArray());
function shade(c, f) {
  const x = C(c);
  return [x[0] * f, x[1] * f, x[2] * f];
}

function mkMaterials(M, o) {
  return {
    body: M.addMaterial({ name: 'body', baseColor: [...C(o.paint), 1], metallic: 0.55, roughness: 0.28 }),
    trim: M.addMaterial({ name: 'trim', baseColor: [...C(o.trim || PAL.darkChrome), 1], metallic: 0.7, roughness: 0.42 }),
    glass: M.addMaterial({ name: 'glass', baseColor: [0.12, 0.16, 0.2, 1], metallic: 0.3, roughness: 0.08, transmission: 0.55 }),
    tyre: M.addMaterial({ name: 'tyre', baseColor: [...PAL.tyre, 1], roughness: 0.95 }),
    chrome: M.addMaterial({ name: 'chrome', baseColor: [...PAL.chrome, 1], metallic: 1.0, roughness: 0.16 }),
    light: M.addMaterial({ name: 'light', baseColor: [...PAL.head, 1], emissive: [1, 0.95, 0.8], emissiveStrength: 2.2 }),
    tail: M.addMaterial({ name: 'tail', baseColor: [...PAL.tail, 1], emissive: [0.9, 0.05, 0.05], emissiveStrength: 1.6 }),
    accent: M.addMaterial({ name: 'accent', baseColor: [...C(o.accent || PAL.black), 1], metallic: 0.4, roughness: 0.5 }),
  };
}

function wheel(M, name, x, y, z, r, w, mi) {
  M.addNode(name, mat({ pos: [x, y, z] }));
  M.add(cylinderGeo(r, r, w, 14, PAL.tyre, mat({ rot: [0, 0, Math.PI / 2] })), mi.tyre);
  M.add(cylinderGeo(r * 0.58, r * 0.58, w * 1.06, 10, PAL.chrome, mat({ rot: [0, 0, Math.PI / 2] })), mi.chrome);
  M.add(cylinderGeo(r * 0.18, r * 0.18, w * 1.1, 6, PAL.darkChrome, mat({ rot: [0, 0, Math.PI / 2] })), mi.trim);
}

// ------------------------------------------------------------------ car helpers
function carCore(M, mi, o) {
  const {
    len = 4.3,
    wid = 1.9,
    bodyH = 0.62,
    wheelR = 0.33,
    wheelW = 0.22,
    wheelbase = 2.6,
    track = 1.58,
    rideH = 0.1,
    noseDrop = 0.86,
    cabinLen = 0.44,
    cabinHeight = 0.42,
    cabinSet = -0.02,
    cabinTaper = 0.78,
    roofColor = null,
    spoiler = null,
    livery = null,
  } = o;

  const halfL = len / 2;
  const halfW = wid / 2;
  const y0 = wheelR + rideH;

  // main body: two tapered slabs so the silhouette reads nose/tail correctly
  M.add(
    frustumGeo(wid * 0.92, len * 0.94, wid, len * 0.88, bodyH * 0.5, o.paint, mat({ pos: [0, y0, 0] })),
    mi.body
  );
  M.add(
    frustumGeo(wid, len * 0.88, wid * noseDrop, len * 0.66, bodyH * 0.42, o.paint, mat({ pos: [0, y0 + bodyH * 0.5, len * 0.05] })),
    mi.body
  );
  // sill + bumpers
  M.box(wid * 0.98, 0.1, len * 0.99, shade(C(o.paint), 0.5), mat({ pos: [0, y0 - bodyH * 0.34, 0] }), mi.trim);
  M.box(wid * 0.94, wheelR * 0.62, 0.12, o.trim || PAL.darkChrome, mat({ pos: [0, y0 - wheelR * 0.1, halfL * 0.99] }), mi.trim);
  M.box(wid * 0.94, wheelR * 0.58, 0.12, o.trim || PAL.darkChrome, mat({ pos: [0, y0 - wheelR * 0.1, -halfL * 0.99] }), mi.trim);
  // grille + air intake
  M.box(wid * 0.52, wheelR * 0.34, 0.08, PAL.black, mat({ pos: [0, y0 + bodyH * 0.02, halfL * 1.02] }), mi.accent);

  // headlights / tail lights
  const hlY = y0 + bodyH * 0.32;
  for (const s of [-1, 1]) {
    M.box(wid * 0.24, wheelR * 0.3, 0.1, PAL.head, mat({ pos: [s * wid * 0.31, hlY, halfL * 1.0] }), mi.light);
    M.box(wid * 0.26, wheelR * 0.26, 0.1, PAL.tail, mat({ pos: [s * wid * 0.32, hlY, -halfL * 1.0] }), mi.tail);
  }

  // cabin / greenhouse
  const cabinZ = (-len * cabinSet);
  const cabH = bodyH * 0.5 + cabinHeight;
  M.add(
    frustumGeo(wid * 0.94, len * cabinLen, wid * cabinTaper, len * cabinLen * 0.72, cabH, PAL.glass, mat({ pos: [0, y0 + bodyH * 0.5, cabinZ] })),
    mi.glass
  );
  // roof panel
  M.add(
    frustumGeo(wid * cabinTaper * 1.01, len * cabinLen * 0.7, wid * cabinTaper * 0.96, len * cabinLen * 0.66, 0.06, roofColor || o.paint, mat({ pos: [0, y0 + bodyH * 0.5 + cabH, cabinZ] })),
    mi.body
  );
  // A/B pillars
  for (const s of [-1, 1]) {
    M.box(0.05, cabH * 1.02, 0.06, o.paint, mat({ pos: [s * wid * 0.44, y0 + bodyH * 0.5 + cabH * 0.5, cabinZ + len * cabinLen * 0.48] }), mi.body);
    M.box(0.05, cabH * 1.02, 0.06, o.paint, mat({ pos: [s * wid * 0.44, y0 + bodyH * 0.5 + cabH * 0.5, cabinZ - len * cabinLen * 0.46] }), mi.body);
  }
  // mirrors
  for (const s of [-1, 1]) {
    M.box(0.1, 0.05, 0.05, o.paint, mat({ pos: [s * wid * 0.52, y0 + bodyH * 0.6, cabinZ + len * cabinLen * 0.42] }), mi.trim);
  }

  if (spoiler) {
    const [spW, spH, spZ] = spoiler;
    M.box(wid * spW, 0.05, 0.26, PAL.darkChrome, mat({ pos: [0, y0 + bodyH * 0.5 + cabH * 0.2, spZ] }), mi.trim);
    for (const s of [-1, 1]) {
      M.box(0.06, cabH * 0.7, 0.06, PAL.black, mat({ pos: [s * wid * 0.35, y0 + bodyH * 0.5 + cabH * 0.06, spZ] }), mi.trim);
    }
  }
  if (livery === 'police') {
    M.box(wid * 1.005, bodyH * 0.2, len * 0.34, [0.1, 0.12, 0.2], mat({ pos: [0, y0 + bodyH * 0.22, 0] }), mi.accent);
    M.box(wid * 1.008, bodyH * 0.09, len * 0.36, [0.9, 0.9, 0.95], mat({ pos: [0, y0 + bodyH * 0.36, 0] }), mi.chrome);
  }
  if (livery === 'racing') {
    M.box(wid * 1.005, 0.03, len * 0.8, o.accent || PAL.red, mat({ pos: [0, y0 + bodyH * 0.46, -len * 0.02] }), mi.accent);
  }

  // wheels
  const wx = track / 2;
  const wz = wheelbase / 2;
  wheel(M, 'wheelFL', -wx, wheelR, wz, wheelR, wheelW, mi);
  wheel(M, 'wheelFR', wx, wheelR, wz, wheelR, wheelW, mi);
  wheel(M, 'wheelRL', -wx, wheelR, -wz, wheelR, wheelW, mi);
  wheel(M, 'wheelRR', wx, wheelR, -wz, wheelR, wheelW, mi);
  // arches
  for (const [x, z] of [[-wx, wz], [wx, wz], [-wx, -wz], [wx, -wz]]) {
    M.add(cylinderGeo(wheelR * 1.16, wheelR * 1.16, wheelW * 1.2, 10, shade(C(o.paint), 0.82), mat({ pos: [x, wheelR, z], rot: [0, 0, Math.PI / 2] }), false), mi.body);
  }

  return { y0, cabH, halfL, halfW, wheelR };
}

function sirenBar(M, mi, y, z = 0) {
  M.addNode('siren', mat({ pos: [0, y, z] }));
  M.box(0.9, 0.09, 0.22, PAL.black, null, mi.trim);
  M.box(0.4, 0.1, 0.2, [0.95, 0.28, 0.2], mat({ pos: [-0.24, 0.005, 0] }), mi.tail);
  M.box(0.4, 0.1, 0.2, [0.25, 0.5, 1.0], mat({ pos: [0.24, 0.005, 0] }), mi.light);
}

// ------------------------------------------------------------------ builders
export function buildSportsCar(name, o) {
  const M = new Model(name);
  const mi = mkMaterials(M, o);
  carCore(M, mi, { ...o, spoiler: o.spoiler ?? [0.8, 0.2, -o.len * 0.46] });
  return M;
}

export function buildPoliceCar(name = 'police_car') {
  const M = new Model(name);
  const mi = mkMaterials(M, { paint: [0.55, 0.57, 0.62], accent: [0.1, 0.13, 0.25], trim: PAL.darkChrome });
  const d = carCore(M, mi, {
    len: 4.75, wid: 1.98, bodyH: 0.7, wheelR: 0.36, wheelW: 0.24, wheelbase: 2.85, track: 1.64,
    cabinLen: 0.46, cabinHeight: 0.44, cabinTaper: 0.8, livery: 'police',
  });
  sirenBar(M, mi, d.y0 + d.cabH + d.y0 * 0.5 + 0.55, 0.1);
  // push bar
  M.box(1.3, 0.34, 0.1, PAL.chrome, mat({ pos: [0, 0.5, d.halfL * 1.04] }), mi.chrome);
  // light bar supports
  M.box(0.1, 0.14, 0.16, PAL.black, mat({ pos: [0, d.y0 + d.cabH * 0.5 + 0.5, 0.1] }), mi.trim);
  return M;
}

export function buildLamborghiniPolice() {
  const M = new Model('police_lambo_diablo');
  const mi = mkMaterials(M, { paint: [0.14, 0.22, 0.42], accent: [0.85, 0.85, 0.9] });
  const d = carCore(M, mi, {
    len: 4.5, wid: 2.04, bodyH: 0.46, wheelR: 0.33, wheelW: 0.26, wheelbase: 2.65, track: 1.7,
    cabinLen: 0.34, cabinHeight: 0.3, cabinTaper: 0.72, cabinSet: 0.06, noseDrop: 0.8, livery: 'police',
    spoiler: [0.92, 0.18, -2.15],
  });
  sirenBar(M, mi, d.y0 + d.cabH + 0.34, 0.2);
  // scissor doors seam + side vents
  for (const s of [-1, 1]) {
    M.box(0.02, 0.3, 0.7, PAL.black, mat({ pos: [s * 1.03, 0.62, 0.35] }), mi.accent);
  }
  M.box(0.9, 0.06, 0.5, PAL.darkChrome, mat({ pos: [0, 0.34, 2.2] }), mi.trim);
  return M;
}

export function buildFerrari() {
  const M = new Model('ferrari_daytona_sp3');
  const mi = mkMaterials(M, { paint: [0.72, 0.06, 0.05], accent: [0.05, 0.05, 0.06] });
  const d = carCore(M, mi, {
    len: 4.62, wid: 2.0, bodyH: 0.5, wheelR: 0.35, wheelW: 0.28, wheelbase: 2.72, track: 1.68,
    cabinLen: 0.36, cabinHeight: 0.32, cabinTaper: 0.74, cabinSet: 0.04, noseDrop: 0.82, livery: 'racing',
    spoiler: [0.86, 0.16, -2.2],
  });
  for (const s of [-1, 1]) {
    M.box(0.02, 0.26, 0.9, PAL.black, mat({ pos: [s * 1.01, 0.6, -0.2] }), mi.accent);
    M.box(0.12, 0.16, 0.3, PAL.black, mat({ pos: [s * 1.02, 0.5, -1.5] }), mi.accent); // side intake
  }
  // quad exhausts
  for (const s of [-1, 1]) {
    M.add(cylinderGeo(0.07, 0.07, 0.16, 8, PAL.chrome, mat({ pos: [s * 0.28, 0.38, -2.34], rot: [Math.PI / 2, 0, 0] })), mi.chrome);
  }
  return M;
}

export function buildMustang() {
  const M = new Model('mustang_roush_1996');
  const mi = mkMaterials(M, { paint: [0.05, 0.09, 0.2], accent: [0.85, 0.7, 0.2] });
  const d = carCore(M, mi, {
    len: 4.7, wid: 1.94, bodyH: 0.72, wheelR: 0.35, wheelW: 0.24, wheelbase: 2.75, track: 1.62,
    cabinLen: 0.44, cabinHeight: 0.4, cabinTaper: 0.82, livery: 'racing',
  });
  // hood scoop + stripe
  M.box(0.7, 0.08, 0.8, shade([0.05, 0.09, 0.2], 0.8), mat({ pos: [0, 1.18, 1.2] }), mi.accent);
  for (const s of [-1, 1]) {
    M.box(0.12, 0.02, 4.4, [0.9, 0.9, 0.9], mat({ pos: [s * 0.34, 1.24, -0.4] }), mi.chrome);
  }
  return M;
}

export function buildPorsche911() {
  const M = new Model('porsche_911_gt3r');
  const mi = mkMaterials(M, { paint: [0.92, 0.92, 0.94], accent: [0.75, 0.1, 0.1] });
  const d = carCore(M, mi, {
    len: 4.6, wid: 2.02, bodyH: 0.58, wheelR: 0.34, wheelW: 0.27, wheelbase: 2.66, track: 1.7,
    cabinLen: 0.38, cabinHeight: 0.34, cabinTaper: 0.8, cabinSet: 0.08, livery: 'racing',
    spoiler: [0.96, 0.2, -2.24],
  });
  // big rear wing
  M.box(1.9, 0.06, 0.42, PAL.black, mat({ pos: [0, 1.34, -2.2] }), mi.accent);
  for (const s of [-1, 1]) {
    M.box(0.06, 0.36, 0.1, PAL.black, mat({ pos: [s * 0.8, 1.16, -2.2] }), mi.accent);
  }
  // roof scoop + vents
  M.box(0.34, 0.1, 0.34, PAL.black, mat({ pos: [0, 1.42, -0.6] }), mi.accent);
  return M;
}

export function buildMissionX() {
  const M = new Model('porsche_mission_x');
  const mi = mkMaterials(M, { paint: [0.86, 0.87, 0.9], accent: [0.55, 0.6, 0.68] });
  const d = carCore(M, mi, {
    len: 4.55, wid: 1.98, bodyH: 0.42, wheelR: 0.35, wheelW: 0.28, wheelbase: 2.7, track: 1.68,
    cabinLen: 0.32, cabinHeight: 0.28, cabinTaper: 0.7, cabinSet: 0.05, noseDrop: 0.76,
    spoiler: [0.9, 0.14, -2.2],
  });
  // bubble canopy + light strips
  M.add(sphereGeo(0.62, 10, 6, PAL.glass, mat({ pos: [0, 1.14, -0.15], scale: [1.25, 0.62, 1.85] })), mi.glass);
  for (const s of [-1, 1]) {
    M.box(0.03, 0.06, 3.2, [0.5, 0.75, 1.0], mat({ pos: [s * 0.99, 0.72, 0] }), mi.light);
  }
  M.box(1.5, 0.05, 0.08, [0.5, 0.75, 1.0], mat({ pos: [0, 0.62, 2.24] }), mi.light);
  return M;
}

export function buildF1() {
  const M = new Model('redbull_rb22');
  const mi = mkMaterials(M, { paint: [0.1, 0.14, 0.42], accent: [0.85, 0.15, 0.1] });
  // slim monocoque
  M.add(frustumGeo(0.42, 2.6, 0.3, 1.2, 0.34, [0.1, 0.14, 0.42], mat({ pos: [0, 0.36, 0.6] })), mi.body);
  M.box(0.36, 0.3, 0.5, PAL.black, mat({ pos: [0, 0.5, 0.2] }), mi.accent);
  // nose cone
  M.add(prismGeo([[-0.16, 0.3], [0.16, 0.3], [0.06, 0.12], [-0.06, 0.12]], 0.9, [0.12, 0.16, 0.45], mat({ pos: [0, 0.08, 1.85], rot: [0, Math.PI / 2, Math.PI / 2] })), mi.body);
  M.box(2.0, 0.04, 0.34, [0.12, 0.16, 0.45], mat({ pos: [0, 0.18, 2.3] }), mi.body); // front wing
  for (const s of [-1, 1]) {
    M.box(0.14, 0.22, 0.06, [0.12, 0.16, 0.45], mat({ pos: [s * 0.98, 0.2, 2.32] }), mi.accent); // endplate
    // sidepods
    M.add(frustumGeo(0.3, 1.7, 0.36, 1.1, 0.32, [0.1, 0.14, 0.42], mat({ pos: [s * 0.42, 0.3, -0.25] })), mi.body);
    // suspension arms
    for (const [x, z] of [[s * 0.9, 1.5], [s * 0.9, -1.1]]) {
      M.box(0.5, 0.04, 0.06, PAL.black, mat({ pos: [x * 0.55, 0.32, z] }), mi.accent);
    }
  }
  // cockpit halo + steering
  M.box(0.5, 0.04, 0.56, PAL.black, mat({ pos: [0, 0.88, 0.3] }), mi.accent);
  M.add(cylinderGeo(0.03, 0.03, 0.36, 6, PAL.black, mat({ pos: [0, 0.7, 0.62], rot: [0.4, 0, 0] })), mi.accent);
  // engine cover + airbox
  M.add(frustumGeo(0.34, 1.9, 0.22, 0.7, 0.4, [0.12, 0.16, 0.45], mat({ pos: [0, 0.5, -1.1] })), mi.body);
  M.box(0.3, 0.28, 0.4, [0.9, 0.6, 0.1], mat({ pos: [0, 0.86, -0.34] }), mi.accent);
  // rear wing
  M.box(1.4, 0.05, 0.42, [0.12, 0.16, 0.45], mat({ pos: [0, 0.96, -2.1] }), mi.body);
  for (const s of [-1, 1]) {
    M.box(0.05, 0.42, 0.62, [0.12, 0.16, 0.45], mat({ pos: [s * 0.7, 0.78, -2.1] }), mi.accent);
  }
  M.box(0.36, 0.2, 0.3, [0.15, 0.15, 0.16], mat({ pos: [0, 0.34, -2.16] }), mi.accent); // diffuser
  // wheels (slick tyres)
  const wr = 0.34;
  wheel(M, 'wheelFL', -0.86, wr, 1.5, wr, 0.32, mi);
  wheel(M, 'wheelFR', 0.86, wr, 1.5, wr, 0.32, mi);
  wheel(M, 'wheelRL', -0.84, wr * 1.08, -1.15, wr * 1.08, 0.4, mi);
  wheel(M, 'wheelRR', 0.84, wr * 1.08, -1.15, wr * 1.08, 0.4, mi);
  // driver
  M.box(0.3, 0.34, 0.26, [0.85, 0.85, 0.88], mat({ pos: [0, 0.62, 0.16] }), mi.chrome);
  M.add(sphereGeo(0.12, 8, 6, [0.9, 0.2, 0.15], mat({ pos: [0, 0.86, 0.14] })), mi.accent);
  return M;
}

export function buildUralTruck() {
  const M = new Model('ural_4320_truck');
  const mi = mkMaterials(M, { paint: [0.26, 0.32, 0.2], accent: [0.16, 0.18, 0.14], trim: [0.22, 0.24, 0.2] });
  const wr = 0.56;
  // chassis
  M.box(1.9, 0.3, 7.2, [0.14, 0.16, 0.13], mat({ pos: [0, 0.72, 0] }), mi.accent);
  // cab
  M.add(frustumGeo(2.3, 1.9, 2.2, 1.7, 1.5, [0.28, 0.34, 0.22], mat({ pos: [0, 1.0, 2.3] })), mi.body);
  M.box(1.6, 0.5, 0.06, PAL.glass, mat({ pos: [0, 1.9, 3.22] }), mi.glass);
  for (const s of [-1, 1]) {
    M.box(0.06, 0.46, 0.9, PAL.glass, mat({ pos: [s * 1.14, 1.9, 2.5] }), mi.glass);
    M.box(0.2, 0.16, 0.2, PAL.head, mat({ pos: [s * 0.85, 1.3, 3.24] }), mi.light);
  }
  M.box(2.3, 0.16, 0.2, [0.12, 0.12, 0.11], mat({ pos: [0, 1.02, 3.3] }), mi.trim);
  // canvas cargo bed with ribs
  M.add(frustumGeo(2.36, 4.4, 2.3, 4.3, 1.5, [0.34, 0.33, 0.28], mat({ pos: [0, 1.08, -1.5] })), mi.accent);
  for (let i = 0; i < 4; i++) {
    M.box(2.4, 0.1, 0.08, [0.24, 0.24, 0.2], mat({ pos: [0, 1.9, -0.2 - i * 1.1] }), mi.trim);
  }
  M.box(2.4, 1.4, 0.1, [0.3, 0.3, 0.25], mat({ pos: [0, 1.5, -3.75] }), mi.trim);
  // 6 wheels
  for (const s of [-1, 1]) {
    wheel(M, `wheelFL`, s * 1.06, wr, 2.5, wr, 0.34, mi);
    wheel(M, `wheelFR`, s * 1.06, wr, 2.5, wr, 0.34, mi);
    wheel(M, `wheelRL`, s * 1.06, wr, -1.3, wr, 0.34, mi);
    wheel(M, `wheelRR`, s * 1.06, wr, -2.5, wr, 0.34, mi);
  }
  // fuel tank + exhaust stack
  M.add(cylinderGeo(0.26, 0.26, 0.9, 8, [0.4, 0.4, 0.36], mat({ pos: [1.2, 1.05, 1.0], rot: [0, 0, Math.PI / 2] })), mi.trim);
  M.add(cylinderGeo(0.09, 0.09, 1.2, 8, [0.2, 0.2, 0.19], mat({ pos: [-1.16, 1.9, 2.6] })), mi.trim);
  return M;
}

export function buildAirplane() {
  const M = new Model('aeroplane');
  const mi = mkMaterials(M, { paint: [0.9, 0.91, 0.93], accent: [0.15, 0.35, 0.65], trim: [0.8, 0.82, 0.85] });
  // fuselage
  M.add(prismGeo([
    [-0.5, -0.5], [0.5, -0.5], [0.62, 0.1], [0.55, 0.6], [-0.55, 0.6], [-0.62, 0.1],
  ], 7.6, [0.92, 0.93, 0.95], mat({ pos: [0, 1.05, 0], rot: [0, Math.PI / 2, 0], scale: [1, 1, 1] })), mi.body);
  // nose cone
  M.add(sphereGeo(0.5, 10, 6, [0.92, 0.93, 0.95], mat({ pos: [0, 1.05, 3.65], scale: [1, 1, 1.3] })), mi.body);
  // cockpit glass
  M.add(frustumGeo(0.86, 1.7, 0.62, 1.0, 0.5, PAL.glass, mat({ pos: [0, 1.5, 2.1] })), mi.glass);
  // wings (swept, low wing)
  M.add(frustumGeo(11.5, 1.5, 8.6, 0.9, 0.16, [0.92, 0.93, 0.95], mat({ pos: [0, 0.98, 0.55] })), mi.body);
  for (const s of [-1, 1]) {
    M.box(0.16, 0.5, 0.9, [0.9, 0.35, 0.15], mat({ pos: [s * 5.6, 1.05, 0.3] }), mi.accent); // wingtip
    M.add(cylinderGeo(0.34, 0.3, 1.5, 10, [0.85, 0.86, 0.88], mat({ pos: [s * 2.9, 0.7, 0.9], rot: [Math.PI / 2, 0, 0] })), mi.trim); // engine nacelle
    M.add(cylinderGeo(0.36, 0.36, 0.1, 10, [0.15, 0.15, 0.16], mat({ pos: [s * 2.9, 0.7, 1.68], rot: [Math.PI / 2, 0, 0] })), mi.accent); // intake
    M.addNode(`prop${s > 0 ? 'R' : 'L'}`, mat({ pos: [s * 2.9, 0.7, 1.78] }));
    M.add(boxGeo(0.1, 1.1, 0.05, [0.12, 0.12, 0.13], mat({ rot: [0, 0, 0.4] })), mi.accent);
    M.add(boxGeo(0.1, 1.1, 0.05, [0.12, 0.12, 0.13], mat({ rot: [0, 0, 1.97] })), mi.accent);
  }
  // tail
  M.add(frustumGeo(0.2, 1.6, 0.14, 0.9, 1.4, [0.92, 0.93, 0.95], mat({ pos: [0, 1.4, -3.2] })), mi.body);
  M.add(frustumGeo(3.6, 0.85, 2.6, 0.6, 0.12, [0.92, 0.93, 0.95], mat({ pos: [0, 1.1, -3.3] })), mi.body);
  M.box(0.1, 1.42, 1.1, [0.15, 0.35, 0.65], mat({ pos: [0, 2.1, -3.55] }), mi.accent);
  // gear
  for (const [x, z] of [[-1.5, 1.5], [1.5, 1.5], [0, -3.0]]) {
    M.add(cylinderGeo(0.07, 0.07, 0.72, 6, PAL.darkChrome, mat({ pos: [x, 0.44, z] })), mi.trim);
    M.add(cylinderGeo(0.24, 0.24, 0.16, 8, PAL.tyre, mat({ pos: [x, 0.13, z], rot: [0, 0, Math.PI / 2] })), mi.tyre);
  }
  // windows
  for (let i = 0; i < 6; i++) {
    for (const s of [-1, 1]) {
      M.box(0.03, 0.16, 0.26, PAL.glass, mat({ pos: [s * 0.5, 1.3, 1.2 - i * 0.6] }), mi.glass);
    }
  }
  return M;
}

export function buildKingAirDeck() {
  // KA350 cockpit interior: stand-alone viewable scene used in "Flight Deck" mode
  const M = new Model('ka350_flight_deck');
  const mi = mkMaterials(M, { paint: [0.13, 0.14, 0.16], accent: [0.08, 0.08, 0.09], trim: [0.22, 0.23, 0.25] });
  const mScreen = M.addMaterial({ name: 'screen', baseColor: [0.05, 0.2, 0.28, 1], emissive: [0.1, 0.55, 0.7], emissiveStrength: 1.4 });
  const mBezel = M.addMaterial({ name: 'bezel', baseColor: [0.1, 0.1, 0.11, 1], roughness: 0.6 });
  const mSeat = M.addMaterial({ name: 'seat', baseColor: [0.26, 0.2, 0.16, 1], roughness: 0.85 });

  // shell: floor, roof, front panel, side walls
  M.box(2.0, 0.1, 2.4, [0.16, 0.17, 0.19], mat({ pos: [0, 0, 0] }), mi.accent);
  M.box(2.1, 0.08, 2.4, [0.18, 0.19, 0.21], mat({ pos: [0, 1.35, 0] }), mi.trim);
  // windshield
  M.add(prismGeo([[-0.95, 0], [0.95, 0], [0.8, 0.9], [-0.8, 0.9]], 0.08, PAL.glass, mat({ pos: [0, 0.5, 1.18], rot: [0.35, 0, 0] })), mi.glass);
  // glare shield
  M.add(frustumGeo(2.0, 0.42, 1.6, 0.28, 0.14, [0.09, 0.09, 0.1], mat({ pos: [0, 0.86, 0.95] })), mi.accent);
  // dashboard + MFDs
  M.add(frustumGeo(1.9, 0.36, 1.8, 0.3, 0.2, [0.12, 0.13, 0.15], mat({ pos: [0, 0.2, 0.84] })), mi.trim);
  for (let i = 0; i < 4; i++) {
    const x = -0.63 + i * 0.42;
    const w = i === 1 || i === 2 ? 0.34 : 0.28;
    M.box(w, 0.28, 0.03, PAL.black, mat({ pos: [x, 0.42, 0.98] }), mBezel);
    M.box(w * 0.86, 0.22, 0.02, [0.05, 0.2, 0.28], mat({ pos: [x, 0.42, 1.0] }), mScreen);
  }
  // glareshield avionics strip
  M.box(1.7, 0.06, 0.12, [0.1, 0.1, 0.11], mat({ pos: [0, 0.3, 0.7] }), mBezel);
  for (let i = 0; i < 10; i++) {
    M.box(0.05, 0.02, 0.03, [0.2, 0.6, 0.3], mat({ pos: [-0.6 + i * 0.13, 0.32, 0.72] }), mScreen);
  }
  // yokes
  for (const s of [-1, 1]) {
    M.add(cylinderGeo(0.035, 0.035, 0.5, 8, PAL.black, mat({ pos: [s * 0.42, 0.45, 0.42], rot: [-0.5, 0, 0] })), mi.accent);
    M.box(0.42, 0.05, 0.06, [0.1, 0.1, 0.11], mat({ pos: [s * 0.42, 0.66, 0.3] }), mi.accent);
    // seats
    M.box(0.62, 0.14, 0.6, [0.24, 0.18, 0.14], mat({ pos: [s * 0.5, 0.34, -0.25] }), mSeat);
    M.box(0.62, 0.9, 0.14, [0.24, 0.18, 0.14], mat({ pos: [s * 0.5, 0.68, -0.56], rot: [0.12, 0, 0] }), mSeat);
    M.box(0.2, 0.24, 0.16, [0.2, 0.15, 0.12], mat({ pos: [s * 0.5, 1.12, -0.6] }), mSeat);
    // side console
    M.box(0.26, 0.16, 0.9, [0.14, 0.15, 0.17], mat({ pos: [s * 0.82, 0.56, -0.1] }), mi.trim);
    M.box(0.08, 0.2, 0.3, [0.1, 0.1, 0.1], mat({ pos: [s * 0.92, 0.66, 0.2], rot: [0, 0, s * 0.2] }), mi.accent); // throttle quadrant
  }
  // centre console + pedals
  M.box(0.3, 0.24, 0.9, [0.14, 0.15, 0.17], mat({ pos: [0, 0.26, 0.3] }), mi.trim);
  M.box(0.24, 0.08, 0.2, [0.09, 0.09, 0.1], mat({ pos: [0, 0.4, 0.44] }), mBezel);
  for (const s of [-1, 1]) {
    M.box(0.2, 0.04, 0.28, PAL.black, mat({ pos: [s * 0.42, 0.14, 0.7] }), mi.accent);
  }
  // overhead panel
  M.add(frustumGeo(0.9, 0.4, 0.8, 0.34, 0.1, [0.12, 0.13, 0.15], mat({ pos: [0, 1.28, 0.55] })), mi.trim);
  // side windows
  for (const s of [-1, 1]) {
    M.box(0.05, 0.5, 1.1, PAL.glass, mat({ pos: [s * 0.98, 0.8, -0.2] }), mi.glass);
  }
  return M;
}

export function buildHelicopter() {
  const M = new Model('little_bird_helicopter');
  const mi = mkMaterials(M, { paint: [0.24, 0.28, 0.22], accent: [0.16, 0.18, 0.15], trim: [0.2, 0.21, 0.2] });
  // cabin bubble
  M.add(sphereGeo(0.95, 12, 8, PAL.glass, mat({ pos: [0, 1.5, 1.0], scale: [1.0, 1.0, 1.5] })), mi.glass);
  M.add(frustumGeo(1.5, 2.6, 1.2, 1.8, 0.9, [0.24, 0.28, 0.22], mat({ pos: [0, 0.95, 0.9] })), mi.body);
  // skids
  for (const s of [-1, 1]) {
    M.add(cylinderGeo(0.06, 0.06, 2.4, 8, PAL.darkChrome, mat({ pos: [s * 0.72, 0.1, 0.5], rot: [Math.PI / 2, 0, 0] })), mi.trim);
    for (const z of [-0.5, 0.55]) {
      M.box(0.07, 0.5, 0.07, PAL.darkChrome, mat({ pos: [s * 0.72, 0.36, z], rot: [0, 0, s * 0.12] }), mi.trim);
    }
  }
  // tail boom
  M.add(frustumGeo(0.42, 0.42, 0.2, 0.2, 3.6, [0.24, 0.28, 0.22], mat({ pos: [0, 1.5, -1.9], rot: [Math.PI / 2, 0, 0] })), mi.body);
  // tail fin + stabilisers
  M.add(frustumGeo(0.14, 1.0, 0.1, 0.5, 0.9, [0.24, 0.28, 0.22], mat({ pos: [0, 1.8, -3.5] })), mi.body);
  M.box(1.5, 0.07, 0.4, [0.24, 0.28, 0.22], mat({ pos: [0, 1.6, -3.3] }), mi.body);
  // main rotor
  M.addNode('rotor', mat({ pos: [0, 2.25, 0.5] }));
  M.add(cylinderGeo(0.12, 0.14, 0.3, 8, PAL.darkChrome, null), mi.trim);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    M.add(boxGeo(3.9, 0.05, 0.24, [0.14, 0.15, 0.14], mat({ pos: [Math.cos(a) * 1.95, 0.1, Math.sin(a) * 1.95], rot: [0, -a, 0] })), mi.accent);
  }
  M.addNode('tailRotor', mat({ pos: [0.16, 1.9, -3.55] }));
  M.add(boxGeo(0.05, 1.0, 0.12, [0.14, 0.15, 0.14], mat({ rot: [0.6, 0, 0] })), mi.accent);
  M.add(boxGeo(0.05, 1.0, 0.12, [0.14, 0.15, 0.14], mat({ rot: [-0.6, 0, 0] })), mi.accent);
  // engine + exhaust
  M.add(cylinderGeo(0.18, 0.18, 0.9, 8, [0.2, 0.21, 0.2], mat({ pos: [0, 1.95, -0.55], rot: [Math.PI / 2, 0, 0] })), mi.trim);
  // seats
  for (const s of [-1, 1]) {
    M.box(0.4, 0.5, 0.4, [0.18, 0.18, 0.19], mat({ pos: [s * 0.36, 1.3, 0.5] }), mi.accent);
  }
  // door gunner mount
  M.add(cylinderGeo(0.04, 0.04, 0.4, 6, PAL.darkChrome, mat({ pos: [-0.8, 1.4, 0.7], rot: [0, 0, 1.2] })), mi.trim);
  return M;
}

// ------------------------------------------------------------------ weapons
export function buildHandgun() {
  const M = new Model('weapon_g17_handgun');
  const mPoly = M.addMaterial({ name: 'polymer', baseColor: [0.11, 0.11, 0.12, 1], roughness: 0.72 });
  const mSteel = M.addMaterial({ name: 'steel', baseColor: [0.32, 0.33, 0.36, 1], metallic: 0.85, roughness: 0.32 });
  const mAcc = M.addMaterial({ name: 'accent', baseColor: [0.05, 0.05, 0.05, 1], roughness: 0.5 });
  // slide
  M.box(0.05, 0.075, 0.36, [0.33, 0.34, 0.37], mat({ pos: [0, 0.055, 0.03] }), mSteel);
  M.box(0.046, 0.02, 0.34, [0.2, 0.2, 0.22], mat({ pos: [0, 0.096, 0.03] }), mPoly); // top rib
  // frame + grip
  M.box(0.045, 0.05, 0.28, [0.12, 0.12, 0.13], mat({ pos: [0, 0.008, 0.0] }), mPoly);
  M.add(frustumGeo(0.045, 0.11, 0.042, 0.1, 0.19, [0.12, 0.12, 0.13], mat({ pos: [0, -0.19, -0.1], rot: [0.22, 0, 0] })), mPoly);
  M.box(0.048, 0.03, 0.08, [0.1, 0.1, 0.11], mat({ pos: [0, -0.03, -0.16] }), mPoly); // beavertail
  // trigger guard
  M.box(0.03, 0.008, 0.11, [0.12, 0.12, 0.13], mat({ pos: [0, -0.06, 0.01] }), mPoly);
  M.box(0.03, 0.05, 0.008, [0.12, 0.12, 0.13], mat({ pos: [0, -0.035, 0.06] }), mPoly);
  // muzzle + Olight
  M.box(0.03, 0.03, 0.06, [0.05, 0.05, 0.05], mat({ pos: [0, 0.058, 0.235] }), mAcc);
  M.box(0.038, 0.042, 0.12, [0.08, 0.08, 0.09], mat({ pos: [0, -0.005, 0.175] }), mAcc);
  M.box(0.03, 0.026, 0.012, [0.85, 0.88, 0.95], mat({ pos: [0, -0.005, 0.24] }), mSteel);
  // sights
  M.box(0.008, 0.014, 0.01, [0.4, 0.75, 0.4], mat({ pos: [0, 0.11, 0.14] }), mAcc);
  M.box(0.012, 0.014, 0.01, [0.4, 0.75, 0.4], mat({ pos: [0, 0.11, -0.12] }), mAcc);
  // mag base
  M.box(0.036, 0.02, 0.06, [0.09, 0.09, 0.1], mat({ pos: [0, -0.29, -0.115], rot: [0.22, 0, 0] }), mAcc);
  M.root.matrix = mat({ scale: [3.4, 3.4, 3.4] }).multiply(new THREE.Matrix4());
  return M;
}

export function buildSMG() {
  const M = new Model('weapon_pp19_vityaz');
  const mPoly = M.addMaterial({ name: 'polymer', baseColor: [0.1, 0.1, 0.11, 1], roughness: 0.7 });
  const mSteel = M.addMaterial({ name: 'steel', baseColor: [0.26, 0.27, 0.29, 1], metallic: 0.85, roughness: 0.35 });
  // receiver
  M.box(0.055, 0.1, 0.42, [0.26, 0.27, 0.29], null, mSteel);
  M.box(0.05, 0.02, 0.4, [0.12, 0.12, 0.13], mat({ pos: [0, 0.06, 0] }), mPoly); // dust cover
  // barrel + shroud
  M.add(cylinderGeo(0.014, 0.014, 0.26, 8, [0.2, 0.2, 0.22], mat({ pos: [0, 0.018, 0.34], rot: [Math.PI / 2, 0, 0] })), mSteel);
  M.add(cylinderGeo(0.026, 0.026, 0.18, 8, [0.16, 0.17, 0.19], mat({ pos: [0, 0.018, 0.29], rot: [Math.PI / 2, 0, 0] })), mSteel);
  M.box(0.03, 0.03, 0.05, [0.06, 0.06, 0.07], mat({ pos: [0, 0.018, 0.47] }), mPoly); // muzzle
  // handguard with vents
  M.box(0.06, 0.07, 0.2, [0.14, 0.14, 0.15], mat({ pos: [0, 0.0, 0.26] }), mPoly);
  for (let i = 0; i < 4; i++) {
    M.box(0.065, 0.014, 0.02, [0.05, 0.05, 0.06], mat({ pos: [0, 0.005, 0.19 + i * 0.05] }), mPoly);
  }
  // pistol grip + trigger guard
  M.add(frustumGeo(0.045, 0.09, 0.042, 0.08, 0.16, [0.1, 0.1, 0.11], mat({ pos: [0, -0.17, -0.1], rot: [0.3, 0, 0] })), mPoly);
  M.box(0.024, 0.008, 0.1, [0.1, 0.1, 0.11], mat({ pos: [0, -0.09, -0.02] }), mPoly);
  // folding stock
  M.box(0.03, 0.03, 0.2, [0.16, 0.16, 0.17], mat({ pos: [0, 0.015, -0.36] }), mSteel);
  M.box(0.05, 0.14, 0.03, [0.1, 0.1, 0.11], mat({ pos: [0, -0.04, -0.46] }), mPoly);
  // magazine (curved, 30rd)
  M.add(frustumGeo(0.032, 0.08, 0.03, 0.07, 0.19, [0.13, 0.13, 0.14], mat({ pos: [0, -0.2, 0.06], rot: [0.12, 0, 0] })), mPoly);
  M.box(0.03, 0.02, 0.07, [0.08, 0.08, 0.09], mat({ pos: [0, -0.3, 0.1], rot: [0.26, 0, 0] }), mPoly);
  // optic rail + red dot
  M.box(0.04, 0.02, 0.3, [0.1, 0.1, 0.11], mat({ pos: [0, 0.08, 0.0] }), mPoly);
  M.box(0.05, 0.05, 0.09, [0.09, 0.09, 0.1], mat({ pos: [0, 0.115, 0.02] }), mPoly);
  M.box(0.032, 0.032, 0.01, [0.4, 0.8, 0.9], mat({ pos: [0, 0.115, 0.07] }), mSteel);
  M.root.matrix = mat({ scale: [2.6, 2.6, 2.6] });
  return M;
}

export function buildRifle() {
  const M = new Model('weapon_akmn_rifle');
  const mPoly = M.addMaterial({ name: 'polymer', baseColor: [0.1, 0.1, 0.11, 1], roughness: 0.72 });
  const mSteel = M.addMaterial({ name: 'steel', baseColor: [0.24, 0.25, 0.27, 1], metallic: 0.8, roughness: 0.38 });
  const mWood = M.addMaterial({ name: 'wood', baseColor: [0.34, 0.19, 0.1, 1], roughness: 0.85 });
  // receiver
  M.box(0.06, 0.11, 0.44, [0.24, 0.25, 0.27], null, mSteel);
  // dust cover with rib
  M.add(cylinderGeo(0.03, 0.03, 0.34, 8, [0.22, 0.23, 0.25], mat({ pos: [0, 0.055, -0.02], rot: [Math.PI / 2, 0, 0] })), mSteel);
  // barrel assembly
  M.add(cylinderGeo(0.015, 0.015, 0.42, 8, [0.19, 0.2, 0.22], mat({ pos: [0, 0.03, 0.42], rot: [Math.PI / 2, 0, 0] })), mSteel);
  M.box(0.055, 0.075, 0.22, [0.3, 0.17, 0.09], mat({ pos: [0, 0.03, 0.36] }), mWood); // handguard
  M.box(0.035, 0.045, 0.1, [0.2, 0.21, 0.23], mat({ pos: [0, 0.03, 0.62] }), mSteel); // gas block
  M.add(cylinderGeo(0.022, 0.022, 0.09, 8, [0.1, 0.1, 0.11], mat({ pos: [0, 0.03, 0.66], rot: [Math.PI / 2, 0, 0] })), mPoly); // muzzle brake
  // gas tube
  M.add(cylinderGeo(0.01, 0.01, 0.3, 6, [0.18, 0.19, 0.2], mat({ pos: [0, 0.06, 0.4], rot: [Math.PI / 2, 0, 0] })), mSteel);
  // wood stock
  M.add(prismGeo([[-0.05, -0.09], [0.05, -0.09], [0.055, 0.02], [-0.05, 0.04]], 0.36, [0.32, 0.18, 0.09], mat({ pos: [0, -0.02, -0.36], rot: [0, 0, 0], scale: [1, 1, 1] })), mWood);
  M.box(0.05, 0.11, 0.05, [0.3, 0.17, 0.08], mat({ pos: [0, -0.05, -0.56], rot: [0.1, 0, 0] }), mWood); // butt plate
  // pistol grip
  M.add(frustumGeo(0.045, 0.09, 0.042, 0.08, 0.16, [0.3, 0.17, 0.08], mat({ pos: [0, -0.19, -0.1], rot: [0.34, 0, 0] })), mWood);
  // trigger guard + trigger
  M.box(0.024, 0.008, 0.1, [0.1, 0.1, 0.11], mat({ pos: [0, -0.085, -0.03] }), mPoly);
  M.box(0.012, 0.04, 0.012, [0.14, 0.14, 0.15], mat({ pos: [0, -0.06, -0.02] }), mSteel);
  // curved 30rd magazine
  M.add(prismGeo([[-0.035, 0], [0.035, 0], [0.045, -0.18], [-0.03, -0.21], [-0.05, -0.06]], 0.075, [0.18, 0.12, 0.07], mat({ pos: [0, -0.09, 0.03], rot: [0.1, 0, 0] })), mWood);
  // rear sight
  M.box(0.045, 0.025, 0.03, [0.12, 0.12, 0.13], mat({ pos: [0, 0.09, 0.08] }), mSteel);
  // optic (red dot on side rail for the AKMN)
  M.box(0.04, 0.018, 0.26, [0.1, 0.1, 0.11], mat({ pos: [-0.045, 0.075, 0.02] }), mPoly);
  M.box(0.055, 0.055, 0.09, [0.08, 0.08, 0.09], mat({ pos: [-0.02, 0.11, 0.0] }), mPoly);
  M.box(0.034, 0.034, 0.012, [0.4, 0.85, 0.9], mat({ pos: [-0.02, 0.11, 0.05] }), mSteel);
  M.root.matrix = mat({ scale: [2.3, 2.3, 2.3] });
  return M;
}
