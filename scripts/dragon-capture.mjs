// Dragon capture harness: stills, motion strips (labelled contact sheets) and measurements of the
// wyverns, driven by a JSON manifest, for art/animation review and before/after comparisons.
//
//   node scripts/dragon-capture.mjs [--manifest scripts/dragon-capture.manifest.json]
//        [--out shots/dragon] [--base http://localhost:5420/] [--serve]
//        [--only REGEX] [--skip REGEX] [--list] [--dry]
//
//   --serve     start `vite --port <port of --base> --strictPort` if nothing answers at --base,
//               and stop it at the end
//   --only/--skip  regular expressions matched against item ids and section ids
//               (e.g. --only '^c-flap-' or --only '^g$'); results of earlier runs into the same
//               --out are kept, and index.md always lists everything captured there
//   --list      print the expanded items (id, boot, kind) and exit; --dry also prints URLs
//   --gpu       launch Chromium on the machine's real GPU (no SwiftShader), for kind "gpu" timing
//               items (EXT_disjoint_timer_query_webgl2); --headful shows the window
//
// Manifest (see scripts/dragon-capture.manifest.json):
//   defaults  { base, size, stripSize, stage, settle, ui }
//   boots     { id: { url, size?, desc? } }       one page load per boot (fresh browser context)
//   sections  [ { id, title, dir, note?, items: [...] } ]
//   vars      { name: [values] }                   shared lists for `each` ("$name")
//   consts    { NAME: "text" }                     {NAME} is replaced in every item's strings
//   item      { id, desc, boot?, kind?: still|strip|grid|sequence|measure, each?: {key: [values] | "$name"},
//               stage?: "pose=flap&cam=side" (showcase re-staging, merged over defaults.stage),
//               steps?: [step], settle?, settleInput?, size?, ui?: hide|show, crop?,
//               strip: frames + step | times[], input?, inputs?: [{at, input}], label?, cols?,
//                      onion?, diff?
//               grid: cells: [{ label, stage }] — one staging per cell (stage merged over the
//                     item's), shot after settle and assembled into one labelled sheet
//               matte: true — wyvern ID-matte luminance report per shot/frame (__cap.matte):
//                      max non-emissive luminance vs the palette's bloom threshold, coverage,
//                      width, brightest region; collected in measure/m-matte-luminance.json
//               ortho: { view: side|front|top, matte?, gap? } — a same-scale orthographic lineup
//                      of every visible wyvern on a 1 m grid (plus a black-silhouette .matte.png
//                      with measured lengths, heights, spans, areas and aspect ratios)
//               aim: { target: eye|<bone>|body, az, el, dist (m or "=expr of t") , fov? } —
//                      re-aim the camera after the rigs ran (eye macros, dollies)
//               spans: true — on-screen wingspan and rider height in pixels
//               stance: true (strips) — per-foot stance/swing markers and a footfall diagram
//               metrics: ["tail","stroke"] (strips) — tail bend per joint, wingtip elevation,
//                      separation and fore-aft per frame, summarised; measure/m-motion-metrics.json
//               diff: gain | { gain, mode: "consecutive" } — difference sheets vs frame 0, or
//                      frame to frame (shimmer/crawl), with a mean-difference figure per frame
//               gpu: { frames } (kind "gpu") — wyvern draw time with/without the wyverns
//                      (GPU timer queries, or a SwiftShader wall-clock proxy); measure/gpu-timings.json
//               sequence: shots: [step + { shot: { id, desc, crop?, label?, ui? } }], run in order
//               measure: { fn: "wyvern", breeds? } }
//   step      { eval?, advance?, input? (held), inputs?: [{at, input}] (from the step's start) }
//   Any numeric field may be a string "=<js expression>" evaluated in the page after staging,
//   e.g. "step": "=1/12/__dw.game.player.breed.flapRate". `each` expands an item over every
//   combination of its values, substituting {key} (or {key.field} for object values) and
//   {=js expression over the keys} in all of the item's strings, e.g. "camDist={=b.span*0.8}".
//
// Determinism: pages load with ?manual=1 (no rAF loop; time only moves through this script), each
// boot gets a fresh browser context (empty localStorage, so no save carries over), showcase items
// re-stage with fresh=1 (default look, the wyvern's animation restarted from rest), and time
// advances in exact steps (sub-steps of at most 1/30 s through game.frame). The same manifest
// gives the same frames. Within one boot only non-wyvern state carries from item to item (the
// rider's cloth, cloud drift), which settle times absorb.
//
// Output: <out>/<section dir>/<id>.png for stills, <out>/<section dir>/<id>/fNN.png plus
// <id>.sheet.png (and .onion.png / .diff.png when asked) for strips, <out>/measure/*.json, and
// <out>/index.md listing every image with its one-line description. Needs python3 with Pillow
// (numpy for onion/diff composites).

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

// --- Arguments ------------------------------------------------------------------------------

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const manifestPath = opt('manifest', 'scripts/dragon-capture.manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const D = { base: 'http://localhost:5420/', size: '1280x720', stripSize: '640x360', stage: 'fresh=1', settle: 1.5, ui: 'hide', ...manifest.defaults };
const base = opt('base', D.base);
const outDir = path.resolve(opt('out', 'shots/dragon'));
const only = opt('only') ? new RegExp(opt('only')) : null;
const skip = opt('skip') ? new RegExp(opt('skip')) : null;

// --- Manifest expansion ---------------------------------------------------------------------

function evalTemplate(expr, vars) {
  const v = new Function(...Object.keys(vars), `return (${expr});`)(...Object.values(vars));
  return typeof v === 'number' ? String(+v.toFixed(3)) : String(v);
}

function substitute(v, vars) {
  if (typeof v === 'string')
    return v
      .replace(/\{=([^}]+)\}/g, (m, e) => evalTemplate(e, vars))
      .replace(/\{(\w+)(?:\.(\w+))?\}/g, (m, k, f) => (k in vars ? String(f ? vars[k][f] : vars[k]) : m));
  if (Array.isArray(v)) return v.map((x) => substitute(x, vars));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substitute(x, vars)]));
  return v;
}

function expand(item) {
  if (!item.each) return [substitute(item, { ...manifest.consts })];
  const keys = Object.keys(item.each);
  let combos = [{}];
  for (const k of keys) {
    const list = typeof item.each[k] === 'string' && item.each[k].startsWith('$') ? manifest.vars[item.each[k].slice(1)] : item.each[k];
    if (!Array.isArray(list)) throw new Error(`each.${k}: no list ${item.each[k]}`);
    combos = combos.flatMap((c) => list.map((v) => ({ ...c, [k]: v })));
  }
  const { each, ...rest } = item;
  return combos.map((vars) => substitute(rest, { ...manifest.consts, ...vars }));
}

const items = [];
for (const sec of manifest.sections) {
  for (const raw of sec.items) {
    for (const it of expand(raw)) {
      items.push({ ...it, section: sec.id, dir: sec.dir ?? sec.id, boot: it.boot ?? sec.boot ?? 'showcase', kind: it.kind ?? 'still' });
    }
  }
}
const ids = new Set();
for (const it of items) {
  if (ids.has(it.id)) throw new Error(`duplicate item id ${it.id}`);
  ids.add(it.id);
}
const selected = items.filter((it) => (!only || only.test(it.id) || only.test(it.section)) && !(skip && (skip.test(it.id) || skip.test(it.section))));

if (flag('list') || flag('dry')) {
  for (const it of selected) {
    const b = manifest.boots[it.boot];
    console.log(`${it.id.padEnd(40)} ${it.kind.padEnd(8)} ${it.boot.padEnd(14)} ${flag('dry') ? (b?.url ?? '?') + (it.stage !== undefined ? '  stage: ' + mergeStage(it.stage) : '') : it.desc ?? ''}`);
  }
  console.log(`${selected.length} of ${items.length} items`);
  process.exit(0);
}

function mergeStage(stage) {
  if (stage === undefined) return undefined;
  const q = new URLSearchParams(D.stage);
  for (const [k, v] of new URLSearchParams(stage)) q.set(k, v);
  return q.toString();
}

const sizeOf = (s) => s.split('x').map(Number);

// --- Results store (kept across runs into the same --out) -------------------------------------

fs.mkdirSync(outDir, { recursive: true });
const resultsPath = path.join(outDir, 'results.json');
const results = fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath, 'utf8')) : {};
function saveResults() {
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 1));
  writeReports();
  writeIndex();
}

