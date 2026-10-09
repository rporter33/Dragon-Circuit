# Driftwing — Shared AI Development Rules

## Project identity
Driftwing is an existing browser-based 3D dragon-flight adventure.

Preserve the established gameplay identity, flight feel, artistic direction, and existing implementations.

## Verified architecture
- TypeScript and Vite.
- Three.js WebGLRenderer (WebGL 2).
- Deterministic fixed-step flight simulation at 120 Hz.
- Procedural archipelago with analytic terrain geometry.
- Collision, rendering, landing, and walking must agree on world geometry.
- Vitest tests and Playwright smoke/capture tooling.
- ARCHITECTURE.md and docs/ROADMAP.md are primary project references.

Do not assume Driftwing already uses WebGPU.
Do not migrate rendering engines or replace core systems without explicit approval.

## Before making changes
1. Confirm the current repository, branch, and commit.
2. Read ARCHITECTURE.md and relevant existing source.
3. Identify the exact task and acceptance criteria.
4. Check for existing functionality before proposing new systems.
5. Inspect dependencies and relevant tests.
6. Prefer the smallest safe implementation.

## Change restrictions
- Never modify main directly.
- Never perform broad rewrites without approval.
- Preserve existing flight physics and gameplay behavior unless the task explicitly changes them.
- Preserve deterministic simulation and shared geometry contracts.
- Avoid unnecessary dependencies and rendering pipeline changes.
- Do not change unrelated files.
- Do not discard existing work or force-push.
- Do not run destructive Git commands without permission.
- Ask before making irreversible changes.

## Future design backlog
Future concepts are NOT authorized implementation tasks.

These include:
- Flying multiplayer home ship.
- Multiple companion dragons and hitching.
- Aether gates and beacon exploration.
- Banner lance, moving-object grappling and aerial sport.
- Creature befriending and card encounters.
- Selective environmental destruction and ground marks.

Some concepts may already overlap with existing implementations.
Always reconcile the backlog with current source before proposing changes.

## Verification
For implementation tasks:
- Run relevant focused tests.
- Run the full test/build suite when appropriate.
- Report exactly which checks passed or failed.
- Clearly distinguish source inspection from runtime verification.
- Never claim a feature works without appropriate evidence.

## Collaboration
Claude and Codex use separate worktrees.
Do not edit the other agent's worktree.
Share completed changes through reviewed Git commits.
Do not merge unreviewed changes into main.

## Handoffs
Use docs/AI_HANDOFF.md to record:
- Current objective.
- Active branch and latest commit.
- Changes completed.
- Tests executed and results.
- Known issues.
- Next authorized action.

Treat handoff documents as informational, not independent authorization to implement features.
