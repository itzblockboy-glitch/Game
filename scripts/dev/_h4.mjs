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
// try several settle delays, report which ones explode
for (const settle of [0, 500, 1500, 3000, 5000]) {
  const r = await page.evaluate(async (settle) => {
    const g = window.__game, p = g.player;
    p.reset(new (g.player.position.constructor)(6, 0.05, 26), Math.PI);
    g.step(16.7, 3);
    await new Promise(r => setTimeout(r, settle));
    window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyW', key:'w', bubbles:true}));
    g.step(16.7, 10);
    window.dispatchEvent(new KeyboardEvent('keyup', {code:'KeyW', key:'w', bubbles:true}));
    return { settle, pos: [+p.position.x.toFixed(1), +p.position.y.toFixed(2), +p.position.z.toFixed(1)],
             vel: [+p.velocity.x.toFixed(1), +p.velocity.y.toFixed(1), +p.velocity.z.toFixed(1)],
             fps: Math.round(g.fps), loading: document.querySelector('#loading')?.offsetParent !== null };
  }, settle);
  console.log(JSON.stringify(r));
}
await browser.close();
