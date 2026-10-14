# Dragon Circuit — asset authoring guides

[Back to Art and Assets](../README.md)

Updated 2026-10-13. These guides capture Robert's selected cel-shaded visual direction and the proposed workflow for one customizable wyvern and one six-limbed dragon.

## Read the guide you need

1. [Art style and visual acceptance](art-style/README.md)
2. [Triangle budgets and export checks](model-budgets/README.md)
3. [Tripo settings and generation workflow](tripo/README.md)
4. [Wyvern and dragon base-model prompts](base-model-prompts/README.md)
5. [Modular customization and compatibility](customization/README.md)
6. [Sol and Blender workflow, including a reusable prompt](sol-blender/README.md)

## Status and boundaries

- **Selected visual direction:** broad, readable forms; matte colors; soft three-band cel shading; selective outlines; simple coordinated environments.
- **Proposed authoring scope:** one reusable wyvern body and one reusable four-legged dragon body, with separate accessories.
- **Provisional:** triangle budgets, material counts, attachment designs and exact shader tuning.
- **Not established:** production-ready replacement meshes, six-limb runtime support, automatic reuse of the wyvern rig, or measured browser performance.
- Prior Blender stills used actual Harrier geometry and a mounted PR11 rider snapshot from revision `8e055069703c83308d5508ee72e5ad1d15ef348e`. They were separate studies, not live gameplay verification. Those local render files and .blend binaries are not uploaded by this documentation change.

Read [AGENTS.md](../../AGENTS.md), [architecture](../../ARCHITECTURE.md) and the [shared visual guide](../../docs/ART_DIRECTION.md) before implementation. Existing documents still use the Driftwing project name; this package does not rename the game or rewrite its canon. This documentation grants no authority to replace assets, alter gameplay, merge or deploy.

## Source baseline

Repository source inspected at `81761be3a4ce53ee1c90cdd9957a3171fe704a8a`: [cosmetic catalog](../../src/cosmetics/catalog.ts), [original triangle budgets](../../src/creatures/wyvern/parts/res.ts), architecture, roadmap and existing art references. Recheck the implementation before integration.
