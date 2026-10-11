# Driftwing — AI Development Handoff

## Latest: Windline targeting, deliberate pull, grounded recall, skydiving and 1.75-second boost — 2026-10-10

- Owner authorized these follow-ups, then specified 1.75-second boost recharge / light-blue bottom-right HUD
  and reported line disconnection during turns. This deliberately supersedes the earlier no-powered-reel
  contract for explicit A/Space pulls only. No automatic pulling, moving anchors or rope wrapping added.
- Workspace `/home/robert/Projects/Driftwing-SkyLance`, branch `exp/sky-lance-v1`, HEAD
  `f3ef231c6a12ed5865cd73562447f6d94a1730bf`; entire pre-existing dirty prototype preserved at `/home/robert/Projects/Driftwing-Preservation/windline-motion-baseline-20261010T233415Z`.
  All 438 archived project files verified by SHA-256. Codex/Claude checkouts were not edited.
- A/Space while tethered requests a 0.4-second pull: 60 m/s² radial acceleration, powered inward speed
  capped at 18 m/s (existing overspeed retained), minimum line 2 m. Reeling follows actual swept inward
  movement; no snap to a shorter radius. Explicit powered work enters the existing energy budget;
  unpowered constraints/energy guard remain. Release clears pull and preserves instantaneous velocity.
  In the production underside trial after 0.3 seconds: line 17.300 → 15.391 m, ascent 12.600 m/s.
  Detached A/Space retains the waist burst and its independent 1.75-second simulation cooldown.
- Reticle position now follows the current ballistic near aim every render frame, independently of
  expensive first-solid prediction (bounded to 20 Hz). Fresh confirmed impact has a separate small dot;
  stale eligibility becomes CHECKING. This avoids jumping the main ring between hit/fallback depths.
  Bracer orbit supports 89° up with exact view pitch and no pole reversal; ordinary/flight limits unchanged.
- Reproduced underside turning disconnect: 8/18/26 m/s trials detached after 504/455/196 fixed steps.
  Camera-only turn stayed attached. A newly blocked line now sweeps back to its preceding clear body
  endpoint, dissipates blocked motion and retains its committed length instead of dropping the rider.
  It may briefly stop at an edge; no wrapping is simulated. Invalid anchors or impossible restoration
  still detach safely. One full LOS check on ordinary steps, two on the exceptional restoration path.
  Final reproduction retains all four trials for 720 steps each. Manual release remains available.
- Ground hold-Y/F now recalls an independently gliding dragon using its actual pose and existing safe
  greeting-landing planner. Transfer occurs only if a landing spot exists. The recalled hop remains airborne
  and blends orientation rather than replaying a supported launch. Four breeds return and can mount;
  existing deliberate midair catch/remount still passes. Existing stable/interactable priority is retained.
- Full forward tucks the rider head-down and brakes horizontal motion toward a vertical dive; back
  spreads the body flat and brakes, with side steering retained. No-input horizontal momentum remains.
  Partial forward still steers. Rider-only descent limits remain 9/13/18 m/s; dragon flight is unchanged.
  Three-build regressions cover head/hip/foot ordering, arm spread, smooth transition and planted resets.
- Bottom-right light-blue boost indicator shows READY, active burst, numeric recharge and progress;
  while linked it identifies the tether-pull action. Hidden during menus/mounted modes; pause freezes time.
  Production checks verify exact 210-tick recharge, 0% → 100% HUD, upward aim, pull/release, ground recall,
  vertical dive/flat brake, actual DOM Q controls and simulated-controller RT/A/Y transitions.
- Baseline focused checks: 161 / 13 passed. Broadened focused checks: 198 / 14 passed before final two
  energy regressions; final full suite includes both and passes 1,092 / 103. Final typecheck/build pass;
  production smoke 15/15 passes. Existing golden fixtures/tolerances unchanged.
- Existing capture harness: nine final 1280×720 captures, six full-dive/brake views across all three
  rider builds, matched steering before/after, upward READY and cooldown HUD. All inspected. These are
  representative pose/UI views, not exhaustive garment intersection proof or a full art-compliance audit.
- Timed production Chromium CPU proxy (drawing disabled): short underside attached mean
  1.823 ms, moving swing 3.115 ms;
  forecast sample mean 3.090 ms. Query counts remain bounded. Earlier pass was 1.597 / 2.688 ms;
  host timing differences do not establish causal cost changes. Long/grazing lines remain a performance
  limitation from the prior pass; no physical-GPU or physical-controller certification claimed.
- Assessment, preservation audit, focused incremental diff, logs and captures: `/home/robert/Projects/Driftwing-Preservation/windline-motion-review-20261011T000025Z`.
  Local play: http://localhost:5176/?view=skyLance&play=1&quality=low — refresh the existing tab.
  No commits, integration, pushes, deployment, dependency changes, M1, wardrobe or dragon-physics work.
  Next: owner playtest/review; no automatic scope expansion.

## Latest: faster Windline, tether CPU correction, six-second boost and companion descent — 2026-10-10

- Owner authorized the reported tether/contact slowdown, faster launcher, reusable six-second boost,
  glide review, and upside-down-looking companion limbs during lower-island arrival. Implemented only
  in `/home/robert/Projects/Driftwing-SkyLance`, `exp/sky-lance-v1`, unchanged HEAD `f3ef231c6a12ed5865cd73562447f6d94a1730bf`.
- Dirty baseline preserved at `/home/robert/Projects/Driftwing-Preservation/tether-performance-baseline-20261010T225153Z`. All 435 archived project files verified by SHA-256;
  tracked, untracked and relevant ignored files included, excluding .git/node_modules/generated dist.
- Launcher speed 42 → 75 m/s; immediate existing Q/RT interaction, 65 m default range and swept first-solid
  contacts retained. Legacy unexposed charged speed becomes 90 m/s so it cannot be slower than tap fire.
- Boost now recharges six seconds after activation on the fixed simulation clock, including airborne,
  tethered and mounted modes. Pause freezes it; landing/mounting/saddle jumps stop thrust without refilling.
  Explicit teleport/respawn/practice reset clears it. Existing upward/horizontal impulse and rope prohibition retained.
  Practice UI shows the remaining cooldown. Freefall speed/steering/camera tuning unchanged after review.
- Confirmed CPU bottleneck: two full 1 cm rope sweeps per fixed tick beneath procedural rock. Retain immediate
  new-attachment validation and pre-dispatch static identity checks; steady ropes check obstruction once,
  after collision-resolved movement, within the same tick. A newly occluded line can receive that tick's
  constraint reaction before detachment (at most one 1/120 s step); removed/moved identities detach before dispatch.
- Rock sweeps clip their original lattice against enclosing solid AABBs. Exact query-local vertical column
  reuse and conservative finite-difference normal rejection avoid repeated procedural height work. The island
  surface equations, first-solid ordering, slack/locked length, swept body corrections and release operation remain.
  An exploratory inflated-contact-sphere accelerator failed a retained dense-reference regression and was removed.
- Companion hops cap descending pitch at 0.55 rad and level before arrival; steep descent prepares limbs through
  the existing flare channel. Hop feet remain airborne until actual supported settling. Player advances the existing
  touchdown id on companion arrival so feet replant on the destination. Rescue swoop orientation/flight tuning unchanged.
- Final verification: focused 186 / 15 passed; full 1,075 / 103 passed; typecheck/build passed; production smoke
  15/15. Dense sweep reference and original island-contact equations agree across seeded/all-island samples;
  field-evaluation budgets and cache expiry pass; all four breeds pass descent/ground contact checks.
  Fixed-step render-rate tests include cooldown. No golden fixtures or tolerances changed.
- Production browser confirms airborne recharge (+11.846 m/s launch; 3.940 m gain), pause clock, steering/manual
  camera, READY/actual underside/pillar attachment, held-rescue blocking and release; actual keyboard and simulated
  standard gamepad cast/boost/dismount/rescue/remount pass. Physical controller testing remains pending.
- Timed CPU proxy (one fixed tick plus normal frame updates, drawing disabled): short underside attachment mean
  11.347 → 1.597 ms; moving short swing 2.688 ms.
  Near-maximum line moving swing mean 5.983, peak 11.500 ms; longer lines remain heavier.
  These are Chromium/SwiftShader host CPU samples, not physical-GPU or owner playtest evidence.
- Evidence and focused incremental patch: `/home/robert/Projects/Driftwing-Preservation/tether-performance-review-20261010T232319Z`. Compared the actual pre-fix/final Harrier descent frame;
  corrected downward-reaching limbs are visible. Other breeds have automated coverage, not new visual captures.
- Local production prototype: http://localhost:5176/?view=skyLance&play=1&quality=low (refresh existing tab).
  Existing dev/preview servers retained. No commit, merge, push, dependency change, deployment, M1 or wardrobe work.
  Next: owner playtest/review; no automatic expansion or integration.

## Latest: responsive freefall, upward burst and general static-surface Windline — 2026-10-10

- Owner authorized this follow-up in the existing isolated prototype: `/home/robert/Projects/Driftwing-SkyLance`, branch
  `exp/sky-lance-v1`, unchanged HEAD `f3ef231c6a12ed5865cd73562447f6d94a1730bf`.
- Complete dirty pre-change state preserved at `/home/robert/Projects/Driftwing-Preservation/windline-control-baseline-20261010T221409Z`; all 432 archived SHA-256 hashes verified.
  Tracked, untracked and ignored project references retained; generated node_modules/dist excluded.
