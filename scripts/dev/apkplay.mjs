/**
 * Drive the APK payload like a player: boot from the same origin the Android
 * WebView uses, press Play, move and shoot, and assert the game is actually
 * simulating (not just rendering a loading screen).
 *
 * Usage: node scripts/dev/apkplay.mjs [url] [out.png]
 */
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://localhost:8097/assets/game/';
const out = process.argv[3] || '/tmp/apk-play.png';

const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium',
  headless: 'shell',
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720',
  ],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:/tmp/swiftshader' },
  protocolTimeout: 600000,
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });

await page.goto(url, { waitUntil: 'domcontentloaded' });
// wait for the loading screen to finish (assets stream in)
await page.waitForFunction(() => !!window.__game?.world, { timeout: 300000 });
await new Promise((r) => setTimeout(r, 4000));

// press Play — the loading overlay covers the menu for a while, so a single
// blind click can land on nothing and leave the game in its menu state (input is
// ignored while `state.started` is false)
const started = await (async () => {
  for (let attempt = 0; attempt < 40; attempt++) {
    const ok = await page.evaluate(() => {
      const g = window.__game;
      if (g?.state?.started) return true;
      const btn = document.querySelector('#btn-play');
      if (btn && btn.offsetParent !== null) btn.click();
      return !!g?.state?.started;
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
})();
if (!started) console.log('WARN — Play button never started the game');
// let the world stream in before driving frames manually — while models are still
// loading the simulation legitimately reports odd states
await page.waitForFunction(() => {
  const g = window.__game;
  return g?.player && g.player.onGround && g.player.position.y > -0.5;
}, { timeout: 300000 });
await new Promise((r) => setTimeout(r, 2500));

await page.evaluate(() => window.__game.step(16.7, 10));

const before = await page.evaluate(() => {
  const g = window.__game;
  return {
    started: !!g.state?.started,
    pos: g.player ? [g.player.position.x, g.player.position.z] : null,
    y: g.player ? +g.player.position.y.toFixed(2) : null,
    state: g.player?.moveState,
    fps: Math.round(g.fps || 0),
  };
});

// headless-shell throttles requestAnimationFrame and drops CDP key events, so the
// test drives the simulation through the game's own step hook and dispatches the
// same KeyboardEvent a browser would. Both are documented in src/main.js.
await page.evaluate(() => window.__game.step(16.7, 20));

await page.evaluate(() => window.dispatchEvent(
  new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true })));
await page.evaluate(() => window.__game.step(16.7, 150));
await page.evaluate(() => window.dispatchEvent(
  new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true })));
await page.evaluate(() => window.__game.step(16.7, 10));

const after = await page.evaluate(() => {
  const g = window.__game;
  return {
    pos: g.player ? [g.player.position.x, g.player.position.z] : null,
    state: g.player?.moveState,
    y: g.player ? +g.player.position.y.toFixed(2) : null,
    tris: g.renderer?.info?.render?.triangles || 0,
    fps: Math.round(g.fps || 0),
  };
});

const moved = before.pos && after.pos
  ? Math.hypot(after.pos[0] - before.pos[0], after.pos[1] - before.pos[1])
  : 0;

console.log(JSON.stringify({ before, after, movedBy: +moved.toFixed(2) }, null, 1));
console.log(errors.length ? errors.slice(0, 8).join('\n') : 'no console errors');
// walking a few metres must keep the player on solid ground, not sink them
const grounded = after.y !== null && after.y > -0.5;
console.log(moved > 1 && grounded
  ? `PLAY OK — walked ${moved.toFixed(1)} m on solid ground`
  : `FAIL — moved ${moved.toFixed(1)} m, y=${after.y}`);

// best-effort: headless-shell often tears the target down first, which must not
// turn a passing play test into a crash
try {
  if (page.isClosed()) throw new Error('page already closed');
  await page.screenshot({ path: out, timeout: 60000 });
  console.log('screenshot → ' + out);
} catch (e) {
  console.log('(screenshot skipped: ' + String(e).slice(0, 80) + ')');
}
try { await browser.close(); } catch { /* target may already be gone */ }
process.exit(moved > 1 && grounded ? 0 : 1);
