/**
 * HIGH-DETAIL VEHICLE FOUNDRY (v2)
 *
 * Real-scale, smooth-shaded road / race / utility vehicles + a motorbike.
 * Replaces the faceted low-poly builders: everything here is lofted from rounded
 * cross-sections so bodywork reads as pressed metal, with clear-coat paint,
 * tinted glass, lathed wheels with proper tyres, discs and calipers, and light
 * units that bloom in the HDR pipeline.
 *
 * Every car exposes the same node contract the runtime already animates:
 *   wheelFL / wheelFR / wheelRL / wheelRR (+ optional wheelML / wheelMR)
 *   weight-0 … weight-N   (suspension masses the body shell rides on)
 *   siren (police), rotor / tailRotor (aircraft)
 */
import {
  Model, mat, boxGeo, loftGeo, latheGeo, smoothBox, capsuleGeo, cylinderGeo, sphereGeo, prismGeo, archGeo, PAL,
} from './glb.mjs';
import * as THREE from 'three';

const C = (c) => (Array.isArray(c) ? c : new THREE.Color(c).toArray());
const shade = (c, f) => {
  const x = C(c);
  return [x[0] * f, x[1] * f, x[2] * f];
};
const mix = (a, b, t) => {
  const x = C(a), y = C(b);
  return [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
};

// ---------------------------------------------------------------- material set
const WHITE = [1, 1, 1, 1];
/** automotive paint colours (linear-space vertex tints) */
const PAINT = {
  rosso: [0.4, 0.018, 0.014],
  silver: [0.46, 0.48, 0.52],
  gtWhite: [0.66, 0.66, 0.68],
  navy: [0.03, 0.05, 0.14],
  cruiser: [0.34, 0.36, 0.4],
  policeBlue: [0.05, 0.1, 0.28],
  f1Navy: [0.045, 0.07, 0.26],
  army: [0.13, 0.19, 0.1],
};
/**
 * All material colours stay WHITE: the GLB writer multiplies per-vertex colour by the
 * material base colour, so exactly one of them may carry the shade. Vertex colours do.
 * Material params still carry the PBR response (metals, glass transmission, emissive).
 */
function mats(M, o) {
  return {
    body: M.addMaterial({ name: 'body', baseColor: WHITE, metallic: 0.08, roughness: 0.42 }),
    bodyDark: M.addMaterial({ name: 'body_dark', baseColor: WHITE, metallic: 0.45, roughness: 0.4 }),
    trim: M.addMaterial({ name: 'trim', baseColor: WHITE, metallic: 0.55, roughness: 0.45 }),
    carbon: M.addMaterial({ name: 'carbon', baseColor: WHITE, metallic: 0.35, roughness: 0.33 }),
    glass: M.addMaterial({ name: 'glass', baseColor: WHITE, metallic: 0.0, roughness: 0.08 }),
    tyre: M.addMaterial({ name: 'tyre', baseColor: WHITE, metallic: 0.0, roughness: 0.92 }),
    rim: M.addMaterial({ name: 'rim', baseColor: WHITE, metallic: 0.95, roughness: 0.19 }),
    disc: M.addMaterial({ name: 'disc', baseColor: WHITE, metallic: 0.85, roughness: 0.45 }),
    caliper: M.addMaterial({ name: 'caliper', baseColor: WHITE, metallic: 0.3, roughness: 0.35 }),
    chrome: M.addMaterial({ name: 'chrome', baseColor: WHITE, metallic: 1.0, roughness: 0.09 }),
    head: M.addMaterial({ name: 'light', baseColor: WHITE, emissive: [1, 0.96, 0.86], emissiveStrength: 1.8 }),
    tail: M.addMaterial({ name: 'tail', baseColor: WHITE, emissive: [0.75, 0.04, 0.03], emissiveStrength: 1.1 }),
    amber: M.addMaterial({ name: 'amber', baseColor: WHITE, emissive: [1, 0.45, 0.05], emissiveStrength: 1.5 }),
    accent: M.addMaterial({ name: 'accent', baseColor: WHITE, metallic: 0.35, roughness: 0.5 }),
    plate: M.addMaterial({ name: 'plate', baseColor: WHITE, roughness: 0.6 }),
    seat: M.addMaterial({ name: 'seat', baseColor: WHITE, roughness: 0.75 }),
  };
}

// ---------------------------------------------------------------- wheels
/** lathed wheel: tyre carcass + sidewall bulge + rim face + brake disc + caliper */
function buildWheel(M, name, x, y, z, rad, width, mi, o = {}) {
  M.addNode(name, mat({ pos: [x, y, z], rot: [0, 0, o.camber || 0] }));
  const hw = width / 2;
  const rimR = rad * (o.rimRatio || 0.66);
  // tyre: closed lathe around X so the tread wraps, sidewalls bulge slightly
  const tyreProfile = [
    [rimR * 0.99, -hw * 0.82],
    [rad * 0.9, -hw],
    [rad * 0.985, -hw * 0.72],
    [rad, -hw * 0.36],
    [rad, hw * 0.36],
    [rad * 0.985, hw * 0.72],
    [rad * 0.9, hw],
    [rimR * 0.99, hw * 0.82],
  ];
  M.add(latheGeo(tyreProfile, o.seg || 22, [0.045, 0.045, 0.05], null, { closed: true }), mi.tyre);
  // rim barrel + face, inset a little so the tyre lip stays visible
  M.add(latheGeo([
    [rimR * 0.99, -hw * 0.78],
    [rimR, -hw * 0.55],
    [rimR, hw * 0.4],
    [rimR * 0.93, hw * 0.62],
    [rimR * 0.62, hw * 0.7],
    [rimR * 0.2, hw * 0.66],
  ], o.seg || 22, o.rimColor || [0.62, 0.64, 0.68], null, { closed: false }), mi.rim);
  // rim dish: darker inner face so spokes read with depth
  // spokes (5 twin spokes) on the outer face
  const spokes = o.spokes || 5;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    M.add(smoothBox(rimR * 0.16, rimR * 0.95, hw * 0.5, o.rimColor || [0.66, 0.68, 0.72], mat({
      pos: [hw * 0.58, Math.cos(a) * rimR * 0.46, Math.sin(a) * rimR * 0.46],
      rot: [a, 0, 0],
    }), { r: 0.3, seg: 2 }), mi.rim);
  }
  // hub + centre cap
  M.add(latheGeo([
    [rimR * 0.26, hw * 0.6],
    [rimR * 0.3, hw * 0.75],
    [rimR * 0.16, hw * 0.9],
    [0.001, hw * 0.92],
  ], 14, shade(o.rimColor || [0.7, 0.72, 0.75], 0.6), null), mi.chrome);
  // brake disc + caliper (visible through open spokes)
  M.add(latheGeo([
    [rad * 0.6, -hw * 0.1],
    [rad * 0.66, -hw * 0.06],
    [rad * 0.66, hw * 0.12],
    [rad * 0.6, hw * 0.16],
  ], 20, [0.36, 0.36, 0.38], null), mi.disc);
  M.add(smoothBox(rad * 0.12, rad * 0.4, hw * 0.4, o.caliper || [0.78, 0.08, 0.06], mat({
    pos: [-hw * 0.02, rad * 0.42, -rad * 0.3],
  }), { r: 0.35, seg: 3 }), mi.caliper);
}

