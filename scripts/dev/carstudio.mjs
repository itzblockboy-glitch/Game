import puppeteer from 'puppeteer-core';
const out = process.argv[2] || '/tmp/studio';
const ids = (process.argv[3] || 'ferrari_daytona_sp3,kawasaki_ninja_h2,redbull_rb22').split(',');
const b = await puppeteer.launch({ executablePath: '/tmp/chromium', headless: 'shell',
  args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--window-size=1000,600'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:/tmp/swiftshader' }, protocolTimeout: 300000 });
const p = await b.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.setViewport({ width: 1000, height: 600 });
await p.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 9000));
await p.evaluate(() => document.querySelector('#btn-play')?.click());
await new Promise(r => setTimeout(r, 3000));
for (const id of ids) {
  const ok = await p.evaluate((carId) => {
    const g = window.__game, T = window.__three;
    const v = g.vehicles.find(x => x.modelId === carId) || g.vehicles[0];
    // studio: neutral backdrop + camera orbit around the chosen vehicle
    g.scene.fog.density = 0.0002;
    g.world.setTimeOfDay(13.2);
    const pos = v.position.clone();
    v.place(pos, 0);
    const c = g.camera;
    c.position.set(pos.x + 4.6, pos.y + 2.0, pos.z + 5.4);
    c.lookAt(pos.x, pos.y + 0.65, pos.z);
    g.state.freeCamera = true;
    window.__studio = { pos };
    return !!v;
  }, id);
  await new Promise(r => setTimeout(r, 1200));
  await p.screenshot({ path: `${out}_${id}.png` });
  console.log(id, ok);
}
console.log('errs', errs.slice(0,4));
await b.close();
