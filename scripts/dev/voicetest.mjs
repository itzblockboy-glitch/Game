import puppeteer from 'puppeteer-core';
const launch = async (name) => {
  const b = await puppeteer.launch({
    executablePath: '/tmp/chromium', headless: 'shell',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader',
      '--enable-unsafe-swiftshader','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required','--window-size=900,600'],
    env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:/tmp/swiftshader' }, protocolTimeout: 240000,
  });
  const p = await b.newPage();
  await p.setViewport({ width: 900, height: 600 });
  p.on('pageerror', e => console.log(name, '[err]', e.message));
  await p.goto('http://localhost:3000/?room=VOICE1&name=' + name, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 13000));
  return { b, p };
};
const A = await launch('Anna');
const B = await launch('Ben');
const enable = (p) => p.evaluate(async () => {
  const g = window.__game;
  const ok = await g.voice.enable();
  return { ok, enabled: g.voice.enabled, peers: g.voice.peers.size };
});
console.log('A enable', JSON.stringify(await enable(A.p)));
await new Promise(r => setTimeout(r, 2500));
console.log('B enable', JSON.stringify(await enable(B.p)));
await new Promise(r => setTimeout(r, 9000));
const state = (p) => p.evaluate(() => {
  const v = window.__game.voice;
  return {
    peers: v.peers.size,
    states: [...v.peers.values()].map(pe => pe.pc.connectionState),
    iceStates: [...v.peers.values()].map(pe => pe.pc.iceConnectionState),
    hasLocalStream: !!v.localStream,
    tracks: v.localStream ? v.localStream.getAudioTracks().length : 0,
    speaking: v.speaking,
    vadThreshold: v.vadThreshold,
  };
});
console.log('A', JSON.stringify(await state(A.p)));
console.log('B', JSON.stringify(await state(B.p)));
await A.p.screenshot({ path: '/tmp/voice.png' });
await A.b.close(); await B.b.close();
