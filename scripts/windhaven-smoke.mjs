// Run against a dev server: node scripts/windhaven-smoke.mjs http://127.0.0.1:5173
// CHROMIUM_PATH can select an installed Chromium/Edge binary. Captures go to ignored shots/.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const origin = process.argv[2] ?? 'http://127.0.0.1:5173';
console.log('Launching Windhaven browser check');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
try {
  console.log('Browser launched');
  if (!process.argv.includes('--live-only')) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.setDefaultTimeout(120000);
  await page.goto(`${origin}/?view=windhaven&manual=1&quality=low`);
  console.log('Page loaded');
  await page.waitForFunction(() => window.__dw?.ready);
  console.log('Game ready');
  await page.evaluate(() => window.__dw.render());
  fs.mkdirSync('shots', { recursive: true });
  const advance = seconds => page.evaluate(s => window.__dw.advance(s), seconds);
  for (const view of ['Overview', 'Top', 'Side']) {
    console.log(`Capturing ${view}`);
    await page.getByRole('button', { name: view, exact: true }).click();
    console.log(`${view} selected`);
    await page.evaluate(() => window.__dw.render());
    await page.screenshot({ path: `shots/windhaven-${view.toLowerCase()}.png` });
  }
  const savedBreed = await page.evaluate(() => window.__dw.game.save.data.wyvern.breed);
  for (const breed of ['harrier', 'skimmer', 'galewing', 'ironback']) {
    await page.getByRole('combobox', { name: 'Review wyvern breed' }).selectOption(breed);
    await page.getByRole('button', { name: 'Walk deck', exact: true }).click();
    await advance(0.5);
    assert.equal(await page.evaluate(() => window.__dw.game.player.mode), 'onFoot');
    const before = await page.evaluate(() => window.__dw.game.player.riderPosition.toArray());
    // Real player movement, with no position overrides during the run.
    await page.evaluate(() => window.__dw.advance(0.5, { foot: { moveX: 0, moveY: 1, sprint: false } }));
    const after = await page.evaluate(() => window.__dw.game.player.riderPosition.toArray());
    assert.ok(Math.hypot(after[0] - before[0], after[2] - before[2]) > 0.3, `${breed} walks`);
    assert.ok(Math.abs(after[1] - 650) < 0.02, `${breed} stays on the deck`);
    await page.getByRole('button', { name: 'Ride / take off', exact: true }).click();
    await advance(0.5);
    assert.equal(await page.evaluate(() => window.__dw.game.player.mode), 'landed');
    await page.evaluate(() => window.__dw.advance(0.1, { flight: { flap: 1 } }));
    for (let i = 0; i < 10; i++) await advance(0.5);
    const state = await page.evaluate(() => ({ mode: window.__dw.game.player.mode, y: window.__dw.game.player.position.y }));
    assert.equal(state.mode, 'flying');
    assert.ok(state.y > 657, `${breed} climbs clear`);
    console.log(`PASS ${breed}: walk, deck support, mount placement and takeoff in browser`);
  }
  assert.equal(await page.evaluate(() => window.__dw.game.save.data.wyvern.breed), savedBreed, 'review selector must not change saved breed');
  await page.getByRole('combobox', { name: 'Review wyvern breed' }).selectOption('galewing');
  await page.getByRole('button', { name: 'Walk deck', exact: true }).click();
  await advance(0.5);
  await page.evaluate(() => window.__dw.render());
  await page.screenshot({ path: 'shots/windhaven-walk.png' });
  const runtimeErrors = await page.evaluate(() => window.__dw.errors);
  assert.deepEqual([...errors, ...runtimeErrors], []);
  console.log('PASS review cameras, breed selector, saved breed unchanged, no browser errors');
  await page.close();
  }

  // Second pass: normal requestAnimationFrame loop and real keyboard events. No advance(),
  // scripted input or teleport calls in this phase: only the exposed review buttons reset.
  const live = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const liveErrors = [];
  live.on('pageerror', e => liveErrors.push(e.message));
  live.on('console', m => { if (m.type() === 'error') liveErrors.push(m.text()); });
  live.setDefaultTimeout(30000);
  await live.goto(`${origin}/?view=windhaven&quality=low&debug=1`);
  await live.waitForFunction(() => window.__dw?.ready && !document.querySelector('#boot:not(.done)'));
  await live.getByText('Inspection paused — choose Walk deck to play.', { exact: true }).waitFor();
  assert.equal(await live.evaluate(() => window.__dw.game.debug.manual), false);
  console.log('PASS live boot: real frame loop and explicit inspection state');
  for (const breed of ['harrier', 'skimmer', 'galewing', 'ironback']) {
    await live.getByRole('combobox', { name: 'Review wyvern breed' }).selectOption(breed);
    await live.getByRole('button', { name: 'Walk deck', exact: true }).click();
    await live.waitForFunction(() => window.__dw.game.screen === 'play' && window.__dw.game.player.mode === 'onFoot');
    const start = await live.evaluate(() => window.__dw.game.player.riderPosition.toArray());
    await live.keyboard.down('w');
    try {
      await live.waitForFunction(p => {
        const at = window.__dw.game.player.riderPosition;
        return Math.hypot(at.x - p[0], at.z - p[2]) > 1;
      }, start);
    } finally { await live.keyboard.up('w'); }
    assert.ok(Math.abs(await live.evaluate(() => window.__dw.game.player.riderPosition.y) - 650) < 0.05);
    // Reset close to the mount, then use F through the actual keyboard input pipeline.
    await live.getByRole('button', { name: 'Walk deck', exact: true }).click();
    await live.keyboard.press('f');
    await live.waitForFunction(() => window.__dw.game.player.mode === 'landed');
    await live.keyboard.press('f');
    await live.waitForFunction(() => window.__dw.game.player.mode === 'onFoot');
    await live.getByRole('button', { name: 'Ride / take off', exact: true }).click();
    // Flapping is held input: a down/up pair inside a render frame with no fixed step
    // can disappear before gameplay consumes it. Hold through the real launch/climb.
    await live.keyboard.down('Space');
    try {
      await live.waitForFunction(() => window.__dw.game.player.mode === 'flying' && window.__dw.game.player.position.y > 657);
    } finally { await live.keyboard.up('Space'); }
    await live.keyboard.press('Escape');
    await live.waitForFunction(() => window.__dw.game.screen === 'pause');
    // Review reset must restore play even if Escape or a browser focus change paused it.
    await live.getByRole('button', { name: 'Walk deck', exact: true }).click();
    await live.waitForFunction(() => window.__dw.game.screen === 'play' && window.__dw.game.player.mode === 'onFoot');
    console.log(`PASS ${breed}: live keyboard walk, F mount/dismount, Space launch, pause and deck recovery`);
  }
  // Let the real scene finish its pause-menu/camera transition before checking the capture.
  const resetTime = await live.evaluate(() => window.__dw.game.save.data.playTime);
  await live.waitForFunction(t => window.__dw.game.save.data.playTime > t + 1 && window.__dw.game.renderer.grade.uFade.value < 0.01, resetTime);
  fs.mkdirSync('shots', { recursive: true });
  await live.screenshot({ path: 'shots/windhaven-live.png' });
  assert.deepEqual([...liveErrors, ...await live.evaluate(() => window.__dw.errors)], []);
  await live.reload();
  await live.waitForFunction(() => window.__dw?.ready && !document.querySelector('#boot:not(.done)'));
  await live.getByRole('button', { name: 'Walk deck', exact: true }).click();
  await live.waitForFunction(() => window.__dw.game.player.mode === 'onFoot' && !window.__dw.game.debug.freeze);
  assert.deepEqual([...liveErrors, ...await live.evaluate(() => window.__dw.errors)], []);
  console.log('PASS live reload and recovery, no browser errors');
} finally {
  await browser.close();
}
