import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium', headless: 'shell',
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--window-size=640,360'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:/tmp/swiftshader' }, protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__game?.world, { timeout: 300000 });
await page.waitForFunction(() => { const b=document.querySelector('#btn-play'); return b && b.offsetParent!==null; }, { timeout: 300000 });
await page.evaluate(() => document.querySelector('#btn-play').click());
await page.waitForFunction(() => window.__game?.state?.started === true, { timeout: 300000 });
await new Promise(r => setTimeout(r, 3000));
const r = await page.evaluate(async () => {
  const g = window.__game, p = g.player;
  const rows = [];
  window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyW', key:'w', bubbles:true}));
  for (let i = 0; i < 40; i++) {
    g.step(16.7, 5);
    rows.push([+p.position.x.toFixed(1), +p.position.y.toFixed(2), +p.position.z.toFixed(1),
               +p.velocity.y.toFixed(2), p.onGround, p.moveState]);
    await new Promise(r => setTimeout(r, 0));
    if (p.position.y < -0.5) break; // stop at the first sign of sinking
  }
  window.dispatchEvent(new KeyboardEvent('keyup', {code:'KeyW', key:'w', bubbles:true}));
  return rows;
});
console.log(JSON.stringify(r));
await browser.close();
