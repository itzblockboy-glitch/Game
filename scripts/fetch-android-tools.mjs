#!/usr/bin/env node
/**
 * Fetch the small Android toolchain used by `npm run apk`.
 *
 * Nothing here needs the Android SDK or a full JDK: aapt2 + the compile-time
 * android.jar + a smali jar are enough to produce a signed APK, and the signing
 * itself is done in node (see scripts/build-apk.mjs).
 *
 *   • aapt2       — from the `aapt2` PyPI wheel (bundles a Linux binary)
 *   • android.jar — from the Sable/android-platforms repo (public SDK stubs)
 *   • smali.jar   — assembles the DEX for the WebView host activity
 *
 * Usage: node scripts/fetch-android-tools.mjs   (needs `java` on PATH to build)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TOOLS = path.join(ROOT, 'tools', 'android');
fs.mkdirSync(TOOLS, { recursive: true });

const have = (f) => fs.existsSync(f);
async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf;
}

// 1. android.jar (compile-time stubs only)
const jarPath = path.join(TOOLS, 'android.jar');
if (!have(jarPath)) {
  console.log('· android.jar');
  await download('https://raw.githubusercontent.com/Sable/android-platforms/master/android-34/android.jar', jarPath);
}

// 2. aapt2 — pull the linux binary out of the PyPI wheel
const aapt2Path = path.join(TOOLS, 'aapt2');
if (!have(aapt2Path)) {
  console.log('· aapt2');
  const meta = await fetch('https://pypi.org/pypi/aapt2/json').then((r) => r.json());
  const url = meta.urls.find((u) => u.filename.endsWith('.whl')).url;
  const whl = path.join(TOOLS, 'aapt2.whl');
  await download(url, whl);
  // the wheel is a plain zip; extract aapt2/bin/Linux/aapt2 by hand (no deps)
  const zlibMod = zlib;
  const zip = fs.readFileSync(whl);
  // locate the entry via the central directory
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  let off = zip.readUInt32LE(eocd + 16);
  const count = zip.readUInt16LE(eocd + 10);
  let found = null;
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(off + 10);
    const csize = zip.readUInt32LE(off + 20);
    const nameLen = zip.readUInt16LE(off + 28);
    const extraLen = zip.readUInt16LE(off + 30);
    const commentLen = zip.readUInt16LE(off + 32);
    const local = zip.readUInt32LE(off + 42);
    const name = zip.slice(off + 46, off + 46 + nameLen).toString();
    if (name.endsWith('Linux/aapt2')) {
      const lNameLen = zip.readUInt16LE(local + 26);
      const lExtra = zip.readUInt16LE(local + 28);
      const start = local + 30 + lNameLen + lExtra;
      const raw = zip.slice(start, start + csize);
      found = method === 0 ? raw : zlibMod.inflateRawSync(raw);
      break;
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  if (!found) throw new Error('aapt2 binary not found in wheel');
  fs.writeFileSync(aapt2Path, found, { mode: 0o755 });
  fs.rmSync(whl, { force: true });
}

// 3. smali — assemble DEX from the hand-written smali sources
const smaliPath = path.join(TOOLS, 'smali.jar');
if (!have(smaliPath)) {
  console.log('· smali.jar');
  // Community mirror of the smali fat jar (the upstream release assets block
  // direct downloads from some networks). Any 2.x fat jar works.
  await download(
    'https://raw.githubusercontent.com/TOSPlus/TPS/master/build/tools/apktool/smali.jar',
    smaliPath,
  );
}

// 4. a Java runtime, if the box has none (jdk4py ships a JRE-only build, which is
//    all smali needs). Skipped when `java` is already on PATH.
let haveJava = false;
try { execFileSync('java', ['-version'], { stdio: 'ignore' }); haveJava = true; } catch {}
if (!haveJava) {
  console.log('· java runtime (jre)');
  const meta = await fetch('https://pypi.org/pypi/jdk4py/json').then((r) => r.json());
  const wheel = meta.urls.find((u) => u.filename.includes('manylinux') && u.filename.endsWith('.whl'));
  if (wheel) {
    const tmp = path.join(TOOLS, 'jre.whl');
    await download(wheel.url, tmp);
    const zip = fs.readFileSync(tmp);
    let eocd = -1;
    for (let i = zip.length - 22; i >= 0; i--) {
      if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    let off = zip.readUInt32LE(eocd + 16);
    const count = zip.readUInt16LE(eocd + 10);
    for (let i = 0; i < count; i++) {
      const method = zip.readUInt16LE(off + 10);
      const csize = zip.readUInt32LE(off + 20);
      const nameLen = zip.readUInt16LE(off + 28);
      const extraLen = zip.readUInt16LE(off + 30);
      const commentLen = zip.readUInt16LE(off + 32);
      const local = zip.readUInt32LE(off + 42);
      const name = zip.slice(off + 46, off + 46 + nameLen).toString();
      const lNameLen = zip.readUInt16LE(local + 26);
      const lExtra = zip.readUInt16LE(local + 28);
      const start = local + 30 + lNameLen + lExtra;
      const raw = zip.slice(start, start + csize);
      const data = method === 0 ? raw : zlib.inflateRawSync(raw);
      const target = path.join(TOOLS, 'jre', name.replace(/^jdk4py\/java-runtime\//, ''));
      if (!name.startsWith('jdk4py/java-runtime/')) { off += 46 + nameLen + extraLen + commentLen; continue; }
      if (name.endsWith('/')) {
        fs.mkdirSync(target, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, data, { mode: name.includes('/bin/') ? 0o755 : 0o644 });
      }
      off += 46 + nameLen + extraLen + commentLen;
    }
    fs.rmSync(tmp, { force: true });
    console.log('  → tools/android/jre');
  }
}
console.log('android toolchain ready in tools/android');