/** Aggregated reports over everything captured into this --out (kept across runs). */
function writeReports() {
  const dir = path.join(outDir, 'measure');
  const all = Object.values(results);
  const mattes = all.flatMap((r) => (r.mattes ?? []).map((m) => ({ item: r.id, ...m })));
  if (mattes.length) {
    fs.mkdirSync(dir, { recursive: true });
    const fails = mattes.filter((m) => !m.error && !m.pass);
    fs.writeFileSync(
      path.join(dir, 'm-matte-luminance.json'),
      JSON.stringify(
        {
          note: 'Wyvern ID matte: the non-emissive light the hide outputs (after fog, before tone mapping; what the bloom prefilter thresholds) against the palette bloom threshold at that time of day. pass = maxNonEmissive below the threshold and no NaN pixels.',
          when: new Date().toISOString(),
          shots: mattes.length,
          failing: fails.map((m) => `${m.id}: ${m.maxNonEmissive} >= ${m.bloomThreshold} (${m.maxNonEmissiveRegion})`),
          clawsBrightest: mattes.filter((m) => m.clawsBrightest).map((m) => m.id),
          reports: mattes,
        },
        null,
        1,
      ),
    );
  }
  const motion = all.filter((r) => r.metrics);
  if (motion.length) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'm-motion-metrics.json'), JSON.stringify(Object.fromEntries(motion.map((r) => [r.id, { desc: r.desc, summary: r.metrics, frames: r.motion }])), null, 1));
  }
  const gpu = all.filter((r) => r.kind === 'gpu' && r.data);
  if (gpu.length) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'gpu-timings.json'),
      JSON.stringify(
        {
          note: 'Wyvern share of the frame: the same frame rendered with and without the wyverns (shadow + scene + post). method timer-query = EXT_disjoint_timer_query_webgl2 on a real GPU (run with --gpu); wallclock-swiftshader-proxy = CPU rasteriser wall clock, only for before/after comparisons on one machine.',
          budgets: { highChase1080: 1.5, low1080: 0.6, stableClose: 2.5 },
          scenarios: Object.fromEntries(gpu.map((r) => [r.id, r.data])),
        },
        null,
        1,
      ),
    );
  }
}

// --- Dev server -----------------------------------------------------------------------------

async function reachable(url) {
  try {
    const r = await fetch(url);
    return r.ok;
  } catch {
    return false;
  }
}

let server = null;
if (!(await reachable(base))) {
  if (!flag('serve')) {
    console.error(`Nothing answers at ${base}. Start the dev server (npx vite --port ${new URL(base).port} --strictPort) or pass --serve.`);
    process.exit(1);
  }
  const port = new URL(base).port || '5173';
  server = spawn('npx', ['vite', '--port', port, '--strictPort'], { stdio: 'ignore', detached: true });
  for (let i = 0; i < 120 && !(await reachable(base)); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await reachable(base))) throw new Error('dev server did not come up');
}
function stopServer() {
  if (server) {
    try {
      process.kill(-server.pid);
    } catch {
      /* already gone */
    }
  }
}
process.on('exit', stopServer);
process.on('SIGINT', () => process.exit(130));

// --- Browser --------------------------------------------------------------------------------

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  headless: !flag('headful'),
  args: flag('gpu')
    ? ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=default', '--enable-features=Vulkan']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const PAGE_EXT = fs.readFileSync(new URL('./dragon-capture.page.js', import.meta.url), 'utf8');

/** In-page helpers: exact time steps with scripted input, projections for crops. */
const HELPERS = () => {
  window.__cap = {
    t: 0,
    /** Advance `seconds` exactly, in equal sub-steps of at most 1/30 s (the game's own advance
     * rounds to whole 1/30 s frames). `schedule` [{at, input}] picks the input by strip time. */
    advance(seconds, input, schedule) {
      if (!(seconds > 1e-9)) return;
      const g = window.__dw.game;
      const n = Math.max(1, Math.ceil(seconds * 30 - 1e-6));
      const dt = seconds / n;
      for (let i = 0; i < n; i++) {
        let inp = input ?? null;
        if (schedule) for (const s of schedule) if (this.t + 1e-9 >= s.at) inp = s.input;
        g.input.setScripted(inp);
        g.frame(dt, false);
        this.t += dt;
      }
      g.input.setScripted(null);
    },
    /** One-line state of the player's wyvern for frame labels: mode, gait, height above the
     * ground, airspeed, pitch and bank (degrees, + = nose up / right wing down), flap phase. */
    state() {
      const p = window.__dw.game.player;
      const w = p.wyvernPose;
      const V = w.position.constructor;
      const f = new V(0, 0, 1).applyQuaternion(w.orientation);
      const l = new V(1, 0, 0).applyQuaternion(w.orientation);
      const deg = (x) => (Math.asin(Math.max(-1, Math.min(1, x))) * 180) / Math.PI;
      const h = w.groundY === null ? '-' : (w.position.y - w.groundY).toFixed(1);
      const flap = w.flapStrength > 0.05 ? ` flap ${w.flapPhase.toFixed(2)}` : '';
      return `${p.mode}/${w.gait} h=${h} v=${w.airspeed.toFixed(0)} pitch=${deg(f.y).toFixed(0)} bank=${deg(l.y).toFixed(0)}${flap}`;
    },
    /** Seconds per gait cycle of the player's wyvern at its current ground speed (after the
     * gait has run a frame; falls back to the walk/run cycle lengths in gait.ts). */
    gaitPeriod() {
      const g = window.__dw.game;
      const w = g.player.wyvernPose;
      let cycle = null;
      try {
        cycle = g.wyvern.animator.gait.timing.cycle;
      } catch {
        /* renamed internals: use the fallback */
      }
      if (!(cycle > 0)) cycle = w.gait === 'run' ? 2.5 : 1.55;
      return (cycle * g.player.breed.standHeight) / Math.max(0.3, w.groundSpeed);
    },
    /** Screen position (CSS px) of the player's wyvern (or a named bone of it). */
    project(name) {
      const g = window.__dw.game;
      const o = name ? g.wyvern.group.getObjectByName(name) : null;
      const p = o ? o.getWorldPosition(g.wyvern.group.position.clone()) : g.player.wyvernPose.position.clone();
      const dist = p.distanceTo(g.camera.position);
      p.project(g.camera);
      const s = g.renderer.size;
      return { x: (p.x * 0.5 + 0.5) * s.x, y: (-p.y * 0.5 + 0.5) * s.y, dist };
    },
  };
};

const pageErrors = [];

