# Windhaven playable blockout

Windhaven is a proposed flying home for a rider and one wyvern, with sheltered crafting and storage space. The current milestone is a stationary, walkable blockout in a dedicated review scene. Its dimensions, appearance and layout remain provisional.

## Version and saved copies

As of October 10, 2026, development is on `feat/windhaven`, based on GitHub `main` commit `844e5c25860aab4c596116df4ffb19fa4e98fd1e` (shrine tutorial, rider motion, flight braking and title music). Windhaven was applied as `9b9964c0f85bac9dc781e8ac2ce20a9b1830640c`; its code was carried across unchanged. The package version is still 0.1.0, so use the Git commit to distinguish builds.

The separate recovery index is `C:\Users\Robert\Projects\Windhaven-Backups\README.md`. It links the original `2026-10-10-before-update` snapshot and the updated `2026-10-10-latest-main` snapshot, each with source, captures and a Git recovery bundle. The original is also retained locally at `windhaven/checkpoint-2026-10-10`, commit `974bb32e7e11a0bfd58d9210429c057dfa4da164`. Restore into a new directory; do not overwrite another checkout's work.

The combined version passed 957 unit tests across 93 files, the production build, 15/15 production smoke checks, and both deterministic and live-keyboard Windhaven browser checks across all four breeds, including reload/recovery. Browser logs and five review captures are included in the updated snapshot. Physical controller and embedded-browser checks remain separate.

## Open the review

Run `npm run windhaven` from the repository. It serves only on `127.0.0.1:5174`, opens `http://127.0.0.1:5174/?view=windhaven`, and refuses to silently change ports. Keep that terminal running while testing; closing the server makes the browser show a connection error. If port 5174 is already serving this project, use the existing preview. This scene is selected explicitly; it does not add the ship to ordinary play.

Use **Overview**, **Top** and **Side** to inspect the silhouette; these views pause simulation and say so in the panel. **Walk deck** resets the rider and wyvern onto the aft terrace and resumes play, including from the pause menu. **Ride / take off** seats the rider facing the open stern. WASD moves, F mounts or dismounts, Space jumps on foot or launches when mounted, and Esc pauses. Drag the view to look around. The breed selector previews all four existing breeds without changing the saved breed choice.

The review uses the normal game session and save infrastructure; other ordinary progression/settings behavior still applies. It is not a separate save slot.

## Layout under review

The hull is 72 metres long with a 28-metre-wide working deck. These are first-pass space allowances, not approved final dimensions. The largest current breed, Galewing, has a 20.5-metre spread wingspan; its animated clearance remains part of visual review.

| Area | Current arrangement |
| --- | --- |
| Aft landing terrace | 28 by 26 metres, with open stern and side approaches. No overhead sails or furnishing across the landing route. |
| Central dragon shelter | 14 by 16 metres, open aft, with a roof underside 9.6 metres above the deck. Side paths let the rider pass a resting dragon. |
| Workshops | Two 5 by 10 metre reserved areas forward and outboard of the shelter, with placeholder benches and storage. |
| Living cabin | An 8 by 10 metre room forward of the shelter; an aft doorway and outside paths keep access straightforward. |
| Chart deck | A forward navigation area with a placeholder chart table. |

The working furnishing proposal is movable benches, storage and decorations inside designated buildable areas. Landing, shelter entry and circulation remain protected. Placement controls, recipes, inventory and furniture persistence are future implementation work.

## Implementation boundaries

`src/world/airship/windhavenPlan.ts` supplies the same box geometry to rendering and terrain collision for the hull, deck, rails, roof, cabin, masts and furniture. `Windhaven.ts` builds the procedural view using the existing painterly material. `src/debug/showcases/windhaven.ts` adds the review scene through the existing lazy showcase loader. No flight physics or shared player behavior was changed.

The sail and steering cloth are visual silhouette studies without collision. Their attachment structure, rigging and collision need another pass. The stepped hull is a space-and-collision blockout, not the finished swept hull from the concept painting.

The shelter has no stable service interaction yet. The ship cannot move, steer, become the home/respawn anchor, or retain furniture changes. The Codex research airship remains unchanged; its story relationship to Windhaven is unresolved.

## Verification

The 23 focused tests in `windhaven.test.ts` exercise actual player simulation for all four breeds: flared landing and stopping from the stern and both sides, standing, dismounting, remounting, takeoff, and entering the shelter. They also check the rider's side walkway, landing airspace against solid colliders, and agreement between solid rendering and collision dimensions. These do not certify animated wing clearance, arbitrary landing angles or a moving platform.

With the preview server running, `npm run test:windhaven` checks two browser paths: deterministic stepping with scripted inputs, then normal live rendering with keyboard events. The live pass tests WASD walking, F mount/dismount, Space launch, Escape pause, reset/resume and page reload. It captures overview, top, side and walking views into ignored `shots/`. Set `CHROMIUM_PATH` to an installed Chromium/Edge executable if Playwright's browser is unavailable. Physical controller hardware and the embedded app browser require their own interactive checks.

## Next development steps

1. Review deck proportions, cabin placement and shelter clearance in the blockout. Check full turns, folded wings, landing flare, launch strokes and camera framing before detailed art.
2. Refine the swept hull, sail spars and fittings while preserving the tested routes. Finish cloth collision and resolve the Codex relationship before production integration.
3. Add deterministic ship movement and support identity/velocity to ground contact. Rider and wyvern must follow translation and yaw through standing, walking, mount transitions, launch and landing. Update dynamic collision bounds on simulation steps; the current static collider index does not support this merely by mutating boxes.
4. Connect home/stable/respawn behavior, then ship persistence and a small complete crafting loop. Region travel and structural expansions follow separately.

The user's request authorizes continued Windhaven development. These steps remain scoped implementation milestones, not approval for renderer replacement, unrelated backlog features or changes to dragon flight feel.
