#!/usr/bin/env node
/**
 * Package LOS SANTOS as a real, installable Android APK.
 *
 * There is no Android SDK or JDK on the build box, so this script assembles the
 * APK by hand using only free-standing tools:
 *
 *   • android.jar          — compile-time stubs (checked into tools/android/)
 *   • aapt2                — compiles res/ + links AndroidManifest + assets
 *   • ecj + d8             — compile + dex the Java WebView host (android/java)
 *   • node:crypto          — signs the finished zip with APK Signature Scheme v2
 *
 * Output: dist/LosSantos-<version>.apk (runs fully offline; multiplayer/voice
 * connect to the public server when the device is online).
 *
 * Usage: node scripts/build-apk.mjs [--skip-sign]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const AND = path.join(ROOT, 'android');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'release', 'LosSantos-1.0.1.apk');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-apk-'));

const TOOLS = process.env.LS_ANDROID_TOOLS || path.join(ROOT, 'tools', 'android');
const AAPT2 = path.join(TOOLS, 'aapt2');
const ANDROID_JAR = path.join(TOOLS, 'android.jar');
const ECJ = path.join(TOOLS, 'ecj.jar');
const D8 = path.join(TOOLS, 'd8.jar');
// prefer an explicit LS_JAVA, then PATH, then the toolchain-local runtime
const JAVA = process.env.LS_JAVA
  || (() => {
    try { execFileSync('java', ['-version'], { stdio: 'ignore' }); return 'java'; } catch {}
    const local = path.join(TOOLS, 'jre', 'bin', 'java');
    return fs.existsSync(local) ? local : 'java';
  })();

/**
 * APK Signature Scheme v2, implemented to the spec:
 *   chunked SHA-256 over (zip contents) + (central directory) + (EOCD pointing at the block)
 *   signed data = digests seq + certificates seq + additional attributes seq
 *   signer      = signed data + signatures seq + public key (SPKI)
 *   value       = 8-byte prefix + "APK Sig Block 42" footer
 * Signed with an RSA-2048 key generated once into tools/android/keys/.
 */
// 0x0103 = RSASSA-PKCS1-v1_5 with SHA-256: supported by every Android since 4.3
const ALG_RSA_PKCS1_SHA256 = 0x0103;
const APK_SIG_MAGIC = Buffer.from('APK Sig Block 42');
const SIG_BLOCK_ID = 0x7109871a; // APK Signature Scheme v2
const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; }
function u64(v) { const b = Buffer.alloc(8); b.writeUInt32LE(v >>> 0, 0); b.writeUInt32LE(Math.floor(v / 4294967296), 4); return b; }
function lp(b) { return Buffer.concat([u32(b.length), b]); }
// "length-prefixed sequence": a uint32 total length followed by the concatenated
// length-prefixed items — there is NO item count on the wire (parsers just read
// until the field is exhausted)
function seq(items) {
  return lp(Buffer.concat(items.map(lp)));
}

/**
 * APK v2 digest. IMPORTANT: the three protected sections (zip contents up to the
 * signing block, the central directory, and the EOCD) are chunked INDEPENDENTLY —
 * each 1 MiB chunk restarts at the section boundary, exactly like apksig's
 * ApkSigningBlockUtils.computeContentDigests.
 */
function chunkedSha256(sections) {
  const CHUNK = 1048576;
  const chunkDigests = [];
  for (const data of sections) {
    if (data.length === 0) continue;
    for (let off = 0; off < data.length; off += CHUNK) {
      const slice = data.subarray(off, Math.min(data.length, off + CHUNK));
      const h = crypto.createHash('sha256');
      h.update(Buffer.concat([Buffer.from([0xa5]), u32(slice.length)]));
      h.update(slice);
      chunkDigests.push(h.digest());
    }
  }
  const n = chunkDigests.length;
  const top = crypto.createHash('sha256');
  top.update(Buffer.concat([Buffer.from([0x5a]), u32(n)]));
  for (const d of chunkDigests) top.update(d);
  return top.digest();
}

function findEocd(buf) {
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error('no EOCD in zip');
}

/**
 * Sign an unsigned APK in place with APK Signature Scheme v2.
 *
 * The digest must be computed over the *finished* file layout (contents + signing
 * block + central directory + EOCD), so the block is first written with a dummy
 * digest — its size is fixed, since RSA-2048 signatures are 256 bytes — and the
 * real digest is then computed by re-reading the file and patched in.
 */
