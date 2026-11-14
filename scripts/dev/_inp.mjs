import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium', headless: 'shell',
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
    '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:/tmp/swiftshader' },
  protocolTimeout: 300000,
});
const page = await browser.newPage();
await page.goto('http://localhost:8097/assets/game/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__game?.world, { timeout: 300000 });
await new Promise(r => setTimeout(r, 4000));
await page.evaluate(() => document.querySelector('#btn-play')?.click());
await page.waitForFunction(() => { const g = window.__game; return g?.player && g.player.onGround; }, { timeout: 300000 });
await new Promise(r => setTimeout(r, 2000));
const res = await page.evaluate(async () => {
  const g = window.__game, p = g.player;
  const out = { keys: Object.keys(g), keysBefore: [...(g.input?.keys || [])] };
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
  out.keysAfter = [...(g.input?.keys || [])];
  const a = [p.position.x, p.position.z, p.position.y];
  g.step(16.7, 30);
  out.moved = +Math.hypot(p.position.x - a[0], p.position.z - a[1]).toFixed(2);
  out.y = +p.position.y.toFixed(2);
  out.state = p.moveState;
  out.surface = p._surface;
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true }));
  return out;
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
