import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(600000);
await page.goto(`http://localhost:5402/?manual=1&quality=high&play=1&view=race&race=roost-loop&spot=ghost&t=20&tod=0.55`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__dw?.ready === true, null, { timeout: 600000 });
await page.evaluate(() => { document.getElementById('ui').style.display = 'none'; });
const dist = Number(process.env.D ?? 15);
const info = await page.evaluate((dist) => {
  const g = window.__dw.game;
  window.__dw.advance(0.2);
  const rg = g.races.ghost;
  const gw = rg.wyvern.group;
  const V = gw.position.constructor;
  const fwd = new V(0, 0, 1).applyQuaternion(gw.quaternion).setY(0).normalize();
  const side = new V(fwd.z, 0, -fwd.x);
  g.cameraRig.setOverride({ position: gw.position.clone().addScaledVector(fwd, -dist).addScaledVector(side, dist * 0.4).add(new V(0, dist * 0.2, 0)), target: gw.position.clone() });
  window.__dw.advance(1 / 60);
  window.__dw.render();
  const m = rg.wyvern.skinnedMesh;
  m.geometry.computeBoundingBox();
  return { scale: gw.scale.toArray(), bb: m.geometry.boundingBox, camDist: g.camera.position.distanceTo(gw.position), fov: g.camera.fov, wingspan: rg.wyvern.rigDef.props.wingspan };
}, dist);
console.log(JSON.stringify(info));
await page.screenshot({ path: `shots/ghostdbg-mine-${dist}.png` });
await page.evaluate(() => {
  const g = window.__dw.game; const rg = g.races.ghost;
  rg.wyvern.skinnedMesh.material = rg.wyvern.materials; rg.depthMesh.visible = false; window.__dw.render();
});
await page.screenshot({ path: `shots/ghostdbg-theirs-${dist}.png` });
await page.evaluate(async () => {
  const g = window.__dw.game; const rg = g.races.ghost;
  const THREE = await import('/node_modules/.vite/deps/three.js').catch(() => null);
  const M = g.wyvern.skinnedMesh.material; // the player's own materials
  rg.wyvern.skinnedMesh.material = M; window.__dw.render();
});
await page.screenshot({ path: `shots/ghostdbg-solid-${dist}.png` });
await browser.close();
