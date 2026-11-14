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
  const log = [];
  const origUpdate = p.update.bind(p);
  let call = 0;
  p.update = function (dt, input, world) {
    const x0 = p.position.x;
    origUpdate(dt, input, world);
    const d = Math.abs(p.position.x - x0);
    if (d > 5) log.push(['p.update', call, +d.toFixed(1), +dt.toFixed(4), JSON.stringify(input), +x0.toFixed(1), +p.position.x.toFixed(1)]);
    call++;
  };
  g.step(16.7, 10);
  return { log, after: [+p.position.x.toFixed(1), +p.position.z.toFixed(1)] };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
