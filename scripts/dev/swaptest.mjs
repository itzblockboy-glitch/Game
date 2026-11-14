import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const b = await puppeteer.launch({
  executablePath: '/tmp/chromium', headless: 'shell',
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--window-size=1100,700'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:/tmp/swiftshader' }, protocolTimeout: 240000,
});
const p = await b.newPage();
await p.setViewport({ width: 1100, height: 700 });
const logs = [];
p.on('pageerror', e => logs.push('[err] ' + e.message));
p.on('console', m => { if (m.type() === 'error') logs.push('[console] ' + m.text()); });
await p.goto('http://localhost:3000/?room=SWAPTEST&name=Tester', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 14000));
// check auto-join from URL
const joined = await p.evaluate(() => ({ started: window.__game.state.started, room: window.__game.network.room, menu: !document.querySelector('#menu').classList.contains('hidden') }));
// hot-swap the police car with the (real, downloaded) cesium milk truck glb
const buf = fs.readFileSync('public/models/cesium_truck.glb').toString('base64');
const swapped = await p.evaluate(async (b64) => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const { hotSwap } = await import('/app.js').then(m => m).catch(() => ({}));
  return { moduleExports: !!hotSwap };
}, buf);
// use the game's internal hook instead
const res = await p.evaluate(async (b64) => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const before = window.__game.vehicles.filter(v => v.id === 'police_car').length;
  try {
    await window.__hotswap('police_car', arr.buffer);
    return { ok: true, before };
  } catch (e) { return { ok: false, err: e.message, before }; }
}, buf);
await new Promise(r => setTimeout(r, 2000));
await p.screenshot({ path: '/tmp/swaptest.png' });
console.log(JSON.stringify({ joined, res, logs }, null, 1));
await b.close();
