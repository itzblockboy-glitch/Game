/**
 * Model studio: loads the game, hides the city, drops a neutral floor + sky env and
 * orbits a single vehicle so vehicle art can be reviewed without the world around it.
 *   node scripts/dev/studio.mjs <modelId> <outPrefix> [w] [h]
 */
import puppeteer from 'puppeteer-core';
const modelId = process.argv[2] || 'ferrari_daytona_sp3';
const outPrefix = process.argv[3] || '/tmp/studio';
const W = Number(process.argv[4] || 1200), H = Number(process.argv[5] || 760);
const b = await puppeteer.launch({ executablePath: '/tmp/chromium', headless: 'shell',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:/tmp/swiftshader' }, protocolTimeout: 300000 });
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.setViewport({ width: W, height: H });
await p.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 9000));
await p.evaluate(() => document.querySelector('#btn-play')?.click());
await new Promise((r) => setTimeout(r, 2500));

await p.evaluate((id) => {
  const g = window.__game, T = window.__three;
  const v = g.vehicles.find((x) => x.modelId === id) || g.vehicles[0];
  // hide the world, keep the sky + env lighting
  g.scene.traverse((o) => {
    if (o.name && /^(city|map|chunk|buildings|roads|props|palm|tree)/i.test(o.name)) o.visible = false;
  });
  for (const o of g.scene.children) {
    if (o.name === 'mapRoot' || o === g.world.mapRoot) o.visible = false;
  }
  if (g.world.mapRoot) g.world.mapRoot.visible = false;
  g.scene.fog.density = 0.0004;
  g.state.freeCamera = true;
  // neutral studio floor
  const floor = new T.Mesh(new T.CircleGeometry(26, 64), new T.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.42, metalness: 0.1 }));
  floor.rotation.x = -Math.PI / 2;
  const base = v.position.clone();
  floor.position.set(base.x, base.y + 0.001, base.z);
  g.scene.add(floor);
  window.__studio = { v, floor, base, T, g };
}, modelId);

const shots = {
  front34: [5.4, 1.65, 6.2, 0.62],
  side: [8.2, 1.25, 0.2, 0.62],
  rear34: [-5.6, 1.8, -6.0, 0.62],
  front: [0.2, 1.35, 8.6, 0.6],
};
for (const [name, [dx, dy, dz, lookY]] of Object.entries(shots)) {
  await p.evaluate(([dx, dy, dz, lookY]) => {
    const { v, base, g } = window.__studio;
    v.place(base, 0);
    const c = g.camera;
    c.position.set(base.x + dx, base.y + dy, base.z + dz);
    c.lookAt(base.x, base.y + lookY, base.z);

  }, [dx, dy, dz, lookY]);
  await new Promise((r) => setTimeout(r, 1400));
  await p.screenshot({ path: `${outPrefix}_${name}.png` });
}
console.log('shots', Object.keys(shots).join(','), 'errors', errs.slice(0, 3));
await b.close();
