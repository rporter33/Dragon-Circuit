// End-to-end smoke test of the production build.
//
//   npm run smoke                     build, serve dist under /driftwing/, run every check
//   node scripts/smoke.mjs --no-build reuse an existing build in --dist (default: dist)
//        [--dist dist] [--port 5390] [--quality low] [--timeout 300] [--headed]
//
// Checks, in a real browser with the real requestAnimationFrame loop (no ?manual):
//   1. ?debug=1 boot: the splash goes away, the first frame steps are never negative and the
//      camera is calm (DT-01), the title answers Enter, play starts.
//   2. Flight: the wyvern flies a few seconds under keyboard control (Space flaps, W/S pitch).
//   3. Pause/resume with Esc; the time of day holds still while paused (PHOTO-01).
//   4. Graphics quality low → high → low at runtime; frames keep coming (QUAL-01).
//   5. A plain production boot (no ?debug): no window.__dw, no errors.
// Any console error, page error or failed same-origin request fails the run.
//
// Needs Playwright's Chromium. CHROMIUM_PATH picks a specific binary; otherwise
// /opt/pw-browsers/chromium is used when present, else Playwright's own download
// (`npx playwright install chromium`). WebGL runs on SwiftShader, so expect a few minutes.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const dist = path.resolve(root, opt('dist', 'dist'));
const port = Number(opt('port', process.env.SMOKE_PORT || 5390));
const quality = opt('quality', 'low');
const timeoutMs = Number(opt('timeout', 300)) * 1000;
const BASE = '/driftwing/';

const results = [];
let failed = false;
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

// --- Build --------------------------------------------------------------------------------------

if (!flag('no-build')) {
  console.log(`building into ${path.relative(root, dist) || '.'} ...`);
  const r = spawnSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error('build failed');
    process.exit(1);
  }
}
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error(`no build at ${dist} (run without --no-build)`);
  process.exit(1);
}

// --- Static server (under a subpath, like GitHub Pages) -----------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.ico': 'image/x-icon',
};
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  if (!url.pathname.startsWith(BASE)) {
    res.writeHead(302, { location: BASE });
    return res.end();
  }
  let rel = decodeURIComponent(url.pathname.slice(BASE.length)) || 'index.html';
  const file = path.resolve(dist, rel);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
});
const origin = `http://127.0.0.1:${port}`;
console.log(`serving ${dist} at ${origin}${BASE}`);

// --- Browser ------------------------------------------------------------------------------------

const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({
  executablePath,
  headless: !flag('headed'),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});

function watch(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message.slice(0, 300)}`));
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(origin)) errors.push(`[request] ${r.url()} ${r.failure()?.errorText ?? ''}`);
  });
  page.on('response', (r) => {
    if (r.url().startsWith(origin) && r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`);
  });
  return errors;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until the game has rendered `n` more frames (the loop is alive). */
async function frames(page, n, label) {
  const start = await page.evaluate(() => window.__dw.game.renderer.gl.info.render.frame);
  try {
    await page.waitForFunction(([s, n]) => window.__dw.game.renderer.gl.info.render.frame >= s + n, [start, n], { timeout: timeoutMs });
    return true;
  } catch {
    check(`${label}: frames keep coming`, false, `stuck at frame ${start}`);
    return false;
  }
}

async function press(page, key, holdMs = 120) {
  await page.keyboard.down(key);
  await sleep(holdMs);
  await page.keyboard.up(key);
}

