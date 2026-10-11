# Driftwing — Claude Code Instructions

Read AGENTS.md before beginning work.

Follow the same architecture, safety, testing, and handoff rules as Codex.

Read ARCHITECTURE.md and the relevant sections of docs/ROADMAP.md before proposing changes.

## Model usage guidance
- Use Sonnet for routine implementation, focused debugging, and tests.
- Recommend Opus for difficult architecture or unresolved cross-system problems.
- Use higher reasoning effort only when task complexity justifies it.
- Keep tasks focused and avoid unnecessary repeated context exploration.

Model switching is controlled by the user, not authorized automatically by this document.

## Important
The existing Three.js/WebGL architecture is authoritative.
WebGPU is not an approved migration.
Future design backlog entries are conceptual only.

Before modifying code, confirm the specific task and acceptance criteria.

## Shared visual direction

Read [docs/ART_DIRECTION.md](docs/ART_DIRECTION.md) before visual work.
Use exactly the same art authority, corrected image lookup, guardrails and
gameplay-camera verification requirements as Codex; do not maintain a separate
Claude art brief. Existing architecture, safety, testing and handoff rules still apply.
