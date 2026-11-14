/**
 * Low-poly rigid-part character builder.
 * Body parts are separate glTF nodes (hips / torso / head / upper+fore arms / legs / shins)
 * so the runtime can drive a full procedural walk / run / jump / punch cycle with zero
 * skinning or animation payload -> each character is only a handful of KB.
 */
import {
  Geo,
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

const SKINS = {
  light: [0.87, 0.68, 0.55],
  fair: [0.92, 0.76, 0.66],
  tan: [0.78, 0.58, 0.42],
  olive: [0.7, 0.53, 0.38],
  brown: [0.55, 0.38, 0.26],
  deep: [0.38, 0.25, 0.17],
};

const HAIR = {
  black: [0.07, 0.06, 0.06],
  brown: [0.24, 0.15, 0.09],
  blonde: [0.78, 0.63, 0.32],
  ginger: [0.55, 0.24, 0.1],
  grey: [0.62, 0.62, 0.64],
  white: [0.9, 0.9, 0.92],
  pink: [0.85, 0.35, 0.55],
  blue: [0.2, 0.3, 0.6],
  purple: [0.35, 0.2, 0.5],
};

const C = (c) => (Array.isArray(c) ? c : new THREE.Color(c).toArray());

function shade(c, f) {
  return [c[0] * f, c[1] * f, c[2] * f];
}

/**
 * @param {object} o character options
 */
export function buildCharacter(o = {}) {
  const {
    name = 'character',
    height = 1.8,
    skin = 'tan',
    hair = 'black',
    hairStyle = 'short', // short | long | bun | pigtails | mohawk | bald | afro | ponytail
    top = [0.2, 0.25, 0.4],
    topStyle = 'tshirt', // tshirt | hoodie | tank | suit | coat | shirt | dress | uniform
    bottom = PAL.denim,
    bottomStyle = 'jeans', // jeans | shorts | skirt | suit | cargo
    shoes = PAL.sneaker,
    build = 'athletic', // slim | athletic | heavy | petite
    hat = null, // cap | beanie | helmet | crown | null
    hatColor = [0.15, 0.15, 0.18],
    accessories = {},
    feminine = false,
  } = o;

  const M = new Model(name);
  const mSkin = M.addMaterial({ name: 'skin', baseColor: [...C(skinHex(skin)), 1], roughness: 0.78 });
  const mHair = M.addMaterial({ name: 'hair', baseColor: [...C(HAIR[hair] || HAIR.black), 1], roughness: 0.62 });
  const mTop = M.addMaterial({ name: 'top', baseColor: [...C(top), 1], roughness: 0.85 });
  const mBottom = M.addMaterial({ name: 'bottom', baseColor: [...C(bottom), 1], roughness: 0.9 });
  const mShoe = M.addMaterial({ name: 'shoe', baseColor: [...C(shoes), 1], roughness: 0.7 });
  const mAcc = M.addMaterial({ name: 'accent', baseColor: [...C(hatColor), 1], roughness: 0.6 });
  const mEye = M.addMaterial({ name: 'eye', baseColor: [0.08, 0.07, 0.09, 1], roughness: 0.25, metallic: 0.0 });

  const skinC = SKINS[skin] || SKINS.tan;
  const hairC = HAIR[hair] || HAIR.black;

  const scale = height / 1.8;
  const slim = { slim: 0.86, petite: 0.78, athletic: 1.0, heavy: 1.26 }[build] || 1.0;
  const shoulder = (feminine ? 0.175 : 0.205) * (0.9 + slim * 0.1);
  const hipW = (feminine ? 0.155 : 0.145) * (0.9 + slim * 0.12);

  const hipY = 0.94 * scale;
  const torsoH = 0.6 * scale;
  const headR = 0.108 * scale;

  M.root.matrix = new THREE.Matrix4();

  // ---------------------------------------------------------------- hips
  M.addNode('hips', mat({ pos: [0, hipY, 0] }));
  M.box(hipW * 2.05, 0.16 * scale, 0.2 * scale * (0.9 + slim * 0.1), PAL.black, mat({ pos: [0, -0.01 * scale, 0] }), mBottom);
  if (bottomStyle !== 'skirt' && bottomStyle !== 'dress') {
    // shorts / upper legs handled by legs; hips get a belt
    M.box(hipW * 2.08, 0.045 * scale, 0.212 * scale, [0.1, 0.09, 0.1], null, mBottom);
    if (accessories.belt) M.box(0.05, 0.05, 0.02, [0.85, 0.72, 0.35], mat({ pos: [0, 0, 0.108 * scale] }), mAcc);
  }

  // ---------------------------------------------------------------- torso
  M.addNode('torso', mat({ pos: [0, 0.05 * scale, 0] }), 'hips');
  const chestW = shoulder * 2.0;
  const waistW = hipW * 1.75;
  const torsoD = 0.21 * scale * (0.92 + slim * 0.1);
  // rib cage: tapered up (broad shoulders)
  M.add(frustumGeo(waistW, torsoD * 0.92, chestW, torsoD * 1.06, torsoH * 0.72, top, mat({ pos: [0, 0.03 * scale, 0] })), mTop);
  // neck
  M.box(0.075 * scale, 0.075 * scale, 0.075 * scale, skinC, mat({ pos: [0, torsoH * 0.72 + 0.05 * scale, 0] }), mSkin);

  // clothing details -------------------------------------------------
  if (topStyle === 'hoodie') {
    // hood bundle behind neck
    M.add(frustumGeo(0.24 * scale, 0.16 * scale, 0.17 * scale, 0.1 * scale, 0.14 * scale, shade(C(top), 0.82), mat({ pos: [0, torsoH * 0.68, -0.06 * scale] })), mTop);
    // kangaroo pocket + drawstrings
    M.box(0.2 * scale, 0.09 * scale, 0.02 * scale, shade(C(top), 0.8), mat({ pos: [0, torsoH * 0.3, torsoD * 0.52] }), mTop);
    M.box(0.012 * scale, 0.1 * scale, 0.012 * scale, [0.9, 0.9, 0.9], mat({ pos: [-0.04 * scale, torsoH * 0.6, torsoD * 0.52] }), mAcc);
    M.box(0.012 * scale, 0.1 * scale, 0.012 * scale, [0.9, 0.9, 0.9], mat({ pos: [0.04 * scale, torsoH * 0.6, torsoD * 0.52] }), mAcc);
  } else if (topStyle === 'tank') {
    // skin shoulders
    M.box(chestW * 0.42, 0.09 * scale, torsoD * 0.98, skinC, mat({ pos: [0, torsoH * 0.66, 0] }), mSkin);
  } else if (topStyle === 'suit') {
    // jacket lapels + shirt triangle
    M.box(0.09 * scale, 0.26 * scale, 0.02 * scale, [0.96, 0.96, 0.98], mat({ pos: [0, torsoH * 0.45, torsoD * 0.53] }), mAcc);
    M.add(prismGeo([
      [-0.09 * scale, 0.2 * scale], [0.09 * scale, 0.2 * scale], [0.02 * scale, -0.34 * scale], [-0.02 * scale, -0.34 * scale],
    ], 0.014 * scale, shade(C(top), 0.7), mat({ pos: [0, torsoH * 0.5, torsoD * 0.53] })), mTop);
  } else if (topStyle === 'coat') {
    M.add(frustumGeo(chestW * 1.06, torsoD * 1.12, chestW * 1.14, torsoD * 1.2, torsoH * 1.02, top, mat({ pos: [0, -0.06 * scale, 0] })), mTop);
  } else if (topStyle === 'shirt') {
    M.box(0.02 * scale, 0.3 * scale, 0.012 * scale, shade(C(top), 0.7), mat({ pos: [0, torsoH * 0.4, torsoD * 0.53] }), mAcc);
  } else if (topStyle === 'dress') {
    M.add(frustumGeo(hipW * 2.2, torsoD * 1.1, chestW * 0.98, torsoD, torsoH * 0.9, top, mat({ pos: [0, -0.04 * scale, 0] })), mTop);
  } else if (topStyle === 'uniform') {
    M.box(chestW * 0.34, 0.14 * scale, 0.016 * scale, [0.85, 0.72, 0.3], mat({ pos: [0.07 * scale, torsoH * 0.5, torsoD * 0.53] }), mAcc);
    M.box(0.02 * scale, 0.4 * scale, 0.014 * scale, [0.9, 0.9, 0.95], mat({ pos: [0, torsoH * 0.45, torsoD * 0.53] }), mAcc);
  }

  if (accessories.apron) {
    M.box(0.32 * scale, 0.42 * scale, 0.02 * scale, [0.94, 0.94, 0.9], mat({ pos: [0, torsoH * 0.12, torsoD * 0.55] }), mAcc);
  }
  if (accessories.backpack) {
    M.add(frustumGeo(0.26 * scale, 0.14 * scale, 0.24 * scale, 0.12 * scale, 0.36 * scale, [0.16, 0.17, 0.22], mat({ pos: [0, torsoH * 0.16, -torsoD * 0.78] })), mAcc);
  }
  if (accessories.vest) {
    M.add(frustumGeo(chestW * 1.05, torsoD * 1.12, chestW * 0.95, torsoD * 1.1, torsoH * 0.6, [0.14, 0.15, 0.16], mat({ pos: [0, torsoH * 0.14, 0] })), mAcc);
  }

  // ---------------------------------------------------------------- head
  const headY = torsoH * 0.72 + 0.06 * scale + headR * 1.02;
  M.addNode('head', mat({ pos: [0, headY, 0] }), 'torso');
  const hw = headR * 1.86;
  const hh = headR * 2.25;
  const hd = headR * 2.0;
  M.add(frustumGeo(hw * 0.8, hd * 0.82, hw, hd, hh * 0.78, skinC, mat({ pos: [0, -hh * 0.26, 0] })), mSkin);
  M.add(frustumGeo(hw, hd, hw * 0.6, hd * 0.78, hh * 0.24, skinC, mat({ pos: [0, hh * 0.52, 0.004 * scale] })), mSkin);
  // nose + ears
  M.box(0.022 * scale, 0.035 * scale, 0.028 * scale, skinC, mat({ pos: [0, -0.004 * scale, hd * 0.51] }), mSkin);
  M.box(0.018 * scale, 0.05 * scale, 0.03 * scale, skinC, mat({ pos: [-hw * 0.52, 0.0, 0] }), mSkin);
  M.box(0.018 * scale, 0.05 * scale, 0.03 * scale, skinC, mat({ pos: [hw * 0.52, 0.0, 0] }), mSkin);
  // eyes
  const eyeY = hh * 0.1;
  M.box(0.026 * scale, 0.018 * scale, 0.012 * scale, [0.97, 0.97, 0.97], mat({ pos: [-0.032 * scale, eyeY, hd * 0.5] }), mAcc);
  M.box(0.026 * scale, 0.018 * scale, 0.012 * scale, [0.97, 0.97, 0.97], mat({ pos: [0.032 * scale, eyeY, hd * 0.5] }), mAcc);
  M.box(0.013 * scale, 0.013 * scale, 0.012 * scale, [0.08, 0.07, 0.09], mat({ pos: [-0.032 * scale, eyeY, hd * 0.51] }), mEye);
  M.box(0.013 * scale, 0.013 * scale, 0.012 * scale, [0.08, 0.07, 0.09], mat({ pos: [0.032 * scale, eyeY, hd * 0.51] }), mEye);
  // brow + mouth
  M.box(0.03 * scale, 0.008 * scale, 0.01 * scale, hairC, mat({ pos: [-0.032 * scale, eyeY + 0.022 * scale, hd * 0.5] }), mHair);
  M.box(0.03 * scale, 0.008 * scale, 0.01 * scale, hairC, mat({ pos: [0.032 * scale, eyeY + 0.022 * scale, hd * 0.5] }), mHair);
  M.box(0.045 * scale, 0.01 * scale, 0.012 * scale, shade(skinC, 0.72), mat({ pos: [0, -hh * 0.28, hd * 0.48] }), mSkin);

  // hair --------------------------------------------------------------
  const hairTop = hh * 0.55;
  if (hairStyle === 'short' || hairStyle === 'fade') {
    M.add(frustumGeo(hw * 1.08, hd * 1.1, hw * 0.72, hd * 0.78, hh * 0.34, hairC, mat({ pos: [0, hairTop, 0] })), mHair);
    M.box(hw * 1.12, hh * 0.34, hd * 0.34, hairC, mat({ pos: [0, hh * 0.14, -hd * 0.42] }), mHair);
  } else if (hairStyle === 'long') {
    M.add(frustumGeo(hw * 1.12, hd * 1.12, hw * 0.74, hd * 0.8, hh * 0.36, hairC, mat({ pos: [0, hairTop, 0] })), mHair);
    M.add(frustumGeo(hw * 1.2, 0.05 * scale, hw * 1.05, 0.06 * scale, hh * 1.15, hairC, mat({ pos: [0, -hh * 0.55, -hd * 0.34] })), mHair);
    M.box(hw * 0.28, hh * 0.85, 0.05 * scale, hairC, mat({ pos: [-hw * 0.55, -hh * 0.2, hd * 0.14] }), mHair);
    M.box(hw * 0.28, hh * 0.85, 0.05 * scale, hairC, mat({ pos: [hw * 0.55, -hh * 0.2, hd * 0.14] }), mHair);
  } else if (hairStyle === 'bun') {
    M.add(frustumGeo(hw * 1.1, hd * 1.1, hw * 0.76, hd * 0.8, hh * 0.34, hairC, mat({ pos: [0, hairTop, 0] })), mHair);
    M.add(sphereGeo(hh * 0.24, 7, 5, hairC, mat({ pos: [0, hh * 0.5, -hd * 0.46] })), mHair);
    M.box(hw * 1.14, hh * 0.4, hd * 0.3, hairC, mat({ pos: [0, hh * 0.18, -hd * 0.42] }), mHair);
  } else if (hairStyle === 'pigtails') {
    M.add(frustumGeo(hw * 1.1, hd * 1.1, hw * 0.76, hd * 0.8, hh * 0.34, hairC, mat({ pos: [0, hairTop, 0] })), mHair);
    for (const s of [-1, 1]) {
      M.add(sphereGeo(hh * 0.2, 6, 4, hairC, mat({ pos: [s * hw * 0.72, hh * 0.1, -hd * 0.3] })), mHair);
      M.add(frustumGeo(hh * 0.3, hh * 0.3, hh * 0.14, hh * 0.14, hh * 0.7, hairC, mat({ pos: [s * hw * 0.78, -hh * 0.62, -hd * 0.26] })), mHair);
    }
  } else if (hairStyle === 'ponytail') {
    M.add(frustumGeo(hw * 1.1, hd * 1.1, hw * 0.76, hd * 0.8, hh * 0.34, hairC, mat({ pos: [0, hairTop, 0] })), mHair);
    M.add(frustumGeo(0.05 * scale, 0.05 * scale, 0.03 * scale, 0.04 * scale, hh * 1.2, hairC, mat({ pos: [0, -hh * 0.2, -hd * 0.62] })), mHair);
  } else if (hairStyle === 'mohawk') {
    M.box(0.05 * scale, hh * 0.42, hd * 1.05, hairC, mat({ pos: [0, hairTop + hh * 0.16, -hd * 0.02] }), mHair);
    M.box(hw * 1.06, hh * 0.16, hd * 1.02, hairC, mat({ pos: [0, hh * 0.34, 0] }), mHair);
  } else if (hairStyle === 'afro') {
    M.add(sphereGeo(hh * 0.62, 9, 6, hairC, mat({ pos: [0, hh * 0.44, -hd * 0.1] })), mHair);
  } else if (hairStyle === 'bald') {
    M.box(hw * 1.02, 0.01, 0.01, skinC, mat({ pos: [0, hairTop, 0] }), mSkin);
  }

  if (feminine && !hat) {
    // subtle earrings
    M.box(0.012 * scale, 0.025 * scale, 0.012 * scale, [0.95, 0.8, 0.3], mat({ pos: [-hw * 0.53, -0.035 * scale, 0] }), mAcc);
    M.box(0.012 * scale, 0.025 * scale, 0.012 * scale, [0.95, 0.8, 0.3], mat({ pos: [hw * 0.53, -0.035 * scale, 0] }), mAcc);
  }

  if (hat === 'cap') {
    M.add(frustumGeo(hw * 1.12, hd * 1.12, hw * 0.86, hd * 0.9, hh * 0.28, hatColor, mat({ pos: [0, hh * 0.42, 0] })), mAcc);
    M.box(hw * 1.02, 0.014 * scale, hd * 0.6, hatColor, mat({ pos: [0, hh * 0.42, hd * 0.62] }), mAcc);
  } else if (hat === 'beanie') {
    M.add(frustumGeo(hw * 1.16, hd * 1.16, hw * 0.8, hd * 0.84, hh * 0.5, hatColor, mat({ pos: [0, hh * 0.24, 0] })), mAcc);
  } else if (hat === 'helmet') {
    M.add(sphereGeo(hh * 0.72, 10, 6, hatColor, mat({ pos: [0, hh * 0.34, 0], scale: [1.05, 1.0, 1.05] })), mAcc);
    M.box(hw * 0.9, 0.05 * scale, 0.06 * scale, [0.2, 0.24, 0.3], mat({ pos: [0, hh * 0.1, hd * 0.5] }), mAcc);
  } else if (hat === 'crown') {
    M.add(cylinderGeo(hh * 0.34, hh * 0.34, 0.05 * scale, 10, [0.92, 0.76, 0.25], mat({ pos: [0, hh * 0.56, 0] })), mAcc);
  }

  if (accessories.glasses) {
    M.box(hw * 1.0, 0.028 * scale, 0.012 * scale, [0.06, 0.06, 0.08], mat({ pos: [0, eyeY + 0.005 * scale, hd * 0.52] }), mEye);
  }
  if (accessories.mask) {
    M.box(hw * 0.9, 0.06 * scale, 0.03 * scale, [0.9, 0.92, 0.95], mat({ pos: [0, -hh * 0.1, hd * 0.48] }), mAcc);
  }

  // ---------------------------------------------------------------- arms
  const armLen = 0.29 * scale;
  const foreLen = 0.27 * scale;
  const armR = 0.055 * scale * (0.85 + slim * 0.2);
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    const shoulderX = s * chestW * 0.5;
    M.addNode(`upperArm${side}`, mat({ pos: [shoulderX, torsoH * 0.66, 0] }), 'torso');
    // shoulder cap
    M.add(sphereGeo(armR * 1.35, 7, 5, topStyle === 'tank' || topStyle === 'dress' ? skinC : top, mat({ pos: [0, 0, 0] })), topStyle === 'tank' || topStyle === 'dress' ? mSkin : mTop);
    M.add(frustumGeo(armR * 1.9, armR * 1.9, armR * 1.5, armR * 1.5, armLen, topStyle === 'hoodie' || topStyle === 'coat' || topStyle === 'suit' ? top : skinC, mat({ pos: [0, -armLen * 0.52, 0] })), topStyle === 'hoodie' || topStyle === 'coat' || topStyle === 'suit' ? mTop : mSkin);
    M.addNode(`foreArm${side}`, mat({ pos: [0, -armLen, 0] }), `upperArm${side}`);
    M.add(frustumGeo(armR * 1.5, armR * 1.5, armR * 1.2, armR * 1.2, foreLen, skinC, mat({ pos: [0, -foreLen * 0.5, 0] })), mSkin);
    // hand
    M.box(armR * 1.7, armR * 2.0, armR * 1.3, skinC, mat({ pos: [0, -foreLen - armR * 0.8, armR * 0.2] }), mSkin);
  }

  // ---------------------------------------------------------------- legs
  const legLen = 0.42 * scale;
  const shinLen = 0.4 * scale;
  const legR = 0.072 * scale * (0.86 + slim * 0.18);
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    M.addNode(`upperLeg${side}`, mat({ pos: [s * hipW * 0.75, -0.04 * scale, 0] }), 'hips');
    const isSkirt = bottomStyle === 'skirt' || bottomStyle === 'dress';
    const legCol = isSkirt || bottomStyle === 'shorts' ? skinC : bottom;
    const legMat = isSkirt || bottomStyle === 'shorts' ? mSkin : mBottom;
    M.add(frustumGeo(legR * 2.1, legR * 2.1, legR * 1.6, legR * 1.6, legLen, legCol, mat({ pos: [0, -legLen * 0.52, 0] })), legMat);
    M.addNode(`lowerLeg${side}`, mat({ pos: [0, -legLen, 0] }), `upperLeg${side}`);
    M.add(frustumGeo(legR * 1.6, legR * 1.6, legR * 1.3, legR * 1.3, shinLen, isSkirt ? skinC : bottomStyle === 'shorts' ? skinC : bottom, mat({ pos: [0, -shinLen * 0.5, 0] })), isSkirt || bottomStyle === 'shorts' ? mSkin : mBottom);
    // sneaker
    M.addNode(`foot${side}`, mat({ pos: [0, -shinLen, 0] }), `lowerLeg${side}`);
    M.add(frustumGeo(legR * 1.9, legR * 3.0, legR * 1.7, legR * 2.2, 0.075 * scale, shoes, mat({ pos: [0, -0.005 * scale, legR * 0.55] })), mShoe);
    M.box(legR * 1.9, 0.022 * scale, legR * 2.9, [0.92, 0.92, 0.94], mat({ pos: [0, -0.038 * scale, legR * 0.55] }), mShoe);
  }

  if (bottomStyle === 'skirt') {
    M.add(frustumGeo(hipW * 2.3, 0.24 * scale, hipW * 1.7, 0.18 * scale, 0.3 * scale, bottom, mat({ pos: [0, -0.2 * scale, 0] })), mBottom);
  }

  // clean stray zero-add (no-op safeguard)
  return M;
}

function skinHex(skin) {
  return SKINS[skin] || SKINS.tan;
}