- Untethered steering follows camera-relative intent with bounded 26 m/s² acceleration and 18 m/s
  controlled horizontal speed. No-input momentum is retained. Manual camera orbit stays available;
  automatic velocity-follow/companion avoidance stops during traversal, preventing steering feedback.
  Rider facing turns smoothly and freefall banking is clearer. Ordinary jumps and dragon flight unchanged.
- One A/Space waist burst sets vertical velocity to at least +12 m/s (retains faster ascent), then
  adds up to 10 m/s horizontal impulse over 0.28 s toward stick intent or camera aim. Horizontal added-speed
  ceiling remains 36 m/s, retaining incoming overspeed. Landing/mount recharges; tether blocks boost/steering.
- All static hard collision surfaces can anchor, including islands' tops/cliffs/undersides, spires,
  arches, building/roof/deck proxies, trunks and practice pillars. Soft foliage/decor without collision
  is excluded. IDs come from collision registration, independent of preview discovery order. Geometry/identity changes invalidate anchors. No moving-anchor following or rope wrapping.
- Shared analytic terrain contacts now optionally identify the hit solid; the existing collision
  calculation is unchanged. Tether validation never exempts the whole attached object: crossing its back
  obstructs/detaches. Fixed maximum length, slack, first-solid collision and release momentum remain.
- Reticle shows blue READY + distance, LINKED, BLOCKED / TOO CLOSE, NO SURFACE (65 m), FIRING/REFORMING.
  Forecast uses the real fixed-step projectile and obstruction validation, bounded at 240 steps,
  refreshed at most 8 Hz. It assumes current harness position; subsequent movement can alter reachability.
- Verification: baseline 117 / 8 passed; final full suite 1,061 / 100 passed; focused 172 / 12 passed; typecheck and final build passed; smoke 15/15.
  Browser: 1 s left turn reached -17.956 m/s with zero automatic camera drift; manual orbit 2.6 rad;
  falling boost launched at +11.846 m/s and gained 3.940 m; real underside READY at 20.551 m, attachment
  retained under held rescue; ordinary pillar attached. Preview-order independence is regression-tested. No golden fixture/tolerance changes.
- Range forecast measured 9.04 ms mean / 10.70 ms max (10 warm headless CPU samples).
  Real GPU and physical-controller feel remain unverified. Software WebGL captures are recorded separately.
- During final audit, AGENTS.md, CLAUDE.md and a new docs/ART_DIRECTION.md had changed independently
  of this pass. Read and preserved separately in the evidence folder; author/source not assumed.
  The guide gives current owner direction precedence, so the wrist-fired magical tether is retained.
  Full production art compliance is not claimed.
- Evidence, assessment and incremental diff against the full dirty baseline: `/home/robert/Projects/Driftwing-Preservation/windline-control-review-20261010T224155Z`.
- Play: http://localhost:5176/?view=skyLance&play=1&quality=low (refresh). Next: owner playtest/review.
  Work stays uncommitted; no integration, pushes, deployment, dependencies or other-checkout edits.

## Latest: rider traversal fidelity, deliberate saddle jump and waist burst — 2026-10-10

- Owner authorized this focused follow-up to the bracer prototype. Work remains isolated in
  `/home/robert/Projects/Driftwing-SkyLance`, `exp/sky-lance-v1`, unchanged HEAD
  `f3ef231c6a12ed5865cd73562447f6d94a1730bf`. No main-game integration or broader Gate C.
- Full pre-change working tree preserved at `/home/robert/Projects/Driftwing-Preservation/traversal-fidelity-baseline-20261010T202559Z`: 430 archived hashes verified, including
  untracked implementation, references and ignored project/cache files. No reset/stash/commit.
- Ordinary jumps remain walker-owned. Five bounded shared-ground queries require a clear four-metre
  drop and 0.65 m rim clearance before skydiving. Tethered airborne ownership remains separate.
- Rider descent targets now 9 / 13 / 18 m/s (brake / neutral / dive), with stronger asymmetrical
  steering poses and camera-relative untethered air control. Descent drag no longer erases upward
  launch/release momentum. Attached rope still gets no steering thrust or boost.
- Hold Y/F for 0.4 s while flying to jump away with inherited velocity and a swept outward hop.
  Release the button before a second hold calls the existing rescue. Same hold cannot catch/eject
  repeatedly. The dragon glides through the existing FlightModel; flight tuning/breeds unchanged.
  Independent landing cannot mount the rider or award grounded rest/regeneration to a flying dragon.
- Experimental foot-camera upward range extended to 80 degrees, retaining terrain boom clearance.
  Actual camera cast from lower platform attaches to higher marker. Mounted/ordinary limits retained.
- A/Space gives one untethered 0.28 s waist burst (12 m/s impulse budget, 36 m/s added-speed cap,
  existing overspeed preserved). It follows current momentum, using aim only at low speed. Landing
  or mounting restores the charge. Compact procedural bronze/slate vessels and blue plumes use a
  render-only hip socket; no animated transform controls physics. No reel/winch/powered tether.
- Final checks: focused 178 tests / 10 files; full 1,042 / 99; typecheck/build passed; final production
  smoke 15/15. Isolated browser fidelity, DOM keyboard, simulated standard controller RT/Y/A,
  accessibility toggle and unpowered platform route passed. No golden or tolerance changes.
- Capture evidence: ordinary-jump before/after, all three rider builds steering, consistent medium
  waist front/side/rear, actual upper-anchor cast and four actual departure/rescue/catch frames.
  Software WebGL only; physical-controller feel and real GPU performance remain owner review.
- A complete lower-to-upper climb using only tether plus one burst has not been demonstrated.
  Verified dragon recall provides a return option. Static anchors only; no automatic pulling.
- Evidence, preservation audit and incremental dirty-baseline patch: `/home/robert/Projects/Driftwing-Preservation/traversal-fidelity-review-20261010T210241Z`.
- Play: `http://localhost:5176/?view=skyLance&play=1&quality=low` (refresh). Next action: owner playtest
  and feedback. No commits, pushes, merges, deployments, dependency changes or other-checkout edits.

## Latest: bracer-fired magical tether and slow rider freefall — 2026-10-10

- Owner requested replacing the cumbersome lance with a bracer-fired magical tether and a clear,
  substantially slower freefall. This focused experimental follow-up supersedes the thrown-lance
  presentation contract here; no main-game integration, flight tuning or broader Gate C is implied.
- Checkout `/home/robert/Projects/Driftwing-SkyLance`, branch `exp/sky-lance-v1`, unchanged HEAD
  `f3ef231c6a12ed5865cd73562447f6d94a1730bf`. Complete dirty Gate B state preserved at
  `/home/robert/Projects/Driftwing-Preservation/bracer-freefall-baseline-20261010T195848Z`:
  all 428 archived file hashes verified, including ten ignored cache files. No reset/stash/commit.
- Removed pole, flag and carry-grip presentation. Left bracer fires a small luminous seed and thin
  blue filament. Existing swept first-solid projectile, approved static anchors, locked maximum
  length/slack, harness authority, release velocity and automatic reformation remain. Animated
  wrist sockets remain render-only. Internal SkyLance module names/URL retained for compatibility.
- Rider-only terminal descent targets: braking 7 m/s, neutral 10 m/s, dive 14 m/s. Vertical implicit
  quadratic drag smoothly brakes excess inherited speed rather than snapping velocity on release.
  Weak horizontal drag is independent. Attached swings bypass the new vertical braking entirely;
  gravity, tether solver reactions/energy guard, dragon flight and breed parameters stay intact.
- Both arms now participate in the braking pose; diving leans forward and streamlines the limbs.
  Existing IK handles all three builds. Freefall blend clears on supported touchdown, boarding and
  teleport. Q/RT hold/release, toggle alternative and deliberate F/Y rescue are unchanged.
- Final typecheck and full suite passed: 1,022 tests / 98 files. Focused traversal/input/rider checks
  passed (142 / 12 files), then the final pose/reset checks (7 / 1 file). No golden updates.
- Initial bracer production build and browser loop passed: neutral fall -9.999999991 m/s,
  maximum rope excess 2.85e-14 m, release error against next-step forces 0. Keyboard, simulated RT,
  pause/resume, toggle, deliberate catch and actual far-platform landing verified (release step 140).
  Final rebuilt-browser confirmation after the pose-reset safeguard: passed with the same metrics.
- Existing capture harness supplies matching before/after medium freefall views, all three rider
  builds, left-bracer firing and line against sky. Visual captures and final confirmation are
  described separately in the evidence report; software WebGL, not physical GPU/controller evidence.
- Evidence and follow-up-only patch: `/home/robert/Projects/Driftwing-Preservation/bracer-freefall-review-20261010T200930Z`.
- Local review: `http://localhost:5176/?view=skyLance&play=1&quality=low` (refresh to load latest build).
  Existing unrelated work retained. No dependency changes, commits, pushes, merges or deployment.
  Next action: owner playtests bracer/slow-fall feel; integration and Gate C remain separately gated.


## Latest: Windline / Sky Lance Gate B — controls and presentation — 2026-10-10

- Owner approved Gate B only. Checkout `/home/robert/Projects/Driftwing-SkyLance`, branch
  `exp/sky-lance-v1`, unchanged HEAD `f3ef231c6a12ed5865cd73562447f6d94a1730bf`.
