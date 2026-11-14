#!/usr/bin/env node
/**
 * Guards the one contract that a black screen violates: the built page must
 * paint something, and must explain itself if the bundle cannot run.
 *
 * 1.0.1 shipped a page that reported a black screen on Samsung devices because
 * a top-level throw (WebGL 2 init) aborted the bundle before any UI existed.
 *
 * Usage: node scripts/check-html.mjs
 */
// Verify the HTML contract: splash present, guard before module, no leaking icons
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const DIST = path.join(process.cwd(), 'dist', 'index.html');
if (!fs.existsSync(DIST)) {
  console.error('missing dist/index.html — run `npm run build` first');
  process.exit(1);
}
const html = fs.readFileSync(DIST, 'utf8');
const checks = [
  ['boot splash markup present', /id="boot-splash"/.test(html)],
  ['splash visible by default (no hidden class)', !/id="boot-splash"[^>]*class="[^"]*hidden/.test(html)],
  ['inline splash CSS (works before stylesheet)', /#boot-splash \{[^}]*position:\s*fixed/.test(html)],
  ['guard script before module', html.indexOf('boot-guard.js') < html.indexOf('type="module"')],
  ['guard is a classic script (not module)', /<script src="\/boot-guard\.js"><\/script>/.test(html)],
  ['module bundle referenced', /<script type="module" src="\/app\.js"><\/script>/.test(html)],
  ['stylesheet referenced', /href="\/styles\.css"/.test(html)],
  ['no leftover <base> tag', !/<base\s/.test(html)],
  ['favicons do not block the app (rel=icon only)', !/rel="icon"[^>]*media="print"/.test(html)],
  ['boot guard file was emitted', fs.existsSync(path.join(process.cwd(), 'dist', 'boot-guard.js'))],
  ['bundle was emitted', fs.existsSync(path.join(process.cwd(), 'dist', 'app.js'))],
  ['stylesheet was emitted', fs.existsSync(path.join(process.cwd(), 'dist', 'styles.css'))],
];

// The bundle must stay within the syntax level old Android WebViews can parse.
// A SyntaxError there produces exactly the black screen this file guards against.
try {
  const esbuild = await import('esbuild');
  const src = fs.readFileSync(path.join(process.cwd(), 'dist', 'app.js'), 'utf8');
  await esbuild.transform(src, { target: 'es2019' });
  checks.push(['bundle parses as ES2019 (old WebView safe)', true]);
} catch (e) {
  checks.push(['bundle parses as ES2019 (old WebView safe)', false]);
  console.log('    es2019 violation:', String(e.message || e).split('\n')[0]);
}

// ---------------------------------------------------------------- module scope
// The 1.0.2 "TypeError: Invalid URL" crash happened at MODULE SCOPE: DRACOLoader
// evaluated `new URL(path, import.meta.url)` where import.meta had been lowered
// to an empty object, so the entire bundle died before any UI existed. Grepping
// for the pattern is not enough — evaluate the bundle and see what it throws.
// The VM has no GPU, so a WebGL error is an acceptable stop; anything else is not.
const appSrc = fs.readFileSync(path.join(process.cwd(), 'dist', 'app.js'), 'utf8');
const scopeError = (() => {
  const el = (id) => ({
    id, style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return true; } },
    setAttribute() {}, getAttribute() { return null; }, appendChild() {}, remove() {},
    addEventListener() {}, removeEventListener() {},
    querySelector() { return el('x'); }, querySelectorAll() { return []; },
    getContext() { return null; }, width: 100, height: 100,
    innerHTML: '', textContent: '', offsetParent: null,
  });
  const document = {
    body: el('body'), documentElement: el('html'),
    getElementById: (id) => el(id), createElement: () => el('new'),
    querySelector: () => el('q'), querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}, exitPointerLock() {},
  };
  const win = {
    document, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    location: { href: 'http://127.0.0.1:1/index.html', origin: 'http://127.0.0.1:1', search: '', reload() {} },
    navigator: { userAgent: 'check', mediaDevices: { getUserMedia: async () => { throw new Error('no media'); } } },
    addEventListener() {}, removeEventListener() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    performance: { now: () => 0 },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    indexedDB: { open: () => ({}) },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    URL, URLSearchParams,
    Blob: class {}, Worker: class {},
    fetch: async () => { throw new Error('no network'); },
    AudioContext: class { constructor() { throw new Error('no audio'); } },
    RTCPeerConnection: class {}, WebSocket: class {},
  };
  win.window = win; win.self = win; win.globalThis = win;
  try {
    vm.runInContext(appSrc, vm.createContext(win), { filename: 'app.js', timeout: 20000 });
    return null;
  } catch (e) {
    return e;
  }
})();
{
  const msg = scopeError ? String(scopeError.message || scopeError) : '';
  // A VM has no GPU, so a *handled* WebGL abort is the expected stopping point.
  // It only counts as handled if the bundle raised BootAbort (meaning it already
  // showed the player a readable card). Anything else is an unhandled crash.
  const handled = !!(scopeError && scopeError.__bootAborted);
  const onlyGpu = /webgl|context|creating webgl/i.test(msg);
  checks.push([
    'bundle reaches module scope without an unhandled crash',
    !scopeError || (handled && onlyGpu),
  ]);
  if (scopeError && !(handled && onlyGpu)) {
    console.log('    unhandled module-scope crash:', (msg || String(scopeError)).slice(0, 140));
  }
}

// the guard must be ES5-safe: an old WebView that cannot parse it would be the
// same black screen all over again
const guard = fs.readFileSync(path.join(process.cwd(), 'dist', 'boot-guard.js'), 'utf8');
for (const [label, re] of [
  ['guard has no arrow functions', /=>/],
  ['guard has no const/let', /\b(const|let)\s/],
  ['guard has no template literals', /`/],
  ['guard has no spread', /\.\.\./],
]) checks.push([label, !re.test(guard)]);
let fails = 0;
for (const [name, ok] of checks) {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name);
  if (!ok) fails++;
}
console.log(fails ? `\n${fails} FAILURE(S)\n` : '\nHTML CONTRACT OK\n');
process.exit(fails ? 1 : 0);