try {
  // 1-4: debug boot ----------------------------------------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    const errors = watch(page);
    page.setDefaultTimeout(timeoutMs);
    // Record the first frame steps as the real loop delivers them.
    await page.addInitScript(() => {
      window.__smoke = { steps: [] };
      let dw;
      Object.defineProperty(window, '__dw', {
        configurable: true,
        get: () => dw,
        set(v) {
          dw = v;
          const g = v.game;
          const frame = g.frame.bind(g);
          g.frame = (dt, render, ft) => {
            const r = frame(dt, render, ft);
            if (window.__smoke.steps.length < 30) window.__smoke.steps.push({ dt, trauma: g.cameraRig.trauma ?? 0 });
            return r;
          };
        },
      });
    });
    const t0 = Date.now();
    await page.goto(`${origin}${BASE}?debug=1&quality=${quality}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__dw?.ready === true && !document.getElementById('boot'), null, { timeout: timeoutMs });
    check('boot: splash gone, game ready', true, `${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await page.waitForFunction(() => window.__smoke.steps.length >= 10, null, { timeout: timeoutMs });
    const steps = await page.evaluate(() => window.__smoke.steps);
    const minDt = Math.min(...steps.map((s) => s.dt));
    const maxTrauma = Math.max(...steps.map((s) => s.trauma));
    check('first frame steps are never negative', minDt >= 0, `min dt ${minDt.toFixed(3)} s`);
    check('camera is calm at boot', maxTrauma <= 1, `max trauma ${maxTrauma.toFixed(2)}`);
    check('starts on the title', (await page.evaluate(() => window.__dw.game.screen)) === 'title');

    await page.focus('canvas').catch(() => {});
    for (let i = 0; i < 4 && (await page.evaluate(() => window.__dw.game.screen)) !== 'play'; i++) {
      await press(page, 'Enter');
      await frames(page, 3, 'title');
    }
    check('Enter starts play', (await page.evaluate(() => window.__dw.game.screen)) === 'play');

    // Into the air above the Roost, then fly on the keyboard.
    const start = await page.evaluate(() => {
      const g = window.__dw.game;
      const V = g.camera.position.constructor;
      g.player.teleport(new V(0, 380, -160), 0, 'flying', 26);
      g.cameraRig.snap(g.player);
      return g.player.position.toArray();
    });
    await frames(page, 3, 'flight');
    await page.keyboard.down('Space');
    await sleep(1500);
    await page.keyboard.up('Space');
    await press(page, 'KeyS', 400);
    await press(page, 'KeyD', 400);
    await frames(page, 10, 'flight');
    const flown = await page.evaluate((p0) => {
      const g = window.__dw.game;
      const p = g.player.position;
      return { mode: g.player.mode, dist: Math.hypot(p.x - p0[0], p.y - p0[1], p.z - p0[2]), playTime: g.save.data.playTime };
    }, start);
    check('flies under keyboard control', flown.dist > 10 && flown.playTime > 0, `${flown.mode}, moved ${flown.dist.toFixed(0)} m`);

    // Pause and resume.
    await press(page, 'Escape');
    await frames(page, 3, 'pause');
    const paused = await page.evaluate(() => ({ screen: window.__dw.game.screen, tod: window.__dw.game.sky.timeOfDay }));
    check('Esc pauses', paused.screen === 'pause');
    await frames(page, 20, 'pause');
    const tod2 = await page.evaluate(() => window.__dw.game.sky.timeOfDay);
    check('time of day holds still while paused', Math.abs(tod2 - paused.tod) < 1e-9, `${paused.tod.toFixed(5)} -> ${tod2.toFixed(5)}`);
    await press(page, 'Escape');
    await frames(page, 3, 'resume');
    check('Esc resumes', (await page.evaluate(() => window.__dw.game.screen)) === 'play');

    // Graphics quality at runtime, both directions.
    for (const q of ['high', quality === 'high' ? 'low' : quality]) {
      await page.evaluate((q) => {
        const g = window.__dw.game;
        g.applySettings({ ...g.settings, quality: q });
      }, q);
      const alive = await frames(page, 5, `quality ${q}`);
      const samples = await page.evaluate(() => window.__dw.game.renderer.target?.samples ?? -1);
      const want = await page.evaluate(() => window.__dw.game.renderer.quality.msaa);
      check(`switch quality to ${q} at runtime`, alive && samples === want, `msaa ${samples}`);
    }

    const handleErrors = await page.evaluate(() => window.__dw.errors);
    const all = [...errors, ...handleErrors.map((e) => `[handle] ${e}`)];
    check('no errors (debug run)', all.length === 0, all.slice(0, 5).join(' | '));
    await page.close();
  }

  // 5: plain production boot ---------------------------------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    const errors = watch(page);
    page.setDefaultTimeout(timeoutMs);
    await page.goto(`${origin}${BASE}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: timeoutMs });
    await sleep(3000);
    const hasHandle = await page.evaluate(() => typeof window.__dw !== 'undefined');
    check('production boot has no window.__dw', !hasHandle);
    check('no errors (production run)', errors.length === 0, errors.slice(0, 5).join(' | '));
    await page.close();
  }
} catch (err) {
  check('smoke run', false, String(err?.message ?? err).split('\n')[0]);
} finally {
  await browser.close();
  server.close();
}

const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
