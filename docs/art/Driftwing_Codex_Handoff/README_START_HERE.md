# Driftwing — Sky Lance and Air Nomad art handoff for Codex

## Purpose and priorities

The Sky Lance is a long Mediterranean-inspired ceremonial banner-lance that becomes a thrown javelin and grappling anchor. The first gameplay deliverable is **THROW → ANCHOR → FIXED-LENGTH TETHER → SWING → RELEASE WITH MOMENTUM → RECOVER**. The 8 outfit presets and 12 armor pieces are visual / future implementation references, **not** immediate acceptance criteria.

These are **2D concept images, visual reference sheets, Markdown specifications, and CSV manifests**. They are NOT .glb/.fbx/.blend models, production-ready meshes, animation rigs, or validated orthographic turnarounds.

### Confirmed prior repo inspection (must recheck locally)

- Workspace: `/home/robert/Projects/Driftwing-Codex`.
- Branch: `dev/codex-wsl`.
- Previously reported HEAD: `1d718e943aa4e960cd39f2ff3bf82eca362d7cfe`.
- Previously reported **dirty worktree**: 37 modified files + 13 untracked files. Do not alter, stash, reset, or commit those files without the user's approval.
- `RiderFoot` in `src/player/foot.ts` provides kinematic walking, jumping, gravity and collisions.
- `Player` manages mounting, falling, and automatic wyvern catching.
- Physics updates at fixed 120 Hz; no general rigid-body engine.
- Shared analytic terrain / structure colliders; raycast reportedly lacks target identity.
- Cosmetic equipment sockets exist, but no throwable-item / gameplay equipment lifecycle system yet.
- M1 “The First Lead” remains open; Sky Lance is an isolated experiment outside the current M1 completion scope.

### Design invariants

1. Use a fixed maximum tether length established at attachment, clamped without teleporting. Slack inside the radius; when taut prevent outward velocity while preserving tangential velocity and allowing inward motion.
2. No automatic rope shortening, retracting, winching, teleporting, or automatic pull-to-anchor during the V1 grapple.
3. Separate projectile collision, anchor, physics tether, decorative banner, and visible rope. Banner cloth has no role in gameplay constraints.
4. First anchor targets: approved **static world surfaces only**. No moving dragons, enemies, or moving structures.
5. Release preserves instantaneous player velocity and restores normal airborne movement. Grappling must not conflict with normal `RiderFoot` gravity/collision or `Player`'s auto-catch state.
6. Prefer tests for tunneling, valid anchor eligibility, rope bounds, constraint energy behavior, momentum, recovery, reset, and collision.
7. Visuals: ivory linen, Aegean/ultramarine blue, matte slate scales, leather, antique bronze, long top-mounted pennon; approachable Mediterranean silhouettes, not fantasy steel plate.

## Pack index

- `01_Sky_Lance/References/` — four Mediterranean sky-nomad illustrations plus banner family and material palette diagrams.
- `01_Sky_Lance/Art_Direction_Master.md` — full visual language, outfits, lance construction and camera considerations.
- `02_Wardrobe/Armor_Cards/` — 12 individual armor design cards (illustrative, not true multi-view modeling blueprints).
- `02_Wardrobe/Concept_Atlases/` — four generalized costume catalog images.
- `02_Wardrobe/Individual_Armor_Specifications.md` — 12 component details and provisional poly estimates.
- `02_Wardrobe/Wardrobe_Artist_Handoff.md` — earlier wardrobe production guidance.
- `02_Wardrobe/*.csv` — armor and clothing slot matrices.

## Instructions for Codex

1. Read `AGENTS.md`, `ARCHITECTURE.md`, `docs/ROADMAP.md`, then this README and `01_Sky_Lance/Art_Direction_Master.md`.
2. Compare the art's lance silhouette with the actual character/dragon scale and third-person gameplay camera. Decide grip location, embedded projectile visual, anchor socket, rope render, and optional saddle holder without assuming they exist yet.
3. Keep V1 collision proxies separate from the eventual visual lance model.
4. Identify the current movement authority and auto wyvern catch logic before integrating a grapple.
5. Propose a safe worktree / checkpoint plan given the dirty tree; never overwrite uncommitted work.
6. Implement a narrow deterministic static-anchor swing vertical slice only after the user approves the safe work strategy. Later import of final 3D character models will require original modeling/rigging.
7. Do not silently include bundled concept art in the runtime assets or commit binary files until the repository's asset policy and user approval are confirmed.

## Important documentation status

The art-direction documents were prepared before Sky Lance grappling was prioritized. Where they describe the banner-lance as purely ceremonial or non-weapon-like, the **updated gameplay directive overrides that constraint for functionality**: it must throw and anchor as a javelin while *visually* retaining the restrained ceremonial identity. Other lore or mechanics remain tentative.
