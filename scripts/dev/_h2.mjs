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
await new Promise(r => setTimeout(r, 4000));
const r = await page.evaluate(() => {
  const g = window.__game, p = g.player;
  g.step(16.7, 5);
  const before = [p.position.x, p.y, p.position.y, p.position.z, p.velocity.x, p.velocity.z];
  // monkey-patch to catch the writer
  let culprit = null;
  const origResolve = g.world.resolveCollision.bind(g.world);
  g.world.resolveCollision = (pos, r) => {
    const bx = p.position.x;
    const res = origResolve(pos, r);
    if (Math.abs(p.position.x - bx) > 5) culprit = 'resolveCollision ' + JSON.stringify([+bx.toFixed(1), +p.position.x.toFixed(1)]);
    return res;
  };
  g.step(16.7, 10);
  return { before, after: [+p.position.x.toFixed(1), +p.position.z.toFixed(1)], culprit };
});
console.log(JSON.stringify(r));
await browser.close();