- Complete dirty Gate A baseline preserved outside source at
  `/home/robert/Projects/Driftwing-Preservation/gate-b-baseline-20261010T182441Z`.
  All 417 archived file hashes verified; unrelated files retained. No reset/stash/commit/integration.
- Immediate fresh Q/RT cast, hold retention and release/cancel; explicit opt-in input context prevents
  held RT across mounted/menu transitions from casting. Practice checkbox enables toggle mode.
  Pause/Escape releases pointer lock before changing the checkbox. Hold F/Y rescue remains deliberate.
  Recovery automatically returns equipment to ready after 0.36 simulation seconds. Legacy manual
  recovery remains compatible. No powered pumping, winching or changes to the tether solver/flight.
- Procedural left bracer, crossback harness and shoulder-routed load strop use render-only rider
  sockets; physical harness remains fixed relative to RiderFoot. Restrained cast/tension/recovery IK
  uses the existing rig. Thin blue tether has a 1.1 px core / 2.3 px edge at viewport resolution,
  world depth testing and ordering after the existing sky dome. No renderer infrastructure changes.
- Practice anchor cues check static identity/range/first-solid line of sight at bounded 10 Hz;
  they do not steer aim or promise a ballistic hit. Added pillar uses the same rendered/collider box.
  Far platform lowered from surface 415 m to 400 m after the unpowered route proved unreachable.
- Final verification: `npm run typecheck`, `npm run build`, `npm test` (1,009 tests / 97 files),
  `git diff --check` passed. Focused rider/input/traversal/camera checks passed (155 / 13 files),
  followed by the final traversal/input checks (82 / 6 files). No golden updates or weakened tolerances.
- Production browser check passed via `node scripts/sky-lance-check.mjs http://localhost:5176/`:
  real DOM Q and toggle, simulated standard RT, buffered quick taps, recovery, pause/resume,
  camera aim, independent fall / deliberate rescue, and actual far-platform landing.
  Max rope excess 2.85e-14 m; release error versus expected next-step gravity/drag 0;
  pillar pass 24.438 m/s; max camera increment 0.085451 rad; right-axis vertical component <7e-19.
- Existing dragon-capture harness produced matching 720p front/side/rear captures of all three
  rider builds, actual cast frames, release/recovery and sky/stone/foliage line views. Baseline
  captured before source edits. Initial occluded views and inherited post-reset poses were corrected
  in staging; earlier failed/stopped attempts are diagnostic evidence, not accepted final captures.
- Evidence, assessment and Gate B-only patch: `/home/robert/Projects/Driftwing-Preservation/gate-b-review-20261010T185714Z`.
  Browser uses SwiftShader: no physical-GPU performance or physical-controller playtest claim.
  Dense-foliage stress, broad wardrobe/quality coverage and production smoke/performance hardening
  remain Gate C work. Motion and control feel await owner feedback.
- Local production preview: `http://localhost:5176/?view=skyLance&play=1&quality=low`.
  No M1, dragon integration, commits, pushes, merges, deployment or dependency changes.
  Next action: owner reviews Gate B; Gate C requires separate approval.

## Latest: Sky Lance Gate A — physics and lifecycle reconciliation — 2026-10-10

- Objective: reconcile the existing isolated prototype with the Windline Bracer contract; Gate A only.
- Checkout `/home/robert/Projects/Driftwing-SkyLance`, branch `exp/sky-lance-v1`, unchanged HEAD
  `f3ef231c6a12ed5865cd73562447f6d94a1730bf`; all implementation remains uncommitted.
- Original 15 modified tracked / 11 untracked files preserved in a SHA256-verified 416-file archive at
  `/home/robert/Projects/Driftwing-Preservation/gate-a-20261010T175251Z` (original Git state included).
- Removed powered swing pumping and its tuning/integrator input. Grounded attachment retains the
  walker and support; grounded bound correction preserves support, jump/edge departure transfers
  ownership, and a subsequent landing detaches. Airborne release retains instantaneous velocity.
- Swept correction starts at the resolved contact; bounded retries detach on incompatible constraints.
  Sweeps fail closed above 128 m or 256 broad-phase candidates; primitive/rock budgets remain bounded.
- Anchors validate stable collider identity, geometry and live source membership before movement;
  all intervening solid hits obstruct. Miss/detach/invalidation enter the existing manually recoverable
  spent state; no recovery control or animation changes.
- Split gravity kicks with an initial radial reaction remove artificial unpowered damping. Energy
  guard remains. Controlled 60 s, 10 m, 0.05 rad swing: energy loss 0.02306% (original 20.1572%),
  period 4.68393849 s vs analytic 4.68320982 s, zero guard stops; growth below 1e-8 J/kg per step.
- Added transition/reset, grounded movement, anchor mutation, collision/budget, scene resource disposal,
  pause/save reset and 30/60/120/144 FPS plus jittered presentation regressions. Scene teardown and
  bfcache suspension use a narrow optional showcase lifecycle hook.
- Baseline command `npx vitest run src/traversal src/player/Player.test.ts src/input/Input.test.ts`:
  91 passed / 5 files. Final focused command adds `src/world/colliders.test.ts`: 137 passed / 7 files.
  `npm test`: 1004 passed / 96 files. `npm run typecheck` and `npm run build`: passed.
  `git diff --check`: passed. No golden fixture or tolerance changes.
- Evidence and Gate A-only diff:
  `/home/robert/Projects/Driftwing-Preservation/gate-a-review-20261010T175251Z/assessment.md`.
- Limits: automated source/unit/build evidence only this gate; no browser, physical-controller,
  production smoke, capture or GPU/allocation profiling performed. Query-budget saturation blocks
  conservatively; dense-scene usability/performance remains Gate C work. Controls/art and practice
  route are otherwise unchanged; no main-game integration or flight physics changes.
- Next action: owner review. Gates B/C, controls/art, commits, pushes, merges and integration require
  separate authorization. This handoff is informational, not authorization.

## Latest: Sky Lance controlled freefall and charged throw — 2026-10-10

This section supersedes the V1 release-grace/automatic-rescue behavior below, in this
experimental worktree only. All prior uncommitted prototype work is retained.

### Authority and checkout
- Owner approved two focused packages: controlled freefall/deliberate catch, then charged
  throw/thinner shaft/tip ribbon/aim UI, with tests, build, browser validation and captures.
- Worktree `/home/robert/Projects/Driftwing-SkyLance`, branch `exp/sky-lance-v1`, HEAD
  `f3ef231c6a12ed5865cd73562447f6d94a1730bf`. Changes remain uncommitted.
- Released checkout `/home/robert/Projects/Driftwing-Codex` remains clean at `844e5c2`.
- No commits, integration, pushes, deployment, dependencies, wardrobes or dragon-mounted
  grappling authorized. Wyvern flight physics and breed tuning are unchanged.

### Behavior and implementation
- In the opt-in scenario, leaving the ground enters `PlayerMode.traversing`; ordinary
  airborne walking braking and automatic rescue do not take movement ownership.
- Hold Y/F for 0.4 seconds while untethered to request the existing swoop/catch sequence.
  A tap does not catch; holding during a valid tether cannot interrupt the swing.
  Grounded mounting retains its existing interact behavior. This is not the complete
  roadmap leap-and-call feature with distance-dependent companion travel time.
- Forward W/left stick smoothly streamlines the freefall pose and reduces quadratic drag;
  backward S/left stick spreads the pose and increases drag. No freefall thrust or winch.
  Existing fixed 120 Hz and four swept integration substeps remain authoritative.
- Release preserves instantaneous velocity; subsequent physics applies gravity/air resistance.
  World contact restores walking. Crossing the existing cloud floor uses fade/respawn rather
  than an unsolicited swoop; freefall is bounded by that existing world safety boundary.
- Hold X/Q to wind up (0.8 seconds to full power), release to throw. Tap speed remains
  42 m/s; full-charge speed is 64 m/s, before inherited rider velocity. Range eligibility
  grows from 65 to 95 m; actual rope length still locks only on attachment and never retracts.
- X/Q still immediately detaches a live tether; RB/E still recovers spent equipment.
  Press/release edges and aim are buffered across zero-step render frames. Pause cancels
  windup and requires button release before a fresh press. Teleport resets transient state.
- Rider windup/freefall uses the existing animation layer and joint-limited IK. Shaft radii
  reduced from .016/.022 to .010/.014 normalized units. Narrow blue ribbon attaches near the
  tip and hangs downward independently of pole orientation; static decorative geometry,
  no cloth solver or decorative collision. No new asset imports or wardrobe work.
- Ivory/bronze reticle projects a short ballistic aim point from the simulation harness after
  camera update, including inherited rider velocity, with a charge ring. It is an aiming aid
  at 20 m, not a target lock or a guaranteed endpoint/range predictor.
- Primary files: `src/player/Player.ts`, `src/traversal/{SkyLance,tether,tuning,SkyLanceVisuals}.ts`,
  `src/core/types.ts`, `src/input/Input.ts`, `src/creatures/rider/animator.ts`,
  `src/game/Game.ts`, `src/debug/showcases/skyLance.ts`, related tests, capture manifest,
  browser check and this handoff. Existing V1 changes in other files are preserved.

