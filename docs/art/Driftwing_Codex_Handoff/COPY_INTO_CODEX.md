# Codex handoff message — paste into your Codex session

I have supplied a Driftwing Sky Lance + Air Nomad reference package at the following local path: **<SET_ABSOLUTE_EXTRACTED_PATH>**.

Please read its `README_START_HERE.md`, `01_Sky_Lance/Art_Direction_Master.md`, and the reference art. This is the approved **visual reference pack**, not source code or completed 3D models.

**Gameplay priority:** Throw → static anchor → fixed-length slack/taut grapple → physics-based 3D swing → preserve velocity on release → recover lance. No retraction or auto-pull. The cloth banner is separate from the gameplay tether. Use the current 120 Hz update architecture and resolve control conflicts with `RiderFoot` and `Player` auto wyvern catch before implementing.

The previous inspection found 37 modified and 13 untracked files at HEAD `1d718e9` on `dev/codex-wsl`. Recheck the live state. **Do not reset, stash, merge, commit, or modify the dirty worktree until we approve a safe development checkpoint/worktree approach.** Sky Lance remains an isolated prototype outside the open M1 gate.

First reply with: verified repository state, safe preservation strategy, concrete files and movement-state integration plan, expected difficulty, and tests. Wait for approval of the worktree plan. Once approved, implement the narrow playable prototype, then expand character wardrobe later.
