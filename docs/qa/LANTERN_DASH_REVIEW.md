# Lantern Dash bounded lift review

Private draft only. Robert's approval covers this route/readability pass and his personal
playtest; it grants no merge, deployment or replacement of the released build. The base was
verified from remote main as `f97bac535611e09c6c732230b5f0ca73b9bbf804` on 2026-10-11.
The clean saved checkout contained no project `.agents/skills`; `/workspace/.agents` was empty.
`AGENTS.md`, architecture, roadmap, canonical art master and pack introduction were read.

## Review correction — final descent

The initial `02cfe3d` package is superseded after independent review found a misleading cue:
a rider who had climbed and then descended below 715 m toward the unchanged 690 m finish
was told to circle back. Presentation now retains bounded departure-height context and
recognizes the actual finish approach by position and finish height. A valid lower final
approach stays aimed at the gold ring, including routes that skipped the suggested thermal.
Low missed lift still offers recovery. No flight, timing, medal, saved-state or route geometry
changes are involved. Full attempts now retain the visible coaching sequence and independently
sample the final 180 m near the ring, rejecting seek/circle-back guidance there. A continuously
flown missed-lift/re-entry exercise separately records off-line recovery; staged fragments
remain excluded from the full-flow airborne claim. Human clarity/enjoyment remain for playtest.

## Player-facing change

Lantern Dash still starts at 630 m and finishes through the same gold ring at 690 m. With
Settings → Gameplay → Show tips enabled, a small suggested-lift label identifies the existing
warm thermal south of Lantern Spire. A compact strip below the timer explains entry, actual
height gained since entry, actual climb/descent rate, leaving with height, and recovery.
It hides on pause, HUD hiding, finish/abort and other courses. A label that would overlap the
strip at short viewport heights is suppressed. There are no new meshes or shaders.

The suggestion uses actual thermal ID 4 (`-1300, 480`, radius 110 m, top 900 m) and recommends
about 730 m for departure. These presentation constants are deliberately independent of
`courseVia`, which remains test-autopilot data. The real finish waypoint, camera waypoint,
records, ghosts, IDs, unlocks, medal thresholds, stamina and FlightModel are unchanged.
Guidance neither steers nor creates a required checkpoint. Alternate lift and route choices
remain valid. Timed races remain mounted; holding Y to leap into Windline aborts them.

The shared HUD integration is `RaceHud` constructing/updating `LanternCoachHud` with
the existing read-only view and HUD visibility, plus binding the race layer's font size directly
to the existing viewport unit so resize inheritance cannot leave the new strip at stale size.
Game, player, input, weather, FX and persistence
systems are untouched. Other workers' branches/worktrees and all rider/wardrobe/skeleton/
animation/Blender files are untouched. Curved/horizontal wind streams remain a separate owner
checkpoint after this review.

## Evidence and its limits

The final tested commit, tree, production build stamp, browser version, input method and all
raw results are in the review package's `evidence/after/evidence.json`. Baseline is in
`evidence/before/evidence.json`. The runner asserts that the loaded production stamp matches
the requested commit. Matched `find`, `enter`, `leave`, and `finish` PNGs hold player/camera,
clear weather parameters, heading, weather time/drift and gust phase constant. The comparison
checks the true finish waypoint separately. Ghosts do not store weather/phase; PB change alone
is not evidence of handling improvement.

The first complete matched virtual-controller runs were identical before/after:

| Breed | Attempt 1 | Retry | Whole-flow flight fraction |
| --- | ---: | ---: | ---: |
| Harrier | 86.37 s | 88.21 s | 94.7% / 98.7% |
| Galewing | 97.44 s | 98.40 s | 95.2% / 98.9% |
| Skimmer | 92.47 s | — | 95.0% |
| Ironback | 91.43 s | — | 94.9% |

Fractions cover rolling start, complete finish and result menu, plus four seconds on foot at
the Roost before each breed's first attempt. Menus/frozen poses are counted separately and
excluded from flying time. The interval and mode totals are retained. This is a bounded racing
sample, not a representative exploration/RPG session and not proof of the larger 60% airborne
design goal. Human attempt/retry measurements remain necessary.

The virtual controller is supplied through `navigator.getGamepads`; the production `Input.poll`
path, deadzones, shaping, trigger mappings and menu edges run normally. Only the QA sidecar
uses the existing feasibility autopilot. It is absent from the shipped build. Automated route
feasibility does not demonstrate human navigation, learning, controller comfort or rumble.