/** twin front / single rear motorcycle wheels, spoked */
function buildBikeWheel(M, name, x, y, z, rad, width, mi) {
  M.addNode(name, mat({ pos: [x, y, z] }));
  M.add(latheGeo([
    [rad * 0.72, -width / 2],
    [rad * 0.95, -width * 0.4],
    [rad, 0],
    [rad * 0.95, width * 0.4],
    [rad * 0.72, width / 2],
  ], 24, PAL.tyre, null, { closed: true }), mi.tyre);
  M.add(latheGeo([
    [rad * 0.2, -width * 0.36],
    [rad * 0.7, -width * 0.3],
    [rad * 0.7, width * 0.3],
    [rad * 0.2, width * 0.36],
  ], 20, [0.15, 0.15, 0.16], null), mi.trim);
  // spoke lacing
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    M.add(smoothBox(0.025, rad * 1.3, 0.025, [0.75, 0.76, 0.78], mat({
      pos: [0, Math.cos(a) * rad * 0.35, Math.sin(a) * rad * 0.35],
      rot: [a, 0, 0],
    }), { r: 0.5, seg: 2 }), mi.chrome);
  }
  M.add(latheGeo([
    [rad * 0.1, -width * 0.42],
    [rad * 0.14, -width * 0.44],
    [rad * 0.14, width * 0.44],
    [rad * 0.1, width * 0.46],
  ], 12, PAL.darkChrome, null), mi.trim);
  // brake disc
  M.add(latheGeo([[rad * 0.42, -width * 0.5], [rad * 0.55, -width * 0.48], [rad * 0.55, -width * 0.3], [rad * 0.42, -width * 0.28]], 18, [0.4, 0.4, 0.42], null), mi.disc);
}

// ---------------------------------------------------------------- body shell
/**
 * Lofts the main shell. `z` runs nose(+) → tail(-), `y` is world height of the
 * section centre, `w`/`h` the section box, `r` the corner roundness.
 */
function shell(M, mi, sections, paint, matIndex) {
  M.add(loftGeo(sections, { color: paint, segPerCorner: 5 }), matIndex);
  return sections;
}

/** greenhouse: glass loft, roof panel, pillars — sits on top of the shell */
function greenhouse(M, mi, o) {
  const { z0, z1, y, w, h, paint, glassCol = [0.045, 0.055, 0.07] } = o;
  const mid = (z0 + z1) / 2;
  // the glass band stops below the roofline: the roof panel then caps it in body colour
  const glassSections = [
    { z: z0, y: y + h * 0.06, w: w * 0.78, h: h * 0.62, r: 0.48 },
    { z: z0 - (z0 - z1) * 0.22, y: y + h * 0.22, w: w * 0.84, h: h * 0.74, r: 0.48 },
    { z: z1 + (z0 - z1) * 0.26, y: y + h * 0.2, w: w * 0.82, h: h * 0.7, r: 0.48 },
    { z: z1, y: y + h * 0.04, w: w * 0.74, h: h * 0.56, r: 0.48 },
  ];
  // slightly inset glass so a paint border shows around it
  M.add(loftGeo(glassSections, { color: glassCol, segPerCorner: 5 }), mi.glass);
  // roof panel in body colour
  M.add(loftGeo([
    { z: z0 - (z0 - z1) * 0.26, y: y + h * 0.58, w: w * 0.9, h: h * 0.4, r: 0.47 },
    { z: z1 + (z0 - z1) * 0.34, y: y + h * 0.56, w: w * 0.88, h: h * 0.38, r: 0.47 },
  ], { color: paint, segPerCorner: 5 }), mi.body);
  // A- and C-pillars in body colour so the glass reads as separate panes
  for (const s of [-1, 1]) {
    M.add(smoothBox(0.07, h * 0.58, 0.1, paint, mat({ pos: [s * w * 0.43, y + h * 0.2, z0 - (z0 - z1) * 0.11], rot: [-0.42, 0, 0] }), { r: 0.45, seg: 2 }), mi.body);
    M.add(smoothBox(0.07, h * 0.56, 0.12, paint, mat({ pos: [s * w * 0.41, y + h * 0.2, z1 + (z0 - z1) * 0.17], rot: [0.55, 0, 0] }), { r: 0.45, seg: 2 }), mi.body);
    M.add(smoothBox(0.06, h * 0.62, 0.08, paint, mat({ pos: [s * w * 0.45, y + h * 0.19, (z0 + z1) * 0.52], rot: [0, 0, 0] }), { r: 0.45, seg: 2 }), mi.body);
  }
  return { mid };
}

/** headlight cluster: housing + lens + DRL strip */
function headlights(M, mi, o) {
  const { y, z, halfW, w = 0.4, h = 0.13, drl = true } = o;
  for (const s of [-1, 1]) {
    const x = s * halfW;
    // dark housing ring so the lens reads as recessed glass
    M.add(smoothBox(w * 1.12, h * 1.3, 0.05, [0.05, 0.05, 0.06], mat({ pos: [x, y, z - 0.035], rot: [0, s * 0.12, 0] }), { r: 0.42, seg: 4 }), mi.carbon);
    M.add(smoothBox(w, h, 0.05, [0.85, 0.84, 0.8], mat({ pos: [x, y, z], rot: [0, s * 0.12, 0] }), { r: 0.42, seg: 4 }), mi.head);
    if (drl) {
      M.add(smoothBox(w * 0.94, 0.03, 0.05, [1, 1, 1], mat({ pos: [x, y - h * 0.62, z + 0.02] }), { r: 0.5, seg: 3 }), mi.head);
    }
  }
}

function taillights(M, mi, o) {
  const { y, z, halfW, w = 0.5, h = 0.1, bar = false } = o;
  if (bar) {
    M.add(smoothBox(halfW * 2.02, h * 0.42, 0.05, [1, 0.1, 0.06], mat({ pos: [0, y, z] }), { r: 0.5, seg: 3 }), mi.tail);
  }
  for (const s of [-1, 1]) {
    M.add(smoothBox(w, h, 0.06, [0.9, 0.06, 0.04], mat({ pos: [s * halfW, y, z] }), { r: 0.42, seg: 4 }), mi.tail);
  }
}

// ---------------------------------------------------------------- cars
/**
 * Generic performance-car builder. o.dims sets real-world scale, o.style picks the
 * silhouette family (super / gt / muscle / sedan / hyper).
 */
