// Ghost readability probe: stage a race with the recorded ghost ahead of the player; measure.
// node ghost.mjs <outdir> [spot=fly] [tods]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const out = process.argv[2] ?? 'shots';
const spot = process.argv[3] ?? 'fly';
const tods = (process.argv[4] ?? '0.55,0.72').split(',').map(Number);
const race = process.env.RACE ?? 'roost-loop';
const t = process.env.T ?? '20';
const lag = process.env.LAG ?? '0.6';
fs.mkdirSync(out, { recursive: true });
const [w, h] = (process.env.SIZE ?? '960x540').split('x').map(Number);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
page.setDefaultTimeout(600000);
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push(e.message));
await page.goto(`http://localhost:5402/?manual=1&quality=high&play=1&view=race&race=${race}&spot=${spot}&t=${t}&tod=${tods[0]}&lag=${lag}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__dw?.ready === true, null, { timeout: 600000 });
if (process.env.NOUI) await page.evaluate(() => (document.getElementById('ui').style.display = 'none'));
if (process.env.BASELINE) await page.evaluate(() => (window.__BASELINE = true));
if (process.env.CAMDIST) await page.evaluate((d) => (window.__CAMDIST = d), Number(process.env.CAMDIST));
for (const tod of tods) {
  const r = await page.evaluate((tod) => {
    const g = window.__dw.game;
    g.debug.tod = tod;
    if (window.__BASELINE) {
      const rg = g.races.ghost;
      window.__dw.advance(0.05);
      rg.wyvern.skinnedMesh.material = rg.wyvern.materials;
      rg.depthMesh.visible = false;
      rg.streamers.mesh.visible = false;
    }
    window.__dw.advance(0.15);
    const camDist = window.__CAMDIST;
    if (camDist) {
      const gw = g.races.ghost.wyvern.group;
      const V = gw.position.constructor;
      const q = gw.quaternion;
      const fwd = new V(0, 0, 1).applyQuaternion(q).setY(0).normalize();
      const side = new V(fwd.z, 0, -fwd.x);
      const pos = gw.position.clone().addScaledVector(fwd, -camDist).addScaledVector(side, camDist * 0.3).add(new V(0, camDist * 0.12, 0));
      g.cameraRig.setOverride({ position: pos, target: gw.position.clone() });
      window.__dw.advance(1 / 60);
    }
    const canvas = g.renderer.canvas;
    const grab = () => {
      window.__dw.render();
      const c2 = document.createElement('canvas');
      c2.width = canvas.width; c2.height = canvas.height;
      const ctx = c2.getContext('2d');
      ctx.drawImage(canvas, 0, 0);
      return ctx.getImageData(0, 0, c2.width, c2.height);
    };
    const ghost = g.races.ghost.group;
    const a = grab();
    ghost.visible = false;
    const b = grab();
    ghost.visible = true;
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = (img, i) => 0.2126 * lin(img.data[i]) + 0.7152 * lin(img.data[i + 1]) + 0.0722 * lin(img.data[i + 2]);
    const ratios = [];
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let y = 0; y < a.height; y += 1) for (let x = 0; x < a.width; x += 1) {
      const i = (y * a.width + x) * 4;
      if (a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2]) continue;
      const l1 = L(a, i), l2 = L(b, i);
      const r = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      if (r < 1.02) continue;
      ratios.push(r);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    ratios.sort((p, q) => p - q);
    const pct = (p) => ratios.length ? ratios[Math.floor(p * (ratios.length - 1))] : 1;
    const strong = ratios.filter((r) => r > 1.3).length;
    const gp = g.races.ghost.wyvern?.group.position;
    const dist = gp ? gp.distanceTo(g.camera.position) : null;
    const sp = gp.clone().project(g.camera);
    const screen = [Math.round((sp.x * 0.5 + 0.5) * canvas.width), Math.round((0.5 - sp.y * 0.5) * canvas.height)];
    const up = new gp.constructor(0, 1, 0).applyQuaternion(g.races.ghost.wyvern.group.quaternion);
    return { px: ratios.length, strong, p50: pct(0.5), p90: pct(0.9), bbox: [minX, minY, maxX, maxY], dist, screen, bankUpY: up.y };
  }, tod);
  await page.evaluate(() => window.__dw.render());
  const name = `${race}_${spot}_t${tod}_d${process.env.CAMDIST ?? 0}`;
  await page.screenshot({ path: path.join(out, name + '.png') });
  console.log(name, JSON.stringify(r));
}
console.log('errors', logs.slice(0, 5));
await browser.close();
