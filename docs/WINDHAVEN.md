# Windhaven traveling home — playable art study

Windhaven is a traveling home that carries the player between levels/regions, with sheltered crafting and storage space and room for several riders. The owner approved the current scale as the working baseline. Destination selection and anchored exploration take priority over constant manual steering; multiplayer is not implemented or implied by the available room. The current milestone is a stationary, walkable art study in a dedicated review scene.

## Version and saved copies

As of October 10, 2026, development is on `feat/windhaven`, based on GitHub `main` commit `844e5c25860aab4c596116df4ffb19fa4e98fd1e` (shrine tutorial, rider motion, flight braking and title music). Windhaven was applied as `9b9964c0f85bac9dc781e8ac2ce20a9b1830640c`; its code was carried across unchanged. The package version is still 0.1.0, so use the Git commit to distinguish builds.

The separate recovery index is `C:\Users\Robert\Projects\Windhaven-Backups\README.md`. It links `2026-10-10-art-pass-1`, the earlier `2026-10-10-latest-main` snapshot and the original `2026-10-10-before-update`, each with source, captures and a Git recovery bundle. The original is also retained locally at `windhaven/checkpoint-2026-10-10`, commit `974bb32e7e11a0bfd58d9210429c057dfa4da164`. Restore into a new directory; do not overwrite another checkout's work.

The earlier combined blockout passed 957 unit tests across 93 files, the production build, 15/15 production smoke checks, and both deterministic and live-keyboard Windhaven browser checks across all four breeds, including reload/recovery. Its logs and captures are preserved in the earlier snapshot. Art-pass results appear below. Physical controller and embedded-browser checks remain separate.

## Open the review

Run `npm run windhaven` from the repository. It serves only on `127.0.0.1:5174`, opens `http://127.0.0.1:5174/?view=windhaven`, and refuses to silently change ports. Keep that terminal running while testing; closing the server makes the browser show a connection error. If port 5174 is already serving this project, use the existing preview. This scene is selected explicitly; it does not add the ship to ordinary play.

Use **Overview**, **Top**, **Side** and **Cabin** to inspect the art; these views pause simulation and say so in the panel. **Walk deck** resets the rider and wyvern onto the aft terrace and resumes play, including from the pause menu. **Ride / take off** seats the rider facing the open stern. WASD moves, F mounts or dismounts, Space jumps on foot or launches when mounted, and Esc pauses. Drag the view to look around. The breed selector previews all four existing breeds without changing the saved breed choice.

The review uses the normal game session and save infrastructure; other ordinary progression/settings behavior still applies. It is not a separate save slot.

## Layout under review

The deck remains 72 metres long with a 28-metre-wide working area. The owner approved this scale for the art pass, including room for several riders. Every original deck rectangle is preserved. The largest current breed, Galewing, has a 20.5-metre spread wingspan; exhaustive animated clearance remains part of further review.

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

The sail, stabilizer cloth and their light fittings remain visual-only. The rounded underbody uses shallow overlapping strakes with identical rendering/collision boxes; the original deck outline and bow steps remain. Rails now have actual open spaces between solid balusters and connected handrails. Cloth collision, smooth bow-edge reconstruction and a fully sculpted production hull remain future work. Cabin window panels are opaque decoration on solid walls, not traversable openings.

The shelter has no stable service interaction yet. The ship cannot move, steer, become the home/respawn anchor, or retain furniture changes. The Codex research airship remains unchanged; its story relationship to Windhaven is unresolved.

## Verification

The 25 focused tests in `windhaven.test.ts` exercise actual player simulation for all four breeds: flared landing and stopping from the stern and both sides, standing, dismounting, remounting, takeoff, and entering the shelter. They also check the rider's side walkway, landing airspace, unchanged deck/door/headroom dimensions, agreement between instanced rendering and collision transforms, finite bounded art geometry and decorative clearance over the terrace. These do not certify exhaustive animated wing clearance, arbitrary landing angles or a moving platform.

With the preview server running, `npm run test:windhaven` checks two browser paths: deterministic stepping with scripted inputs, then normal live rendering with keyboard events. The live pass tests WASD walking, F mount/dismount, Space launch, Escape pause, reset/resume and page reload. It captures overview, top, side and walking views into ignored `shots/`. Set `CHROMIUM_PATH` to an installed Chromium/Edge executable if Playwright's browser is unavailable. Physical controller hardware and the embedded app browser require their own interactive checks.

## Art pass 1 — October 10, 2026

This pass adds a finer rounded strake hull, connected tapered handrails, plank caulking, two tiers of fuller crescent sails with shared-shape spars/seams, curved stabilizer cloth, a tensioned shelter shade, arched opaque cabin window panels, a shallow blue canvas roof and a travel pennon. The original deck rectangles, cabin footprint/doorway, workshop footprints, landing terrace and shelter headroom remain unchanged. Reduced material rim lighting preserves the pale/blue color separation in bright daylight.

Implementation: `src/world/airship/Windhaven.ts` and `windhavenPlan.ts`; review cameras: `src/debug/showcases/windhaven.ts`. The ship uses 13 render meshes, 983 solid box instances and 50,367 triangles before shadow passes. These are geometry counts, not a frame-rate claim. No new dependencies, runtime image imports, renderer changes or flight changes.