function car(M, mi, o) {
  const {
    len, wid, wheelR, wheelW = 0.28, wheelbase, track, rideH = 0.055,
    bodyH = 0.52, noseH = 0.36, cabin = null, style = 'gt', paint = [0.7, 0.1, 0.1],
  } = o;
  const y0 = wheelR + rideH;         // rocker height
  const halfL = len / 2;
  const halfW = wid / 2;
  const frontAxle = wheelbase / 2;
  const rearAxle = -wheelbase / 2;

  // ---- main body: ONE lofted hull whose sections carry the silhouette (roof included)
  const belt = y0 + bodyH;           // shoulder line
  const cab = cabin || { z0: frontAxle * 0.62, z1: rearAxle * 0.78, h: bodyH * 0.72, w: wid * 0.82 };
  const roofH = cab.h;
  const sections = [
    { z: halfL, y: y0 + noseH * 0.4, w: wid * 0.68, h: noseH * 0.66, r: 0.42 },
    { z: halfL * 0.94, y: y0 + noseH * 0.52, w: wid * 0.88, h: noseH * 1.0, r: 0.38 },
    { z: halfL * 0.8, y: y0 + noseH * 0.66, w: wid * 0.96, h: noseH * 1.2, r: 0.34 },
    { z: halfL * 0.62, y: y0 + noseH * 0.74, w: wid * 0.99, h: noseH * 1.24, r: 0.32 },
    // cowl: the hull tops out at the belt line right through the cabin —
    // the greenhouse (glass + roof) is a separate loft that sits on top of it
    { z: cab.z0 + 0.2, y: y0 + bodyH * 0.5, w: wid, h: bodyH * 0.98, r: 0.3 },
    { z: cab.z0 - 0.1, y: y0 + bodyH * 0.51, w: wid * 0.99, h: bodyH * 0.98, r: 0.3 },
    { z: (cab.z0 + cab.z1) * 0.5, y: y0 + bodyH * 0.52, w: wid * 0.98, h: bodyH * 0.97, r: 0.3 },
    { z: cab.z1 + 0.1, y: y0 + bodyH * 0.53, w: wid * 0.985, h: bodyH * 0.96, r: 0.3 },
    { z: cab.z1 - 0.3, y: y0 + bodyH * 0.56, w: wid * 0.97, h: bodyH * 0.92, r: 0.32 },
    // rear haunch + tail
    { z: rearAxle * 0.95, y: y0 + bodyH * 0.62, w: wid * 1.0, h: bodyH * 0.98, r: 0.3 },
    { z: -halfL * 0.93, y: y0 + bodyH * 0.64, w: wid * 0.95, h: bodyH * 0.9, r: 0.34 },
    { z: -halfL, y: y0 + bodyH * 0.56, w: wid * 0.8, h: bodyH * 0.66, r: 0.42 },
  ];
  M.add(loftGeo(sections, { color: paint, segPerCorner: 6 }), mi.body);

  // ---- greenhouse: one glass loft with A/C pillars and a body-colour roof cap
  const roofTop = belt + roofH;
  const gw = wid * 0.82;
  // one continuous glass band whose TOP EDGE is exactly the roofline
  const cabBottom = belt - bodyH * 0.05;
  const bandH = roofTop - cabBottom;
  const bandY = (roofTop + cabBottom) / 2;
  const glassSections = [
    { z: cab.z0 + 0.2, y: bandY - bandH * 0.1, w: gw * 0.74, h: bandH * 0.62, r: 0.44 },
    { z: cab.z0 + 0.02, y: bandY, w: gw * 0.94, h: bandH, r: 0.42 },
    { z: (cab.z0 + cab.z1) * 0.5, y: bandY, w: gw, h: bandH, r: 0.42 },
    { z: cab.z1 + 0.12, y: bandY - bandH * 0.02, w: gw * 0.96, h: bandH * 0.96, r: 0.42 },
    { z: cab.z1 - 0.26, y: bandY - bandH * 0.14, w: gw * 0.8, h: bandH * 0.7, r: 0.44 },
  ];
  M.add(loftGeo(glassSections, { color: [0.06, 0.075, 0.09], segPerCorner: 6 }), mi.glass);
  // roof cap: a thin painted lid flush with the glass top edge
  M.add(loftGeo([
    { z: cab.z0 + 0.06, y: roofTop - 0.012, w: gw * 0.9, h: 0.05, r: 0.49 },
    { z: (cab.z0 + cab.z1) * 0.5, y: roofTop - 0.008, w: gw * 0.99, h: 0.05, r: 0.49 },
    { z: cab.z1 + 0.14, y: roofTop - 0.012, w: gw * 0.94, h: 0.045, r: 0.49 },
  ], { color: paint, segPerCorner: 6 }), mi.body);
  // A- and C-pillars / window frames in body colour
  for (const s of [-1, 1]) {
    const x = s * gw * 0.5;
    M.add(smoothBox(0.055, bandH * 0.98, 0.11, paint, mat({ pos: [x, bandY, cab.z0 + 0.02], rot: [-0.4, 0, 0] }), { r: 0.45, seg: 3 }), mi.body);
    M.add(smoothBox(0.055, bandH * 0.92, 0.12, paint, mat({ pos: [x, bandY - bandH * 0.02, cab.z1 + 0.1], rot: [0.44, 0, 0] }), { r: 0.45, seg: 3 }), mi.body);
    M.add(smoothBox(0.05, bandH * 0.8, 0.08, paint, mat({ pos: [x * 1.004, bandY, (cab.z0 + cab.z1) * 0.54] }), { r: 0.45, seg: 2 }), mi.body);
    M.add(smoothBox(0.05, 0.035, 0.16, [0.25, 0.25, 0.27], mat({ pos: [s * (wid * 0.487), belt - bodyH * 0.16, -0.15] }), { r: 0.5, seg: 2 }), mi.chrome);
  }

  // ---- rocker between the axles only (arches stay open so the wheels read clearly)
  const sillLen = Math.max(0.5, wheelbase - wheelR * 2.4);
  for (const s of [-1, 1]) {
    M.add(smoothBox(0.07, rideH * 2.0, sillLen, [0.1, 0.1, 0.11], mat({ pos: [s * wid * 0.46, y0 - rideH * 1.5, (frontAxle + rearAxle) / 2] }), { r: 0.5, seg: 3 }), mi.carbon);
  }

  M.add(smoothBox(wid * 1.0, 0.035, 0.38, [0.06, 0.06, 0.07], mat({ pos: [0, y0 - rideH * 1.7, halfL * 0.9] }), { r: 0.5, seg: 3 }), mi.carbon);
  M.add(smoothBox(wid * 0.86, 0.1, 0.34, [0.05, 0.05, 0.06], mat({ pos: [0, y0 - rideH * 0.2, -halfL * 0.94] }), { r: 0.4, seg: 3 }), mi.carbon);

  // ---- lights
  headlights(M, mi, { y: y0 + noseH * 1.0, z: halfL * 0.83, halfW: halfW * 0.62, w: wid * 0.2, h: noseH * 0.085, drl: false });
  taillights(M, mi, { y: y0 + bodyH * 0.74, z: -halfL * 0.96, halfW: halfW * 0.62, w: wid * 0.28, h: bodyH * 0.075, bar: true });

  // ---- mirrors
  for (const s of [-1, 1]) {
    M.add(smoothBox(0.19, 0.09, 0.13, paint, mat({ pos: [s * (halfW * 0.96), belt - bodyH * 0.02, cab.z0 * 0.78], rot: [0, s * 0.18, 0] }), { r: 0.42, seg: 3 }), mi.body);
    M.add(smoothBox(0.02, 0.07, 0.11, [0.05, 0.05, 0.06], mat({ pos: [s * (halfW * 1.05), belt - bodyH * 0.02, cab.z0 * 0.78], rot: [0, s * 0.18, 0] }), { r: 0.4, seg: 2 }), mi.carbon);
  }

  // ---- exhausts
  const pipes = o.pipes ?? 2;
  for (let i = 0; i < pipes; i++) {
    const spread = pipes === 1 ? 0 : (i / (pipes - 1) - 0.5) * wid * 0.46;
    M.add(latheGeo([
      [0.048, 0], [0.058, 0.02], [0.058, 0.14], [0.05, 0.15],
    ], 12, [0.3, 0.3, 0.32], mat({ pos: [spread, y0 + 0.02, -halfL * 0.93], rot: [Math.PI / 2, 0, 0] })), mi.chrome);
  }

  weightNodes(M, { track, wheelR, wheelbase });

  // ---- wheels
  const wopts = { rimColor: o.rim || [0.63, 0.65, 0.69], caliper: o.caliper, seg: 22, spokes: o.spokes || 5 };
  const rearW = wheelW * (o.rearTyre || 1.12);
  // wheels are set wide enough that the tyre wall always shows outside the bodywork
  const tF = Math.max(track / 2, wid / 2 + wheelW * 0.22);
  const tR = Math.max(track / 2 + (o.rearTrack || 0), wid / 2 + rearW * 0.22);
  buildWheel(M, 'wheelFL', -tF, wheelR, frontAxle, wheelR, wheelW, mi, wopts);
  buildWheel(M, 'wheelFR', tF, wheelR, frontAxle, wheelR, wheelW, mi, wopts);
  buildWheel(M, 'wheelRL', -tR, wheelR, rearAxle, wheelR, rearW, mi, wopts);
  buildWheel(M, 'wheelRR', tR, wheelR, rearAxle, wheelR, rearW, mi, wopts);
  // back to the root node: everything after the wheels is body detail
  M.use('root');

  // ---- grille + badge
  M.add(smoothBox(wid * 0.62, noseH * 0.5, 0.06, [0.035, 0.035, 0.045], mat({ pos: [0, y0 + noseH * 0.34, halfL * 0.97] }), { r: 0.35, seg: 3 }), mi.carbon);
  for (const s of [-1, 1]) {
    M.add(smoothBox(0.05, noseH * 0.34, 0.1, [0.3, 0.3, 0.32], mat({ pos: [s * wid * 0.33, y0 + noseH * 0.34, halfL * 0.97] }), { r: 0.4, seg: 2 }), mi.chrome);
  }
  M.add(smoothBox(0.14, 0.08, 0.03, [0.85, 0.75, 0.35], mat({ pos: [0, y0 + noseH * 0.4, halfL * 1.0] }), { r: 0.5, seg: 2 }), mi.chrome);
  // number plate
  M.add(smoothBox(0.42, 0.12, 0.02, [0.88, 0.88, 0.84], mat({ pos: [0, y0 - rideH * 0.4, -halfL * 0.995] }), { r: 0.4, seg: 2 }), mi.plate);

  // ---- spoiler / wing
  if (o.wing === 'gt') {
    const wz = -halfL * 0.86;
    for (const s of [-1, 1]) {
      M.add(smoothBox(0.05, bodyH * 0.62, 0.24, [0.06, 0.06, 0.07], mat({ pos: [s * wid * 0.34, belt + bodyH * 0.34, wz + 0.14], rot: [0.5, 0, 0] }), { r: 0.4, seg: 3 }), mi.carbon);
    }
    M.add(smoothBox(wid * 1.02, 0.05, 0.34, paint, mat({ pos: [0, belt + bodyH * 0.5, wz], rot: [-0.14, 0, 0] }), { r: 0.5, seg: 3 }), mi.body);
    for (const s of [-1, 1]) {
      M.add(smoothBox(0.05, bodyH * 0.42, 0.3, [0.06, 0.06, 0.07], mat({ pos: [s * wid * 0.4, belt + bodyH * 0.26, wz + 0.06] }), { r: 0.4, seg: 2 }), mi.carbon);
      M.add(smoothBox(0.035, 0.24, 0.36, paint, mat({ pos: [s * wid * 0.51, belt + bodyH * 0.5, wz] }), { r: 0.4, seg: 2 }), mi.body);
    }
  } else if (o.wing === 'ducktail') {
    M.add(smoothBox(wid * 0.9, 0.09, 0.16, paint, mat({ pos: [0, belt + bodyH * 0.06, -halfL * 0.9], rot: [-0.3, 0, 0] }), { r: 0.45, seg: 3 }), mi.body);
  } else if (o.wing === 'f1') {
    // single-element rear wing with endplates + DRS flap
    M.add(smoothBox(wid * 0.92, 0.035, 0.42, paint, mat({ pos: [0, belt + bodyH * 0.86, -halfL * 0.9], rot: [-0.2, 0, 0] }), { r: 0.5, seg: 3 }), mi.carbon);
    M.add(smoothBox(wid * 0.9, 0.03, 0.2, paint, mat({ pos: [0, belt + bodyH * 1.04, -halfL * 0.84], rot: [-0.5, 0, 0] }), { r: 0.5, seg: 2 }), mi.carbon);
    for (const s of [-1, 1]) {
      M.add(smoothBox(0.03, bodyH * 0.72, 0.46, paint, mat({ pos: [s * wid * 0.46, belt + bodyH * 0.66, -halfL * 0.9] }), { r: 0.4, seg: 2 }), mi.body);
    }
  }

  // ---- livery stripe (optional)
  if (o.stripe) {
    for (const s of [-1, 1]) {
      M.add(smoothBox(0.1, 0.02, len * 0.82, o.stripe, mat({ pos: [s * wid * 0.15, belt + bodyH * 0.02, -0.1] }), { r: 0.5, seg: 2 }), mi.accent);
    }
  }

  return { y0, belt, halfL, halfW, frontAxle, rearAxle };
}