async function bootPage(bootId) {
  const b = manifest.boots[bootId];
  if (!b) throw new Error(`unknown boot ${bootId}`);
  const [w, h] = sizeOf(b.size ?? D.size);
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(`[${bootId}] ${m.text()}`);
  });
  page.on('pageerror', (e) => pageErrors.push(`[${bootId}] ${e.message}`));
  // No hot reloads mid-capture: a source edit would otherwise reload the page under the harness.
  if (typeof page.routeWebSocket === 'function') await page.routeWebSocket(/.*/, () => {});
  const t0 = Date.now();
  await page.goto(new URL(b.url, base).toString(), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__dw?.ready === true, null, { timeout: 300000 });
  await page.addStyleTag({ content: 'html.cap-noui #ui, html.cap-noui #boot { display: none !important; }' });
  await page.evaluate(HELPERS);
  await page.evaluate(PAGE_EXT);
  console.log(`boot ${bootId} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return { ctx, page, size: `${w}x${h}` };
}

// --- Item execution -------------------------------------------------------------------------

async function num(page, v, fallback = 0) {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.startsWith('=')) return Number(await page.evaluate(`(${v.slice(1)})`));
  return Number(v);
}

/** A label expression's value, or '?' when it throws (e.g. a renamed private field). */
async function evalLabel(page, expr) {
  return page.evaluate(`(() => { try { return String(${expr}); } catch (e) { return '?'; } })()`);
}

async function advance(page, seconds, input, schedule) {
  // Long advances in chunks so one evaluate never blocks for minutes.
  let left = seconds;
  while (left > 1e-9) {
    const chunk = Math.min(left, 1);
    await page.evaluate(([s, i, sc]) => window.__cap.advance(s, i, sc), [chunk, input ?? null, schedule ?? null]);
    left -= chunk;
  }
}

async function runStep(page, st) {
  if (st.eval) await page.evaluate(st.eval);
  if (st.inputs)
    await page.evaluate(() => {
      window.__cap.t = 0;
    });
  const adv = await num(page, st.advance, 0);
  if (adv > 0) await advance(page, adv, st.input, st.inputs);
}

let current = { size: null };
async function setView(page, it, kind) {
  const size = it.size ?? (kind === 'strip' || kind === 'grid' ? D.stripSize : D.size);
  if (size !== current.size) {
    const [w, h] = sizeOf(size);
    await page.setViewportSize({ width: w, height: h });
    await page.waitForFunction(([ww, hh]) => window.__dw.game.renderer.size.x === ww && window.__dw.game.renderer.size.y === hh, [w, h]);
    current.size = size;
  }
  const hide = (it.ui ?? D.ui) !== 'show';
  await page.evaluate((h) => document.documentElement.classList.toggle('cap-noui', h), hide);
}

async function shoot(page, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.evaluate(() => window.__dw.render());
  await page.screenshot({ path: file });
}

const rel = (f) => path.relative(outDir, f).split(path.sep).join('/');
const pyJobs = [];

async function cropJob(page, crop, file) {
  if (!crop || !(Number(crop.box ?? 128) > 0)) return null;
  const c = await page.evaluate((n) => window.__cap.project(n), crop.target ?? null);
  const out = file.replace(/\.png$/, '.crop.png');
  pyJobs.push({ type: 'crop', src: file, out, cx: c.x, cy: c.y, box: Number(crop.box ?? 128), scale: Number(crop.scale ?? 4), label: `${crop.label ?? ''} ${c.dist.toFixed(0)} m`.trim() });
  return { file: rel(out), dist: c.dist };
}

/** Short text for a matte report (index descriptions and frame labels). */
function matteText(m) {
  if (!m || m.error) return `matte: ${m?.error ?? 'n/a'}`;
  const ok = m.maxNonEmissive < m.bloomThreshold ? 'below' : 'AT/ABOVE';
  return `hide max ${m.maxNonEmissive} ${ok} bloom ${m.bloomThreshold} (${m.maxNonEmissiveRegion}), ${m.pxAtThreshold} px ≥ thr, brightest ${m.brightestRegion}${m.clawsBrightest ? ' (CLAWS)' : ''}, width ${(m.widthFrac * 100).toFixed(1)}%, cover ${(m.coverage * 100).toFixed(1)}%${m.nanPixels ? `, ${m.nanPixels} NaN px` : ''}`;
}

async function frameExtras(page, it, res, key) {
  const ex = {};
  if (it.matte) ex.matte = await page.evaluate(() => window.__cap.matte());
  if (it.spans) ex.spans = await page.evaluate(() => window.__cap.spans());
  if (it.stance) ex.feet = await page.evaluate(() => window.__cap.feet());
  if (it.metrics) ex.metrics = await page.evaluate((n) => window.__cap.metrics(n), it.metrics);
  if (ex.matte) (res.mattes ??= []).push({ id: key, ...ex.matte });
  return ex;
}

function extrasText(ex) {
  const parts = [];
  if (ex.matte) parts.push(matteText(ex.matte));
  if (ex.spans) parts.push(`span ${ex.spans.spanPx}px (${(ex.spans.spanFrac * 100).toFixed(1)}% of width) at ${ex.spans.dist} m, rider ${ex.spans.riderPx}px`);
  return parts.join('; ');
}

function shortExtras(ex) {
  const parts = [];
  if (ex.matte && !ex.matte.error) parts.push(`max ${ex.matte.maxNonEmissive.toFixed(2)}/${ex.matte.bloomThreshold}`);
  if (ex.feet) parts.push(ex.feet.map((f) => `${f.name}${f.swing ? '·' : '■'}`).join(' '));
  if (ex.metrics?.tail) parts.push(`tail ${ex.metrics.tail.maxBend}°@${ex.metrics.tail.at}`);
  if (ex.metrics?.stroke) parts.push(`tip ${ex.metrics.stroke.L.elev}°/${ex.metrics.stroke.R.elev}° sep ${ex.metrics.stroke.sep}`);
  return parts.join('  ');
}

/** Per-strip summary of tail and stroke metrics (Q6, Q7). */
function summariseMetrics(frames, times) {
  const out = {};
  const tails = frames.map((f) => f.ex.metrics?.tail).filter(Boolean);
  if (tails.length) {
    const worst = tails.reduce((a, b) => (b.maxBend > a.maxBend ? b : a));
    const pitch = tails.map((t) => t.tipPitch);
    out.tail = { maxBend: worst.maxBend, worstFrame: tails.indexOf(worst), tipPitchRange: [Math.min(...pitch), Math.max(...pitch)], tipExcursion: +((Math.max(...pitch) - Math.min(...pitch)) / 2).toFixed(1) };
  }
  const st = frames.map((f) => f.ex.metrics?.stroke).filter(Boolean);
  if (st.length) {
    const el = st.map((s) => (s.L.elev + s.R.elev) / 2);
    const top = Math.max(...el);
    const bot = Math.min(...el);
    const iTop = el.indexOf(top);
    const iBot = el.indexOf(bot);
    // Downstroke share: frames whose elevation falls to the next frame (cyclic).
    let down = 0;
    for (let i = 0; i < el.length; i++) if (el[(i + 1) % el.length] < el[i]) down++;
    const nearTop = el.filter((e) => e >= top - 0.1 * (top - bot)).length;
    out.stroke = {
      tipElevTop: +top.toFixed(1),
      tipElevBottom: +bot.toFixed(1),
      sepAtTop: st[iTop].sep,
      minSep: Math.min(...st.map((s) => s.sep)),
      downstrokeFrac: +(down / el.length).toFixed(2),
      nearTopFrac: +(nearTop / el.length).toFixed(2),
      tipFwdAtBottom: +((st[iBot].L.fwd + st[iBot].R.fwd) / 2).toFixed(2),
      beatSeconds: times.length > 1 ? +((times[times.length - 1] - times[0]) * (times.length / (times.length - 1))).toFixed(3) : null,
    };
  }
  return out;
}

async function runItem(page, it) {
  const t0 = Date.now();
  const dir = path.join(outDir, it.dir);
  await setView(page, it, it.kind);
  await page.evaluate(() => {
    window.__cap.t = 0;
    window.__cap.resetAim();
  });
  if (it.stage !== undefined) await page.evaluate((q) => window.__wyvernShowcase(q), mergeStage(it.stage));
  for (const st of it.steps ?? []) await runStep(page, st);
  if (it.aim) await page.evaluate((o) => window.__cap.aim(o), it.aim);
  const settle = await num(page, it.settle, it.kind === 'sequence' || it.kind === 'measure' || it.kind === 'gpu' ? 0 : D.settle);
  await advance(page, settle, it.settleInput);
  const meta = { boot: it.boot, stage: mergeStage(it.stage), settle, size: current.size };
  const res = { id: it.id, section: it.section, kind: it.kind, desc: it.desc ?? '', meta, files: [] };

  if (it.kind === 'still' && it.ortho) {
    const file = path.join(dir, `${it.id}.png`);
    await page.evaluate(() => window.__dw.render());
    const lay = await page.evaluate((o) => window.__cap.ortho({ ...o, matte: false }), it.ortho);
    await page.screenshot({ path: file });
    await page.evaluate(() => window.__cap.orthoRestore());
    res.ortho = lay;
    const labels = it.ortho.labels ?? null;
    pyJobs.push({ type: 'ortho', src: file, out: file, layout: lay, labels, matte: false, title: it.id });
    res.files.push({ file: rel(file), desc: `${it.desc} — orthographic, one scale (${lay.ppm} px/m), 1 m grid` });
    if (it.ortho.matte) {
      const mf = file.replace(/\.png$/, '.matte.png');
      await page.evaluate(() => window.__dw.render());
      const lay2 = await page.evaluate((o) => window.__cap.ortho({ ...o, matte: true }), it.ortho);
      await page.screenshot({ path: mf });
      await page.evaluate(() => window.__cap.orthoRestore());
      pyJobs.push({ type: 'ortho', src: mf, out: mf, layout: lay2, labels, matte: true, title: it.id, json: path.join(outDir, 'measure', `${it.id}.silhouettes.json`) });
      res.files.push({ file: rel(mf), desc: `${it.desc} — black silhouettes, measured (measure/${it.id}.silhouettes.json)` });
    }
  } else if (it.kind === 'still') {
    const file = path.join(dir, `${it.id}.png`);
    await shoot(page, file);
    const ex = await frameExtras(page, it, res, it.id);
    res.extras = ex;
    const et = extrasText(ex);
    res.files.push({ file: rel(file), desc: it.desc + (it.label ? ` [${await evalLabel(page, it.label)}]` : '') + (et ? ` {${et}}` : '') });
    const c = await cropJob(page, it.crop, file);
    if (c) res.files.push({ file: c.file, desc: `${it.desc} — ${it.crop.scale ?? 4}x crop around the wyvern (${c.dist.toFixed(0)} m from the camera)` });
  } else if (it.kind === 'strip') {
    await page.evaluate(() => {
      window.__cap.t = 0;
    });
    let times;
    if (it.times) times = await Promise.all(it.times.map((v) => num(page, v)));
    else {
      const n = it.frames ?? 12;
      const step = await num(page, it.step, 0.1);
      times = Array.from({ length: n }, (_, i) => i * step);
    }
    const frames = [];
    let t = 0;
    for (let i = 0; i < times.length; i++) {
      await advance(page, times[i] - t, it.input, it.inputs);
      t = times[i];
      const file = path.join(dir, it.id, `f${String(i).padStart(2, '0')}.png`);
      await shoot(page, file);
      const ex = await frameExtras(page, it, res, `${it.id}/f${String(i).padStart(2, '0')}`);
      let label = `${String(i).padStart(2, '0')}  t=${t.toFixed(3)}s`;
      if (it.label) label += `  ${await evalLabel(page, it.label)}`;
      const sx = shortExtras(ex);
      if (sx) label += `  ${sx}`;
      frames.push({ file, label, ex });
    }
    meta.times = times;
    const sheet = path.join(dir, `${it.id}.sheet.png`);
    pyJobs.push({ type: 'sheet', out: sheet, frames: frames.map((f) => [f.file, f.label, f.ex.feet ?? null]), cols: it.cols ?? (frames.length > 9 ? 4 : 3), title: it.id, desc: it.desc ?? '', gait: !!it.stance });
    res.files.push({ file: rel(sheet), desc: `${it.desc} — contact sheet, ${frames.length} frames${it.stance ? ' (feet: ■ stance, ○ swing; footfall diagram below)' : ''}` });
    if (it.onion) {
      const out = path.join(dir, `${it.id}.onion.png`);
      pyJobs.push({ type: 'onion', out, frames: frames.map((f) => f.file), title: it.id, desc: `${it.desc} — onion skin (all frames over their median)` });
      res.files.push({ file: rel(out), desc: `${it.desc} — onion skin: every frame's moving parts over the median background (motion arcs)` });
    }
    if (it.diff) {
      const out = path.join(dir, `${it.id}.diff.png`);
      const d = typeof it.diff === 'object' ? it.diff : { gain: it.diff === true ? 6 : it.diff };
      const consecutive = d.mode === 'consecutive';
      pyJobs.push({ type: 'diff', out, frames: frames.map((f) => [f.file, f.label]), cols: it.cols ?? 4, gain: d.gain ?? 6, consecutive, title: it.id, desc: `${it.desc} — ${consecutive ? '|frame - previous frame|' : '|frame - frame 0|'} amplified`, stats: path.join(outDir, 'measure', `${it.id}.diff.json`) });
      res.files.push({ file: rel(out), desc: `${it.desc} — ${consecutive ? 'frame-to-frame difference (shimmer, crawl, pops)' : 'difference from frame 0'}, amplified (measure/${it.id}.diff.json)` });
    }
    res.frames = frames.map((f) => ({ file: rel(f.file), label: f.label }));
    if (it.metrics || it.stance || it.matte || it.spans) res.frameData = frames.map((f, i) => ({ t: times[i], ...f.ex }));
    if (it.metrics) {
      res.metrics = summariseMetrics(frames, times);
      res.motion = frames.map((f, i) => ({ t: +times[i].toFixed(3), ...f.ex.metrics }));
      res.files[0].desc += ` [${JSON.stringify(res.metrics)}]`;
    }
    if (it.matte && it.spans) {
      // A dolly: coverage × distance² is constant for a fixed model, so a jump flags a LOD pop.
      const k = frames.map((f) => (f.ex.matte?.coverage ?? 0) * (f.ex.spans?.dist ?? 0) ** 2);
      const med = [...k].sort((a, b) => a - b)[Math.floor(k.length / 2)] || 1;
      let jump = 0;
      let at = -1;
      for (let i = 1; i < k.length; i++) {
        const j = Math.abs(k[i] - k[i - 1]) / med;
        if (j > jump) {
          jump = j;
          at = i;
        }
      }
      res.dolly = { normalisedCoverage: k.map((v) => +(v / med).toFixed(3)), maxJump: +jump.toFixed(3), atFrame: at };
      res.files[0].desc += ` [coverage×d² max frame-to-frame jump ${(jump * 100).toFixed(1)}% at f${String(at).padStart(2, '0')}]`;
    }
    if (it.stance) {
      const order = touchdownOrder(frames.map((f) => f.ex.feet));
      res.touchdownOrder = order;
      res.files[0].desc += ` [touchdowns: ${order.join(', ') || 'none'}]`;
    }
  } else if (it.kind === 'grid') {
    const cells = [];
    for (let i = 0; i < it.cells.length; i++) {
      const c = it.cells[i];
      const q = new URLSearchParams(mergeStage(it.stage ?? ''));
      for (const [k, v] of new URLSearchParams(c.stage ?? '')) q.set(k, v);
      await page.evaluate(() => {
        window.__cap.t = 0;
      });
      await page.evaluate((qs) => window.__wyvernShowcase(qs), q.toString());
      for (const st of c.steps ?? []) await runStep(page, st);
      await advance(page, await num(page, c.settle ?? it.settle, D.settle), it.settleInput);
      const file = path.join(dir, it.id, `c${String(i).padStart(2, '0')}.png`);
      await shoot(page, file);
      const ex = await frameExtras(page, it, res, `${it.id}/c${String(i).padStart(2, '0')}`);
      const sx = shortExtras(ex);
      cells.push({ file, label: (c.label ?? c.stage) + (sx ? `  ${sx}` : ''), ex });
    }
    const sheet = path.join(dir, `${it.id}.sheet.png`);
    pyJobs.push({ type: 'sheet', out: sheet, frames: cells.map((f) => [f.file, f.label, null]), cols: it.cols ?? (cells.length > 4 ? (cells.length > 6 ? 4 : 3) : 2), title: it.id, desc: it.desc ?? '' });
    res.files.push({ file: rel(sheet), desc: `${it.desc} — ${cells.length} variants side by side` });
    res.frames = cells.map((f) => ({ file: rel(f.file), label: f.label }));
    if (it.cellStats) pyJobs.push({ type: 'cellstats', cells: cells.map((f) => [f.file, f.label]), out: path.join(outDir, 'measure', `${it.id}.cells.json`) });
  } else if (it.kind === 'sequence') {
    // Steps run in order; any step with a shot captures after it.
    for (const st of it.shots ?? []) {
      await runStep(page, st);
      if (st.shot) {
        if (st.shot.ui) await page.evaluate((h) => document.documentElement.classList.toggle('cap-noui', h), st.shot.ui !== 'show');
        const file = path.join(dir, `${st.shot.id}.png`);
        await shoot(page, file);
        let extra = '';
        if (st.shot.label) extra = ` [${await evalLabel(page, st.shot.label)}]`;
        const ex = await frameExtras(page, { ...it, ...st.shot }, res, st.shot.id);
        const et = extrasText(ex);
        res.files.push({ file: rel(file), desc: st.shot.desc + extra + (et ? ` {${et}}` : '') });
        const c = await cropJob(page, st.shot.crop, file);
        if (c) res.files.push({ file: c.file, desc: `${st.shot.desc} — ${st.shot.crop.scale ?? 4}x crop (${c.dist.toFixed(0)} m)` });
        if (st.shot.ui) await page.evaluate((h) => document.documentElement.classList.toggle('cap-noui', h), (it.ui ?? D.ui) !== 'show');
      }
    }
  } else if (it.kind === 'measure') {
    const data = await measure(page, it.measure ?? {});
    const file = path.join(outDir, 'measure', `${it.id}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 1));
    res.files.push({ file: rel(file), desc: it.desc });
    res.data = data;
  } else if (it.kind === 'gpu') {
    await page.evaluate(() => window.__dw.render());
    const data = await page.evaluate((o) => window.__cap.gpu(o), it.gpu ?? {});
    data.scenario = it.id;
    data.desc = it.desc;
    res.data = data;
    const file = path.join(dir, `${it.id}.png`);
    await shoot(page, file);
    res.files.push({ file: rel(file), desc: `${it.desc} — ${data.method}: wyverns ${data.wyvernMs} ms of a ${data.frameMs} ms frame (${data.size}, ${data.quality}, ${data.renderer})` });
  }
  res.seconds = (Date.now() - t0) / 1000;
  results[it.id] = res;
  console.log(`  ${it.id} (${res.seconds.toFixed(1)} s)`);
}

/** Order in which feet touch down over a strip (swing → stance transitions). */
function touchdownOrder(feetFrames) {
  const out = [];
  for (let i = 1; i < feetFrames.length; i++) {
    const a = feetFrames[i - 1];
    const b = feetFrames[i];
    if (!a || !b) continue;
    for (let f = 0; f < b.length; f++) if (a[f].swing && !b[f].swing) out.push(b[f].name);
  }
  return out;
}

// --- Measurement (runs in the page) -----------------------------------------------------------

/** Installs window.__capM: inventories, frame deltas and per-scenario benchmarks (in the page). */
const MEASURE_SETUP = () => {
  const g = window.__dw.game;
  const W = g.wyvern;
  const round = (v, d = 4) => (Number.isFinite(v) ? +v.toFixed(d) : null);
  const median = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  const stage = (q) => window.__wyvernShowcase(`fresh=1&sky=native&tod=0.7&${q}`);
  const adv = (s) => window.__cap.advance(s);

  /** Triangles, vertices, buffers, materials and textures of everything under a group. */
  function inventory(root) {
    const out = { meshes: 0, skinned: 0, drawCallsPerPass: 0, shadowCasters: 0, triangles: 0, vertices: 0, bufferBytes: 0, bones: 0, materials: [], textures: [] };
    const mats = new Set();
    const texs = new Set();
    const geos = new Set();
    root.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      out.meshes++;
      if (o.isSkinnedMesh) {
        out.skinned++;
        out.bones += o.skeleton.bones.length;
      }
      const geo = o.geometry;
      const ml = Array.isArray(o.material) ? o.material : [o.material];
      const draws = Array.isArray(o.material) ? Math.max(1, geo.groups.length) : 1;
      out.drawCallsPerPass += draws;
      if (o.castShadow) out.shadowCasters += draws;
      const count = geo.index ? geo.index.count : geo.attributes.position.count;
      out.triangles += Math.min(count, geo.drawRange.count) / 3;
      out.vertices += geo.attributes.position.count;
      if (!geos.has(geo)) {
        geos.add(geo);
        for (const a of Object.values(geo.attributes)) out.bufferBytes += a.array.byteLength;
        if (geo.index) out.bufferBytes += geo.index.array.byteLength;
      }
      for (const m of ml) mats.add(m);
    });
    for (const m of mats) {
      const t = [];
      const scan = (v, name) => {
        if (!(v && v.isTexture)) return;
        t.push(name);
        if (texs.has(v)) return;
        texs.add(v);
        const img = v.image ?? {};
        out.textures.push({ name, type: v.constructor.name, width: img.width ?? null, height: img.height ?? null, bytes: img.data ? img.data.byteLength : null });
      };
      for (const k of ['map', 'normalMap', 'roughnessMap', 'alphaMap', 'gradientMap', 'emissiveMap', 'aoMap']) scan(m[k], k);
      if (m.uniforms) for (const [k, u] of Object.entries(m.uniforms)) scan(u?.value, k);
      out.materials.push({ type: m.type, name: m.name || null, transparent: m.transparent, side: m.side, uniforms: m.uniforms ? Object.keys(m.uniforms).length : null, defines: m.defines ? Object.keys(m.defines).length : 0, textures: t });
    }
    out.triangles = Math.round(out.triangles);
    return out;
  }

  /** Draw calls and triangles the group adds to a whole rendered frame (main + shadow + post). */
  function frameDelta(group) {
    g.renderer.render(g.scene, g.camera, 0);
    const a = { ...g.renderer.stats };
    const v = group.visible;
    group.visible = false;
    g.renderer.render(g.scene, g.camera, 0);
    const b = { ...g.renderer.stats };
    group.visible = v;
    g.renderer.render(g.scene, g.camera, 0);
    return { calls: a.calls - b.calls, triangles: a.triangles - b.triangles, frameCalls: a.calls, frameTriangles: a.triangles };
  }

  /**
   * Stage a scenario and return its per-frame body (one call = one frame's work at 60 fps).
   *   wyvern.<pose>       Wyvern.update on the showcase's pose (flap advances its phase, walk moves on)
   *   animator / apply / matrices / skeleton   the parts of it on the flap pose
   *   rider.mounted / rider.onFoot   Rider.update
   *   frame               Game.frame(1/60) without rendering (every system's simulation + presentation)
   */
  function prepare(breed, scen) {
    const pose = g.player.wyvernPose;
    const P = (q) => {
      stage(`breed=${breed}&cam=three&${q}`);
      adv(1.0);
    };
    const flapper = () => {
      const rate = g.player.breed.flapRate;
      let ph = pose.flapPhase;
      return () => {
        pose.flapPhase = ph = (ph + rate / 60) % 1;
      };
    };
    const mesh = W.skinnedMesh;
    switch (scen) {
      case 'wyvern.flap': {
        P('pose=flap');
        const f = flapper();
        return () => {
          f();
          W.update(1 / 60, pose);
        };
      }
      case 'wyvern.walk': {
        P('pose=walk');
        const p0 = pose.position.clone();
        const v = pose.velocity.clone();
        let k = 0;
        return () => {
          // Walking on: the gait plants feet and queries the ground as it goes.
          pose.position.copy(p0).addScaledVector(v, ++k / 60);
          W.update(1 / 60, pose);
        };
      }
      case 'wyvern.glide':
      case 'wyvern.idle':
        P(`pose=${scen.split('.')[1]}`);
        return () => W.update(1 / 60, pose);
      case 'animator': {
        P('pose=flap');
        const f = flapper();
        const A = W.animator;
        return () => {
          f();
          A.update(1 / 60, pose, W.uniforms);
        };
      }
      case 'apply': {
        P('pose=flap');
        const A = W.animator;
        const bones = mesh.skeleton.bones;
        return () => A.apply(bones);
      }
      case 'matrices':
        P('pose=flap');
        return () => W.group.updateMatrixWorld(true);
      case 'skeleton':
        P('pose=flap');
        return () => mesh.skeleton.update();
      case 'rider.mounted': {
        P('pose=glide');
        const rp = g.player.riderPose;
        return () => g.rider.update(1 / 60, rp, W.saddle);
      }
      case 'rider.onFoot': {
        P('pose=idle&rider=beside');
        const rp = g.player.riderPose;
        return () => g.rider.update(1 / 60, rp, null);
      }
      case 'frame':
        P('pose=flap');
        return () => g.frame(1 / 60, false);
    }
    throw new Error(`unknown scenario ${scen}`);
  }

  window.__capM = {
    /** Static inventory of one breed (and the rider on it). */
    inventory(breed) {
      stage(`breed=${breed}&pose=glide&cam=three`);
      adv(0.5);
      const mesh = W.skinnedMesh;
      return {
        stats: W.stats,
        lods: W.lodCount ?? W.lods?.length ?? 1,
        inventory: inventory(W.group),
        frame: frameDelta(W.group),
        boneTexture: mesh.skeleton.boneTexture ? `${mesh.skeleton.boneTexture.image.width}x${mesh.skeleton.boneTexture.image.height}` : null,
      };
    },
    rider() {
      stage('breed=harrier&pose=glide&cam=three');
      adv(0.5);
      const mounted = { inventory: inventory(g.rider.group), frame: frameDelta(g.rider.group) };
      stage('breed=harrier&pose=idle&cam=side&rider=beside');
      adv(1.0);
      return { ...mounted, inventoryOnFoot: inventory(g.rider.group), quality: g.settings.quality };
    },
    async cosmeticTriangles() {
      try {
        const cat = await import('/src/cosmetics/catalog.ts');
        const Ctor = W.constructor;
        const tri = {};
        for (const [slot, key] of [['wyvernHorns', 'horns'], ['wyvernFrill', 'frill'], ['wyvernTail', 'tail'], ['saddle', 'saddle']]) {
          tri[key] = {};
          for (const c of cat.cosmeticsFor(slot)) {
            const w = new Ctor({ ...cat.DEFAULT_WYVERN, [key]: c.id });
            tri[key][c.id] = w.stats.triangles;
            w.dispose();
          }
        }
        return tri;
      } catch (e) {
        return `unavailable (${e.message})`;
      }
    },
    /** ms per call: 5 runs of n after a warm-up, median and min. */
    time(breed, scen, n) {
      let fn;
      try {
        fn = prepare(breed, scen);
      } catch (e) {
        return { error: e.message };
      }
      for (let i = 0; i < 300; i++) fn();
      const ms = [];
      for (let r = 0; r < 5; r++) {
        const t0 = performance.now();
        for (let i = 0; i < n; i++) fn();
        ms.push((performance.now() - t0) / n);
      }
      return { msMedian: round(median(ms)), msMin: round(Math.min(...ms)), runs: ms.map((x) => round(x)) };
    },
    /** Stage a scenario and warm it up; __capM.run(n) then runs it (for the heap profiler). */
    arm(breed, scen) {
      const fn = prepare(breed, scen);
      for (let i = 0; i < 300; i++) fn();
      this.run = (n) => {
        for (let i = 0; i < n; i++) fn();
      };
    },
  };
};

/** Bytes allocated per call of a scenario, from the sampling heap profiler (collected objects included). */
async function allocations(page, cdp, breed, scen, n) {
  await page.evaluate(([b, s]) => window.__capM.arm(b, s), [breed, scen]);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 128, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  await page.evaluate((k) => window.__capM.run(k), n);
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  let total = 0;
  const sites = new Map();
  const walk = (node, stack) => {
    const f = node.callFrame;
    const here = f.functionName || '(anonymous)';
    const where = f.url ? `${f.url.replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '')}:${f.lineNumber + 1}` : '';
    if (node.selfSize > 0) {
      total += node.selfSize;
      const key = `${here} ${where}`.trim();
      sites.set(key, (sites.get(key) ?? 0) + node.selfSize);
    }
    for (const c of node.children ?? []) walk(c, stack);
  };
  walk(profile.head, []);
  const top = [...sites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => ({ site: k, bytesPerCall: Math.round(v / n) }));
  return { bytesPerCall: Math.round(total / n), top };
}

async function measure(page, opts) {
  const breeds = opts.breeds ?? ['harrier', 'skimmer', 'galewing', 'ironback'];
  const n = opts.iterations ?? 600;
  const allocN = opts.allocIterations ?? 300;
  await page.evaluate(MEASURE_SETUP);
  const report = { when: new Date().toISOString(), quality: await page.evaluate(() => window.__dw.game.settings.quality), iterations: n, allocIterations: allocN, userAgent: await page.evaluate(() => navigator.userAgent), cpus: (await import('node:os')).cpus().length, loadavg: (await import('node:os')).loadavg().map((x) => +x.toFixed(2)), wyvern: {}, rider: {} };
  for (const b of breeds) report.wyvern[b] = await page.evaluate((x) => window.__capM.inventory(x), b);
  report.wyvern.cosmeticTriangles = await page.evaluate(() => window.__capM.cosmeticTriangles());
  report.rider = await page.evaluate(() => window.__capM.rider());
  // Warm every code path once before timing anything (the JIT otherwise bills the first breed).
  for (const b of breeds) for (const s of ['wyvern.flap', 'wyvern.idle', 'wyvern.walk']) await page.evaluate(([x, y]) => window.__capM.time(x, y, 60), [b, s]);
  const scen = ['wyvern.flap', 'wyvern.glide', 'wyvern.idle', 'wyvern.walk', 'animator', 'apply', 'matrices', 'skeleton'];
  for (const b of breeds) {
    const cpu = {};
    for (const s of scen) cpu[s] = await page.evaluate(([x, y, k]) => window.__capM.time(x, y, k), [b, s, n]);
    report.wyvern[b].cpu = cpu;
  }
  report.rider.cpu = {};
  for (const s of ['rider.mounted', 'rider.onFoot']) report.rider.cpu[s] = await page.evaluate(([y, k]) => window.__capM.time('harrier', y, k), [s, n]);
  report.frame = await page.evaluate(([k]) => window.__capM.time('harrier', 'frame', k), [Math.min(n, 120)]);
  // Allocations (sampling heap profiler through the DevTools protocol).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  report.alloc = {};
  for (const b of breeds) for (const s of ['wyvern.flap', 'wyvern.idle', 'wyvern.walk']) report.alloc[`${b} ${s}`] = await allocations(page, cdp, b, s, allocN);
  for (const s of ['rider.mounted', 'rider.onFoot', 'frame']) report.alloc[s] = await allocations(page, cdp, 'harrier', s, s === 'frame' ? 120 : allocN);
  await cdp.detach();
  return report;
}

// --- Python: contact sheets, onion skins, difference sheets, crops ------------------------------

const PY = String.raw`
import sys, json
from PIL import Image, ImageDraw, ImageFont
try:
    import numpy as np
except Exception:
    np = None

def font(sz):
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            pass
    try:
        return ImageFont.load_default(size=sz)
    except Exception:
        return ImageFont.load_default()

F_LABEL = font(15)
F_TITLE = font(20)
F_DESC = font(14)
BG = (17, 18, 22)

def header(w, title, desc):
    h = 58
    im = Image.new('RGB', (w, h), BG)
    d = ImageDraw.Draw(im)
    d.text((10, 6), title, fill=(240, 220, 170), font=F_TITLE)
    d.text((10, 34), desc[:int(w / 8.5)], fill=(200, 200, 200), font=F_DESC)
    return im

def label(im, text):
    d = ImageDraw.Draw(im, 'RGBA')
    l, t, r, b = d.textbbox((0, 0), text, font=F_LABEL)
    d.rectangle((0, 0, r - l + 12, b - t + 10), fill=(0, 0, 0, 170))
    d.text((6, 4 - t), text, fill=(255, 255, 255), font=F_LABEL)

def grid(tiles, cols, title, desc, gap=4):
    w, h = tiles[0].size
    rows = (len(tiles) + cols - 1) // cols
    W = cols * w + (cols + 1) * gap
    H = rows * h + (rows + 1) * gap
    head = header(W, title, desc)
    sheet = Image.new('RGB', (W, H + head.size[1]), BG)
    sheet.paste(head, (0, 0))
    for i, t in enumerate(tiles):
        r, c = divmod(i, cols)
        sheet.paste(t, (gap + c * (w + gap), head.size[1] + gap + r * (h + gap)))
    return sheet

FEET_COL = {'LH': (90, 200, 255), 'RH': (255, 170, 60), 'LF': (120, 255, 140), 'RF': (255, 90, 160)}

def draw_feet(im, feet):
    d = ImageDraw.Draw(im, 'RGBA')
    for f in feet:
        x, y = f['x'], f['y']
        if not (-50 < x < im.size[0] + 50 and -50 < y < im.size[1] + 50):
            continue
        c = FEET_COL.get(f['name'], (255, 255, 255))
        r = 7
        if f['swing']:
            d.ellipse((x - r, y - r, x + r, y + r), outline=c + (255,), width=2)
        else:
            d.ellipse((x - r, y - r, x + r, y + r), fill=c + (230,), outline=(0, 0, 0, 255))
        d.text((x + r + 2, y - 8), f['name'], fill=c + (255,), font=F_LABEL)

def gait_diagram(width, frames):
    # Hildebrand-style footfall diagram: rows LH, LF, RH, RF; a bar where the foot is in stance.
    rows = ['LH', 'LF', 'RH', 'RF']
    n = len(frames)
    h = 26 * len(rows) + 30
    im = Image.new('RGB', (width, h), BG)
    d = ImageDraw.Draw(im)
    x0 = 60
    cw = (width - x0 - 10) / max(1, n)
    for ri, name in enumerate(rows):
        y = 20 + ri * 26
        d.text((8, y + 2), name, fill=FEET_COL[name], font=F_LABEL)
        for i, feet in enumerate(frames):
            if not feet:
                continue
            f = next((q for q in feet if q['name'] == name), None)
            if f and not f['swing']:
                d.rectangle((x0 + i * cw + 1, y, x0 + (i + 1) * cw - 1, y + 18), fill=FEET_COL[name])
            else:
                d.rectangle((x0 + i * cw + 1, y, x0 + (i + 1) * cw - 1, y + 18), outline=(70, 70, 80))
    d.text((x0, 2), 'footfall: filled = stance (frame by frame)', fill=(200, 200, 200), font=F_DESC)
    return im

def lstar(a):
    c = a / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    y = lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722
    return np.where(y > 0.008856, 116 * np.cbrt(y) - 16, 903.3 * y)

for job in json.load(sys.stdin)['jobs']:
    kind = job['type']
    if kind == 'sheet':
        tiles = []
        feet_frames = []
        for fr in job['frames']:
            f, text = fr[0], fr[1]
            feet = fr[2] if len(fr) > 2 else None
            im = Image.open(f).convert('RGB')
            if feet:
                draw_feet(im, feet)
            label(im, text)
            tiles.append(im)
            feet_frames.append(feet)
        sheet = grid(tiles, job['cols'], job['title'], job['desc'])
        if job.get('gait') and any(feet_frames):
            gd = gait_diagram(sheet.size[0], feet_frames)
            out = Image.new('RGB', (sheet.size[0], sheet.size[1] + gd.size[1]), BG)
            out.paste(sheet, (0, 0))
            out.paste(gd, (0, sheet.size[1]))
            sheet = out
        sheet.save(job['out'], optimize=True)
    elif kind == 'diff' and np is not None:
        ims = [np.asarray(Image.open(f).convert('RGB')).astype(np.float32) for f, _ in job['frames']]
        tiles = []
        stats = []
        for i, ((f, text), a) in enumerate(zip(job['frames'], ims)):
            ref = ims[i - 1] if job.get('consecutive') and i > 0 else ims[0]
            raw = np.abs(a - ref).max(axis=2)
            stats.append({'frame': i, 'mean': round(float(raw.mean()), 3), 'p99': round(float(np.percentile(raw, 99)), 2), 'max': round(float(raw.max()), 1)})
            d = np.clip(raw * job['gain'], 0, 255).astype(np.uint8)
            heat = np.stack([d, (d * 0.7).astype(np.uint8), (255 - d) // 6], axis=2)
            im = Image.fromarray(heat)
            label(im, text + '  mean %.2f' % stats[-1]['mean'])
            tiles.append(im)
        grid(tiles, job['cols'], job['title'], job['desc']).save(job['out'], optimize=True)
        if job.get('stats'):
            import os
            os.makedirs(os.path.dirname(job['stats']), exist_ok=True)
            body = stats[1:] if job.get('consecutive') else stats
            summary = {'consecutive': bool(job.get('consecutive')), 'meanOfMeans': round(sum(s['mean'] for s in body) / max(1, len(body)), 3), 'maxP99': max((s['p99'] for s in body), default=0), 'frames': stats}
            json.dump(summary, open(job['stats'], 'w'), indent=1)
    elif kind == 'onion' and np is not None:
        ims = np.stack([np.asarray(Image.open(f).convert('RGB')).astype(np.float32) for f in job['frames']])
        med = np.median(ims, axis=0)
        out = med * 0.55
        n = len(ims)
        for i, a in enumerate(ims):
            m = (np.abs(a - med).max(axis=2) > 18)[..., None]
            w = 0.35 + 0.65 * (i + 1) / n
            out = np.where(m, out * (1 - w) + a * w, out)
        im = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
        head = header(im.size[0], job['title'], job['desc'])
        sheet = Image.new('RGB', (im.size[0], im.size[1] + head.size[1]), BG)
        sheet.paste(head, (0, 0))
        sheet.paste(im, (0, head.size[1]))
        sheet.save(job['out'], optimize=True)
    elif kind == 'crop':
        im = Image.open(job['src']).convert('RGB')
        b = job['box']
        x0 = int(round(job['cx'] - b / 2))
        y0 = int(round(job['cy'] - b / 2))
        x0 = max(0, min(im.size[0] - b, x0))
        y0 = max(0, min(im.size[1] - b, y0))
        c = im.crop((x0, y0, x0 + b, y0 + b)).resize((b * job['scale'], b * job['scale']), Image.NEAREST)
        label(c, job['label'])
        c.save(job['out'], optimize=True)
    elif kind == 'ortho':
        im = Image.open(job['src']).convert('RGB')
        lay = job['layout']
        ppm = lay['ppm']
        names = job.get('labels') or ['wyvern %d' % (i + 1) for i in range(len(lay['layout']))]
        W, H = im.size
        meas = []
        if job['matte'] and np is not None:
            a = np.asarray(im).astype(np.float32).mean(axis=2) < 128
            for i, box in enumerate(lay['layout']):
                x0 = max(0, int(box['x0']) - 3)
                x1 = min(W, int(box['x1']) + 4)
                sub = a[:, x0:x1]
                ys, xs = np.nonzero(sub)
                if len(xs) == 0:
                    meas.append(None)
                    continue
                wpx = xs.max() - xs.min() + 1
                hpx = ys.max() - ys.min() + 1
                area = sub.sum() / (ppm * ppm)
                m = {'name': names[i] if i < len(names) else str(i), 'width_m': round(wpx / ppm, 2), 'height_m': round(hpx / ppm, 2), 'area_m2': round(float(area), 2)}
                if lay['view'] == 'top':
                    m['span_m'] = m['width_m']
                    m['length_m'] = m['height_m']
                    m['planformAR'] = round(m['span_m'] ** 2 / max(1e-6, m['area_m2']), 2)
                    # Torso width: the narrowest... widest section of the body in the middle third
                    # of the length, wings excluded by taking runs that touch the centreline.
                    cx = int((xs.min() + xs.max()) / 2)
                    rows = []
                    for yy in range(ys.min(), ys.max() + 1):
                        row = sub[yy]
                        if not row[cx]:
                            rows.append(0)
                            continue
                        l = cx
                        while l > 0 and row[l - 1]:
                            l -= 1
                        r = cx
                        while r < len(row) - 1 and row[r + 1]:
                            r += 1
                        rows.append(r - l + 1)
                    m['centreRunMax_m'] = round(max(rows) / ppm, 2)
                elif lay['view'] == 'side':
                    m['length_m'] = m['width_m']
                    # Depth of the silhouette at the middle of its length (body depth incl. legs/wings).
                    cx = int((xs.min() + xs.max()) / 2)
                    col = sub[:, cx]
                    yy = np.nonzero(col)[0]
                    m['midDepth_m'] = round((yy.max() - yy.min() + 1) / ppm, 2) if len(yy) else None
                else:
                    m['frontWidth_m'] = m['width_m']
                meas.append(m)
            if job.get('json'):
                import os
                os.makedirs(os.path.dirname(job['json']), exist_ok=True)
                json.dump({'view': lay['view'], 'ppm': ppm, 'silhouettes': meas}, open(job['json'], 'w'), indent=1)
        d = ImageDraw.Draw(im, 'RGBA')
        # 1 m grid (every 5 m stronger), labels and the ground line.
        gy = lay['ground']['y'] if lay['view'] != 'top' else H
        col = (0, 0, 0, 40) if job['matte'] else (255, 255, 255, 34)
        col5 = (0, 0, 0, 90) if job['matte'] else (255, 255, 255, 80)
        x = lay['ground']['x'] % ppm
        k = 0
        start = lay['ground']['x'] - int(lay['ground']['x'] / ppm) * ppm
        xi = 0
        while start + xi * ppm < W:
            xx = start + xi * ppm
            idx = int(round((xx - lay['ground']['x']) / ppm))
            d.line((xx, 0, xx, H), fill=col5 if idx % 5 == 0 else col, width=1)
            xi += 1
        yi = 0
        while gy - yi * ppm > 0:
            yy = gy - yi * ppm
            d.line((0, yy, W, yy), fill=col5 if yi % 5 == 0 else col, width=1)
            yi += 1
        if lay['view'] != 'top':
            d.line((0, gy, W, gy), fill=(200, 40, 40, 200), width=2)
        tc = (20, 20, 20) if job['matte'] else (255, 255, 255)
        for i, box in enumerate(lay['layout']):
            nm = names[i] if i < len(names) else str(i)
            txt = nm
            if meas and i < len(meas) and meas[i]:
                m = meas[i]
                if lay['view'] == 'top':
                    txt += '  span %.1f m  len %.1f m  AR %.2f' % (m['span_m'], m['length_m'], m['planformAR'])
                elif lay['view'] == 'side':
                    txt += '  len %.1f m  ht %.1f m' % (m['length_m'], m['height_m'])
                else:
                    txt += '  w %.1f m  ht %.1f m' % (m['width_m'], m['height_m'])
            d.text((box['x0'], max(2, box['y0'] - 22)), txt, fill=tc, font=F_LABEL)
        d.text((8, H - 22), '%s  orthographic  %.1f px/m  grid 1 m (5 m bold)' % (job['title'], ppm), fill=tc, font=F_LABEL)
        im.save(job['out'], optimize=True)
    elif kind == 'cellstats' and np is not None:
        ls = [lstar(np.asarray(Image.open(f).convert('RGB')).astype(np.float32)) for f, _ in job['cells']]
        out = {'note': 'CIELAB L* (0..100) differences between each cell and cell 0, over the pixels that changed by more than 2 L*', 'cells': []}
        for (f, lab), l in zip(job['cells'], ls):
            dl = l - ls[0]
            m = np.abs(dl) > 2
            out['cells'].append({'label': lab, 'changedPx': int(m.sum()), 'meanDeltaL': round(float(dl[m].mean()) / 100, 4) if m.any() else 0, 'p90AbsDeltaL': round(float(np.percentile(np.abs(dl[m]), 90)) / 100, 4) if m.any() else 0})
        import os
        os.makedirs(os.path.dirname(job['out']), exist_ok=True)
        json.dump(out, open(job['out'], 'w'), indent=1)
`;

function flushPython() {
  if (!pyJobs.length) return;
  const r = spawnSync('python3', ['-c', PY], { input: JSON.stringify({ jobs: pyJobs }), encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) console.error(r.stderr);
  pyJobs.length = 0;
}

// --- Index ----------------------------------------------------------------------------------

function writeIndex() {
  const lines = [];
  lines.push(`# ${manifest.title ?? 'Dragon capture'}`, '');
  if (manifest.intro) lines.push(manifest.intro, '');
  lines.push(`Generated by \`node scripts/dragon-capture.mjs --manifest ${manifestPath}\` (last update ${new Date().toISOString()}).`, '');
  for (const sec of manifest.sections) {
    const secItems = items.filter((it) => it.section === sec.id && results[it.id]);
    if (!secItems.length) continue;
    lines.push(`## ${sec.title}`, '');
    if (sec.note) lines.push(sec.note, '');
    for (const it of secItems) {
      const r = results[it.id];
      if (r.failed) lines.push(`- **${it.id} failed**: ${r.failed}`);
      for (const f of r.files) lines.push(`- [\`${f.file}\`](${f.file}) — ${f.desc}`);
      if (r.frames?.length) lines.push(`  - ${r.kind === 'grid' ? 'cells' : 'frames'}: \`${path.posix.dirname(r.frames[0].file)}/\` (${r.frames.map((f) => path.posix.basename(f.file, '.png') + ' ' + f.label.replace(/^\d+\s+/, '')).join('; ')})`);
    }
    lines.push('');
  }
  const m = Object.values(results).filter((r) => r.kind === 'measure' && r.data);
  if (m.length) {
    lines.push('## Measurements (tables)', '');
    for (const r of m) lines.push(...measureTables(r), '');
  }
  fs.writeFileSync(path.join(outDir, 'index.md'), lines.join('\n'));
}

function measureTables(r) {
  const d = r.data;
  const L = [`### ${r.id} — quality=${d.quality}, ${d.iterations} iterations x 5 runs per timing (median ms), ${d.cpus} CPUs, load ${d.loadavg?.join(' ')}, ${d.when}`, ''];
  const breeds = Object.keys(d.wyvern).filter((k) => k !== 'cosmeticTriangles');
  const ms = (x) => (x?.msMedian ?? '—');
  if (breeds.length) {
    L.push('| breed | LODs | triangles | vertices | bones | bone texture | meshes / draws per pass | shadow draws | frame Δ calls | frame Δ triangles | buffers (KB) | materials | textures |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const b of breeds) {
      const w = d.wyvern[b];
      const inv = w.inventory;
      L.push(`| ${b} | ${w.lods} | ${w.stats.triangles} | ${w.stats.vertices} | ${w.stats.bones} | ${w.boneTexture} | ${inv.meshes} / ${inv.drawCallsPerPass} | ${inv.shadowCasters} | ${w.frame.calls} | ${w.frame.triangles} | ${(inv.bufferBytes / 1024).toFixed(0)} | ${inv.materials.map((x) => x.type).join(', ')} | ${inv.textures.map((t) => `${t.name} ${t.width}x${t.height}`).join(', ') || 'none'} |`);
    }
    L.push('', 'CPU per frame (ms, median of 5 runs):', '');
    L.push('| breed | Wyvern.update flap | glide | idle | walk | animator.update (flap) | apply to bones | updateMatrixWorld | skeleton.update (bone matrices) |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    for (const b of breeds) {
      const c = d.wyvern[b].cpu ?? {};
      L.push(`| ${b} | ${ms(c['wyvern.flap'])} | ${ms(c['wyvern.glide'])} | ${ms(c['wyvern.idle'])} | ${ms(c['wyvern.walk'])} | ${ms(c.animator)} | ${ms(c.apply)} | ${ms(c.matrices)} | ${ms(c.skeleton)} |`);
    }
    L.push('');
  }
  if (d.wyvern.cosmeticTriangles && typeof d.wyvern.cosmeticTriangles === 'object') {
    L.push('Harrier triangles by shape cosmetic: ' + Object.entries(d.wyvern.cosmeticTriangles).map(([k, v]) => `${k} {${Object.entries(v).map(([id, n]) => `${id} ${n}`).join(', ')}}`).join('; '), '');
  }
  if (d.rider?.inventory) {
    const i = d.rider.inventory;
    const f = d.rider.inventoryOnFoot;
    L.push(`Rider (mounted, quality ${d.rider.quality}): ${i.meshes} meshes (${i.skinned} skinned, ${i.bones} bones), ${i.drawCallsPerPass} draws per pass, ${i.shadowCasters} shadow draws, ${i.triangles} triangles, ${i.vertices} vertices, ${(i.bufferBytes / 1024).toFixed(0)} KB buffers, frame Δ ${d.rider.frame.calls} calls / ${d.rider.frame.triangles} triangles; ${i.materials.length} materials (${[...new Set(i.materials.map((x) => x.type))].join(', ')}); textures ${i.textures.map((t) => `${t.name} ${t.width}x${t.height}`).join(', ') || 'none'}. On foot: ${f.meshes} meshes, ${f.triangles} triangles.`);
    const c = d.rider.cpu ?? {};
    L.push(`Rider.update: mounted ${ms(c['rider.mounted'])} ms, on foot ${ms(c['rider.onFoot'])} ms. Whole Game.frame without rendering: ${ms(d.frame)} ms.`, '');
  }
  if (d.alloc) {
    L.push('Allocations per call (sampling heap profiler, 128-byte interval, collected objects included):', '');
    L.push('| scenario | bytes/call | top sites (bytes/call) |', '|---|---|---|');
    for (const [k, v] of Object.entries(d.alloc)) L.push(`| ${k} | ${v.bytesPerCall} | ${v.top.map((t) => `${t.site} ${t.bytesPerCall}`).join('; ')} |`);
    L.push('');
  }
  return L;
}

// --- Run ------------------------------------------------------------------------------------

const t0 = Date.now();
const bootOrder = [];
for (const it of selected) if (!bootOrder.includes(it.boot)) bootOrder.push(it.boot);
for (const bootId of bootOrder) {
  let { ctx, page, size } = await bootPage(bootId);
  current = { size };
  for (const it of selected.filter((x) => x.boot === bootId)) {
    try {
      // A page that reloaded (lost its helpers) would capture from a different state: boot again.
      if (!(await page.evaluate(() => !!window.__cap).catch(() => false))) {
        console.warn(`  page lost its state before ${it.id}; booting ${bootId} again`);
        await ctx.close();
        ({ ctx, page } = await bootPage(bootId));
        current = { size: null };
      }
      await runItem(page, it);
    } catch (e) {
      console.error(`  ${it.id} FAILED: ${e.message}`);
      results[it.id] = { id: it.id, section: it.section, kind: it.kind, desc: it.desc, failed: e.message, files: [] };
    }
    flushPython();
    saveResults();
  }
  const errs = await page.evaluate(() => window.__dw.errors).catch(() => []);
  for (const e of errs) pageErrors.push(`[${bootId}] ${e}`);
  await ctx.close();
}
await browser.close();
flushPython();
saveResults();
if (pageErrors.length) {
  console.log(`page errors (${pageErrors.length}):`);
  for (const e of [...new Set(pageErrors)].slice(0, 30)) console.log('  ' + e);
}
console.log(`done: ${selected.length} items in ${((Date.now() - t0) / 60000).toFixed(1)} min -> ${path.join(outDir, 'index.md')}`);
stopServer();
