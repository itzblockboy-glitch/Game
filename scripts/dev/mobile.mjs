import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({
  executablePath: '/tmp/chromium', headless: 'shell',
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:/tmp/swiftshader' }, protocolTimeout: 240000,
});
const p = await b.newPage();
await p.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
await p.goto('http://localhost:3000/?room=MOBILE', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 15000));
await p.screenshot({ path: '/tmp/mobile1.png' });
const info = await p.evaluate(() => ({
  dpr: window.devicePixelRatio,
  canvas: [document.querySelector('canvas').width, document.querySelector('canvas').height],
  stick: !!document.querySelector('#stick')?.getBoundingClientRect().width,
  btns: document.querySelectorAll('.tbtn').length,
  touchDisplay: getComputedStyle(document.querySelector('#touch')).display,
  quality: window.__game.state.quality,
  tris: window.__game.renderer.info.render.triangles,
}));
console.log(JSON.stringify(info));
await b.close();