/** suspension masses: the runtime bobs these so the shell pitches/rolls on its springs */
function weightNodes(M, o) {
  const items = [
    ['weight0', -o.track / 2 * 0.8, o.wheelR * 1.15, o.wheelbase / 2],
    ['weight1', o.track / 2 * 0.8, o.wheelR * 1.15, o.wheelbase / 2],
    ['weight2', -o.track / 2 * 0.8, o.wheelR * 1.15, -o.wheelbase / 2],
    ['weight3', o.track / 2 * 0.8, o.wheelR * 1.15, -o.wheelbase / 2],
  ];
  for (const [name, x, y, z] of items) M.addNode(name, mat({ pos: [x, y, z] }));
}

// ---------------------------------------------------------------- exports: cars
export function buildFerrari() {
  const M = new Model('ferrari_daytona_sp3');
  const mi = mats(M, { paint: PAINT.rosso, caliper: [0.85, 0.8, 0.1], rim: [0.5, 0.51, 0.54] });
  car(M, mi, {
    paint: PAINT.rosso, len: 4.68, wid: 2.02, wheelR: 0.355, wheelW: 0.3, wheelbase: 2.65, track: 1.7, bodyH: 0.52, noseH: 0.34,
    cabin: { z0: 0.62, z1: -1.2, h: 0.36, w: 1.62 }, wing: 'ducktail', pipes: 2, rearTyre: 1.18,
  });
  // side intake scallops
  for (const s of [-1, 1]) {
    M.add(smoothBox(0.06, 0.2, 0.85, [0.04, 0.04, 0.05], mat({ pos: [s * 1.0, 0.62, -0.55] }), { r: 0.4, seg: 3 }), mi.carbon);
  }
  return M;
}