### Actual verification
- `npm run typecheck`: passed.
- Focused traversal/player/input tests: 91 passed across 5 files.
- Final `npm test`: 967 passed across 95 files; no golden regeneration or tolerance changes.
- Final `npm run build`: passed.
- `node scripts/sky-lance-check.mjs`: passed on final source. Real DOM Q/E and simulated
  standard-controller X/RB mapping, full windup/release, pause cancellation, ledge freefall,
  deliberate catch, actual camera-aim attachment, swing/release/recovery/ground restoration.
  Rope excess 3.20e-14 m; release velocity error against the next gravity/drag step 0.
  Measured horizontal change during that step .00574 m/s is aerodynamic drag, not a release
  impulse. Strict 1e-8 release-physics assertion remains; no blanket tolerance relaxation.
- Final `node scripts/smoke.mjs --no-build --port 5393`: 15/15 passed against the
  resulting production build, including title/play, pause/resume, quality switches and plain boot.
- Existing dragon-capture harness: five final captures completed, visually reviewed:
  all three rider builds at full windup, plus freefall dive/brake. Manifest assertions check
  actual charge and traversal mode rather than assigning poses. Output:
  `/tmp/driftwing-sky-lance-r2/index.md`; earlier V1 views remain in
  `/tmp/driftwing-sky-lance-captures/index.md`. Browser telemetry:
  `/tmp/driftwing-sky-lance-check.json`.
- Browser/captures use software WebGL (SwiftShader). Physical gamepad feel, real GPU
  performance and owner playtesting remain outstanding; no claim of hardware validation.
- `git diff --check`: passed. No repository cleanup, resets, stash or Git integration done.

### Next authorized action
Owner playtest/review at `http://localhost:5175/?view=skyLance&play=1&quality=low`.
Development server remains running on 5175. Await further direction before expanding scope
or checkpointing/integrating this experiment. Known prototype limits remain: registered
static anchors only, no rope wrapping, no moving anchors, no rope shortening, no cloth solver.

## Latest: isolated Sky Lance V1 prototype — 2026-10-10

This section supersedes historical objectives below for this worktree; older entries are retained.

### Authority and checkout
- Owner approved the checkpoint/worktree procedure and isolated implementation, staged tests,
  locked dependency installation, runtime validation and captures. No commit, integration, push,
  deployment, dependency changes, wardrobes or dragon-mounted grapple work is authorized.
- Worktree: `/home/robert/Projects/Driftwing-SkyLance`; branch: `exp/sky-lance-v1`.
- HEAD remains `f3ef231c6a12ed5865cd73562447f6d94a1730bf`; prototype changes are uncommitted.
- This verified reference-pack checkpoint contains released gameplay at `844e5c2` plus art/docs.
  Only `docs/art-reference-pack` was fetched; no branch was merged into the released checkout.
- Released worktree `/home/robert/Projects/Driftwing-Codex` remains clean on `dev/codex-wsl`
  at `844e5c25860aab4c596116df4ffb19fa4e98fd1e`. All prior rider, gameplay and music work is preserved.

### Implemented boundaries
- Opt-in practice scene: `?view=skyLance&play=1`, using the real Game, Player, Rider, camera,
  analytic terrain and shared collider index. Two elevated decks and two registered static anchors.
- `PlayerMode.traversing` owns `RiderFoot.position/velocity` during tethered/released travel.
  Equipment attachment resolves before movement dispatch; pending rescue changes to a return hop
  from the companion's current position. No catch interrupts a valid swing.
- Detached travel preserves velocity rather than using ordinary walking acceleration or fall drag.
  Release grants 1.5 seconds before a fresh ordinary rescue clock. Ground contact restores walking;
  teleport, spawn, quit and mount transitions reset transient equipment.
- New `src/traversal/` modules separate equipment state, anchor identity, swept queries, tether
  solving and procedural presentation. Gameplay never reads animated hand positions for forces.
- Fixed 120 Hz; four integration substeps. Rope length locks at attachment, allows slack/inward
  travel, removes outward radial velocity and preserves tangent velocity. Bounded tangential input
  pumping and an energy guard prevent constraint-created energy. No retraction or winch force.
- Swept sphere projectile proxy and three swept rider body probes. Primitive structures use
  signed-distance conservative advancement; rock uses shared analytic contact queries with a
  conservative sampled envelope (at most 1 cm extra clearance) and bisection. Query exhaustion
  fails closed. Conflicting world/rope contacts and blocked lines detach; no rope wrapping.
  Only the attached fixture's own eye is excluded from line obstruction checks, never rider collision.
- Manual recovery after detachment restores equipment immediately without moving the rider.
  In-flight throws can also be cancelled by recovery; attached ropes cannot be recovered/retracted.
- Q / Xbox X (PlayStation square): throw or release. E / RB (R1): recover.
  Shift / B or L3: run; Space / A: jump; WASD / left stick: move or pump;
  mouse / right stick: aim; R / View or the practice button: reset.
- Existing flight tuning, breeds, renderer, golden fixtures, dependencies and ordinary movement
  paths are unchanged. The opt-in scene supplies its own control/status panel; no M1 expansion.

### Art reference disposition
- Art master 2.0, the reference pack documents/manifests and all 23 supplied images were reviewed.
  Existing tracked reference assets were not duplicated, imported into runtime, or modified.
- Ready to apply: palette, ceremonial silhouette and proportions. The placeholder uses a pole
  1.45 times nominal rider height, restrained tip, grip wrap, bronze eye and long static blue pennon.
- JPEG/PNG character, faction, armor and banner artwork is visual reference, not completed 3D art.
  There are no supplied runtime models, rigs or animations to import. Production garment geometry,
  rigging, throw/recovery animation and banner cloth remain future modeling/animation work.
- Physics uses a compact tip proxy and stable torso endpoint; decorative shaft, eye and banner
  geometry exert no forces. Shaft contact and production eye/grip offsets need later art refinement.
  Static pennon and instant recovery are deliberate V1 placeholders.
- Master 2.0 takes precedence over the older atlas's 2.5–3-times-height pole and older wardrobe
  archery/palette notes. Illustrated serpentine dragons/pagoda roofs are not changes to game canon.

### Actual verification
- Before editing: existing Player/collision baseline, 55 tests passed.
- Each system was tested before the next integration stage: projectile/tether, traversal ownership,
  input/rider presentation, then the complete browser loop.
- Final `npm run typecheck`: passed.
- Final `npm test`: 959 passed across 95 files (25 additions over the released 934-test baseline).
- Final `npm run build`: passed. `node scripts/smoke.mjs --no-build --port 5393`: 15/15 passed.
- Coverage includes thin/invalid/occluded targets, slack and length bounds, 60-second unpowered
  energy stability, tangent preservation, pumping bounds, release momentum, restoration, pending
  catch cancellation, high-speed wall/ceiling/analytic-terrain contacts, repeated recovery, zero dt,
  teleport/reset, queued aim, and fixed outcomes at 30/60/120/144 FPS plus jittered presentation.
- `node scripts/sky-lance-check.mjs`: passed in Chromium/SwiftShader. Actual attachment, two-second
  swing, release, recovery and grounded walking restoration recorded; maximum length excess
  `2.842170943040401e-14 m`, horizontal release velocity change `0 m/s` in this trajectory.
  Also passed real keyboard event mapping, simulated standard-pad X/RB edges, pause/resume and
  attachment with existing camera aim (no custom projectile aim injected for that check).
- Browser telemetry: `/tmp/driftwing-sky-lance-check.json`. This is software-renderer evidence,
  not a physical-controller playtest or real-GPU performance measurement.
- Existing capture harness completed seven images: all three rider builds plus anchor, swing,
  release and recovery. Index: `/tmp/driftwing-sky-lance-captures/index.md`.
  Captures were visually reviewed for grip/pennon and tether legibility; binary outputs stay outside Git.
- `git diff --check`: passed. No golden fixtures or tolerances regenerated/changed.

### Remaining review and next authorized action
- Owner should playtest the isolated prototype at
  `http://localhost:5175/?view=skyLance&play=1&quality=low` (practice server left running).
  Run forward, jump toward the gap, aim up at the first bronze fixture and throw; pump, release,
  then recover. Release timing determines whether the second deck is reached.
- Physical-controller feel, real-GPU performance, production art and broader-world anchor placement
  remain unverified/deferred. Existing discovery notices can appear over the practice scene.
  Collision queries currently allocate temporary vectors; this isolated prototype is not a zero-
  allocation production traversal system. Long/grazing rock sweeps have a conservative clearance.
- Await owner review before changing scope, integrating, committing, pushing or deploying.
  M1 Gate C remains independent; no wardrobe or dragon integration was started.

---

## Objective and authority
M1 "The First Lead", WP1: research state and save integrity. Gate A approved.
Stop at Gate B before WP2. No commit authorized.
Brief read from origin/dev/claude at 4490a59 without merging.

## Checkout
- Agent: Codex
- Branch: dev/codex-wsl
- HEAD/baseline: 1d718e943aa4e960cd39f2ff3bf82eca362d7cfe
- Work is uncommitted; no other worktree edited.

