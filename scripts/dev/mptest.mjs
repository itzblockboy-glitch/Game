import puppeteer from 'puppeteer-core';
const launch = () => puppeteer.launch({
  executablePath: '/tmp/chromium', headless: 'shell',
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--window-size=1024,640'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:/tmp/swiftshader' }, protocolTimeout: 240000,
});
const join = async (name, room) => {
  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 1024, height: 640 });
  await p.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 12000));
  await p.evaluate((n, r) => {
    document.querySelector('#input-name').value = n;
    document.querySelector('#input-room').value = r;
    document.querySelector('#btn-multi').click();
  }, name, room);
  return { b, p };
};
const A = await join('Lucia', 'FRIENDS');
await new Promise(r => setTimeout(r, 4000));
const B = await join('Marcus', 'FRIENDS');
await new Promise(r => setTimeout(r, 9000));
// A moves toward B
await B.p.evaluate(() => window.__tp(-40, 40, Math.PI));
await A.p.evaluate(() => window.__tp(-40, 20, Math.PI));
await new Promise(r => setTimeout(r, 4000));
const stats = async (p) => p.evaluate(() => {
  const g = window.__game;
  return { myId: g.network.myId, connected: g.network.connected, players: g.network.players.size,
    names: [...g.network.players.values()].map(v => v.name),
    latency: g.network.latency, bytesOut: g.network.bytesOut, bytesIn: g.network.bytesIn };
});
console.log('A', JSON.stringify(await stats(A.p)));
console.log('B', JSON.stringify(await stats(B.p)));
await A.p.screenshot({ path: '/tmp/mp_A.png' });
await B.b.close(); await A.b.close();