export function buildMissionX() {
  const M = new Model('porsche_mission_x');
  const mi = mats(M, { paint: PAINT.silver, caliper: [0.1, 0.35, 0.85], rim: [0.72, 0.74, 0.78] });
  const d = car(M, mi, {
    paint: PAINT.silver, len: 4.6, wid: 1.99, wheelR: 0.35, wheelW: 0.29, wheelbase: 2.68, track: 1.68, bodyH: 0.48, noseH: 0.3,
    cabin: { z0: 0.55, z1: -1.15, h: 0.42, w: 1.5 }, wing: 'ducktail', pipes: 0, rearTyre: 1.15,
  });
  // glass bubble canopy, the Mission X signature
  M.add(loftGeo([
    { z: 0.9, y: d.belt + 0.02, w: 1.24, h: 0.3, r: 0.48 },
    { z: 0.2, y: d.belt + 0.14, w: 1.44, h: 0.42, r: 0.48 },
    { z: -0.7, y: d.belt + 0.1, w: 1.4, h: 0.36, r: 0.48 },
    { z: -1.4, y: d.belt - 0.02, w: 1.16, h: 0.22, r: 0.46 },
  ], { color: [0.05, 0.07, 0.09], segPerCorner: 6 }), mi.glass);
  // light signature: continuous rear bar + front DRL blades
  M.add(smoothBox(1.7, 0.035, 0.04, [0.75, 0.09, 0.05], mat({ pos: [0, d.y0 + 0.42, -2.29] }), { r: 0.5, seg: 3 }), mi.tail);
  for (const s of [-1, 1]) {
    M.add(smoothBox(0.05, 0.04, 1.1, [1, 0.97, 0.9], mat({ pos: [s * 0.98, d.y0 + 0.5, 0.9] }), { r: 0.5, seg: 3 }), mi.head);
  }
  return M;
}

export function buildPorsche911() {
  const M = new Model('porsche_911_gt3r');
  const mi = mats(M, { paint: PAINT.gtWhite, caliper: [0.78, 0.1, 0.08], rim: [0.55, 0.56, 0.6] });
  car(M, mi, {
    paint: PAINT.gtWhite, len: 4.62, wid: 2.05, wheelR: 0.35, wheelW: 0.3, wheelbase: 2.46, track: 1.72, bodyH: 0.56, noseH: 0.34,
    cabin: { z0: 0.72, z1: -1.05, h: 0.44, w: 1.6 }, wing: 'gt', pipes: 2, rearTyre: 1.2, rearTrack: 0.02,
  });
  // GT3 livery: red bonnet flash + door number boxes
  M.add(smoothBox(0.55, 0.02, 0.9, [0.72, 0.1, 0.1], mat({ pos: [0, 0.79, 1.5] }), { r: 0.5, seg: 2 }), mi.accent);
  for (const s of [-1, 1]) {
    M.add(smoothBox(0.02, 0.26, 0.5, [0.95, 0.95, 0.95], mat({ pos: [s * 1.03, 0.66, -0.1] }), { r: 0.45, seg: 2 }), mi.plate);
  }
  // swan-neck wing mounts
  for (const s of [-1, 1]) {
    M.add(smoothBox(0.05, 0.2, 0.12, [0.06, 0.06, 0.07], mat({ pos: [s * 0.42, 0.92, -1.9] }), { r: 0.4, seg: 2 }), mi.carbon);
  }
  return M;
}

