// Ring + ghost readability probe: stages rings over the cloud sea and measures contrast.
// node rings.mjs <outdir> [quality] [shots=1]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'shots';
const quality = process.argv[3] ?? 'high';
const doShots = (process.argv[4] ?? '1') === '1';
const size = process.env.SIZE ?? '960x540';
fs.mkdirSync(out, { recursive: true });
const [w, h] = size.split('x').map(Number);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
page.setDefaultTimeout(600000);
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push(e.message));
await page.goto(`http://localhost:5402/?manual=1&quality=${quality}&play=1&view=race&race=roost-loop&spot=rings&ring=3&tod=0.42`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__dw?.ready === true, null, { timeout: 600000 });
if (process.env.NOUI) await page.evaluate(() => (document.getElementById('ui').style.display = 'none'));
await page.evaluate(() => window.__dw.advance(1.5));

const cases = (process.env.CASES ?? 'roost-loop:3,cascade-run:2,underspan:3,roost-loop:0,needle-slalom:2').split(',').map((c) => c.split(':'));
const tods = (process.env.TODS ?? '0.42,0.72').split(',').map(Number);
const results = [];
for (const tod of tods) {
  for (const [race, ring] of cases) {
    const r = await page.evaluate(async ([race, ring, tod]) => {
      const g = window.__dw.game;
      const V = g.player.position.constructor;
      g.debug.tod = tod;
      const def = g.races.defs.find((d) => d.id === race);
      const rd = def.rings[ring];
      const p = new V(...rd.position);
      const nn = new V(...rd.normal).normalize();
      const s2 = new V(nn.z, 0, -nn.x).normalize();
      g.cameraRig.setOverride({ position: p.clone().addScaledVector(nn, -70).addScaledVector(s2, 14).add(new V(0, 9, 0)), target: p.clone().addScaledVector(nn, 40) });
      g.races.debugStage(def.id, ring, 10000);
      window.__dw.advance(1.2);
      // Two frames, identical but for the race visuals.
      const cam = g.camera;
      const canvas = g.renderer.canvas;
      const grab = () => {
        window.__dw.render();
        const c2 = document.createElement('canvas');
        c2.width = canvas.width; c2.height = canvas.height;
        const ctx = c2.getContext('2d');
        ctx.drawImage(canvas, 0, 0);
        return ctx.getImageData(0, 0, c2.width, c2.height);
      };
      const group = g.races.visuals.group;
      const withRing = grab();
      group.visible = false;
      const without = grab();
      group.visible = true;
      const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      const lum = (img, x, y) => {
        let L = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(img.width - 1, Math.max(0, x + dx)), yy = Math.min(img.height - 1, Math.max(0, y + dy));
          const i = (yy * img.width + xx) * 4;
          L += 0.2126 * lin(img.data[i]) + 0.7152 * lin(img.data[i + 1]) + 0.0722 * lin(img.data[i + 2]);
          n++;
        }
        return L / n;
      };
      const tube = Math.max(0.9, rd.radius * 0.09);
      const R = rd.radius + tube;
      const up = Math.abs(nn.y) < 0.95 ? new V(0, 1, 0) : new V(1, 0, 0);
      const a1 = new V().crossVectors(nn, up).normalize();
      const a2 = new V().crossVectors(nn, a1);
      const ratios = [];
      const bgL = [];
      for (let k = 0; k < 24; k++) {
        const th = (k / 24) * Math.PI * 2;
        let best = 1;
        // Across the tube's width, keep the peak.
        for (const rr of [R - tube * 0.6, R, R + tube * 0.6]) {
          const q = p.clone().addScaledVector(a1, Math.cos(th) * rr).addScaledVector(a2, Math.sin(th) * rr).project(cam);
          if (q.z > 1 || Math.abs(q.x) > 1 || Math.abs(q.y) > 1) continue;
          const x = Math.round((q.x * 0.5 + 0.5) * canvas.width), y = Math.round((0.5 - q.y * 0.5) * canvas.height);
          const L1 = lum(withRing, x, y), L2 = lum(without, x, y);
          best = Math.max(best, (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05));
          if (rr === R) bgL.push(L2);
        }
        ratios.push(best);
      }
      ratios.sort((a, b) => a - b);
      bgL.sort((a, b) => a - b);
      return { median: ratios[12], min: ratios[0], bg: bgL[Math.floor(bgL.length / 2)] };
    }, [race, Number(ring), tod]);
    const name = `${race}_r${ring}_t${tod}`;
    if (doShots) {
      await page.evaluate(() => window.__dw.render());
      await page.screenshot({ path: path.join(out, name + '.png') });
    }
    results.push({ name, ...r });
    console.log(name, JSON.stringify(r));
  }
}
console.log('errors', logs.slice(0, 5));
await browser.close();