Sources read together: [shared guide](ART_DIRECTION.md); `Art_Direction_Master.md` v2 and `README_START_HERE.md` under `docs/art/Driftwing_Codex_Handoff/` on `origin/docs/art-reference-pack` at verified commit `f3ef231c6a12ed5865cd73562447f6d94a1730bf`; supplied Windhaven concept plate (preserved as `windhaven-concept-reference.jpg` in the external backups). The master is proposed art direction, not a production mesh specification.

Reproduce evidence with `node scripts/windhaven-art.mjs` while the preview is running. It saves 11 high-quality 1440×900 captures and metrics under `shots/windhaven-art/`. Browser: Playwright with Microsoft Edge and SwiftShader; no physical-GPU performance certification. Gameplay-camera images are `on-foot.png`, `mounted.png`, `takeoff.png`, `bank.png`, `dive.png`, `brake.png` and `dismount.png`; `overview.png`, `side.png`, `top.png` and `cabin.png` are inspection cameras. Flight labels describe short scripted inputs, not certification of a sustained full dive or exhaustive animation coverage. The art-pass recovery snapshot includes these images.

| Guide category | Source / implementation | Observed evidence and status |
| --- | --- | --- |
| Costume / silhouette | Master sections 01–03; Windhaven concept; `Windhaven.ts` | **Partial** for ship silhouette: `overview.png`, `side.png` and `on-foot.png` show the tiered canopy and broad open terrace. Original bow steps and square masts remain. Costume changes are **not applicable** to this ship pass. |
| Palette / materials | Master section 05 swatches; `Windhaven.ts` material palette | **Verified in sampled daylight views**: `on-foot.png` and `cabin.png` show pale surfaces, blue accents, brown timber and restrained bronze. No chrome/gloss added. Fine woven/wood surface treatment and other lighting conditions remain unverified. |
| Armor / detail | Master sections 01, 05; `Windhaven.ts` fittings | Armor is **not applicable**; no armor edits. Ship detail is **partial**: broad trim/seams and inset panels read in `on-foot.png` and `cabin.png`; worktables/storage remain simple forms. |
| Lance / banner | Master sections 03–04; `Windhaven.ts` travel pennon | **Partial**: a long pale/blue top-mounted ship pennon appears in `cabin.png`. This is a ship signal, not a rider lance; no lance gameplay or final insignia approval claimed. Cloth is static. |
| Bracer / tether / harness | Pack introduction; no implementation changes | **Not applicable**: equipment, tether and harness systems are outside this pass. Their appearance in captures is not a compliance claim. |
| Architecture | Master sections 02, 07; `windhavenPlan.ts`, `Windhaven.ts` | **Partial**: pale cabin, arched panels, blue roof and linen shade follow the Mediterranean language in `cabin.png` / `on-foot.png`. Cabin interior and fully sculpted hull remain unfinished. Panels are solid decorative shutters. |
| Dragons | Master section 07; existing creature implementation retained | **Not applicable** to art changes. Existing Galewing is the gameplay scale cue in captures; all four breeds retain landing/walking/launch test coverage. No creature visual compliance claimed. |
| Animation / camera clearance | Master sections 04, 08; existing game camera/player plus Windhaven scene | **Partial**: sampled on-foot, mounted, takeoff, bank, tuck/pitch, flare and dismount views keep the dragon and forward route readable. Shelter underside enters the upper frame during early takeoff/bank. Review panel covers some left-side scenery/dragon at close range. Exhaustive wing turns, sustained full dives, all camera angles and controller hardware remain unverified. |

This is an art progression beyond the blockout, not final production-art approval. Cloth/fittings remain decorative and require collision review before free flight through the canopy. The approved deck space and primary dragon routes remain protected.

Validation: full suite passed 959 tests in 93 files before the final visual refinements; final focused suite passed 25/25 and the final production build passed. Both Windhaven browser paths passed; after the final rail/material adjustment the live four-breed path and reload were rerun successfully. Final standard production smoke passed 15/15. Eleven final high-quality art captures produced no reported browser errors. No physical-GPU frame-rate or controller certification claimed.

## Next development steps

1. Review deck proportions, cabin placement and shelter clearance in the blockout. Check full turns, folded wings, landing flare, launch strokes and camera framing before detailed art.
2. Refine the swept hull, sail spars and fittings while preserving the tested routes. Finish cloth collision and resolve the Codex relationship before production integration.
3. Connect home/stable/respawn behavior, ship persistence and a small complete crafting loop. Keep the landing terrace and circulation protected during placement.
4. Add destination-based region travel. If the journey moves the occupied ship continuously, first implement deterministic support identity/velocity and moving collision bounds for walking, mounting, launch and landing. The current static collider index cannot support this merely by mutating boxes. Continuous manual steering is not the primary loop.

The user's request authorizes continued Windhaven development. These steps remain scoped implementation milestones, not approval for renderer replacement, unrelated backlog features or changes to dragon flight feel.
