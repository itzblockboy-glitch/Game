/**
 * Loads the game exactly as the Android APK does — from
 * /assets/game/index.html on a remote origin — and reports whether the world,
 * models and render loop came up without console errors.
 *
 * Usage: node scripts/dev/apkurl.mjs http://localhost:8098/assets/game/ /tmp/out.png
 */
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://localhost:8098/assets/game/';
const out = process.argv[3] || '/tmp/android-origin.png';
const wait = Number(process.argv[4] || 14000);

const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium',
  headless: 'shell',
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720',
  ],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:/tmp/swiftshader' },
  protocolTimeout: 240000,
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });

await page.goto(url, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, wait));

const state = await page.evaluate(() => ({
  world: !!window.__game?.world,
  player: !!window.__game?.player,
  tris: window.__game?.renderer?.info?.render?.triangles || 0,
  fps: Math.round(window.__game?.stats?.fps || window.__game?.fps || 0),
}));
console.log(JSON.stringify(state));
console.log(errors.length ? errors.slice(0, 10).join('\n') : 'no console errors');
await page.screenshot({ path: out });
await browser.close();
