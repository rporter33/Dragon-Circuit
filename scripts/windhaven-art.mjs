// Reproducible high-quality art captures; run with the local Vite preview already running.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const origin = process.argv[2] ?? 'http://127.0.0.1:5174';
const output = 'shots/windhaven-art-2';
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${origin}/?view=windhaven&manual=1&quality=high&breed=galewing`);
  await page.waitForFunction(() => window.__dw?.ready);
  await page.evaluate(() => window.__dw.render());
  const advance = s => page.evaluate(s => window.__dw.advance(s), s);
  const shot = async name => {
    await page.evaluate(() => window.__dw.render());
    await page.screenshot({ path: `${output}/${name}.png` });
    console.log(`Captured ${name}`);
  };
  for (const name of ['Overview', 'Top', 'Side']) {
    await page.getByRole('button', { name, exact: true }).click();
    await shot(name.toLowerCase());
  }
  await page.getByRole('button', { name: 'Walk deck', exact: true }).click();
  await advance(0.5);
  await shot('on-foot');
  await page.getByRole('button', { name: 'Ride / take off', exact: true }).click();
  await advance(0.5);
  await shot('mounted');
  await page.evaluate(() => window.__dw.advance(0.1, { flight: { flap: 1 } }));
  await advance(0.5);
  await shot('takeoff');
  await page.evaluate(() => window.__dw.advance(0.5, { flight: { roll: 0.7, pitch: 0.15 } }));
  await shot('bank');
  await page.evaluate(() => window.__dw.advance(0.5, { flight: { roll: 0, pitch: -0.5, tuck: 1 } }));
  await shot('dive');
  await page.evaluate(() => window.__dw.advance(0.5, { flight: { flare: 1 } }));
  await shot('brake');
  await page.getByRole('button', { name: 'Ride / take off', exact: true }).click();
  await advance(0.5);
  await page.evaluate(() => window.__dw.advance(0.1, { pressed: { interact: true } }));
  await advance(1);
  assert.equal(await page.evaluate(() => window.__dw.game.player.mode), 'onFoot');
  await shot('dismount');
  await page.getByRole('button', { name: 'Cabin', exact: true }).click();
  await shot('cabin');
  for (const name of ['Windows', 'Hitches']) {
    await page.getByRole('button', { name, exact: true }).click();
    await shot(name.toLowerCase());
  }
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Breezy wind', exact: true }).click();
  await advance(2);
  await shot('wind-a');
  const clothBefore = await page.evaluate(() => window.__dw.game.scene.getObjectByName('Windhaven').sails.map(s => Array.from(s.solver.pos)));
  await advance(1);
  await shot('wind-b');
  const cloth = await page.evaluate(before => {
    const ship = window.__dw.game.scene.getObjectByName('Windhaven');
    return ship.sails.map((s, i) => {
      let motion = 0, anchorError = 0;
      s.solver.pos.forEach((v, j) => {
        motion = Math.max(motion, Math.abs(v - before[i][j]));
        if (s.pinned[Math.floor(j / 3)]) anchorError = Math.max(anchorError, Math.abs(v - s.rest[j]));
      });
      return { name: s.mesh.name, motion, anchorError };
    });
  }, clothBefore);
  assert.equal(cloth.length, 9);
  for (const sail of cloth) { assert.ok(sail.motion > 0.0001, `${sail.name} moves in world wind`); assert.equal(sail.anchorError, 0); }
  await page.evaluate(() => window.__dw.game.pause());
  const paused = await page.evaluate(() => window.__dw.game.scene.getObjectByName('Windhaven').sails.map(s => Array.from(s.solver.pos)));
  await advance(1);
  assert.deepEqual(await page.evaluate(() => window.__dw.game.scene.getObjectByName('Windhaven').sails.map(s => Array.from(s.solver.pos))), paused);
  await page.evaluate(() => window.__dw.game.resume());
  const metrics = await page.evaluate(() => {
    const ship = window.__dw.game.scene.getObjectByName('Windhaven');
    let meshes = 0, triangles = 0, instances = 0;
    ship.traverse(o => {
      if (!o.isMesh) return;
      meshes++;
      triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
      if (o.isInstancedMesh) instances += o.count;
    });
    return { meshes, triangles, instances, runtimeErrors: window.__dw.errors };
  });
  assert.deepEqual([...errors, ...metrics.runtimeErrors], []);
  fs.writeFileSync(`${output}/metrics.json`, JSON.stringify({ quality: 'high', viewport: [1440, 900], browser: 'Chromium with SwiftShader; not physical GPU profiling', cloth, pauseVerified: true, ...metrics }, null, 2));
  console.log(JSON.stringify(metrics));
} finally { await browser.close(); }
