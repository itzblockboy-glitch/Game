import puppeteer from 'puppeteer-core';
const url = process.argv[2] || 'http://localhost:3000/';
const out = process.argv[3] || '/tmp/shot.png';
const waitMs = Number(process.argv[4] || 12000);
const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium',
  headless: 'shell',
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1280,720',
    '--disable-features=UseChromeOSDirectVideoDecoder',
  ],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:/tmp/swiftshader' },
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise((r) => setTimeout(r, waitMs));
const play = process.argv[5];
if (play) {
  await page.evaluate(() => { document.querySelector('#btn-play')?.click(); });
  await new Promise((r) => setTimeout(r, Number(play)));
}
const action = process.argv[8];
if (action === 'stunt') {
  await page.evaluate(() => { const b = [...document.querySelectorAll('*')].find(e => e.id === 'btn-map'); b?.click(); });
  await new Promise((r) => setTimeout(r, 9000));
}
if (action === 'hub') {
  await page.evaluate(() => document.querySelector('#btn-assets')?.click());
  await new Promise((r) => setTimeout(r, 900));
}
const quality = process.argv[7];
if (quality) await page.evaluate((q) => { const el = document.querySelector('#set-quality'); if (el) { el.value = q; el.dispatchEvent(new Event('input', { bubbles: true })); } }, quality);
const view = process.argv[6];
if (view) {
  const parts = view.split(':');
  if (parts[0] === 'tp') {
    await page.evaluate((a) => window.__tp(Number(a[1]), Number(a[2]), Number(a[3] || 0), { vehicle: a[4], time: a[5] ? Number(a[5]) : undefined }), parts);
  } else {
    await page.evaluate((v) => window.__view(v), view);
  }
  await new Promise((r) => setTimeout(r, 3500));
}
const info = await page.evaluate(() => {
  const g = window.__game;
  const gl = document.querySelector('canvas')?.getContext('webgl2');
  const q = (sel) => document.querySelector(sel);
  const vis = (sel) => { const e = q(sel); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { w: Math.round(r.width), h: Math.round(r.height), op: cs.opacity, disp: cs.display }; };
  let uiErr = null;
  try {
    if (window.__game?.ui) {
      window.__game.ui.showHUD(true);
      window.__game.ui.setVitals(88, 40);
      window.__game.ui.setAmmo('24 / 30');
      window.__game.ui.setFps(58);
      window.__game.ui.chat('Lucia', 'meet me at the pier');
      window.__game.ui.toast('Weapon equipped: AKMN', 'good');
      window.__game.ui.setVoicePeers([{ name: 'Lucia', speaking: true }, { name: 'Marcus', muted: true }]);
    }
  } catch (e) { uiErr = e.message; }
  return {
    webgl2: !!gl,
    uiErr,
    canvas: vis('canvas'),
    hud: vis('#hud'),
    minimap: vis('#minimap'),
    dataMeter: vis('#data-meter'),
    hpBar: q('#hp-fill')?.style.width,
    ammo: q('#amy')?.textContent,
    chatLines: document.querySelectorAll('.chat-line').length,
    voicePeers: document.querySelectorAll('.vp').length,
    glRenderer: gl ? gl.getParameter(gl.RENDERER) : null,
    hasGame: !!g,
    started: g?.state?.started,
    chunks: g?.world?.chunks?.length,
    visible: g?.world?.chunks?.filter((c) => c.mesh.visible).length,
    tris: g?.renderer?.info?.render?.triangles,
    calls: g?.renderer?.info?.render?.calls,
    playerPos: g?.player ? [+g.player.position.x.toFixed(1), +g.player.position.y.toFixed(1), +g.player.position.z.toFixed(1)] : null,
    vehicles: g?.vehicles?.length,
    loadingText: document.querySelector('#load-text')?.textContent,
    loadWidth: document.querySelector('#load-fill')?.style.width,
    menuVisible: !document.querySelector('#menu')?.classList.contains('hidden'),
    hasVignette: !!document.querySelector('#loading, #menu'),
  };
});
await page.screenshot({ path: out });
console.log(JSON.stringify(info, null, 1));
console.log('--- logs ---');
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