export function buildF1() {
  const M = new Model('redbull_rb22');
  const mi = mats(M, { paint: [0.08, 0.12, 0.4], accent: [0.85, 0.13, 0.1], caliper: [0.8, 0.1, 0.05], rim: [0.15, 0.15, 0.16] });
  // monocoque: slim tapered tub
  M.add(loftGeo([
    { z: 2.5, y: 0.3, w: 0.16, h: 0.14, r: 0.45 },
    { z: 2.0, y: 0.32, w: 0.26, h: 0.22, r: 0.42 },
    { z: 1.2, y: 0.38, w: 0.42, h: 0.34, r: 0.38 },
    { z: 0.4, y: 0.42, w: 0.5, h: 0.42, r: 0.35 },
    { z: -0.2, y: 0.44, w: 0.46, h: 0.4, r: 0.35 },
    { z: -1.0, y: 0.4, w: 0.34, h: 0.32, r: 0.4 },
    { z: -1.7, y: 0.34, w: 0.2, h: 0.22, r: 0.45 },
    { z: -2.1, y: 0.3, w: 0.1, h: 0.12, r: 0.48 },
  ], { color: PAINT.f1Navy, segPerCorner: 5 }), mi.body);
  // sidepods + floor
  for (const s of [-1, 1]) {
    M.add(loftGeo([
      { z: 1.0, y: 0.34, w: 0.34, h: 0.22, r: 0.4 },
      { z: 0.2, y: 0.34, w: 0.52, h: 0.32, r: 0.35 },
      { z: -0.7, y: 0.33, w: 0.5, h: 0.28, r: 0.38 },
      { z: -1.5, y: 0.3, w: 0.26, h: 0.16, r: 0.44 },
    ], { color: PAINT.f1Navy, segPerCorner: 4, m: mat({ pos: [s * 0.5, 0, 0] }) }), mi.body);
    // front wing endplate
    M.add(smoothBox(0.03, 0.24, 0.5, PAINT.f1Navy, mat({ pos: [s * 0.94, 0.16, 2.34] }), { r: 0.4, seg: 3 }), mi.body);
    // sidepod inlet
    M.add(smoothBox(0.26, 0.16, 0.06, [0.03, 0.03, 0.04], mat({ pos: [s * 0.52, 0.42, 0.94] }), { r: 0.4, seg: 2 }), mi.carbon);
  }
  // multi-element front wing
  for (let i = 0; i < 3; i++) {
    M.add(smoothBox(1.86, 0.022, 0.22 - i * 0.03, PAINT.f1Navy, mat({ pos: [0, 0.1 + i * 0.055, 2.36 - i * 0.12], rot: [0.16 + i * 0.1, 0, 0] }), { r: 0.5, seg: 3 }), mi.body);
  }
  // floor + diffuser
  M.add(smoothBox(1.5, 0.03, 3.2, [0.04, 0.04, 0.05], mat({ pos: [0, 0.15, -0.3] }), { r: 0.45, seg: 3 }), mi.carbon);
  // halo
  M.add(smoothBox(0.52, 0.045, 0.05, [0.06, 0.06, 0.07], mat({ pos: [0, 0.9, 0.5] }), { r: 0.5, seg: 3 }), mi.carbon);
  M.add(smoothBox(0.045, 0.2, 0.5, [0.06, 0.06, 0.07], mat({ pos: [0, 0.86, 0.24] }), { r: 0.5, seg: 3 }), mi.carbon);
  // airbox + engine cover fin
  M.add(loftGeo([
    { z: -0.45, y: 0.72, w: 0.3, h: 0.22, r: 0.45 },
    { z: -0.75, y: 0.7, w: 0.34, h: 0.26, r: 0.45 },
    { z: -1.6, y: 0.52, w: 0.2, h: 0.16, r: 0.45 },
    { z: -2.0, y: 0.42, w: 0.09, h: 0.1, r: 0.48 },
  ], { color: PAINT.f1Navy, segPerCorner: 4 }), mi.body);
  M.add(smoothBox(0.03, 0.26, 0.9, PAINT.f1Navy, mat({ pos: [0, 0.72, -1.3] }), { r: 0.5, seg: 2 }), mi.accent);
  // rear wing (two elements + endplates + beam wing)
  M.add(smoothBox(1.34, 0.03, 0.36, PAINT.f1Navy, mat({ pos: [0, 0.94, -2.02], rot: [-0.18, 0, 0] }), { r: 0.5, seg: 3 }), mi.body);
  M.add(smoothBox(1.3, 0.028, 0.18, PAINT.f1Navy, mat({ pos: [0, 1.06, -1.9], rot: [-0.5, 0, 0] }), { r: 0.5, seg: 3 }), mi.body);
  M.add(smoothBox(1.2, 0.02, 0.1, PAINT.f1Navy, mat({ pos: [0, 0.36, -2.16] }), { r: 0.5, seg: 2 }), mi.body);
  for (const s of [-1, 1]) {
    M.add(smoothBox(0.028, 0.42, 0.46, PAINT.f1Navy, mat({ pos: [s * 0.68, 0.84, -2.0] }), { r: 0.4, seg: 3 }), mi.body);
  }
  // tyres: wide slicks; rims are dark and small
  const wr = 0.36;
  buildWheel(M, 'wheelFL', -0.86, wr, 1.62, wr, 0.34, mi, { seg: 22, spokes: 6, rimColor: [0.12, 0.12, 0.13], caliper: [0.8, 0.1, 0.05], rimRatio: 0.6 });
  buildWheel(M, 'wheelFR', 0.86, wr, 1.62, wr, 0.34, mi, { seg: 22, spokes: 6, rimColor: [0.12, 0.12, 0.13], caliper: [0.8, 0.1, 0.05], rimRatio: 0.6 });
  buildWheel(M, 'wheelRL', -0.84, wr * 1.08, -1.28, wr * 1.08, 0.44, mi, { seg: 22, spokes: 6, rimColor: [0.12, 0.12, 0.13], caliper: [0.8, 0.1, 0.05], rimRatio: 0.58 });
  buildWheel(M, 'wheelRR', 0.84, wr * 1.08, -1.28, wr * 1.08, 0.44, mi, { seg: 22, spokes: 6, rimColor: [0.12, 0.12, 0.13], caliper: [0.8, 0.1, 0.05], rimRatio: 0.58 });
  M.use('root');
  // suspension wishbones
  for (const s of [-1, 1]) {
    for (const [z, r] of [[1.62, wr], [-1.28, wr * 1.08]]) {
      M.add(smoothBox(0.66, 0.03, 0.05, [0.05, 0.05, 0.06], mat({ pos: [s * 0.44, r * 0.9, z], rot: [0, 0, s * 0.1] }), { r: 0.5, seg: 2 }), mi.carbon);
      M.add(smoothBox(0.66, 0.03, 0.05, [0.05, 0.05, 0.06], mat({ pos: [s * 0.44, r * 0.42, z], rot: [0, 0, s * 0.1] }), { r: 0.5, seg: 2 }), mi.carbon);
    }
  }
  // driver + helmet
  M.add(smoothBox(0.34, 0.3, 0.26, [0.8, 0.8, 0.84], mat({ pos: [0, 0.6, 0.34] }), { r: 0.4, seg: 3 }), mi.plate);
  M.add(capsuleGeo(0.115, 0.04, 14, [0.85, 0.16, 0.12], mat({ pos: [0, 0.8, 0.36] })), mi.accent);
  M.add(smoothBox(0.2, 0.09, 0.04, [0.12, 0.13, 0.16], mat({ pos: [0, 0.78, 0.44] }), { r: 0.5, seg: 3 }), mi.glass);
  return M;
}

export function buildMustang() {
  const M = new Model('mustang_roush_1996');
  const mi = mats(M, { paint: PAINT.navy, caliper: [0.7, 0.7, 0.72] });
  const d = car(M, mi, {
    paint: PAINT.navy, len: 4.72, wid: 1.95, wheelR: 0.35, wheelW: 0.25, wheelbase: 2.78, track: 1.62, bodyH: 0.62, noseH: 0.4,
    cabin: { z0: 0.75, z1: -1.25, h: 0.42, w: 1.5 }, wing: 'ducktail', pipes: 2, stripes: true,
  });
  // Roush stripes + hood scoop
  for (const s of [-1, 1]) {
    M.add(smoothBox(0.12, 0.015, 4.2, [0.9, 0.9, 0.92], mat({ pos: [s * 0.26, 0.95, -0.15] }), { r: 0.5, seg: 2 }), mi.plate);
  }
  M.add(smoothBox(0.7, 0.09, 0.9, C([0.05, 0.08, 0.19]), mat({ pos: [0, 0.9, 1.15] }), { r: 0.4, seg: 3 }), mi.bodyDark);
  return M;
}

export function buildPoliceCar() {
  const M = new Model('police_car');
  const mi = mats(M, { paint: PAINT.cruiser, rim: [0.5, 0.5, 0.52] });
  const d = car(M, mi, {
    paint: PAINT.cruiser, len: 4.86, wid: 1.98, wheelR: 0.36, wheelW: 0.25, wheelbase: 2.86, track: 1.64, bodyH: 0.66, noseH: 0.44,
    cabin: { z0: 0.85, z1: -1.35, h: 0.52, w: 1.58 }, wing: null, pipes: 1,
  });
  // black-and-white livery: dark doors + rear quarter
  for (const s of [-1, 1]) {
    M.add(smoothBox(0.015, 0.32, 2.1, [0.06, 0.08, 0.16], mat({ pos: [s * 1.0, d.y0 + 0.3, -0.25] }), { r: 0.4, seg: 2 }), mi.accent);
  }
  // push bar
  M.add(cylinderGeo(0.04, 0.04, 1.1, 10, PAL.darkChrome, mat({ pos: [0, 0.5, 2.5], rot: [0, 0, Math.PI / 2] })), mi.trim);
  // light bar (node named 'siren' — the runtime pulses it)
  M.addNode('siren', mat({ pos: [0, d.belt + 0.52, 0.1] }));
  M.add(smoothBox(1.12, 0.13, 0.24, [0.05, 0.05, 0.06], mat({}), { r: 0.35, seg: 3 }), mi.carbon);
  M.add(smoothBox(0.5, 0.1, 0.2, [0.7, 0.05, 0.06], mat({ pos: [-0.28, 0.02, 0] }), { r: 0.4, seg: 3 }), mi.tail);
  M.add(smoothBox(0.5, 0.1, 0.2, [0.1, 0.25, 0.9], mat({ pos: [0.28, 0.02, 0] }), { r: 0.4, seg: 3 }), mi.head);
  // roof antenna + spotlights
  M.add(cylinderGeo(0.012, 0.012, 0.9, 6, PAL.darkChrome, mat({ pos: [0.55, d.belt + 0.75, -1.1] })), mi.trim);
  return M;
}

