# Windline priority visual review — 2026-10-11

These four completed PNGs support review of the HUD obstruction repair and the
approved fixed centre dot/controller prompts. They are full browser captures,
not motion clips, physical controller tests, or proof of rider animation quality.

| Capture | Actual captured source | File |
| --- | --- | --- |
| Before HUD, 1280 × 720 | `a475c40` (same tree as deployed main `193e56f`) | [PNG](qa/windline-hud-before-1280.png) |
| Repaired HUD, 1280 × 720 | `c1b8e37` | [PNG](qa/windline-hud-after-1280.png) |
| Valid centre dot and Xbox controls, 1280 × 720 | `43439d8` | [PNG](qa/Driftwing-valid-dot-controller-720p-43439d8.png) |
| Freefall status and Xbox controls, 1280 × 720 | `7fde07c` | [PNG](qa/Driftwing-controller-freefall-720p-7fde07c.png) |

The existing before/after images match the review copies byte for byte. The new
captures have [SHA-256 hashes](qa/windline-priority-review-manifest.json),
[reticle/source metadata](qa/windline-priority-review-reticle.json), and the
[24-case controller HUD matrix](qa/windline-priority-review-controller-hud.json).
The controller matrix activates the simulated standard Xbox controller, asserts
actual gamepad device/glyph selection, and checks viewport containment, primary
HUD/central-view clearance and status visibility. Green/ring checks inspect the
painted computed style and a real RT cast's matching static anchor/impact.

The dot uses light blue for neutral and green plus a ring for a currently valid
centre-ray attachment. It stays at the screen centre. Changed aim clears stale
green feedback until the next bounded forecast; pressing cast solves afresh.
The under-Roost fixture's close rock background is intentional collision/aim
test context. These images do not demonstrate the deferred updated character.

The requested Library retry failed before creation with
`hosted apps tools/list request failed: network`. No Library files were created.
The completed evidence is instead preserved in the authorized draft branch.

## Focused practice-route retry

The retry ran only a fresh prototype boot, a reload after a distant airborne
fixture, and the existing unpowered swing/landing sample. It did not rerun full
suites or change runtime code. [Diagnostics](qa/windline-priority-review-practice-retry.json)
record a 2.26 s fresh boot, 92 ms reload document, 1.67 s reload-to-ready, and no
browser/network errors. Release at step 200 lands physically on the far platform
at y = 400, z = −51.68 without pull or boost. The matching pillar pass reaches
17.26 m/s; the camera-roll and recenter bounds pass. The previous timeout's cause
was not established.

The retry loaded the same production asset as the clean `7fde07c` controller
capture. The prototype has no pause build stamp; this identity limitation is
recorded explicitly alongside the production script hash. The subsequent
`5d30bb9` commit changes only its presentation regression test.

Full enhancement CI and user/parent release review remain the merge gates.
Windhaven gameplay, character model updates and separate audio PR #7 are excluded.

Source CI `38113451419` subsequently failed the ready-preview average CPU cost
assertion in `windline-reticle-check.mjs`, after normal gameplay/save/reload and
controller flow passed. It did not reach the prototype practice reload. The
follow-up schedules each forecast cooldown from completion and yields additional
time after an expensive query, capped at 250 ms. Changed-pose eligibility still
clears immediately and a physical cast still solves afresh. The 2.5 ms average
cost assertion and all collision/behaviour assertions remain unchanged. A slow
query regression verifies that the next gameplay frames do not repeat it
immediately. New exact-head CI remains required before release.
