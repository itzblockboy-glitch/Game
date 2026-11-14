/**
 * Verify the *APK's own asset bundle* boots: loads the extracted assets/ tree from
 * file:// exactly like the Android WebView does, and reports console errors
 * (CORS/NotAllowedError on file://) plus whether the game reached the world.
 *
 * Usage: node scripts/dev/apktest.mjs /tmp/apkassets
 */
import puppeteer from 'puppeteer-core';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || '/tmp/apkassets');
const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium',
  headless: 'shell',
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720', '--allow-file-access-from-files',
  ],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:/tmp/swiftshader' },
  protocolTimeout: 240000,
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 240)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 240)); });

await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 12000));

const state = await page.evaluate(() => ({
  hasGame: !!window.__game?.world,
  player: !!window.__game?.player,
  fps: Math.round(window.__game?.fps || 0),
  tris: window.__game?.renderer?.info?.render?.triangles || 0,
  models: window.__game?.assets?.loadedCount ?? null,
  loading: document.querySelector('#loading')?.style.display,
}));
console.log(JSON.stringify(state));
console.log(errors.length ? errors.slice(0, 12).join('\n') : 'no console errors');

await page.screenshot({ path: '/tmp/apkfile.png' });
await browser.close();