export function buildLamborghiniPolice() {
  const M = new Model('police_lambo_diablo');
  const mi = mats(M, { paint: PAINT.policeBlue, caliper: [0.8, 0.75, 0.1], rim: [0.6, 0.61, 0.65] });
  const d = car(M, mi, {
    paint: PAINT.policeBlue, len: 4.5, wid: 2.04, wheelR: 0.34, wheelW: 0.29, wheelbase: 2.65, track: 1.72, bodyH: 0.44, noseH: 0.26,
    cabin: { z0: 0.5, z1: -1.1, h: 0.34, w: 1.6 }, wing: 'gt', pipes: 2, rearTyre: 1.2,
  });
  // Italian-police white door panels
  for (const s of [-1, 1]) {
    M.add(smoothBox(0.015, 0.26, 1.0, [0.9, 0.9, 0.92], mat({ pos: [s * 1.02, d.y0 + 0.26, 0.1] }), { r: 0.4, seg: 2 }), mi.plate);
  }
  M.addNode('siren', mat({ pos: [0, d.belt + 0.36, 0.05] }));
  M.add(smoothBox(0.9, 0.1, 0.2, [0.05, 0.05, 0.06], mat({}), { r: 0.35, seg: 3 }), mi.carbon);
  M.add(smoothBox(0.4, 0.08, 0.16, [0.75, 0.05, 0.06], mat({ pos: [-0.22, 0.02, 0] }), { r: 0.4, seg: 3 }), mi.tail);
  M.add(smoothBox(0.4, 0.08, 0.16, [0.1, 0.25, 0.9], mat({ pos: [0.22, 0.02, 0] }), { r: 0.4, seg: 3 }), mi.head);
  return M;
}

export function buildSportsCar(name, o = {}) {
  const M = new Model(name);
  const mi = mats(M, o);
  car(M, mi, {
    paint: o.paint || PAINT.rosso, len: o.len || 4.5, wid: o.wid || 1.95, wheelR: o.wheelR || 0.34, wheelW: 0.27,
    wheelbase: o.wheelbase || 2.6, track: 1.66, bodyH: 0.5, noseH: 0.32, wing: o.spoiler ? 'gt' : 'ducktail',
  });
  return M;
}

// ---------------------------------------------------------------- motorcycle
export function buildSportBike(name = 'kawasaki_ninja_h2', paint = [0.06, 0.35, 0.16]) {
  const M = new Model(name);
  const mi = mats(M, { paint, accent: [0.04, 0.04, 0.05], caliper: [0.85, 0.75, 0.1], rim: [0.16, 0.16, 0.18] });
  M.addMaterial({ name: 'rider_suit', baseColor: [0.08, 0.09, 0.12, 1], roughness: 0.55, metallic: 0.15 });
  const suit = M.materials.length - 1;

  const wF = 0.33, wR = 0.33;
  // frame spine + engine block
  M.add(loftGeo([
    { z: 0.62, y: 0.52, w: 0.2, h: 0.3, r: 0.4 },
    { z: 0.24, y: 0.56, w: 0.28, h: 0.44, r: 0.35 },
    { z: -0.16, y: 0.56, w: 0.3, h: 0.42, r: 0.35 },
    { z: -0.5, y: 0.58, w: 0.2, h: 0.3, r: 0.4 },
  ], { color: paint, segPerCorner: 4 }), mi.body);
  // tank
  M.add(loftGeo([
    { z: 0.44, y: 0.8, w: 0.24, h: 0.14, r: 0.45 },
    { z: 0.2, y: 0.86, w: 0.36, h: 0.24, r: 0.45 },
    { z: -0.02, y: 0.88, w: 0.4, h: 0.26, r: 0.45 },
    { z: -0.24, y: 0.86, w: 0.3, h: 0.2, r: 0.45 },
    { z: -0.36, y: 0.82, w: 0.18, h: 0.12, r: 0.48 },
  ], { color: paint, segPerCorner: 5 }), mi.body);
  // seat + tail
  M.add(loftGeo([
    { z: -0.3, y: 0.9, w: 0.24, h: 0.1, r: 0.48 },
    { z: -0.56, y: 0.93, w: 0.26, h: 0.11, r: 0.48 },
    { z: -0.82, y: 0.98, w: 0.18, h: 0.14, r: 0.45 },
    { z: -1.02, y: 1.02, w: 0.1, h: 0.1, r: 0.48 },
  ], { color: [0.09, 0.09, 0.1], segPerCorner: 4 }), mi.seat);
  // rear light strip
  M.add(smoothBox(0.12, 0.05, 0.04, [1, 0.08, 0.05], mat({ pos: [0, 1.0, -1.02] }), { r: 0.5, seg: 2 }), mi.tail);
  // fairing nose + screen
  M.add(loftGeo([
    { z: 0.88, y: 0.82, w: 0.16, h: 0.2, r: 0.45 },
    { z: 0.72, y: 0.78, w: 0.34, h: 0.34, r: 0.4 },
    { z: 0.46, y: 0.72, w: 0.42, h: 0.4, r: 0.38 },
    { z: 0.2, y: 0.66, w: 0.4, h: 0.34, r: 0.38 },
  ], { color: paint, segPerCorner: 5 }), mi.body);
  M.add(loftGeo([
    { z: 0.9, y: 1.0, w: 0.2, h: 0.14, r: 0.48 },
    { z: 0.66, y: 1.02, w: 0.3, h: 0.24, r: 0.48 },
    { z: 0.44, y: 1.0, w: 0.26, h: 0.2, r: 0.48 },
  ], { color: [0.6, 0.75, 0.85], segPerCorner: 5 }), mi.glass);
  // headlight
  M.add(smoothBox(0.2, 0.12, 0.05, [1, 0.98, 0.92], mat({ pos: [0, 0.85, 0.9] }), { r: 0.5, seg: 3 }), mi.head);
  // forks + handlebars
  for (const s of [-1, 1]) {
    M.add(smoothBox(0.05, 0.62, 0.05, [0.7, 0.72, 0.75], mat({ pos: [s * 0.14, 0.62, 0.66], rot: [0.32, 0, 0] }), { r: 0.45, seg: 3 }), mi.chrome);
    M.add(smoothBox(0.22, 0.035, 0.035, [0.12, 0.12, 0.13], mat({ pos: [s * 0.26, 0.9, 0.52] }), { r: 0.5, seg: 2 }), mi.carbon);
    // swingarm
    M.add(smoothBox(0.06, 0.06, 0.62, [0.6, 0.62, 0.65], mat({ pos: [s * 0.14, 0.42, -0.5] }), { r: 0.4, seg: 3 }), mi.chrome);
    // exhaust
    M.add(latheGeo([[0.07, 0], [0.085, 0.06], [0.085, 0.5], [0.07, 0.56]], 14, [0.55, 0.56, 0.6], mat({ pos: [s * 0.2, 0.4, -0.2], rot: [-Math.PI / 2, 0, 0] })), mi.chrome);
  }
  // rider (crouched, in leathers) — gives the bike real scale
  M.add(loftGeo([
    { z: 0.05, y: 1.06, w: 0.34, h: 0.22, r: 0.45 },
    { z: -0.16, y: 1.14, w: 0.4, h: 0.3, r: 0.4 },
    { z: -0.34, y: 1.1, w: 0.36, h: 0.26, r: 0.4 },
  ], { color: [0.05, 0.055, 0.07], segPerCorner: 4 }), suit);
  M.add(capsuleGeo(0.13, 0.06, 16, [0.08, 0.32, 0.16], mat({ pos: [0, 1.24, 0.12], rot: [0.4, 0, 0] })), mi.body);
  M.add(smoothBox(0.2, 0.1, 0.05, [0.1, 0.1, 0.12], mat({ pos: [0, 1.22, 0.24], rot: [0.4, 0, 0] }), { r: 0.5, seg: 3 }), mi.glass);
  for (const s of [-1, 1]) {
    M.add(smoothBox(0.1, 0.42, 0.12, [0.08, 0.09, 0.12], mat({ pos: [s * 0.2, 0.98, 0.12], rot: [0.5, 0, 0] }), { r: 0.45, seg: 3 }), suit);
  }

  buildBikeWheel(M, 'wheelFL', 0, wF, 0.72, wF, 0.11, mi);
  buildBikeWheel(M, 'wheelRL', 0, wR, -0.78, wR, 0.17, mi);
  M.use('root');
  return M;
}

