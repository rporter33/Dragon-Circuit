// Headless screenshots for development and review.
//
//   node scripts/shot.mjs --url "http://localhost:5173/?play=1&manual=1&tod=0.3" --out shots/a.png
//        [--advance 2] [--input '{"flight":{"flap":1}}'] [--size 1280x720] [--eval "js expr"]
//        [--steps steps.json]
//
// With ?manual=1 the game does not run its own loop; this script drives time through
// window.__dw.advance(seconds), which keeps captures deterministic even on a software GPU.
// --steps takes a JSON array of { advance, input?, shot?, eval? } run in order.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const url = opt('url', 'http://localhost:5173/?play=1&manual=1');
const out = opt('out', 'shots/shot.png');
const [w, h] = opt('size', '1280x720').split('x').map(Number);
const stepsFile = opt('steps');
let steps = stepsFile
  ? JSON.parse(fs.readFileSync(stepsFile, 'utf8'))
  : [{ advance: Number(opt('advance', '1')), input: opt('input') ? JSON.parse(opt('input')) : undefined, eval: opt('eval'), shot: out }];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__dw?.ready === true, null, { timeout: 60000 });

for (const step of steps) {
  if (step.eval) await page.evaluate(step.eval);
  if (step.advance) {
    // Advance in chunks so long runs don't block the page for minutes.
    let left = step.advance;
    while (left > 0) {
      const chunk = Math.min(left, 0.5);
      await page.evaluate(([s, input]) => window.__dw.advance(s, input), [chunk, step.input ?? null]);
      left -= chunk;
    }
  }
  if (step.shot) {
    await page.evaluate(() => window.__dw.render());
    fs.mkdirSync(path.dirname(step.shot), { recursive: true });
    await page.screenshot({ path: step.shot });
    console.log(`saved ${step.shot}`);
  }
  if (step.log) {
    const v = await page.evaluate(step.log);
    console.log(JSON.stringify(v));
  }
}

const errors = await page.evaluate(() => window.__dw.errors);
for (const l of logs) console.log(l);
if (errors.length) console.log('errors:', errors);
await browser.close();
