// Diagnostic replay only. The retained, uninstrumented 100-query measurement
// finishes first; these timings never replace it or contribute to its CPU gate.
export async function diagnoseReticle100(page, pose) {
  const result = await page.evaluate(pose => {
    const g = __dw.game, p = g.player, v = g.skyLanceVisuals, w = p.skyLance.world;
    const terrain = w.terrain, index = terrain.colliders;
    const sweep = w.sweep, rock = terrain.rockContact, candidates = index.candidates;
    const mode = w.localUndersideBounds;
    const saved = { feet: p.foot.position.clone(), velocity: p.foot.velocity.clone(),
      camera: g.camera.position.clone(), quaternion: g.camera.quaternion.clone() };
    const rows = [], mismatches = [];
    let active = null, layer = 'centreRay';
    const target = () => {
      const t = v.target;
      return t ? { state: t.state, anchor: t.anchorId, distance: t.distance,
        point: t.point?.toArray() ?? null } : null;
    };
    const reset = () => {
      p.foot.position.fromArray(pose.feet); p.foot.velocity.fromArray(pose.velocity);
      g.camera.position.fromArray(pose.camera); g.camera.quaternion.fromArray(pose.quaternion);
      g.camera.updateMatrixWorld();
    };
    w.sweep = function(...args) {
      layer = active?.first ? 'centreRay' : args[2] === .02 ? 'tether' : 'projectile';
      if (active) active.first = false;
      const slot = active?.layers[layer], start = performance.now();
      try { return sweep.apply(this, args); }
      finally { if (slot) { slot.ms += performance.now() - start; slot.sweeps++; } }
    };
    terrain.rockContact = function(...args) {
      const slot = active?.layers[layer], start = performance.now();
      try { return rock.apply(this, args); }
      finally { if (slot) { slot.rockContactMs += performance.now() - start; slot.rockQueries++; } }
    };
    index.candidates = function(...args) {
      const slot = active?.layers[layer], start = performance.now();
      try {
        const entries = candidates.apply(this, args);
        if (slot) { slot.primitiveCandidateQueries++; slot.primitiveCandidatesReturned += entries.length; }
        return entries;
      } finally { if (slot) slot.primitiveLookupMs += performance.now() - start; }
    };
    try {
      w.localUndersideBounds = true; reset(); w.clearGeometryCertificates();
      const revision = w.revision;
      for (let i = 0; i < 100; i++) {
        // Reproduce the original repeated addition, not a rounded multiplication.
        p.foot.position.x += .001;
        const layers = Object.fromEntries(['centreRay', 'projectile', 'tether'].map(k => [k,
          { ms: 0, sweeps: 0, rockContactMs: 0, rockQueries: 0,
            primitiveLookupMs: 0, primitiveCandidateQueries: 0, primitiveCandidatesReturned: 0 }]));
        const before = { ...w.certificateStats };
        active = { first: true, layers }; v.nextPreview = 0;
        const start = performance.now();
        v.updateReticle(g.camera, p.foot.position, p.foot.velocity, p.skyLance);
        const completeMs = performance.now() - start; active = null;
        const sweepMs = Object.values(layers).reduce((sum, slot) => sum + slot.ms, 0);
        const el = document.querySelector('#sky-lance-reticle');
        rows.push({ index: i, completeMs, sweepMs, nonSweepMs: completeMs - sweepMs, layers,
          misses: w.certificateStats.misses - before.misses,
          hits: w.certificateStats.hits - before.hits,
          tightened: w.certificateStats.tightened - before.tightened,
          feet: p.foot.position.toArray(), velocity: p.foot.velocity.toArray(),
          camera: g.camera.position.toArray(), quaternion: g.camera.quaternion.toArray(),
          target: target(), green: el.classList.contains('is-valid'), state: el.dataset.target,
          revision: w.revision });
      }
      // Original oracle runs only after measured replay, without instrumentation.
      w.sweep = sweep; terrain.rockContact = rock; index.candidates = candidates;
      w.localUndersideBounds = false; reset();
      for (let i = 0; i < 100; i++) {
        p.foot.position.x += .001; v.nextPreview = 0;
        v.updateReticle(g.camera, p.foot.position, p.foot.velocity, p.skyLance);
        const reference = target(), row = rows[i];
        if (JSON.stringify(reference) !== JSON.stringify(row.target) ||
            row.green !== (reference?.state === 'reachable')) {
          mismatches.push({ index: i, reference, candidate: row.target, green: row.green });
        }
      }
      return { rows, mismatches, referenceQueries: 100, pose,
        coldStart: true, excludedWarmupQueries: 0,
        baselineRevision: pose.revision, replayRevision: revision,
        geometryStableDuringReplay: rows.every(row => row.revision === revision),
        renderMode: 'manual complete queries; no 3D submission during measured replay',
        interpretation: 'Instrumented diagnostic costs include timing-hook overhead and are not acceptance measurements. Rock/primitive timings nest inside sweep timings; non-sweep residual also includes wrapper overhead. Clock quantization can produce small negative residuals.' };
    } finally {
      active = null; w.sweep = sweep; terrain.rockContact = rock; index.candidates = candidates;
      w.localUndersideBounds = mode;
      p.foot.position.copy(saved.feet); p.foot.velocity.copy(saved.velocity);
      g.camera.position.copy(saved.camera); g.camera.quaternion.copy(saved.quaternion);
      g.camera.updateMatrixWorld(); v.nextPreview = 0;
      v.updateReticle(g.camera, p.foot.position, p.foot.velocity, p.skyLance);
    }
  }, pose);
  const stats = values => {
    const sorted = values.slice().sort((a, b) => a - b);
    return { mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) };
  };
  const summarize = rows => ({ count: rows.length,
    completeMs: stats(rows.map(row => row.completeMs)),
    nonSweepMs: stats(rows.map(row => row.nonSweepMs)),
    layers: Object.fromEntries(['centreRay', 'projectile', 'tether'].map(key => [key,
      Object.fromEntries(Object.keys(rows[0].layers[key]).map(metric =>
        [metric, stats(rows.map(row => row.layers[key][metric]))]))])) });
  const zeroMiss = result.rows.filter(row => row.misses === 0);
  result.summary = summarize(result.rows);
  result.zeroMissSummary = zeroMiss.length ? summarize(zeroMiss) : null;
  return result;
}
