# Windline current-render validation

Robert approved a deeper reticle performance pass after the bounded experiment failed. This candidate remains in draft PR #5; merge and deployment are not authorized. It incorporates released editor/audio main `a7adb45c28dd252091b8c10e13ea357067071061` without character-model or ship gameplay work.

## Physical contract and bounded geometry reuse

Every visible ready render on the normal analytic adapter executes the complete current centred cast: first camera-ray solid, compensated physical projectile at 120 Hz, first-impact/anchor agreement, 65 m harness range and full tether obstruction. No target result or green eligibility is reused across changed pose, velocity or camera. Actual button presses also solve afresh. Unknown slower adapters retain their bounded fallback and clear unproved changed-pose eligibility. Mounted/hidden/attached states do not run ready forecasts.

Only static analytic **empty-space geometry** is memoized. A 4 cm XZ cell stores a conservative contact-plane floor for one island definition and inflated probe radius. The 16,384-entry FIFO bounds live cells; definition changes invalidate the relevant namespace. Primitive candidates and membership remain fresh independently. The original sample lattice/order, candidate coverage, probe inflation, exact primitive sweeps, full contact queries, bisection and logical 16,384-query fail-closed budget remain intact. Proven-empty consecutive lattice nodes may skip evaluation, but every skipped node charges the same logical budget and exhaustion returns the original index/fraction. Potential contacts always use the complete original oracle.

Natural intervals now include the existing seeded skew, variable exponent/lip, ragged outline, twin lobes, tilt and tooth scale. They do not introduce a second collision shape. Origin singularities, broad/nonfinite domains and changed definitions fall back; vertical columns, spires, arches and unsupported paths retain their existing queries. These paths and individual cold/GC peaks can cost more than the mean gate.

The tighter noise bound is derived from the installed simplex-noise 4.x kernel, not sampled gradients. For each `70 t^4 g·q`, `t=.5-|q|²`, the derivative operator has eigenvalues `t^4` and `t^3(.5-9|q|²)`. With `|g|<=sqrt(2)`, summing independent operator-norm bounds over the three equilateral support centres bounds every seed. A 64×64 interval partition encloses the whole simplex bounding rectangle; each radial interval evaluates endpoints and the only interior maximum at `|q|²=1/6`. The resulting bound is below 9.87; source uses 10 with outward rounding and extra final guards. Reflection/translation covers the other simplex/cells; kernels and derivatives vanish at support seams. The test checks the installed kernel constants and proves whole domains, rather than relying on pointwise gradient samples.

The original [bounded report](WINDLINE_SWEEP_SPIKE_2026-10-11.md) describes the unchanged height/stencil contact-plane derivation. Its failed measurements and disabled status belong to historical head `6d5d8d1`; this document describes the subsequently authorized pass. Transcendental rounding guards plus regression evidence are engineering validation, not a universal formal proof of JavaScript arithmetic.

## Required evidence

- Geometry tests: whole-domain kernel proof; 1,500 plane boxes across authored/seeded crags, teeth, rims and angular seams; 320 complete/interrupted exact sweeps; thin primitive, overlap, revision, radius, length and logical-exhaustion checks; cold/hot cell reuse, new blockers, definition changes, cell boundaries, FIFO eviction and repopulation. Original hit/no-hit, fraction, point, normal and anchor must agree.
- Complete browser profile: 80 changing poses per depth (18/45/55 m), alternating original/candidate, every query includes centre ray/projectile/tether. **No warmup queries are excluded** and the cache is cleared once per depth. Strong motion adds 3 cm per query, changing inherited velocity and look; every query remains eligible. Both all-query and eligible-query means must be <=2.5 ms at every depth. First query, cache misses, layer counts, p95/max and cold-every-query diagnostics remain visible.
- Reticle/browser flow: full query on each of 100 changed poses, continuously green eligible frames, same-render newly inserted blocker invalidation, physical RT impact agreement, moving ready queries, no attached forecasts, retained/released long swing and the existing CPU gates.
- Actual RAF/input/physics/camera/DOM proof: stationary and freefall software 3D phases, separately labeled painted-UI moving/look phase with 3D submission suppressed. Every recorded pose is replayed through the complete original adapter after timing. The high-refresh UI phase must exceed 45 callbacks/sec after an explicit 500 ms software-renderer settling interval, keep every continuously eligible frame green with no checking/transitions, and meet the complete-query mean. This establishes software UI cadence only; full software rendering and physical refresh/GPU performance are separate.
- Full unit/typecheck/build, ordinary production smoke, normal save/reload and repeated/interrupted/controller/HUD/prototype gates remain required. Released editor lifecycle/save isolation and audio mixer/cue checks are rerun on the combined candidate. CI runs both complete-query gates and stores cold/RAF/raw browser evidence.

## Exploratory checkpoint and final evidence location

Two pre-integration dirty source runs passed the stronger complete-query profile, including the first query and every certificate miss:

| Depth | Run A mean / p95 / max ms | Run B mean / p95 / max ms |
|---|---|---|
| 18 m | 1.521 / 4.600 / 9.900 | 1.867 / 4.900 / 21.200 |
| 45 m | 1.239 / 1.800 / 2.400 | 1.743 / 3.100 / 15.100 |
| 55 m | 1.223 / 1.600 / 1.800 | 1.825 / 3.300 / 22.700 |

All 240 pairs in each run matched target state, anchor, distance and impact exactly. The first per-render browser check had 100/100 fresh green poses, 120/120 fresh moving ready frames with no checking, a zero-error physical impact and retained swing. These exploratory values do not substitute for the final clean committed-head evidence and CI linked from PR #5.

Raw filenames: `/tmp/driftwing-complete-preflight-browser-check.json`, `/tmp/driftwing-moving-preflight-browser-check.json`, `/tmp/driftwing-cold-preflight-browser-check.json`, `/tmp/driftwing-reticle-motion-browser-check.json`, and existing Windline/editor/audio reports. The integration workflow uploads browser evidence. Final head, tree, counts, timings, workflow/artifact links and remaining limits are recorded in PR #5 and its final handoff.

The saved cloud restart lost shell Git authentication. Authorized connector reads supplied verified Git source/commit/tree identities; the isolated combined checkout sparsely excludes only four released editor **documentation PNGs** because that connector accepts UTF-8 only. Their original blob identities are preserved unchanged in the candidate tree, and CI checks out the full repository. No proof image was replaced or synthesized. The live Pages host remains CONNECT403 from this environment. No physical iPhone/controller/GPU, subjective audio-listening or new per-category art certification is claimed.
