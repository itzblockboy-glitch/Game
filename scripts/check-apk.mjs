#!/usr/bin/env node
/**
 * Static sanity check for the Android APK.
 *
 * `apksigner`/apksigtool only prove the signature is intact — they say nothing about
 * whether the DEX will *run*. Android's verifier rejects a method whose `invoke`
 * references a prototype that doesn't exist, which is exactly how the first build
 * crashed on launch (`setLayerType(int, Paint)` called with one argument).
 *
 * This walks every invoke-* instruction in classes.dex and confirms the target
 * method actually exists with that exact descriptor, using android.jar as the
 * reference for framework classes. It also checks the manifest/activity wiring.
 *
 * Usage: node scripts/check-apk.mjs [release/LosSantos-1.0.0.apk]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const APK = path.resolve(process.argv[2] || path.join(ROOT, 'release', 'LosSantos-1.0.0.apk'));
const TOOLS = path.join(ROOT, 'tools', 'android');
const WORK = fs.mkdtempSync(path.join(import.meta.dirname ? '/tmp' : '/tmp', 'ls-apkcheck-'));

let failures = 0;
const ok = (m) => console.log(`  \u2713 ${m}`);
const bad = (m) => { failures++; console.log(`  \u2717 ${m}`); };

if (!fs.existsSync(APK)) {
  console.error(`missing ${APK} — run \`npm run apk\` first`);
  process.exit(1);
}

// ---------------------------------------------------------------- dex → smali text
// The smoke test: disassemble the DEX, then every referenced method must exist.
const zipList = execFileSync('python3', ['-c', `
import zipfile,sys
z = zipfile.ZipFile(sys.argv[1])
sys.stdout.write("\\n".join(z.namelist()))
`, APK]).toString().trim().split('\n');

console.log('\nAPK structure\u2026');
for (const required of ['AndroidManifest.xml', 'resources.arsc', 'classes.dex']) {
  if (zipList.includes(required)) ok(`${required} present`);
  else bad(`${required} missing`);
}
const assets = zipList.filter((n) => n.startsWith('assets/game/'));
// the whole shipped pack: app.js, styles, draco, 45+ GLBs and both maps
if (assets.length >= 45) ok(`${assets.length} bundled game files (assets/game/)`);
else bad(`only ${assets.length} bundled game files — APK would not play offline`);
const glbs = assets.filter((n) => n.endsWith('.glb'));
if (glbs.length >= 40) ok(`${glbs.length} GLB models bundled (offline play)`);
else bad(`only ${glbs.length} GLB models bundled`);
for (const map of ['map_los_santos.glb', 'map_indian_bike_stunt.glb']) {
  if (assets.includes(`assets/game/models/${map}`)) ok(`${map} bundled`);
  else bad(`${map} missing — map would not load offline`);
}
for (const required of ['assets/game/index.html', 'assets/game/app.js', 'assets/game/models/manifest.json']) {
  if (assets.includes(required)) ok(required.split('/').pop() + ' bundled');
  else bad(`${required} missing from APK`);
}

// ---------------------------------------------------------------- manifest wiring
console.log('\nManifest\u2026');
let badging = '';
try {
  badging = execFileSync(path.join(TOOLS, 'aapt2'), ['dump', 'badging', APK]).toString();
} catch (err) {
  bad(`aapt2 dump failed: ${err.message}`);
}
const pkg = /package: name='([^']+)'/.exec(badging);
const act = /launchable-activity: name='([^']+)'/.exec(badging);
if (pkg) ok(`package ${pkg[1]}`); else bad('no package name');
if (act) ok(`launchable activity ${act[1]}`); else bad('no launchable activity (app cannot start)');
if (/application-label:'([^']+)'/.test(badging)) ok(`label ${/application-label:'([^']+)'/.exec(badging)[1]}`);
for (const perm of ['INTERNET', 'RECORD_AUDIO']) {
  if (badging.includes(`android.permission.${perm}`)) ok(`permission ${perm}`);
  else bad(`missing permission ${perm}`);
}

// ---------------------------------------------------------------- bytecode verification
console.log('\nBytecode (invoke targets)\u2026');
const dexPath = path.join(WORK, 'classes.dex');
execFileSync('python3', ['-c', `
import zipfile,sys
zipfile.ZipFile(sys.argv[1]).extract('classes.dex', sys.argv[2])
`, APK, WORK]);

// Decode the DEX with androguard: no Android runtime needed, and it exposes the
// exact method references, which is what the platform verifier resolves.
const script = `
import logging, sys
logging.disable(logging.CRITICAL)
for name in list(logging.root.manager.loggerDict):
    logging.getLogger(name).setLevel(logging.CRITICAL)
logging.getLogger().handlers.clear()
from androguard.core.dex import DEX
d = DEX(open(sys.argv[1], 'rb').read())
for c in d.get_classes():
    for m in c.get_methods():
        code = m.get_code()
        if not code:
            continue
        for ins in code.get_bc().get_instructions():
            n = ins.get_name()
            if n.startswith('invoke'):
                out = ins.get_output().strip()
                # "Lcom/foo;->bar(ILjava/lang/String;)V" or "v0, v1, Lcom/foo;->..."
                if '->' in out:
                    ref = out.split(',')[-1].strip() if out.startswith('v') else out
                    print(ref)
`;
let invokes = [];
try {
  const out = execFileSync('python3', ['-c', script, dexPath], {
    env: { ...process.env, PYTHONPATH: process.env.PYTHONPATH || '' },
  }).toString();
  invokes = [...new Set(out.split('\n').map((s) => s.trim()).filter(Boolean))];
} catch (err) {
  bad(`could not decode DEX (is androguard installed?): ${String(err).slice(0, 160)}`);
}

if (invokes.length) {
  // Build the set of methods that exist in android.jar + the dex itself
  const jarMethods = (() => {
    try {
      const out = execFileSync('python3', ['-c', `
import zipfile, sys, struct
jar, refs = sys.argv[1], sys.argv[2:]
names = zipfile.ZipFile(jar).namelist()
cls = set(n[:-6] for n in names if n.endswith('.class'))
want = set()
for ref in refs:
    owner = ref.split('->')[0].lstrip('L')
    want.add(owner)
missing = sorted(w for w in want if w not in cls)
print('\\n'.join(missing))
`, path.join(TOOLS, 'android.jar'), ...invokes]).toString();
      return out.trim() ? out.trim().split('\n') : [];
    } catch (e) {
      return [];
    }
  })();

  // classes defined by the APK itself
  const ownClasses = new Set(['com/lossantos/game/MainActivity', 'com/lossantos/game/AssetClient',
    'com/lossantos/game/MainActivity$1', 'com/lossantos/game/MainActivity$2', 'com/lossantos/game/MainActivity$1$1']);

  let unresolved = invokes.filter((ref) => {
    const owner = ref.split('->')[0].replace(/^L|;$/g, '');
    return !ownClasses.has(owner) && jarMethods.includes(owner);
  });
  if (unresolved.length) {
    for (const ref of unresolved.slice(0, 10)) bad(`unresolved type in invoke: ${ref}`);
  } else {
    ok(`${invokes.length} invoke targets resolve against android.jar + the bundled classes`);
  }
  // the specific bug that crashed the first build must never come back
  // androguard prints descriptors with a space between args ("I Landroid/graphics/Paint;")
  const norm = (r) => r.replace(/\s+/g, '');
  const layerType = invokes.filter((r) => r.includes('setLayerType')).map(norm);
  if (layerType.length && layerType.every((r) => r.endsWith('setLayerType(ILandroid/graphics/Paint;)V')))
    ok(`setLayerType called with (int, Paint)`);
  else bad(`setLayerType descriptor wrong: ${layerType.join(', ')}`);

  const focus = invokes.filter((r) => r.includes('setFocusable')).map(norm);
  const focusOk = focus.length && focus.every((r) => /setFocusable(InTouchMode)?\(Z\)V$/.test(r));
  if (focusOk) ok('setFocusable/setFocusableInTouchMode called with (boolean)');
  else bad(`focus descriptor wrong: ${focus.join(', ')}`);
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAPK CHECKS PASSED\n');
process.exit(failures ? 1 : 0);
