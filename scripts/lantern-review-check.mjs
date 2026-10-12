// Exact-head production QA. Virtual standard gamepad; automated steering is feasibility,
// not human usability. Never replaces navigator.getGamepads outside this browser context.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'rolldown';
import { chromium } from 'playwright';
import { browserEvidence } from './browser-evidence.mjs';

const args = process.argv.slice(2);
const opt = (key, fallback) => args.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const baseline = args.includes('--baseline');
const url = new URL(args[0] ?? 'http://127.0.0.1:5174/');
url.search = '?manual=1&quality=low&tod=0.5&weather=clear';
const out = path.resolve(opt('out', '/tmp/driftwing-lantern-review'));
fs.mkdirSync(out, { recursive: true });
const bundle = await build({ input: 'scripts/lantern-pilot.ts', output: { format: 'iife', name: 'LanternPilot' } });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [], evidence = { baseline, input: 'virtual standard gamepad via actual Input.poll; existing feasibility autopilot', attempts: [], scenes: [], limitations: ['No physical controller, rumble or human usability certification.', 'Automated full attempts are race sessions, not a representative exploration/RPG session.'] };
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await page.goto(url.href); await page.waitForFunction(() => window.__dw?.ready);
  evidence.metadata = await browserEvidence(page, url);
  await page.addScriptTag({ content: bundle.output.find(o => o.type === 'chunk').code });
  await page.evaluate(() => {
    const g = __dw.game;
    g.save.data.firstLeadGuide = 'skipped';
    g.startGame();
    g.applySettings({ ...g.settings, showControlHints: true, reducedMotion: true, invertPitch: false, invertPitchPad: false, holdToFlap: true });
    const pad = window.__lanternPad = { id: 'Lantern review virtual Xbox standard controller', mapping: 'standard', connected: true, index: 0, timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
    window.__lanternButton = (i, value) => pad.buttons[i] = { pressed: value > 0.5, touched: value > 0, value };
    window.__lanternNeutral = () => { pad.axes.fill(0); pad.buttons.forEach((_, i) => __lanternButton(i, 0)); };
    window.__lanternClimate = () => {
      g.weather.set('clear', true); g.weather.time = 0; g.weather.drift.set(0, 0, 0);
      g.weather.clock.elapsed = g.weather.clock.transition; g.weather.clock.duration = 1e9;
      g.weather.clock.heading = g.weather.clock.fromHeading = g.weather.clock.targetHeading = 0.4;
      g.weather.update(0, g.camera, g.player.position);
      g.weather.field.state.time = 0; g.weather.field.state.drift.set(0, 0, 0);
      g.weather.lift = 0; g.weather.thermalId = -1;
    };
    window.__lanternTick = n => { for (let i = 0; i < n; i++) g.frame(1 / 120, false); };
    window.__lanternEvents = { respawns: 0, misses: 0, touches: 0, hits: 0 };
    g.events.on('respawn', () => __lanternEvents.respawns++);
    g.events.on('ringMissed', () => __lanternEvents.misses++);
    g.events.on('touchdown', () => __lanternEvents.touches++);
    g.events.on('terrainHit', e => { if (e.impulse > 2.5) __lanternEvents.hits++; });
  });

  // Measure complete begin -> finish -> results -> retry flows, including on-foot time before
  // the first launch. Count menus separately: a frozen dragon in a menu is not flight time.
  for (const breed of ['harrier', 'galewing', 'skimmer', 'ironback']) {
    const repeats = ['harrier', 'galewing'].includes(breed) ? 2 : 1;
    for (let repeat = 0; repeat < repeats; repeat++) {
      await page.evaluate(({ breed, repeat }) => {
        const g = __dw.game;
        if (repeat === 0) g.resume();
        __lanternNeutral();
        if (repeat === 0) { g.races.abort('quit'); g.setWyvernLook({ ...g.save.data.wyvern, breed }); g.placeAtSpawn(); }
        const metrics = window.__lanternMetrics = { breed, repeat, modes: {}, menuSeconds: 0, sampledSeconds: 0, flapFreeGain: 0, maxStall: 0, mappingError: 0, coachingSequence: [], lastCoachPhase: null, finalApproachSamples: 0, finalApproachPhases: {}, badApproach: [], startConditions: null, eventsBefore: { ...__lanternEvents } };
        window.__lanternSample = () => {
          const mode = g.screen === 'play' && !g.ui.capturesInput ? g.player.mode : 'menu';
          metrics.modes[mode] = (metrics.modes[mode] ?? 0) + 1 / 120;
          metrics.sampledSeconds += 1 / 120;
        };
        // Four seconds at the Roost (first attempt); later retries include results/menu below.
        if (repeat === 0) for (let i = 0; i < 480; i++) { g.frame(1 / 120, false); __lanternSample(); }
        __lanternClimate();
        metrics.startConditions = { kind: g.weather.kind, params: { ...g.weather.params }, time: g.weather.time, drift: g.weather.drift.toArray(), heading: g.weather.clock.heading };
        if (repeat === 0) g.beginRace('lantern-dash');
        else { __lanternButton(8, 1); __lanternTick(1); __lanternButton(8, 0); }
        window.__lanternRunner = LanternPilot.create(g);
        window.__lanternFree = null;
      }, { breed, repeat });
      let result;
      for (let chunk = 0; chunk < 50; chunk++) {
        result = await page.evaluate(baseline => {
          const g = __dw.game, m = __lanternMetrics, runner = __lanternRunner;
          const finish = g.races.defs.find(d => d.id === 'lantern-dash').rings[0].position;
          for (let i = 0; i < 1200 && ['countdown', 'running'].includes(g.races.state); i++) {
            LanternPilot.steer(g, __lanternPad, runner);
            const y = g.player.flight.position.y;
            const flapFree = runner.pilot.circling && runner.input.flap === 0;
            g.frame(1 / 120, false); __lanternSample();
            m.maxStall = Math.max(m.maxStall, g.player.flight.stall);
            m.mappingError = Math.max(m.mappingError, Math.abs(g.input.frame.flight.pitch - runner.input.pitch), Math.abs(g.input.frame.flight.roll - runner.input.roll));
            const p = g.player.position;
            if (g.races.state === 'running') {
              const coach = document.querySelector('.dw-lantern-coach'), phase = coach?.dataset.phase ?? 'absent';
              if (phase !== m.lastCoachPhase && m.coachingSequence.length < 24)
                m.coachingSequence.push({ phase, timeMs: g.races.elapsedMs, position: p.toArray(), text: coach?.textContent });
              m.lastCoachPhase = phase;
            }
            // Independent final-flight window: observe real full attempts rather than staging
            // a successful end pose or using the coach's departure altitude as a test oracle.
            if (g.races.state === 'running' && g.player.mode === 'flying' && g.player.flight.stall <= 0.05 &&
                Math.hypot(p.x - finish[0], p.z - finish[2]) < 180 && p.y >= finish[1] - 10 && p.y <= finish[1] + 40) {
              const coach = document.querySelector('.dw-lantern-coach'), phase = coach?.dataset.phase ?? 'absent';
              m.finalApproachSamples++;
              m.finalApproachPhases[phase] = (m.finalApproachPhases[phase] ?? 0) + 1;
              if (!baseline && !['approach', 'finish'].includes(phase) && m.badApproach.length < 5)
                m.badApproach.push({ position: p.toArray(), phase, text: coach?.textContent });
            }
            if (flapFree && g.input.frame.flight.flap === 0) {
              if (__lanternFree === null) __lanternFree = y;
              m.flapFreeGain = Math.max(m.flapFreeGain, g.player.flight.position.y - __lanternFree);
            } else __lanternFree = null;
            if (g.races.state === 'running' && __lanternEvents.misses > m.eventsBefore.misses) {
              runner.pilot.goAround(runner.ringS); m.eventsBefore.misses = __lanternEvents.misses;
            }
          }
          return { state: g.races.state, mode: g.player.mode, position: g.player.position.toArray(), metrics: m, timeMs: g.races.elapsedMs, events: { ...__lanternEvents } };
        }, baseline);
        if (!['countdown', 'running'].includes(result.state)) break;
      }
      assert.equal(result.state, 'finished', `${breed}/${repeat}: ${JSON.stringify(result)}`);
      assert.equal(result.events.respawns, result.metrics.eventsBefore.respawns, 'whole route must finish without respawn');
      assert.equal(result.events.hits, result.metrics.eventsBefore.hits, 'whole route must avoid hard solid contacts');
      assert.ok(result.metrics.mappingError < 1e-6, 'real stick mapping must match requested pilot steering');
      assert.ok(result.metrics.finalApproachSamples > 0, 'each full attempt must observe the actual lower final approach');
      if (!baseline) assert.deepEqual(result.metrics.badApproach, [], 'valid final descent must stay aimed at the finish, not seek/circle back');
      if (!baseline) {
        assert.ok(result.metrics.coachingSequence.some(s => s.phase === 'seek'), 'full attempt observes finding lift');
        assert.ok(result.metrics.coachingSequence.some(s => s.phase === 'climb'), 'full attempt observes entering real lift');
        assert.ok(result.metrics.coachingSequence.some(s => s.phase === 'approach'), 'full attempt observes the lower finish approach');
      }
      // Wait for the actual result card, then View performs the existing retry in next repeat.
      await page.evaluate(() => {
        __lanternNeutral();
        for (let i = 0; i < 360; i++) { __dw.game.frame(1 / 120, false); __lanternSample(); }
      });
      result.metrics = await page.evaluate(() => __lanternMetrics);
      result.metrics.airborneFraction = (result.metrics.modes.flying ?? 0) / result.metrics.sampledSeconds;
      evidence.attempts.push(result);
      console.log(`${breed} ${repeat + 1}: ${(result.timeMs / 1000).toFixed(2)} s; flap-free +${result.metrics.flapFreeGain.toFixed(1)} m; whole-flow ${(100 * result.metrics.airborneFraction).toFixed(1)}% flight`);
    }
  }

  evidence.persisted = await page.evaluate(async () => {
    const g = __dw.game;
    await new Promise(resolve => setTimeout(resolve, 100));
    const record = { ...g.save.data.races['lantern-dash'] };
    const ghost = await g.save.getGhost('lantern-dash');
    return { record, ghost: ghost ? { raceId: ghost.raceId, breed: ghost.breed, timeMs: ghost.timeMs, samples: ghost.samples?.length ?? ghost.data?.length } : null };
  });
  assert.ok(evidence.persisted.ghost, 'best run persists a ghost');

  // The existing pace pilot can reach the thermal nearly at its exit height. A full route
  // therefore need not include 30 m of circling. Verify the learning exercise separately,
  // explicitly staged in real lift; never use this fragment as the full-flow airtime measure.
  evidence.thermalExercise = [];
  for (const breed of ['harrier', 'galewing', 'skimmer', 'ironback']) {
    const climb = await page.evaluate(breed => {
      const g = __dw.game; g.resume(); g.races.abort('quit'); __lanternNeutral();
      g.setWyvernLook({ ...g.save.data.wyvern, breed }); __lanternClimate();
      const entrySpeed = Math.max(26, 1.35 * g.player.model.derived.vStall / Math.sqrt(Math.cos(42 * Math.PI / 180)));
      // Tangential entry in the pilot's circling direction, rather than an artificial 180°
      // reversal inside the core (particularly unfair to Ironback's existing roll inertia).
      g.player.teleport(g.player.position.clone().set(-1255, 610, 480), Math.PI, 'flying', entrySpeed);
      const runner = LanternPilot.create(g);
      runner.pilot.s = runner.pilot.path.nodeS[2];
      runner.pilot.path.nodes[2].climbTo = 780;
      const y = g.player.position.y, respawns = __lanternEvents.respawns;
      let seconds = 0, maxFlap = 0;
      for (let i = 0; i < 120 * 40 && g.player.position.y - y < 30; i++) {
        LanternPilot.steer(g, __lanternPad, runner);
        runner.input.flap = 0; LanternPilot.setFlight(__lanternPad, runner.input);
        __lanternTick(1); seconds += 1 / 120;
        maxFlap = Math.max(maxFlap, g.input.frame.flight.flap);
      }
      __lanternNeutral();
      return { breed, entrySpeed, seconds, gain: g.player.position.y - y, maxFlap, respawns: __lanternEvents.respawns - respawns, mode: g.player.mode };
    }, breed);
    evidence.thermalExercise.push(climb);
    assert.ok(climb.gain >= 30 && climb.maxFlap === 0 && climb.respawns === 0, `real-air 30 m exercise: ${JSON.stringify(climb)}`);
  }

  // Matched world/HUD scenes; position, camera, sky and weather phase are reset identically.
  for (const [name, position, yaw, speed] of [
    ['find', [-900, 560, 500], -Math.PI / 2, 30],
    ['enter', [-1300, 610, 480], -Math.PI / 2, 26],
    ['leave', [-1270, 735, 480], Math.PI / 2, 28],
    ['finish', [-970, 706, 740], -1.2, 30],
  ]) {
    const scene = await page.evaluate(({ position, yaw, speed }) => {
      const g = __dw.game;
      g.resume(); g.races.abort('quit'); __lanternNeutral();
      g.setWyvernLook({ ...g.save.data.wyvern, breed: 'harrier' }); __lanternClimate();
      g.player.teleport(g.player.position.clone().fromArray(position), yaw, 'flying', speed);
      g.cameraRig.snap(g.player); g.races.debugStage('lantern-dash', 0, 30000);
      __lanternTick(12); __dw.render();
      const def = g.races.defs.find(d => d.id === 'lantern-dash');
      return { position: g.player.position.toArray(), camera: g.camera.position.toArray(), weather: { kind: g.weather.kind, time: g.weather.time, drift: g.weather.drift.toArray(), fieldTime: g.weather.field.state.time, heading: g.weather.clock.heading }, waypoint: g.races.waypoint(g.player.position.clone()).toArray(), finish: def.rings[0].position, stats: __dw.stats(), coach: document.querySelector('.dw-lantern-coach')?.textContent };
    }, { position, yaw, speed });
    assert.deepEqual(scene.waypoint, scene.finish, 'guidance preserves the true finish target');
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    evidence.scenes.push({ name, ...scene });
  }

  if (!baseline) {
    evidence.recovery = await page.evaluate(() => {
      const g = __dw.game;
      const stage = (x, y, z, speed = 26) => { g.player.teleport(g.player.position.clone().set(x, y, z), 0, 'flying', speed); g.frame(0, false); };
      stage(-1300, 600, 480); const entry = document.querySelector('.dw-lantern-coach').dataset.phase;
      stage(-1100, 600, 480); const missedLift = document.querySelector('.dw-lantern-coach').dataset.phase;
      stage(-1300, 610, 480); const reentry = document.querySelector('.dw-lantern-coach').dataset.phase;
      g.player.flight.stall = 0.5; g.frame(0, false); const stall = document.querySelector('.dw-lantern-coach').dataset.phase;
      g.player.flight.stall = 0; g.events.emit('ringMissed', { raceId: 'lantern-dash', index: 0 }); g.frame(0, false);
      return { entry, missedLift, reentry, stall, overshoot: document.querySelector('.dw-lantern-coach').dataset.phase };
    });
    assert.deepEqual(evidence.recovery, { entry: 'climb', missedLift: 'recover', reentry: 'climb', stall: 'stall', overshoot: 'finish' });
    // One staged entry, then continuous real flight: fly out of lift, see recovery, and steer
    // back through Input.poll. No teleport between departure and re-entry; no airtime claim.
    evidence.offLineRecovery = await page.evaluate(() => {
      const g = __dw.game; g.resume(); g.races.abort('quit'); __lanternNeutral(); __lanternClimate();
      g.player.teleport(g.player.position.clone().set(-1300, 600, 480), 0, 'flying', 26);
      g.races.debugStage('lantern-dash', 0, 30000); g.frame(0, false);
      const sequence = [], respawns = __lanternEvents.respawns;
      let last = '', seconds = 0;
      const sample = () => {
        const el = document.querySelector('.dw-lantern-coach'), phase = el.dataset.phase;
        if (phase !== last && sequence.length < 16) sequence.push({ phase, seconds, position: g.player.position.toArray(), text: el.textContent });
        last = phase; return phase;
      };
      sample();
      for (let i = 0; i < 1200 && last !== 'recover' && g.races.state === 'running'; i++) { __lanternTick(1); seconds += 1 / 120; sample(); }
      const sawRecovery = last === 'recover';
      const runner = LanternPilot.create(g);
      runner.pilot.s = runner.pilot.path.nodeS[2];
      runner.pilot.circlingNode = 2; // QA pilot's existing orbit mode, never runtime navigation
      let reentered = false;
      for (let i = 0; i < 7200 && !reentered && g.races.state === 'running'; i++) {
        LanternPilot.steer(g, __lanternPad, runner); __lanternTick(1); seconds += 1 / 120;
        reentered = sample() === 'climb';
      }
      __lanternNeutral(); g.races.abort('quit');
      return { sawRecovery, reentered, seconds, sequence, respawns: __lanternEvents.respawns - respawns, mode: g.player.mode };
    });
    assert.ok(evidence.offLineRecovery.sawRecovery && evidence.offLineRecovery.reentered && evidence.offLineRecovery.respawns === 0 && evidence.offLineRecovery.mode === 'flying', 'real missed-lift flight must return to lift with truthful recovery cues');
    // Actual stall recovery inputs at a safe height; this is a staged failure, not a whole run.
    evidence.stallRecovery = await page.evaluate(() => {
      const g = __dw.game;
      g.races.abort('quit'); g.player.teleport(g.player.position.clone().set(-900, 900, 500), 0, 'flying', 8);
      g.races.debugStage('lantern-dash', 0, 30000); __lanternNeutral();
      LanternPilot.setFlight(__lanternPad, { pitch: 0.8, roll: 0, yaw: 0, flap: 0, flare: 0, tuck: 0 });
      for (let i = 0; i < 360 && g.player.flight.stall < 0.2; i++) __lanternTick(1);
      const before = { stall: g.player.flight.stall, speed: g.player.flight.airspeed };
      LanternPilot.setFlight(__lanternPad, { pitch: -0.15, roll: 0, yaw: 0, flap: 1, flare: 0, tuck: 0 }); __lanternTick(480);
      __lanternNeutral();
      return { before, after: { stall: g.player.flight.stall, speed: g.player.flight.airspeed }, mode: g.player.mode, input: g.input.device };
    });
    assert.ok(evidence.stallRecovery.before.stall > 0.15);
    assert.ok(evidence.stallRecovery.after.stall < 0.1 && evidence.stallRecovery.after.speed > evidence.stallRecovery.before.speed);

    evidence.actualOvershoot = await page.evaluate(() => {
      const g = __dw.game; g.races.abort('quit'); __lanternNeutral();
      const ring = g.races.defs.find(d => d.id === 'lantern-dash').rings[0];
      const normal = g.player.position.clone().fromArray(ring.normal);
      const before = g.player.position.clone().fromArray(ring.position).addScaledVector(normal, -80); before.y += 50;
      g.player.teleport(before, Math.atan2(normal.x, normal.z), 'flying', 35);
      g.races.debugStage('lantern-dash', 0, 30000);
      const misses = __lanternEvents.misses, respawns = __lanternEvents.respawns;
      for (let i = 0; i < 1200 && __lanternEvents.misses === misses && g.races.state === 'running'; i++) __lanternTick(1);
      const state = g.races.state, cue = document.querySelector('.dw-lantern-coach').dataset.phase;
      const heading = Math.atan2(g.player.flight.velocity.x, g.player.flight.velocity.z);
      LanternPilot.setFlight(__lanternPad, { pitch: 0, roll: 0.5, yaw: 0, flap: 0, flare: 0, tuck: 0 }); __lanternTick(360);
      const turned = Math.abs(Math.atan2(g.player.flight.velocity.x, g.player.flight.velocity.z) - heading);
      const result = { state, cue, missed: __lanternEvents.misses > misses, turnedRadians: turned, respawns: __lanternEvents.respawns - respawns, mode: g.player.mode };
      __lanternNeutral(); g.races.abort('quit');
      return result;
    });
    assert.equal(evidence.actualOvershoot.missed, true); assert.equal(evidence.actualOvershoot.cue, 'finish');
    assert.ok(evidence.actualOvershoot.turnedRadians > 0.1 && evidence.actualOvershoot.respawns === 0 && evidence.actualOvershoot.mode === 'flying');

    // Real gamepad Menu pause, View retry, deliberate Y leap abort. No new race lifecycle.
    evidence.lifecycle = await page.evaluate(() => {
      const g = __dw.game; g.races.abort('quit'); __lanternNeutral(); g.beginRace('lantern-dash');
      const runner = LanternPilot.create(g);
      for (let i = 0; i < 1500 && g.races.state !== 'running'; i++) { LanternPilot.steer(g, __lanternPad, runner); __lanternTick(1); }
      __lanternNeutral(); __lanternButton(9, 1); __lanternTick(1); __lanternButton(9, 0);
      const time = g.races.elapsedMs, weather = g.weather.time, position = g.player.position.toArray(); __lanternTick(120);
      const paused = g.screen === 'pause' && g.races.elapsedMs === time && g.weather.time === weather && JSON.stringify(position) === JSON.stringify(g.player.position.toArray()) && document.querySelector('.dw-lantern-coach').hidden;
      __lanternButton(9, 1); __lanternTick(1); __lanternButton(9, 0); __lanternTick(1);
      const resumed = g.screen === 'play';
      __lanternButton(8, 1); __lanternTick(1); __lanternButton(8, 0); __lanternTick(1);
      const retried = g.races.state === 'countdown' && document.querySelector('.dw-lantern-coach').hidden;
      for (let i = 0; i < 1500 && g.races.state !== 'running'; i++) __lanternTick(1);
      __lanternButton(3, 1); __lanternTick(60); __lanternButton(3, 0); __lanternTick(1);
      return { paused, resumed, retried, leapMode: g.player.mode, leapAborted: g.races.activeId === null, hiddenAfterAbort: document.querySelector('.dw-lantern-coach').hidden };
    });
    assert.equal(evidence.lifecycle.paused, true); assert.equal(evidence.lifecycle.resumed, true); assert.equal(evidence.lifecycle.retried, true); assert.equal(evidence.lifecycle.leapAborted, true); assert.equal(evidence.lifecycle.hiddenAfterAbort, true);

    for (const [width, height] of [[1280, 720], [1920, 1080], [617, 463], [720, 1280]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height &&
        Math.abs(parseFloat(getComputedStyle(document.querySelector('.dw-ui')).fontSize) - Math.max(14, Math.min(40, height * 0.01667))) < 0.1 &&
        Math.abs(parseFloat(getComputedStyle(document.querySelector('.dw-lantern-coach')).fontSize) - Math.max(12, Math.min(34, height * 0.0141695))) < 0.1,
        { width, height }, { polling: 50 });
      const layout = await page.evaluate(() => {
        const g = __dw.game; __lanternNeutral(); g.races.abort('quit');
        g.player.teleport(g.player.position.clone().set(-900, 560, 500), -Math.PI / 2, 'flying', 30); g.cameraRig.snap(g.player);
        g.races.debugStage('lantern-dash', 0, 30000); g.frame(0, true);
        const el = document.querySelector('.dw-lantern-coach'), r = el.getBoundingClientRect();
        return { width: innerWidth, height: innerHeight, bounds: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, clipped: el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight, device: g.input.device, fonts: ['.dw-racehud', '.dw-race', '.dw-race-row', '.dw-lantern-coach', '.dw-lantern-coach b', '.dw-lantern-coach span'].map(q => [q, getComputedStyle(document.querySelector(q)).fontSize]) };
      });
      evidence.scenes.push({ name: `layout-${width}`, ...layout });
      assert.ok(layout.bounds.left >= 0 && layout.bounds.right <= width && layout.bounds.bottom < height * 0.4 && !layout.clipped, `coach layout: ${JSON.stringify(layout)}`);
      await page.screenshot({ path: path.join(out, `layout-${width}.png`) });
    }
    evidence.optional = await page.evaluate(() => {
      const g = __dw.game;
      g.applySettings({ ...g.settings, showControlHints: false }); g.frame(0, false);
      const off = document.querySelector('.dw-lantern-coach').hidden && document.querySelector('.dw-lantern-lift').hidden;
      g.applySettings({ ...g.settings, showControlHints: true }); g.ui.hudHidden = true; g.frame(0, false);
      const hudOff = document.querySelector('.dw-lantern-coach').hidden;
      g.ui.hudHidden = false; g.frame(0, false);
      return { off, hudOff, restored: !document.querySelector('.dw-lantern-coach').hidden };
    });
    assert.deepEqual(evidence.optional, { off: true, hudOff: true, restored: true });
    evidence.interruptedGuidance = [];
    for (const toggle of ['tips', 'hud']) {
      const interrupted = await page.evaluate(toggle => {
        const g = __dw.game; g.races.abort('quit'); g.resume(); __lanternNeutral();
        const stage = (x, y) => { g.player.teleport(g.player.position.clone().set(x, y, 480), 0, 'flying', 26); g.frame(0, false); };
        const visible = on => {
          if (toggle === 'tips') g.applySettings({ ...g.settings, showControlHints: on });
          else g.ui.hudHidden = !on;
          g.frame(0, false);
        };
        stage(-1300, 600); g.races.debugStage('lantern-dash', 0, 30000); g.frame(0, false);
        const title = () => document.querySelector('.dw-lantern-coach b').textContent;
        const entry = title(); visible(false);
        stage(-1100, 610); stage(-1300, 620);
        const hidden = document.querySelector('.dw-lantern-coach').hidden;
        visible(true); const reentry = title();
        stage(-1300, 650); const climbed = title();
        g.pause(); g.frame(1, false); g.resume(); g.frame(0, false);
        return { toggle, hidden, entry, reentry, climbed, afterPause: title() };
      }, toggle);
      evidence.interruptedGuidance.push(interrupted);
      assert.equal(interrupted.hidden, true);
      assert.ok(interrupted.entry.includes('+0 m') && interrupted.reentry.includes('+0 m') && interrupted.climbed.includes('+30 m'));
      assert.equal(interrupted.afterPause, interrupted.climbed);
    }
  }
  // Same warmed RaceHud update on a static fixture. This isolates CPU presentation cost,
  // excludes render/GPU and does not claim delivered FPS on hardware.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  evidence.hudCost = await page.evaluate(() => {
    const g = __dw.game; g.resume(); __lanternNeutral(); g.races.abort('quit');
    g.player.teleport(g.player.position.clone().set(-900, 560, 500), -Math.PI / 2, 'flying', 30);
    g.cameraRig.snap(g.player); g.races.debugStage('lantern-dash', 0, 30000); g.frame(0, false);
    const hud = g.ui.raceHud;
    for (let i = 0; i < 1000; i++) hud.update(0, g.view, true);
    const samples = [];
    for (let block = 0; block < 20; block++) {
      const start = performance.now();
      for (let i = 0; i < 1000; i++) hud.update(0, g.view, true);
      samples.push((performance.now() - start) / 1000);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    return { millisecondsPerUpdate: samples, medianMs: sorted[10], p95Ms: sorted[18], method: '20 x 1000 warmed static RaceHud updates; CPU only, no render or input steering' };
  });
  await page.reload(); await page.waitForFunction(() => window.__dw?.ready);
  evidence.reload = await page.evaluate(async () => {
    const g = __dw.game; g.startGame(); g.beginRace('lantern-dash');
    await new Promise(resolve => setTimeout(resolve, 100));
    const ghost = g.races.currentGhost;
    return { record: { ...g.save.data.races['lantern-dash'] }, ghost: ghost ? { raceId: ghost.raceId, breed: ghost.breed, timeMs: ghost.timeMs } : null, state: g.races.state };
  });
  assert.deepEqual(evidence.reload.record, evidence.persisted.record);
  assert.equal(evidence.reload.ghost?.timeMs, evidence.persisted.ghost.timeMs);
  assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => __dw.errors), []);
  evidence.passed = true;
} catch (e) { evidence.failure = String(e.stack ?? e); throw e; }
finally { evidence.errors = errors; fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2)); await browser.close(); }