function signV2(apkPath, keyDir) {
  const key = crypto.createPrivateKey(fs.readFileSync(path.join(keyDir, 'key.pem')));
  const certDer = fs.readFileSync(path.join(keyDir, 'cert.der'));
  const pubDer = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });
  const ZERO = Buffer.alloc(32);

  const build = (digest) => {
    const signedData = Buffer.concat([
      seq([Buffer.concat([u32(ALG_RSA_PKCS1_SHA256), lp(digest)])]), // digests
      seq([certDer]),                                                // certificates
      seq([]),                                                       // additional attributes
    ]);
    const signature = crypto.sign('sha256', signedData, {
      key,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    });
    const signer = Buffer.concat([
      lp(signedData),
      seq([Buffer.concat([u32(ALG_RSA_PKCS1_SHA256), lp(signature)])]),
      lp(pubDer),
    ]);
    const value = seq([signer]);
    const pair = Buffer.concat([u64(4 + value.length), u32(SIG_BLOCK_ID), value]);
    const sizeOfBlock = pair.length + 8 + 16;
    const block = Buffer.concat([u64(sizeOfBlock), pair, u64(sizeOfBlock), APK_SIG_MAGIC]);
    return { block, signedData };
  };

  const unsigned = fs.readFileSync(apkPath);
  const eocd = findEocd(unsigned);
  const cdOffset = unsigned.readUInt32LE(eocd + 16);
  const cdSize = unsigned.readUInt32LE(eocd + 12);
  const contents = unsigned.subarray(0, cdOffset);
  const cd = unsigned.subarray(cdOffset, cdOffset + cdSize);

  const assemble = (block) => {
    const eocdOut = Buffer.from(unsigned.subarray(eocd));
    eocdOut.writeUInt32LE(cdOffset + block.length, 16);
    return Buffer.concat([contents, block, cd, eocdOut]);
  };

  // pass 1: dummy digest → real file layout
  const probe = assemble(build(ZERO).block);
  fs.writeFileSync(apkPath, probe);

  // pass 2: read back exactly like a verifier and digest the three protected sections
  const ver = fs.readFileSync(apkPath);
  const vEocd = findEocd(ver);
  const vCd = ver.readUInt32LE(vEocd + 16);
  const vCdSize = ver.readUInt32LE(vEocd + 12);
  // the signed EOCD has its central-directory offset rewritten to point at the
  // signing block, which is exactly where the block's first size field starts
  const sbStart = vCd - (ver.readUInt32LE(vCd - 24) + 8);
  const vEocdCopy = Buffer.from(ver.subarray(vEocd));
  vEocdCopy.writeUInt32LE(sbStart, 16);
  const realDigest = chunkedSha256([
    ver.subarray(0, sbStart),
    ver.subarray(vCd, vCd + vCdSize),
    vEocdCopy,
  ]);

  const { block } = build(realDigest);
  const signed = assemble(block);
  fs.writeFileSync(apkPath, signed);

  if (process.env.LS_APK_DEBUG) {
    const check = fs.readFileSync(apkPath);
    const cEocd = findEocd(check);
    const cCd = check.readUInt32LE(cEocd + 16);
    const cCdSize = check.readUInt32LE(cEocd + 12);
    const cSb = cCd - (check.readUInt32LE(cCd - 24) + 8);
    const cEocdCopy = Buffer.from(check.subarray(cEocd));
    cEocdCopy.writeUInt32LE(cSb, 16);
    const d = chunkedSha256([check.subarray(0, cSb), check.subarray(cCd, cCd + cCdSize), cEocdCopy]);
    console.log('  debug: signed', realDigest.toString('hex').slice(0, 16),
      'verified', d.toString('hex').slice(0, 16), d.equals(realDigest) ? 'MATCH' : 'MISMATCH');
  }
  return signed.length;
}

/**
 * A self-signed release key, generated once and reused so upgrades install over
 * the previous build. RSASSA-PSS requires a plain RSA key (SHA-256 + salt == len).
 */
