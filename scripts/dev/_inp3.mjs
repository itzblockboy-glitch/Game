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
const res = await page.evaluate(() => {
  const g = window.__game, p = g.player;
  const wrap = document.getElementById('chat-input-wrap');
  const info = { wrapExists: !!wrap, wrapClass: wrap?.className, visible: wrap ? wrap.offsetParent !== null : null };
  let got = null;
  window.addEventListener('keydown', (e) => { got = e.code; }, { once: true });
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
  info.windowSaw = got;
  const a = [p.position.x, p.position.z];
  g.step(16.7, 30);
  info.moved = +Math.hypot(p.position.x - a[0], p.position.z - a[1]).toFixed(2);
  info.state = p.moveState; info.y = +p.position.y.toFixed(2);
  return info;
});
console.log(JSON.stringify(res));
await browser.close();
