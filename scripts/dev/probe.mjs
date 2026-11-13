import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium', headless: 'shell',
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--window-size=1280,720'],
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib:/tmp/swiftshader' }, protocolTimeout: 180000,
});
const page = await browser.newPage();
await page.setViewport({width:1280,height:720});
await page.goto('http://localhost:3000/', {waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,9000));
await page.evaluate(()=>document.querySelector('#btn-play')?.click());
await new Promise(r=>setTimeout(r,1500));
await page.evaluate(()=>window.__view('skyline'));
await new Promise(r=>setTimeout(r,2500));
const info = await page.evaluate(async ()=>{
  const g = window.__game;
  const THREE = await import('/app.js').then(()=>null).catch(()=>null);
  const { scene, camera } = g;
  // raycast centre of screen
  const rc = new (window.__THREE?.Raycaster || Object)();
  const hits = [];
  scene.traverse((o) => { if (o.isMesh) hits.push(o); });
  // pick the facade meshes and report texture state
  const facades = hits.filter(h => h.material?.name === 'facade' || h.material?.name === 'glasstower');
  return {
    facadeMeshes: facades.length,
    sample: facades.slice(0,3).map(h => ({
      mat: h.material.name,
      hasMap: !!h.material.map,
      imgW: h.material.map?.image?.width,
      repeat: h.material.map ? [h.material.map.repeat.x, h.material.map.repeat.y] : null,
      uvCount: h.geometry.attributes.uv?.count,
      uvSample: h.geometry.attributes.uv ? [h.geometry.attributes.uv.getX(0), h.geometry.attributes.uv.getY(0)] : null,
      verts: h.geometry.attributes.position.count,
    })),
  };
});
console.log(JSON.stringify(info,null,1));
await browser.close();
