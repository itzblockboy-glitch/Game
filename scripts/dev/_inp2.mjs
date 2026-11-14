import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium', headless: 'shell',
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
    '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:/tmp/swiftshader' },
  protocolTimeout: 300000,
});
const page = await browser.newPage();
await page.goto('http://localhost:8097/assets/game/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__game?.world, { timeout: 300000 });
await new Promise(r => setTimeout(r, 4000));
await page.evaluate(() => document.querySelector('#btn-play')?.click());
await page.waitForFunction(() => { const g = window.__game; return g?.player && g.player.onGround; }, { timeout: 300000 });
await new Promise(r => setTimeout(r, 2000));
const res = await page.evaluate(() => {
  const g = window.__game;
  const chat = document.querySelector('#chat-wrap') || document.querySelector('[class*=chat]');
  return {
    chatClass: chat ? chat.className : 'none',
    chatHidden: chat ? chat.classList.contains('hidden') : null,
    chatVisible: chat ? chat.offsetParent !== null : null,
    focused: document.activeElement?.tagName + '#' + (document.activeElement?.id || ''),
    hasInput: !!g.input,
  };
});
console.log(JSON.stringify(res));
await browser.close();