The pace pilot need not circle because it can reach the thermal near the departure altitude.
The 30 m flap-free exercise is therefore measured separately in real rising air with actual
gamepad polling, with all four breeds. That staged fragment is never the airtime numerator for
the complete attempt/retry report. Stall recovery uses a deliberately low-speed staged case
in safe open air; guidance-state probes are separately identified from physical flight.

## Validation

Run on the exact final checkout:

```sh
npm run typecheck
npm test -- --maxWorkers=2
npm run build
CHROMIUM_PATH=/usr/bin/chromium node scripts/smoke.mjs --no-build
npm run preview -- --host 127.0.0.1 --port 5174 --strictPort
CHROMIUM_PATH=/usr/bin/chromium node scripts/lantern-review-check.mjs http://127.0.0.1:5174
```

Initial unit run: 112 files / 1,200 tests passed, including all seven courses on all breeds,
ordered medals and the original 4 m body/wingtip clearance checks. The 15-check production
smoke passed. The final-head reports are authoritative over these initial results. No existing
assertion or threshold was reduced. New tests cover factual descent, real thermal membership,
re-entry, stall/overshoot priority, optional route choice, hysteresis and reset.
The browser regression also hides tips and the HUD separately, leaves and re-enters lift while
hidden, then verifies a new-entry +0 m and subsequent +30 m. Pause preserves the current gain.

Measured build cost initially: main Game JS +3.64 kB uncompressed / +1.28 kB gzip and CSS
+0.64 kB / +0.13 kB gzip. Final package reports retain exact final sizes and matched draw calls/
triangles/program counts. The warmed static RaceHud benchmark records 20 × 1,000 updates,
median/p95 milliseconds. It measures CPU presentation cost only, not physical GPU FPS.

Harness/setup failures encountered and corrected: the default Chromium path was absent and
the download CDN returned 403, so the installed `/usr/bin/chromium` was used; the harness was
corrected to use the existing `beginRace` API and actual breed IDs; an inappropriate assumption
that the pace route must circle 30 m was split into the explicit learning exercise; a staged
Ironback 180° reversal left the column, so the exercise now starts tangentially in the circling
direction; the first stall fixture recovered before sampling, so recovery is sampled at a real
stall in open air; the short-height label overlap was fixed, and the coach is placed before
the split delta so a prior record's transient line cannot push it into the world view.
Independent review caught stale entry state across hidden movement; state observation now
continues independently of visibility, with interrupted-flow regressions for tips/HUD and pause.
Original course/physics thresholds
remain unchanged. Raw final failures, if any, stay in the evidence file and block package CI.

Unrun here: physical Windows launcher execution, physical gamepad/rumble, human usability,
representative exploration airtime and Robert's acceptance. The private PR's integration CI
adds the repository's wider browser gates; its actual status must be checked, not inferred
from local smoke. No hosting/deploy workflow is invoked by this review package workflow.

## Windows review and physical checklist

The PR's **Lantern Dash private review package** Actions run produces an authenticated private
artifact named `lantern-dash-review-<full head SHA>`. Download it, then extract the inner ZIP to
a new folder. Double-click `Start-Driftwing.cmd`, keep the console open and play in Chrome/Edge.
The bundled readable PowerShell server binds only `127.0.0.1:18787`, requires no Node/Python/
admin setup, and opens the review game. It makes no persistent execution-policy change.
Closing the console stops it. Windows execution remains a physical review check.

This localhost origin has separate browser storage from the normal game, so it separates normal production saves. Different review folders served on this same port
in the same browser share review records and ghosts. Keep the port and browser to retain
those records. It does not migrate normal saves. If managed
Windows blocks PowerShell, the source fallback is `npm ci`, `npm run build`, then
`npm run preview -- --host 127.0.0.1 --port 18787`. A cloud localhost URL is not the delivery.

1. Two attempts with Harrier and two with Galewing. Try coaching on and off.
2. Find lift using the warm strokes; enter with speed and bank gradually rather than reverse
   abruptly. Release RT, gain at least 30 m without flapping, then leave near 730 m.
3. Glide around the spire's east side, bank through the gold ring and finish without respawn.
4. Intentionally miss lift, leave too early, overshoot the finish and stall safely high up.
   Recover; record which cue made the recovery understandable and any camera/HUD obstruction.
5. Menu pause/resume, View retry, held-Y Windline abort. Close/reopen; confirm record and ghost.
6. Record whole attempts/retries: time flying, on ground and in menus; mistakes, comfort and
   weather. Report clarity and satisfaction separately from time/medal performance.

Keyboard: WASD pitch/bank, Space flap, C flare, Esc pause, R retry. The canonical existing warm
wind visual vocabulary is reused. No new cosmetic production or environment asset art is claimed.
