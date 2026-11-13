import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/tmp/chromium', headless: 'shell',
  args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:/tmp/swiftshader' }, protocolTimeout: 240000 });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 720 });
await p.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 8000));
await p.evaluate(() => document.querySelector('#btn-assets')?.click());
await new Promise(r => setTimeout(r, 2000));
await p.screenshot({ path: '/tmp/s_hub2.png' });
await b.close();
