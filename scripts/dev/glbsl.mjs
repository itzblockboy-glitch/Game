/**
 * Fast standalone GLB turntable: loads public/models/<id>.glb into a neutral studio
 * (PMREM softbox env, key/fill lights, shadow floor) and shoots N angles.
 *   node scripts/dev/glbsl.mjs ferrari_daytona_sp3 /tmp/car
 */
import puppeteer from 'puppeteer-core';
const id = process.argv[2] || 'ferrari_daytona_sp3';
const out = process.argv[3] || '/tmp/car';
const angles = (process.argv[4] || '0.8,1.57,2.6,-0.8').split(',').map(Number);
const b = await puppeteer.launch({
  executablePath: '/tmp/chromium', headless: 'shell',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:/tmp/swiftshader' },
  protocolTimeout: 120000,
});
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.setViewport({ width: 1000, height: 620 });
await p.goto(`http://localhost:3000/dev/?m=/models/${id}.glb`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__ready === true || window.__err', { timeout: 60000 });
const info = await p.evaluate(() => window.__info || window.__err);
let i = 0;
for (const az of angles) {
  await p.evaluate((az) => window.__aim(az, 0.22, undefined, undefined), az);
  await new Promise((r) => setTimeout(r, 500));
  await p.screenshot({ path: `${out}_${i++}.png` });
}
console.log(id, JSON.stringify(info), 'errors', errs.slice(0, 2));
await b.close();
