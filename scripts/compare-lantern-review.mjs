import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const out = path.resolve(process.argv[2] ?? '/tmp/lantern-evidence');
const read = name => JSON.parse(fs.readFileSync(path.join(out, name, 'evidence.json'), 'utf8'));
const before = read('before'), after = read('after');
assert.equal(before.passed, true); assert.equal(after.passed, true);
assert.equal(before.metadata.testedHead, 'f97bac535611e09c6c732230b5f0ca73b9bbf804');
assert.equal(after.metadata.runnerDirty, false, 'final evidence must use a clean checkout');
assert.equal(before.attempts.length, after.attempts.length);
const runs = before.attempts.map((a, i) => {
  const b = after.attempts[i];
  assert.equal(a.metrics.breed, b.metrics.breed); assert.equal(a.metrics.repeat, b.metrics.repeat);
  assert.deepEqual(a.metrics.startConditions, b.metrics.startConditions);
  assert.ok(Math.abs(a.timeMs - b.timeMs) < 0.01, 'presentation-only changes must preserve matched pilot time');
  return { breed: a.metrics.breed, attempt: a.metrics.repeat + 1, beforeMs: a.timeMs, afterMs: b.timeMs, airborneFraction: b.metrics.airborneFraction, modes: b.metrics.modes };
});
const scenes = ['find', 'enter', 'leave', 'finish'].map(name => {
  const a = before.scenes.find(s => s.name === name), b = after.scenes.find(s => s.name === name);
  for (const key of ['position', 'camera', 'weather', 'waypoint', 'finish']) assert.deepEqual(a[key], b[key], `${name}: matched ${key}`);
  for (const key of ['calls', 'triangles']) assert.equal(a.stats[key], b.stats[key], `${name}: no added 3D ${key}`);
  return { name, before: a.stats, after: b.stats };
});
const summary = { baseline: before.metadata.testedHead, head: after.metadata.testedHead, runs, scenes, hudCost: { before: before.hudCost, after: after.hudCost }, physicalControllerTested: false, physicalWindowsTested: false };
fs.writeFileSync(path.join(out, 'comparison.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(out, 'comparison.html'), `<!doctype html><meta charset="utf-8"><title>Lantern Dash private review</title><style>body{font:16px system-ui;background:#182631;color:#f2eada;margin:2em}h1{font-size:1.4em}section{margin:2em 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:1em}figure{margin:0}img{width:100%;height:auto}figcaption{padding:.4em}small{color:#c6ac86}@media(max-width:800px){.pair{grid-template-columns:1fr}}</style><h1>Lantern Dash: suggested lift and recovery</h1><p>Baseline ${summary.baseline.slice(0, 7)} → review ${summary.head.slice(0, 7)}. Player, camera, clear weather, heading and phase match. These are staged readability views.</p><p><small>Virtual controller / cloud Chromium checks. Physical Windows, gamepad, rumble and human usability remain unverified. Full-flow airborne measurements are in comparison.json; these still frames are not airtime evidence.</small></p>${scenes.map(s => `<section><h2>${s.name}</h2><div class="pair"><figure><img src="before/${s.name}.png"><figcaption>Before</figcaption></figure><figure><img src="after/${s.name}.png"><figcaption>After · Show tips enabled</figcaption></figure></div></section>`).join('')}`);
console.log(JSON.stringify({ baseline: summary.baseline, head: summary.head, matchedRuns: runs.length, matchedScenes: scenes.length, hudMedianBeforeMs: before.hudCost.medianMs, hudMedianAfterMs: after.hudCost.medianMs }));