function ensureKey(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const pem = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.der');
  if (have(pem) && have(cert)) return;
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  fs.writeFileSync(pem, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  // self-signed X.509 via openssl (present on every build box)
  const csr = path.join(dir, 'key.csr');
  const crt = path.join(dir, 'cert.pem');
  run('openssl', ['req', '-new', '-key', pem, '-out', csr, '-subj', '/CN=LOS SANTOS/O=LosSantos/C=US']);
  run('openssl', ['x509', '-req', '-in', csr, '-signkey', pem, '-out', crt, '-days', '10950']);
  const der = execFileSync('openssl', ['x509', '-in', crt, '-outform', 'der']);
  fs.writeFileSync(cert, der);
  fs.rmSync(csr, { force: true });
  fs.rmSync(crt, { force: true });
  console.log('  key: generated release signing key');
}

function run(cmd, args, opts = {}) {

  return execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}
function have(file) {
  try { fs.accessSync(file, fs.constants.R_OK); return true; } catch { return false; }
}

// ---------------------------------------------------------------- 1. assets
// The whole dist/ tree becomes assets/game/ inside the APK, so index.html,
// app.js, styles.css, draco/ and models/ all resolve relative to file://
const assetsGame = path.join(WORK, 'assets', 'game');
fs.mkdirSync(assetsGame, { recursive: true });
const skip = new Set(['LosSantos-1.0.0.apk', 'LosSantos-1.0.1.apk']);
const copy = (from, to) => {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copy(a, b); }
    else fs.copyFileSync(a, b);
  }
};
copy(DIST, assetsGame);

// rewrite the built index.html so every absolute URL works from file://android_asset
const idxPath = path.join(assetsGame, 'index.html');
let html = fs.readFileSync(idxPath, 'utf8');
html = html
  .replace(/href="\/manifest.webmanifest"/, 'href="manifest.webmanifest"')
  .replace(/href="\/styles.css"/, 'href="styles.css"')
  .replace(/src="\/app\.js"/, 'src="app.js"')
  .replace('<head>', '<head>\n    <base href="./" />');
fs.writeFileSync(idxPath, html);

