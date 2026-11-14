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
