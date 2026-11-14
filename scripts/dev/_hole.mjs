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
const r = await page.evaluate(async () => {
  const g = window.__game, p = g.player;
  const out = { final: null, path: [] };
  // walk exactly like apkplay and record y
  window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyW', key:'w', bubbles:true}));
  g.step(16.7, 5);
  let prev = p.position.clone();
  for (let i = 0; i < 40; i++) {
    g.step(16.7, 10);
    const d = p.position.distanceTo(prev);
    if (d > 3) {
      out.jump = { from: [+prev.x.toFixed(2), +prev.y.toFixed(2), +prev.z.toFixed(2)],
                   to: [+p.position.x.toFixed(2), +p.position.y.toFixed(2), +p.position.z.toFixed(2)],
                   dist: +d.toFixed(2), inVehicle: g.state.inVehicle,
                   car: g.vehicles.filter(v => v.position.distanceTo(p.position) < 8).map(v => [v.id, +v.position.x.toFixed(1), +v.position.z.toFixed(1), +v.speed.toFixed(1)]) };
      break;
    }
    prev.copy(p.position);
    if (i % 10 === 0) out.path.push([+p.position.x.toFixed(1), +p.position.y.toFixed(2), +p.position.z.toFixed(1)]);
    await new Promise(r => setTimeout(r, 0));
  }
  window.dispatchEvent(new KeyboardEvent('keyup', {code:'KeyW', key:'w', bubbles:true}));
  out.final = [+p.position.x.toFixed(1), +p.position.y.toFixed(2), +p.position.z.toFixed(1)];
  return out;
});
console.log(JSON.stringify(r));
await browser.close();
