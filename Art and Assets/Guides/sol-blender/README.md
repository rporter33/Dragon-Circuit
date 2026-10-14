# Sol + Blender — accurate asset studies

[Back to guide index](../README.md)

## Model choice

Recommendation recorded 2026-10-13: GPT-6.1 Sol with High reasoning for ordinary design iteration, Blender work and review; GPT-6 Astra for difficult anatomy, rig or compatibility analysis. Image-generation models create reference images, not production 3D meshes. Tripo H3.1/Smart Mesh are separate mesh-generation choices.

Model names and availability can change. Verify the picker and [official OpenAI model guide](https://developers.openai.com/api/docs/models) rather than treating this recommendation as permanent.

## Reusable prompt

```text
Work as a Blender asset artist for Dragon Circuit, following the existing Driftwing art references. Create a separate, editable Blender study using the supplied model and references.

Target style: stylized low-to-mid-poly 3D with soft three-band cel shading, matte colors, broad readable forms and restrained outlines. Match the approved Harrier-and-rider study when that reference is actually supplied. Preserve smooth character silhouettes; use selective faceting on rocks, horns and architecture. Avoid photorealistic textures, dense surface noise, tiny modeled scales and excessive ornament.

Inspect the existing asset before editing. Report dimensions, triangle count, materials, rig and reference conflicts. Preserve the original file. Do not invent hidden anatomy or change proportions silently.

Prioritize:
1. Correct anatomy, limb count and proportions.
2. Clean silhouette and connected surfaces.
3. Rig, joint deformation and attachment clearance.
4. Broad color regions and consistent cel shading.
5. Final lighting and presentation.

Keep horns, crests, tail ornaments and saddle equipment separate from the base body. Preserve supplied customization and rig contracts. A polygon target is a budget, not a reason to damage deformation.

Use EEVEE and a controllable three-band toon material for this study. Preserve original base colors. Keep outlines thin and selective; inspect for broken strokes and clutter.

Show matched front, side and three-quarter renders before a beauty render. Inspect actual rendered images and correct visible defects. Where rigged, check representative poses and the neutral pose.

Deliver the editable .blend, preview renders, actual triangle count, source provenance and unresolved issues. Distinguish visual approval from animation or game-readiness verification.

No game changes, original-asset overwrites, commits or publication.
```

For an existing model shading pass, add: **“Material-and-lighting pass only; preserve all geometry.”** For a new model, supply the chosen [base prompt](../base-model-prompts/README.md), references and [budget](../model-budgets/README.md) separately.

## Rendering workflow

1. Inspect the actual Blender version, scene and existing data.
2. Work in a new file or isolated scene; do not overwrite the original.
3. Resolve source units and axes before placing a rider or camera. The documented game frame is +Z forward, +Y up, +X left; Blender imports may convert axes.
4. Use Diffuse BSDF → Shader to RGB → Color Ramp, multiplied by source color, then Emission → Material Output Surface in EEVEE.
5. Use simple sun lighting and controlled color management; do not force a high-contrast look if it clips the palette.
6. Add Line Art selectively. Inspect edge categories, thickness, overlapping geometry and antialiasing; higher resolution does not fix broken geometry.
7. Review saved render pixels, not only a successful render command.
8. Preserve editable materials and disclose any posed snapshot or proxy.

The previous stand-in rider was superseded by an actual mounted PR11 snapshot in a local study. That snapshot is static review geometry; do not describe it as a live rig or claim that the latest build was tested.

A future Three.js implementation needs its own shader, animation, customization and performance validation. EEVEE shader nodes and Grease Pencil strokes do not automatically export as functioning browser effects.