## Completed
- Added pure research normalization, once-only transition/event payloads, stable Highmoor ridge observation key, and inscription-gated airship stage 0/1.
- Retained save version/key 1 for the additive optional field. Defaults initialize research; loading sanitizes M1 IDs and recomputes point totals.
- Existing finds remain authoritative: unique feathers contribute to nature, relics to antiquity, known landmarks to winds. No duplicate find records.
- Existing reset clears research/observations and stage reward while retaining settings.
- Files: src/research/state.ts, src/research/state.test.ts, src/progression/save.ts, src/progression/save.test.ts, src/game/contracts.ts, this handoff.

## Verification
- Focused Vitest: 21 tests passed across 3 files.
- Full Vitest: 885 tests passed across 87 files.
- npm run typecheck: passed.
- No production build, browser smoke or manual gameplay run for WP1.

## Limits and known issues
- Transitions return researchEntry payloads; runtime emission/subscriptions and Game wiring are deferred.
- Totals are a derived cache: later runtime must recompute when authoritative finds change.
- WP3 must enforce airborne ridge-observation eligibility; persistence alone does not establish observation.
- All-breed approaches, Greek correctness and aerial visibility remain unverified.
- Repeated-dive stutter is a pre-existing owner observation, not a diagnosed regression.
- Approved document wording and encounter presentation are deferred from WP1.

## Next action
Gate B persistence/data-contract review. Await explicit approval before WP2 and permission before any commit.

## WP2 — Gate C candidate
Gate B approved. Implemented the first shrine only; stop for owner browser playtest before WP3.
- Built two pale columns, a Greek inscription slab, and a clear approach keep-out at the existing shrine anchor. Terrain and flight tuning are unchanged.
- Added procedural stroke glyphs (no fonts); Greek remains linguistically/epigraphically unverified. Registry translation now carries the approved lead.
- Registered on-foot read interaction; existing Game prompt routing reserves stable priority and suppresses mount/call while reading.
- Added survey runtime: once-only rewards/events and derived-find refresh. Re-reading opens the same translation in the existing paused dialog, with standard confirm/back controls.
- Added static keel and raised-rib states at the existing dock; inscription unlocks stage 1. Collider arrays are replaced on stage changes so reset removes rib collisions.
- Applied Gate A-approved AGENTS/ROADMAP wording. WP3 second-site presentation and WP4 knowledge record remain deferred.
- Additional files: src/research/Research.ts, Research.test.ts, firstLeadEncounter.ts, firstLeadText.ts; src/world/dressing/ventari/FirstLead.ts, FirstLead.test.ts, glyphs.ts. Modified Game.ts, Ui.ts, registry.ts, ventari/plan.ts and approved project documents.

### WP2 checks and limitations
- Focused encounter/player/planning/interaction suite: 65 tests passed across 5 files.
- After collider-reset fix: 8 focused tests passed across 2 files; typecheck and production build passed.
- Full suite before collider-reset fix: 893 tests passed across 89 files; final rerun recorded below.
- Landing tests exercise a 17 m/s still-air flared final approach for all four breeds. They do not establish human routefinding, aerial visibility, weather coverage, or overall experience quality.
- Browser smoke attempted but blocked by missing host Chromium libraries (libnspr4, libnss3, libasound2t64). Downloaded Playwright's Ubuntu 24.04 fallback browser because its installer does not recognize Ubuntu 26.04. No project dependency changed. Host library install could not proceed: sudo requires interactive authentication.
- No browser captures or runtime visual/UI verification completed. Owner Gate C playtest remains required.
- Dev server started at http://127.0.0.1:5174/ (5173 was already occupied).
- No commits made. Next action: resolve browser prerequisites and owner Gate C playtest; do not start WP3 on this handoff alone.
- Final full Vitest rerun after collider-reset fix: 893 tests passed across 89 files.