// absolute fetches (/models/…, /draco/…) need to resolve relative to the asset dir
let appjs = fs.readFileSync(path.join(assetsGame, 'app.js'), 'utf8');
appjs = appjs
  .replace(/(["'`])\/models\//g, '$1models/')
  .replace(/(["'`])\/draco\//g, '$1draco/')
  .replace(/(["'`])\/vendor\//g, '$1vendor/');
fs.writeFileSync(path.join(assetsGame, 'app.js'), appjs);

// the manifest stores absolute /models/... paths; make them relative to the doc
const manPath = path.join(assetsGame, 'models', 'manifest.json');
if (fs.existsSync(manPath)) {
  const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  for (const m of man.models || []) {
    if (m.file && m.file.startsWith('/')) m.file = m.file.slice(1);
  }
  fs.writeFileSync(manPath, JSON.stringify(man));
}

// ---------------------------------------------------------------- 2. resources
const resDir = path.join(WORK, 'res');
fs.mkdirSync(resDir, { recursive: true });
run(AAPT2, ['compile', '--dir', path.join(AND, 'res'), '-o', resDir]);
const flats = fs.readdirSync(resDir).filter((f) => f.endsWith('.flat')).map((f) => path.join(resDir, f));
const linked = path.join(WORK, 'app-unsigned.apk');
run(AAPT2, [
  'link', '-o', linked,
  '-I', ANDROID_JAR,
  '--manifest', path.join(AND, 'AndroidManifest.xml'),
  '-A', path.join(WORK, 'assets'),
  '--auto-add-overlay',
  '--min-sdk-version', '24',
  '--target-sdk-version', '34',
  ...flats,
]);

// ---------------------------------------------------------------- 3. dex
// The host activity is real Java (android/java), compiled with the Eclipse
// compiler and dexed with d8 — no hand-written smali, so the bytecode Android
// verifies at launch is exactly what javac would produce.
const javaOut = path.join(WORK, 'classes');
fs.mkdirSync(javaOut, { recursive: true });
const javaSources = [];
const collectJava = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collectJava(full);
    else if (e.name.endsWith('.java')) javaSources.push(full);
  }
};
collectJava(path.join(AND, 'java'));
run(JAVA, ['-jar', ECJ, '-1.7', '-nowarn', '-cp', ANDROID_JAR, '-d', javaOut, ...javaSources]);

const dexOut = path.join(WORK, 'dex');
fs.mkdirSync(dexOut, { recursive: true });
const classFiles = [];
const collectClass = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collectClass(full);
    else if (e.name.endsWith('.class')) classFiles.push(full);
  }
};
collectClass(javaOut);
run(JAVA, [
  '-cp', D8, 'com.android.tools.r8.D8',
  '--min-api', '24', '--release',
  '--lib', ANDROID_JAR,
  '--output', dexOut,
  ...classFiles,
]);
const dex = path.join(dexOut, 'classes.dex');

// splice classes.dex (stored) into the linked apk
const zipOut = path.join(WORK, 'app-dex.apk');
addStoredEntry(linked, zipOut, 'classes.dex', fs.readFileSync(dex));

// ---------------------------------------------------------------- 4. sign (v2)
const keyDir = path.join(TOOLS, 'keys');
ensureKey(keyDir);
const size = signV2(zipOut, keyDir);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.copyFileSync(zipOut, OUT);

console.log(`\n  apk: ${path.relative(ROOT, OUT)} (${(size / 1048576).toFixed(2)} MB)`);
fs.rmSync(WORK, { recursive: true, force: true });


/** minimal zip reader: returns entries with their raw local record */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('bad central directory');
    const e = {
      flags: buf.readUInt16LE(off + 8),
      method: buf.readUInt16LE(off + 10),
      crc: buf.readUInt32LE(off + 16),
      csize: buf.readUInt32LE(off + 20),
      usize: buf.readUInt32LE(off + 24),
      local: buf.readUInt32LE(off + 42),
    };
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    e.name = buf.slice(off + 46, off + 46 + nameLen).toString();
    off += 46 + nameLen + extraLen + commentLen;
    entries.push(e);
  }
  return entries;
}


/** rebuild a zip, adding `name` as a stored (uncompressed) entry */
function addStoredEntry(srcPath, dstPath, name, data) {
  const buf = fs.readFileSync(srcPath);
  const entries = readZip(buf).filter((e) => e.name !== name);
  const out = [];
  const centrals = [];
  let offset = 0;
  const push = (b) => { out.push(b); offset += b.length; };

  for (const e of entries) {
    if (buf.readUInt32LE(e.local) !== LOCAL_SIG) throw new Error('bad local header ' + e.name);
    const nameLen = buf.readUInt16LE(e.local + 26);
    const extraLen = buf.readUInt16LE(e.local + 28);
    const dataStart = e.local + 30 + nameLen + extraLen;
    const localOff = offset;
    push(buf.slice(e.local, dataStart + e.csize));
    centrals.push({ e, localOff, nameBuf: buf.slice(e.local + 30, e.local + 30 + nameLen) });
  }

  // the dex goes in last so aapt2's alignment of earlier entries is untouched
  const nameBuf = Buffer.from(name);
  const crcVal = crc32(data);
  const localOff = offset;
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(LOCAL_SIG, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(0x0800, 6);
  lh.writeUInt16LE(0, 8); // stored
  lh.writeUInt32LE(crcVal, 14);
  lh.writeUInt32LE(data.length, 18);
  lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26);
  push(lh); push(nameBuf); push(data);
  centrals.push({
    e: { flags: 0x0800, method: 0, crc: crcVal, csize: data.length, usize: data.length, name },
    localOff, nameBuf,
  });

  const cdStart = offset;
  for (const { e, localOff: lo, nameBuf: nb } of centrals) {
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(CENTRAL_SIG, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(e.flags ?? 0x0800, 8);
    ch.writeUInt16LE(e.method, 10);
    ch.writeUInt32LE(e.crc, 16);
    ch.writeUInt32LE(e.csize, 20);
    ch.writeUInt32LE(e.usize, 24);
    ch.writeUInt16LE(nb.length, 28);
    ch.writeUInt32LE(lo, 42);
    push(ch); push(nb);
  }
  const cdSize = offset - cdStart;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(centrals.length, 8);
  eocd.writeUInt16LE(centrals.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  push(eocd);
  fs.writeFileSync(dstPath, Buffer.concat(out));
  console.log(`  zip: ${centrals.length} entries · ${(offset / 1048576).toFixed(2)} MB`);
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