// ---------------------------------------------------------------- utility / heavy
export function buildUralTruck() {
  const M = new Model('ural_4320_truck');
  const mi = mats(M, { paint: PAINT.army, trim: [0.2, 0.21, 0.19], rim: [0.28, 0.28, 0.3] });
  const paint = PAINT.army;
  const wr = 0.58;
  // chassis rails
  for (const s of [-1, 1]) {
    M.add(smoothBox(0.14, 0.22, 7.4, [0.12, 0.13, 0.11], mat({ pos: [s * 0.72, 0.78, 0] }), { r: 0.4, seg: 3 }), mi.trim);
  }
  // cab: lofted, with rounded nose — reads like a real Ural cab
  M.add(loftGeo([
    { z: 3.28, y: 1.42, w: 2.2, h: 1.1, r: 0.3 },
    { z: 3.1, y: 1.5, w: 2.34, h: 1.34, r: 0.3 },
    { z: 2.5, y: 1.56, w: 2.36, h: 1.6, r: 0.3 },
    { z: 1.7, y: 1.56, w: 2.34, h: 1.6, r: 0.3 },
    { z: 1.5, y: 1.5, w: 2.3, h: 1.4, r: 0.32 },
  ], { color: paint, segPerCorner: 5 }), mi.body);
  // windscreen + side glass
  M.add(smoothBox(1.86, 0.66, 0.05, [0.1, 0.14, 0.16], mat({ pos: [0, 2.06, 3.14], rot: [0.12, 0, 0] }), { r: 0.4, seg: 3 }), mi.glass);
  for (const s of [-1, 1]) {
    M.add(smoothBox(0.05, 0.6, 1.0, [0.1, 0.14, 0.16], mat({ pos: [s * 1.17, 2.04, 2.35] }), { r: 0.4, seg: 3 }), mi.glass);
    M.add(smoothBox(0.24, 0.16, 0.12, [1, 0.95, 0.8], mat({ pos: [s * 0.78, 1.34, 3.3] }), { r: 0.45, seg: 3 }), mi.head);
  }
  // bumper + grille
  M.add(smoothBox(2.3, 0.24, 0.18, [0.16, 0.17, 0.15], mat({ pos: [0, 1.2, 3.36] }), { r: 0.4, seg: 3 }), mi.trim);
  M.add(smoothBox(1.5, 0.5, 0.06, [0.05, 0.05, 0.05], mat({ pos: [0, 1.62, 3.34] }), { r: 0.35, seg: 3 }), mi.carbon);
  // cargo box with ribs + tarp top
  M.add(loftGeo([
    { z: 1.3, y: 1.7, w: 2.36, h: 1.5, r: 0.12 },
    { z: -3.4, y: 1.7, w: 2.36, h: 1.5, r: 0.12 },
  ], { color: [0.32, 0.31, 0.27], segPerCorner: 3 }), mi.accent);
  M.add(loftGeo([
    { z: 1.24, y: 2.62, w: 2.4, h: 0.3, r: 0.3 },
    { z: -3.44, y: 2.62, w: 2.4, h: 0.3, r: 0.3 },
  ], { color: [0.4, 0.38, 0.32], segPerCorner: 4 }), mi.trim);
  for (let i = 0; i < 6; i++) {
    M.add(smoothBox(2.42, 0.06, 0.08, [0.25, 0.24, 0.21], mat({ pos: [0, 2.3, 0.9 - i * 0.82] }), { r: 0.5, seg: 2 }), mi.trim);
  }
  // mudguards over each wheel
  for (const s of [-1, 1]) {
    for (const z of [2.55, -1.35, -2.75]) {
      M.add(smoothBox(0.5, 0.1, 1.5, [0.18, 0.25, 0.15], mat({ pos: [s * 1.05, wr * 2.24, z] }), { r: 0.45, seg: 3 }), mi.body);
    }
  }
  // 6x6 wheels
  buildWheel(M, 'wheelFL', -1.02, wr, 2.55, wr, 0.4, mi, { seg: 20, spokes: 6, rimRatio: 0.55 });
  buildWheel(M, 'wheelFR', 1.02, wr, 2.55, wr, 0.4, mi, { seg: 20, spokes: 6, rimRatio: 0.55 });
  buildWheel(M, 'wheelML', -1.02, wr, -1.35, wr, 0.4, mi, { seg: 20, spokes: 6, rimRatio: 0.55 });
  buildWheel(M, 'wheelMR', 1.02, wr, -1.35, wr, 0.4, mi, { seg: 20, spokes: 6, rimRatio: 0.55 });
  buildWheel(M, 'wheelRL', -1.02, wr, -2.75, wr, 0.4, mi, { seg: 20, spokes: 6, rimRatio: 0.55 });
  buildWheel(M, 'wheelRR', 1.02, wr, -2.75, wr, 0.4, mi, { seg: 20, spokes: 6, rimRatio: 0.55 });
  M.use('root');
  // exhaust stack + mirrors
  M.add(cylinderGeo(0.075, 0.075, 2.4, 12, [0.22, 0.22, 0.2], mat({ pos: [1.22, 2.2, 2.0] })), mi.trim);
  for (const s of [-1, 1]) {
    M.add(smoothBox(0.06, 0.06, 0.34, PAL.darkChrome, mat({ pos: [s * 1.28, 2.24, 3.0] }), { r: 0.5, seg: 2 }), mi.trim);
    M.add(smoothBox(0.2, 0.26, 0.05, [0.12, 0.12, 0.12], mat({ pos: [s * 1.42, 2.26, 3.0] }), { r: 0.45, seg: 3 }), mi.glass);
  }
  return M;
}

console.log;