## Gate C feedback — early-island terrain/foliage revision
Owner could not spot the encounter and reported foliage obstruction and bumpy islands; requested a flattening pass. Started with the recommended M1 route (Roost, Gull's Rest, Highmoor), pending broader scope preference.
- Updated only layout parameters and field styles: hill allowance 7→3 m / 6→2 m / 26→8 m; broader flat centers at Gull's Rest and Highmoor; lower tree hints; shorter grass and reduced Gull's Rest/Highmoor tuft density.
- All top surfaces still use IslandShape, shared by mesh/collision/walking/landing. Cliffs, outlines, island baseline heights, flight tuning and unrelated islands retain their existing definitions.
- Terrain revision supersedes the earlier WP2 note that terrain was unchanged. Procedural site/prop positions may regenerate with the new tops.
- Focused terrain, mesh, dressing, placement and collision suite: 48 tests passed across 8 files. Production build (including typecheck) passed. Full suite result recorded below.
- Browser verification remains blocked by previously documented host libraries. Owner must assess visibility and terrain feel after reloading http://localhost:5174/.
- Gate C remains open; no WP3 work or commit authorized.
- Full suite after terrain revision: 893 tests passed across 89 files; git diff --check passed.


## Approved shrine visibility correction and introductory tutorial — 2026-10-09
- Branch dev/codex-wsl, HEAD 1d718e943aa4e960cd39f2ff3bf82eca362d7cfe. Existing uncommitted work preserved; no commit, integration or deployment performed.
- Owner separately approved the bounded shrine visibility correction and a tutorial implementation/verification scope. This supersedes M1's no-marker rule only for introductory first-shrine guidance (ROADMAP updated); subsequent exploration remains unguided.
- Moved the shrine toward the Roost-facing side, enlarged the pale columns to 18 m and added a solid lintel. Increased column separation to 22 m and beam width to 25 m; rendering and collider dimensions match. Site footprint radius is 14 m; existing 23 m vegetation keep-out remains. No additional terrain or flight tuning changes in this pass.
- Initial enlarged-column layout failed the existing Ironback landing test. Diagnostic runs with shrine colliders excluded passed; excluding the plaque alone still failed. Widening the columns resolved the failure with the original test assertions and all collider sources restored. All four breeds pass the existing still-air final approach; this is not a human routefinding or weather playtest.
- Extended existing device-aware lessons with bank controls. After walking/mounting, takeoff, flapping and pitch lessons, a paused local map offers Guide me / Skip guidance / Back. It derives outlines from IslandShape and displays the player, Roost and actual first-shrine anchor; it does not reveal the second encounter.
- Pause → Tutorial map reopens it. Active guidance adds a pinned named compass marker and contextual travel/landing/dismount/read instructions. Races suppress shrine guidance. Reading the inscription removes guidance using the authoritative research entry; tutorial completion does not award research.
- Added optional firstLeadGuide active/skipped persistence and restored sanitized individual tip IDs on load. Settings → Gameplay → Replay tips resets lessons and the guidance offer without clearing research; an already-read inscription stays completed.
- New tutorial files: src/ui/TutorialMap.ts, firstLeadGuide.ts, firstLeadGuide.test.ts. Changes also touch Ui, Tips, Hud, tutor, SettingsMenu, ui.css, Game, contracts and save loading.
- Final automated checks: 898 tests passed across 90 files; npm run build passed (includes tsc --noEmit); production smoke 15/15 passed. git diff --check passed before this appended note, rechecked afterward.
- Browser verification on localhost:5174: map offer after lessons; skip and active-state reload; individual lessons survive reload; Pause map access; simulated standard Xbox-pad confirmation; approach/dismount/read text; actual Settings replay; race countdown hides shrine marker; actual on-foot read prompt and translated dialog persist inscription completion. Browser page errors and debug error list empty. Simulated controller input is not a physical-controller playtest.
- Captures in /tmp: driftwing-tutorial-map.png, driftwing-tutorial-guide.png, driftwing-shrine-after-approach.png, driftwing-shrine-after-high-approach.png, driftwing-shrine-after-close.png. Camera overrides establish static views, not a complete naturally flown discovery sequence. Shrine is more evident from the elevated approach; distant lower views still make it small.
- Host browser-library blocker in previous entries is resolved by the owner's WSL installation. Greek remains provisional and linguistically unverified.
- Next action: owner Gate C visual/gameplay review at http://localhost:5174/. No WP3, commits, integration, push or deployment authorized by this handoff.


## Approved Gate A — rider hip continuity and authoritative touchdown (2026-10-09)
- Owner approved the proposed bounded Gate A after the source review. Reference main is bb87b14374ab3e177203385c71cbcb06b472566e; implementation baseline is dev/codex-wsl at 1d718e943aa4e960cd39f2ff3bf82eca362d7cfe plus all pre-existing uncommitted M1/tutorial work. That work was preserved. No integration, commit, push, deployment or dependency change.
- Unchanged source/scripts were archived to /tmp/driftwing-gatea-baseline.tar before implementation. Comparing that archive against the working tree confirmed only the approved fidelity/capture files changed in this pass, before this appended handoff.
- Rider body.ts now distributes the original 45% pelvis contribution continuously over the upper thigh, scaled with rider build. Geometry topology, vertex counts, bones, outfit boundaries and attachment targets are unchanged. Regression coverage checks the actual body loft for every outfit across all three builds; separate garment/strap skin fields are intentionally excluded from this continuity criterion. The original abrupt field failed the new regression.
- Player carries the existing terrain-normal touchdown impact into optional reusable WyvernPose metadata, with a contact serial and explicit reset epoch. Animation consumes each contact once; short teleports reset settling without producing an impact. Gentle authoritative impacts no longer inherit the legacy minimum impact/settle impulse. Eligibility, physics, timing, launch impulses and flight tuning are unchanged. Synthetic showcase poses explicitly omit this channel; ghosts and synthetic poses retain their velocity-based fallback.
- Regression tests first reproduced the 20 m/s rendered-velocity versus 0.2 m/s authoritative-impact mismatch. Added coverage includes all breeds, duplicate consumption, zero-duration updates, reset, interrupted settling, and 30/60/120/144 FPS plus jitter. An end-to-end Player/wyvern landing test gives identical fixed-step final states across those rates and under 5 cm variation in final saddle height. This is a scripted clear-ground approach, not comprehensive human/weather/terrain certification.
- Verification: focused rider/wyvern/player suite passed 218 tests across 12 files before the final end-to-end test; the final ground suite passed 40 tests. Final npm test: 905 tests across 90 files passed, including unchanged goldens. npm run typecheck passed. npm run build passed. Golden fixtures and tolerances were not changed.
- Capture harness now uses installed Playwright Chromium when the historical /opt binary is absent, records actual contact/state/animation telemetry, frames riders from their spine, corrects breed wingspan framing, and reports unavailable composites instead of linking them as produced results. No parallel capture stack was introduced.
- Baseline evidence: /tmp/driftwing-gatea-before (root grids, eight corrected landing strips, initial performance measurements), /tmp/driftwing-gatea-rider-before (36 correctly framed rider views: four breeds x three builds x three angles), /tmp/driftwing-gatea-reference-before (five reconstructed video-reference scenes). Earlier frozen landing attempts and cut-off rider framing were invalidated and recaptured before source implementation; use corrected saved telemetry, not scenario labels.
- After evidence: /tmp/driftwing-gatea-after/index.md and results.json: 54 scenarios (four eight-pose root grids, 36 rider views, eight real landing strips, five reference reconstructions, one measurement). All eight landing strips have exactly matching before/after contact events and positions. Low-sink impacts range 1.60–1.68 m/s; higher-sink impacts 5.18–5.23 m/s. Animation now uses the exact impacts; e.g. Harrier low-sink changed from estimated 1.396 to authoritative 1.620 m/s.
- Capture limitations: Pillow is missing, so 14 contact sheets/footfall diagrams are unavailable; individual PNGs and telemetry remain. Chromium closed during two larger runs; missing scenarios succeeded in isolated runs. Cause of browser closure is unverified. These are SwiftShader captures, not physical-GPU performance or owner playtest evidence. The YouTube video could not be retrieved in the source review; reconstructed scenes use the owner's timestamp descriptions, with no inferred narration or claim to exact camera/haze matching. The possible video roof intersection remains unproven.
- Default geometry measurements are unchanged: Harrier 21,502 triangles, Skimmer 21,666, Galewing 21,926, Ironback 25,490; 58 wyvern bones each. Current profiles/budget tests pass. Runtime still has one wyvern LOD; defined LOD profiles do not establish runtime switching.
- Scope intentionally deferred: no demonstrated root-junction defect justified a topology change. Rider attachment/stirrup retargeting awaits unavailable dragon2/e evidence and owner scope decision. Available dragon2/a, c and l snapshots were reviewed as diffs, not integrated; main's foot-driven trunk/ground/landing behavior remains. Gate B flight responsiveness needs a separate measured proposal and explicit approval. No claim that this small correction completes the broader anatomical/artistic quality bar.
- Next authorized action after delivery: owner review/playtest of Gate A. No automatic expansion, branch integration, commit, push or deployment; M1 Gate C review remains separately open.
- Final production smoke: node scripts/smoke.mjs --no-build --port 5391 passed 15/15 checks, including keyboard flight, pause/resume, both quality switches and plain production startup; no reported debug/production errors. The run was slow in this environment but completed with the documented timeout and assertions unchanged.
- Installed versions rechecked from node_modules package metadata: Three.js 0.186.1, TypeScript 6.0.2, Vite 8.3.4, Vitest 5.0.3, Playwright 1.56.1.
- Performance evidence (existing harness, SwiftShader, 180 timing iterations / 120 allocation iterations): before/initial-after/isolated-repeat full-frame CPU medians 0.2967/0.1575/0.1875 ms; allocation samples 8,031/8,240/8,203 bytes per frame. Baseline load average was 10.05 versus repeat 0.62, so these do not establish a speed improvement or causally attribute the sampled allocation difference. Per-breed flap CPU medians before/repeat: Harrier 0.0450/0.0244 ms, Skimmer 0.0322/0.0478, Galewing 0.0383/0.0422, Ironback 0.0383/0.0200; observed increases on two breeds coexist with lower initial-after readings and changed load. No real-GPU timing or zero-allocation claim.
- Investigated the initial Harrier flap allocation outlier (171 before, 1,961 initial-after bytes/call): 1,784 bytes/call were attributed to V8 IDLE_EXTERNAL. An isolated repeat measured 188 total, 25 IDLE_EXTERNAL. The original outlier was not reproduced; no application regression cause was established. Initial measurement preserved in /tmp/driftwing-gatea-after/measure/fidelity-cost.initial.json; repeat in fidelity-cost.json. Existing substantial ground/rider/frame allocations remain outside this correction scope.
- Final git diff --check passed. Handoff changes append to the preserved pre-existing text. Owner review remains the next step; broader anatomical/boarding/weather and physical-controller playtesting are still needed before claiming the overall fidelity target is met.

## Approved Gate B — bounded roll-braking pass (2026-10-09)

- Objective and authority: owner approved the measured two-parameter experiment on dev/codex-wsl at 1d718e943aa4e960cd39f2ff3bf82eca362d7cfe plus all existing uncommitted work. Only src/flight/FlightModel.ts, src/flight/FlightModel.test.ts and this appended handoff changed during Gate B. No commit, integration, push, deployment, dependency change or other checkout edit.
- Implementation: rollBrake 2.6 → 2.9; the existing braking tracking-gain cap 1.6 becomes rollBrakeGainMax = 1.8. Four direct-stick pulse regression cases protect the reduction in released-roll drift. Existing handling/ranking tests remain unchanged. No input shaping, camera, animation, breed, maximum-rate, lift/drag, stamina, climb/zoom or auto-level parameter changes.
- Independent unchanged-source 60 FPS baseline/candidate comparison: simulated-pad cruise overshoot Harrier 7.71° → 6.85°, Skimmer 10.45° → 9.29°, Galewing 7.02° → 6.26°, Ironback 7.57° → 6.71° (10.8–11.3% reduction). Arrest was 33 ms faster for each; first 1° bank response unchanged. All 16 keyboard/pad cruise/near-stall-start roll comparisons improved overshoot and arrest. Near-stall means initial speed 1.1 vStall, not sustained speed. No flapping, calm-air browser override and placement grace removed.
- Corrected render-rate comparison: 80 paired roll trials across all four breeds, keyboard/simulated pad, cruise/near-stall starts and 30/60/120/144 FPS plus jitter. Pad cruise overshoot reduction 10.8–11.3% at every timing; onset unchanged, arrest no worse, and every near-stall-start overshoot improved. Existing tests preserve Skimmer > Harrier > Ironback > Galewing responsiveness and slower heavy-breed roll-in/out. These are deterministic scripted trials, not human approach alignment or physical-controller latency/playtest evidence.
- Checks actually run: focused FlightModel/Player/input 151 passed before adding the four new cases; FlightModel with new cases 60 passed; npm test 909 passed across 90 files; npm run typecheck passed; npm run build passed; node scripts/smoke.mjs --no-build --port 5391 passed 15/15, including production startup and no reported errors. Existing golden fixtures/tolerances were untouched. Final whitespace and scope checks recorded below.
- Evidence: /tmp/driftwing-gateb-candidate/assessment.md and comparison.json; original unchanged-source baseline in /tmp/driftwing-gateb-baseline. Authoritative multi-rate baseline is /tmp/driftwing-gateb-rates-active-before/results.json; candidate /tmp/driftwing-gateb-rates-corrected-after/results.json; comparison verified-comparison.json in that candidate directory. Matching six-frame-per-breed visual sequences: /tmp/driftwing-gateb-visual-active-before/index.md and /tmp/driftwing-gateb-visual-after/index.md. Representative arrest frames inspected for all four breeds; chase views do not establish anatomical close-up quality or subjective controller feel.
- Measurement corrections: initial temporary multi-rate scheduling could hold a command one extra frame at a floating-point boundary. An initial in-page baseline override also imported a separate Vite module instead of the active HMR module. Those comparisons are superseded. The final baseline override imports the active resource URL and asserts its FlightModel constructor equals the player's constructor before setting original tuning. No repository rollback was needed. Initial sequence shot names also overwrote earlier breeds; unique per-breed recaptures supersede those images. Pillow remains absent, so individual PNGs/JSON are available without contact sheets.
- Existing-tool cost proxy, isolated after smoke: /tmp/driftwing-gateb-cost-active/measure/cost-before.json and cost-after.json, with verified active-module tuning overrides. Full-frame CPU medians 0.3092 → 0.2892 ms; sampled allocation 8,354 → 7,036 bytes/frame. After runs ranged 0.1692–0.4142 ms and load differed, so these do not establish a causal performance improvement or zero allocation. This is the existing showcase/frame proxy in SwiftShader, not an isolated roll-physics benchmark or physical-GPU measurement. Geometry unchanged: Harrier 21,502, Skimmer 21,666, Galewing 21,926, Ironback 25,490 triangles; 58 bones each.
- Remaining decisions: owner keyboard/controller playtest of the small braking change; unavailable feat/loop overlap remains unreconciled, as explicitly accepted for this isolated experiment. Broader rider attachment/boarding and anatomical work remain separate. Next authorized action after delivery is owner review, without automatic tuning expansion, integration, commits or deployment.

- Final Gate B checks: git diff --check passed. Hash/file-list comparison with the approved baseline found exactly the three approved files changed, with no added or removed files; all pre-existing work preserved.

## Approved mounted foot-contact correction — 2026-10-09

- Authority and baseline: owner approved the focused stirrup/boot correction and its verification on dev/codex-wsl at 1d718e943aa4e960cd39f2ff3bf82eca362d7cfe plus the existing working tree. Missing dragon2/e overlap was explicitly accepted for independent work. No commit, integration, push, deployment, dependency change or other checkout edit.
- Game injects the existing Wyvern.socket lookup into Rider. Rider resolves current world stirrup holds into its current anchor after the wyvern update, using reusable vectors/matrix. Missing providers or individual holds retain the original flank-fit fallback; no stale contacts. No new attachment subsystem or tack geometry changes.
- The mount layer supports the boot sole under the ball on the existing 18 mm brass tread, using actual ankle bind height rather than the different nominal RigDims.ankleY. Supported leg IK compensates the rig's small fore/aft bind offsets, blended by mount weight; the original on-foot/fallback solve remains intact. Build rebuilds refresh cached leg lengths/hip offsets without resetting smoothing or changing hand behavior. Existing torso/hip choreography, mount/dismount timing, wyvern animation and flight physics were not changed in this pass.
- Final tests cover 4 breeds × 3 rider builds × 4 saddles × 8 poses: actual skinned boot surfaces within 2 cm of the socket centre, outside the 18 mm rod there, and within 3 mm of its top; limb reach below 99%; lower-shin clearance against the barrel profile. Expanded mounted wing-clearance coverage includes every build and all four saddles with original clearance assertions. Moving/banking trials cover 30/60/120/144 FPS and jitter, look/saddle rebuilds, zero-duration updates and teleports. Missing-hold fallback and on-foot standing/walking/running/turning equivalence also pass.
- Checks actually run: final focused attachment/mounted 27 passed before adding the on-foot case; full suite with that case 931 passed across 91 files; final attachment suite with the additional metal-clearance assertion 22 passed. Typecheck and production build passed. Production smoke (node scripts/smoke.mjs --no-build --port 5391) passed 15/15, including runtime quality switching and no reported debug/production errors. Existing golden fixtures and tolerances were untouched.
- Unchanged-source baseline and final browser comparison cover all 48 combinations / 384 staged poses / 1,344 paired skinned surface samples. Maximum boot-surface distance to socket centre: Harrier 27.76 → 1.815 cm; Skimmer 31.48 → 1.815 cm; Galewing 30.49 → 1.815 cm; Ironback 26.60 → 1.815 cm. Final minimum 1.810 cm. These distances include the rod thickness, not an air gap. Paired hand-surface distances are identical; maximum leg reach about 93.9%, minimum knee flexion about 40.3°. Unsigned distances do not by themselves prove absence of every possible mesh intersection.
- Evidence: /tmp/driftwing-foot-assessment.md and driftwing-foot-assessment.json. Final default-saddle before/after captures and real Player mount/dismount snapshots are in /tmp/driftwing-rider-{breed}-captures and /tmp/driftwing-foot-{breed}-captures-surface. Additional saddle baselines/final telemetry are in /tmp/driftwing-foot-{breed}-variants-before and -variants-surface; those transition traces use the default saddle. All three additional saddle types across every build have extra idle/flare views in /tmp/driftwing-foot-saddle-views, plus elevated rear bank/kneel/flare views. Representative comparisons for every breed and saddle type were inspected with no new boot/body/metal clipping observed. Some front/side views are occluded by neck/wings; visual review is representative, not exhaustive. Pillow remains absent; individual PNGs/JSON were saved without contact sheets. Interim -after, -final and -verified captures are superseded by -surface.
- Existing-tool cost sample (600 CPU / 300 allocation iterations, high quality): full-frame CPU median 0.235 → 0.1675 ms; mounted rider 0.071 → 0.0695 ms. Sampled allocation: full frame 8,362 → 8,567 bytes/call; mounted rider 1,535 → 1,645. Host load differed and CPU run ranges overlap, so no causal performance improvement, allocation-regression attribution or zero-allocation claim. This is a SwiftShader/browser CPU proxy, not physical-GPU evidence. Raw comparison: /tmp/driftwing-foot-cost-comparison.json. Wyvern triangles unchanged (21,502 / 21,666 / 21,926 / 25,490), 58 bones each; rider inventory unchanged.
- Remaining scope: broader boarding/kneeling behavior and legacy arm bind-dimension caches were not corrected. Controlled presentation staging and directly invoked Player transitions are not a human flight/controller or input-discoverability playtest. Owner visual/play review at http://localhost:5174/ is next; no automatic expansion, integration, commits or deployment is authorized.


## Mounted posture follow-up — scoped trial stopped for hardware approval (2026-10-10)

- Objective: knees forward and less splayed, with a squat-like saddle posture. Owner approved animator/attachment/mounted-test changes and runtime validation, with hardware changes requiring a separate decision.
- Workspace: /home/robert/Projects/Driftwing-Codex; dev/codex-wsl at 1d718e943aa4e960cd39f2ff3bf82eca362d7cfe. Existing uncommitted work preserved.
- Captured 48 unchanged baseline side/rear idle/flare views across four breeds and three rider builds with the existing dragon-capture harness: /tmp/posture-before/index.md. Recreated temporary manifests because earlier /tmp evidence was unavailable. Started local dev server on port 5174 for approved captures.
- Two knee-pole trials preserved the original contact/clearance checks, but did not meet the proposed forward-dominant posture criteria. Added exploratory forward-posture assertions failed; they were not weakened. Trial edits and diagnostic assertions/logging were removed by restoring only this turn's changes. Hash comparison confirmed all tracked/untracked project files identical to turn start before this append.
- Fixed-contact geometric bound, slight build/default saddle/settled idle: knee flexion about 50.59 degrees; maximum forward knee travel from hip about 8.22 cm; minimum outward travel about 21.13 cm (separate extrema). Equivalent bounds measured for all four breeds in that scenario. Knee-pole rotation cannot deepen flexion with fixed hip/ankle and limb lengths. /tmp/posture-findings.md records measurements. /tmp/posture-after is incomplete, discarded-trial evidence, not a delivered implementation.
- Source finding requiring expanded scope: src/creatures/wyvern/parts/saddle.ts clearOf(q), lines 522–530, samples hide into p. Its shin check at line 556 passes p as q, so hide sampling overwrites the queried point and p.distanceTo(q) becomes zero. This forces a negative sampled clearance and drives outward fitting to its upper bound. This aliasing is established by source; a correction has not been implemented or runtime verified.
- Focused checks on unchanged restored source: attachment and mounted tests passed 28/28 across two files. Four isolated default-saddle matrix cases also passed with diagnostic measurement. No full tests/build/typecheck/smoke run: no implementation retained, pending hardware scope decision. No golden changes, commits, integration, push or deployment.
- Proposed next scope for owner approval: fix only the saddle fitter's query/sample-vector alias, then align the mounted knee direction with the corrected existing tread sockets. Expected files: parts/saddle.ts, rider/animator.ts, rider/attachment.test.ts, mounted.test.ts, wyvern.anatomy.test.ts, append-only AI_HANDOFF.md. Preserve seat/grip, limb proportions, flight and gameplay. Verify hide/tread/boot/wing contact across all 48 breed/build/saddle combinations, matching captures, focused and full checks, production smoke. No such expanded work is authorized yet.


## Mounted saddle-fit correction — implemented and verified (2026-10-10)

- Owner explicitly approved the expanded saddle-fit correction, knee alignment, tests/captures and production verification. Workspace /home/robert/Projects/Driftwing-Codex; dev/codex-wsl remains at 1d718e943aa4e960cd39f2ff3bf82eca362d7cfe. No commits, branch integration, pushes or deployment.
- src/creatures/wyvern/parts/saddle.ts: use a separate reusable shin query vector so hide sampling cannot overwrite its clearance query. Correct the tread's ankle-relative fore/aft offset from -0.06 to +0.06 m: the supported boot ball is ahead of the ankle in +Z. This changes fitted stirrup hardware while preserving the seat-height and grip calculations, limb proportions and fitting clearance requirements.
- src/creatures/rider/animator.ts: supported knee pole points forward with a small inward bias (mirrored x=-0.35, z=1). Keep the existing boot-ball target on the 18 mm tread, ankle attitude, bind-offset correction, hip/torso/hand choreography and missing-socket fallback. No new per-frame allocation; the added fit vector is constructed with the cached straddle fit. No performance benchmark was run for this package.
- Regression coverage expanded in rider/attachment.test.ts and wyvern.anatomy.test.ts: neutral forward knee, all-pose forward knee/back-folded shin, and independently reconstructed fitted shin running primarily back rather than sideways. New regressions fail against the unchanged baseline (two isolated failures), and pass on the correction. An initially proposed 8 cm forward-knee requirement for every pose failed in flare because existing brace choreography moves the hips forward; keep 8 cm for neutral and positive forward travel for every pose. No pre-existing assertion, golden fixture or tolerance was weakened or regenerated.
- Focused final attachment/mounted checks: 28/28 passed. Focused anatomy/attachment/mounted matrix before final inward-pole refinement: 69/69 passed; final full suite includes those files and passed 931 tests across 91 files. Final npm run typecheck, npm test, npm run build and node scripts/smoke.mjs --no-build --port 5391 passed; smoke 15/15, including debug/production error checks, keyboard flight, pause/resume and quality switching. git diff --check passed.
- All 48 breed/build/saddle combinations retain boot/tread contact and existing lower-shin/body and wing clearance checks. Existing timing/rebuild/moving/banking tests cover 30/60/120/144 FPS, jitter, zero dt, teleports, missing holds and on-foot equivalence. Automated limb/capsule and surface sampling are not exhaustive triangle-intersection proof or a human controller playtest.
- Final visual evidence: /tmp/saddle-fit-verified/index.md and results.json, with all 120 expected image IDs and files checked: 48 matching default-saddle idle/flare side/rear views, plus 72 additional-saddle idle side/rear views. All 48 combinations represented. Matching unchanged default-saddle views: /tmp/posture-before/index.md. Review links/limitations: /tmp/saddle-fit-review.md. Representative comparisons inspected across every breed, every rider build and all saddle styles; no new clipping observed in those views. Royal decoration occludes some rear views; side views and automated coverage provide additional evidence. Capture flare labels describe the wyvern pose; rider channels are recorded separately, and braced-rider behavior is covered by unit tests.
- Capture recovery: initial large run lost Chromium; one sequential batch runner ended with exit 143. Causes unverified. Smaller batches and one isolated retry recovered all expected final images/telemetry. Original failed/partial runs remain for diagnosis; /tmp/saddle-fit-final, -after and -preview* are superseded by -verified. Captures use the existing harness and temporary manifests, without project tooling changes or dependency installs.
- Neutral Harrier/slight example: forward knee travel about 5.84 -> 9.37 cm; outward knee travel about 28.92 -> 22.97 cm; flexion about 50.59 -> 74.14 degrees. Before telemetry is settled unit-test idle; after telemetry is settled showcase idle, with tiny settling differences (not a frame-identical replay). Across final captured showcase poses, flexion 71.34–91.03 degrees and forward knee travel 8.42–14.36 cm. Measurements: /tmp/saddle-fit-posture-measurements.json and saddle-fit-capture-summary.json.
- Default wyvern geometry unchanged: Harrier 21,502, Skimmer 21,666, Galewing 21,926, Ironback 25,490 triangles; 58 bones each. Captures are browser/SwiftShader evidence, not physical-GPU performance measurements.
- Preservation check: file hashes from the start of this package confirm only saddle.ts, rider/animator.ts, rider/attachment.test.ts and wyvern.anatomy.test.ts changed before this append. mounted.test.ts required no edits; its existing tests pass. All earlier uncommitted work preserved. Flight, gameplay, shared world geometry, dependencies and other worktrees unchanged.
- Next action: owner visual/play review at http://localhost:5174/. Stop before further posture/boarding work, scope expansion, integration, commits, pushes or deployment without corresponding explicit approval.


## Small seated-rider lift (2026-10-10)

- Owner reported slight seated clipping and approved an efficient focused correction. Branch dev/codex-wsl, HEAD 1d718e9; prior uncommitted work preserved.
- rider/animator.ts: add 0.01 m to mounted pelvis height, blended through the existing mount layer. Preserve knee direction, seat hardware, hip rotation, hand and boot IK targets, on-foot behavior and flight.
- A 0.02 m trial failed the existing Skimmer neutral forward-knee assertion (0.07788 m versus >0.08 m); reduced the lift to 0.01 m instead of weakening the test or changing the approved leg posture.
- Final focused verification: attachment, mounted and rider gait tests passed 34/34 across three files; npm run typecheck passed. One matching Harrier/medium side capture inspected: /tmp/seat-lift-final/posture/harrier-medium-idle-90.png; baseline /tmp/saddle-fit-verified/posture/harrier-medium-idle-90.png. Representative visual evidence only, not exhaustive seat/garment intersection proof. All 48 contact combinations remain covered by focused tests.
- For this small follow-up, no full-suite/build/smoke rerun; those results in the preceding entry apply to the preceding version. No fixtures, dependencies, commits, pushes or deployment. Next action: owner review at localhost:5174; no automatic expansion.

## Combined build preparation and looping title music (2026-10-10)

- Owner requested bringing all existing edits together with the latest build, including looping title music until gameplay. Workspace /home/robert/Projects/Driftwing-Codex, branch dev/codex-wsl, HEAD 1d718e943aa4e960cd39f2ff3bf82eca362d7cfe. All previous tracked and untracked edits preserved; no merge, commit, push or deployment performed in this step.
- Remote read-only verification: main and latest successful Pages deployment remain bb87b14374ab3e177203385c71cbcb06b472566e, already an ancestor of this branch. Successful workflow https://github.com/rporter33/Driftwing/actions/runs/37949007576. dev/claude remains 4490a59d3e79beca94221214faa6679bfd15d349; its additional work is planning documents, not newer gameplay implementation. No feature snapshots or Claude worktree changes imported.
- New title files: src/audio/assets/driftwing-intro.mp3 (owner-supplied recording, 5,011,419 bytes), src/audio/titleMusic.ts and its focused lifecycle tests. src/audio/Audio.ts routes the looping recording through the existing music bus after gesture unlock and suppresses procedural music scheduling during the title. Game.setScreen forwards presentation screen transitions. Title/menu/Stable before gameplay retain the recording; play stops and disconnects it, and procedural scoring resumes. Existing title artwork and navigation retained. Context visibility suspension and existing Master/Music volume controls apply. No dependency or renderer changes.
- Verification on the complete dirty-tree candidate: npm run typecheck passed; npm test passed 934 tests across 92 files; npm run build passed; node scripts/smoke.mjs --no-build --port 5391 passed 15/15, including production subpath startup, flight, pause/resume, runtime quality switches and no reported errors. git diff --check passed. No golden fixtures or tolerances changed.
- Additional production Chromium check, without an autoplay-policy override: no audio context running before gesture; Enter opens title menu and starts the actual recording; decoded duration 216.0535 seconds; music-bus signal RMS 0.023735; Music and Master mute independently reach zero gain; accelerated native looping crosses the recording length repeatedly without an ended event; Enter into gameplay leaves the title source stopped/disconnected. No page errors or HTTP errors observed. Script /tmp/driftwing-title-check.mjs. Accelerated loop coverage is not a human assessment of the musical seam or device-speaker playback. Browser uses SwiftShader, not physical-GPU validation.
- Limitation: recording uses a decoded WebAudio buffer retained for returning to title, approximately 73 MiB of stereo PCM at the observed 44.1 kHz output sample rate, plus browser overhead. Streaming could reduce this memory if required; no device-memory profiling or low-memory mobile certification was performed. Existing procedural notes may finish their scheduled tails when returning from gameplay to title; no new procedural notes are scheduled during title playback.
- M1 remains the implemented first-site/tutorial slice; later second-site/observation/journal work is incomplete and was not implemented by this release preparation. Ancient Greek remains explicitly provisional and unverified.
- Next action: owner confirms configured commit author Robert Porter <robertporter343@gmail.com> and proposed message "Update shrine tutorial, rider motion, flight braking and title music", then explicitly approves the reviewed combined release to origin/main. Pushing main triggers .github/workflows/deploy.yml and publishes https://rporter33.github.io/Driftwing/. No release approval inferred from preparation; author and main/publication confirmations are pending. Current local build stamp still identifies uncommitted candidate baseline 1d718e9, not a new release commit.

## Combined release approved (2026-10-10)

- Owner explicitly approved the configured Robert Porter author, combined commit message, fast-forward update of origin/main, and resulting Pages deployment after reviewing the combined build and verification above.
- Release scope is the complete reviewed working tree: first-site/tutorial and early-island improvements, rider/saddle and landing fixes, bounded roll braking, capture tooling/documentation, and looping title music. Later M1 work and other feature branches remain excluded.
- Next authorized action: commit on dev/codex-wsl, rebuild with the commit stamp, push the reviewed commit to origin/main without force, and verify the resulting deployment. Record actual release SHA/workflow results in the delivery response; this entry is approval evidence, not a claim deployment has succeeded.

## Art reference import handoff — 2026-10-10

- Objective: upload the user's complete art reference pack to Git for future Codex art-direction work.
- Working branch: `docs/art-reference-pack`, based on remote `main` at
  `bb87b14374ab3e177203385c71cbcb06b472566e`.
- Completed: preserve the original ZIP and 32 extracted files in `docs/art/`, add
  a browsable index, and point future Codex work to it through root `AGENTS.md`.
- Verification: source/copy ZIP SHA-256 match; all 31 bundled manifest hashes match.
  No game tests or builds run because this is a documentation/reference import.
- Existing development checkouts were not modified.
- Historical repository state and implementation prompts inside the pack require
  revalidation and current task authorization; importing them does not authorize gameplay work.
- Next step: review the reference import for integration. Use the images and specifications
  in subsequently authorized art tasks.

The import commit is the Git commit introducing this file; this is a static handoff snapshot.
