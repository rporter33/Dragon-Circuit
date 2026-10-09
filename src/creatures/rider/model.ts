// Assembles one rider look into a skinned mesh: body + outfit + hair + headgear + neckwear, all in
// one geometry (one draw call) on a fresh rig. Moving cloth is set up separately (cloth specs).

import { Color, MeshToonMaterial, SkinnedMesh, type BufferAttribute, type BufferGeometry } from 'three';
import type { RiderLook } from '../../core/types';
import { applyPainterly, toonRamp } from '../../render/painterly';
import { creatureUniforms } from '../../render/uniforms';
import { CREATURE_LIGHT_PARS, RIDER_RIG_LIGHT } from '../wyvern/shading/light';
import { createRig, rigDims, type Rig } from './rig';
import { SkinBuilder } from './meshKit';
import { buildBody, makeBodyCtx, type BodyCtx } from './body';
import { outfitStyle } from './outfits';
import { buildHair } from './hair';
import { buildHeadgear, coversCrown } from './headgear';
import { buildNeckwear } from './accessories';
import { evalRecipe, riderPalette, type ColorRecipe, type RiderPalette } from './palette';

export interface RiderModel {
  rig: Rig;
  mesh: SkinnedMesh;
  geometry: BufferGeometry;
  ctx: BodyCtx;
  palette: RiderPalette;
  /** Per vertex: how its color derives from the look (null = a constant color). */
  recipes: (ColorRecipe | null)[];
}

let bodyMaterial: MeshToonMaterial | null = null;

/**
 * The shared rider material: vertex-colored soft toon with the painterly rim and fog, plus a
 * per-vertex `glow` (circlet stone, goggle glints, catch lights) that brightens at night.
 */
export function riderMaterial(): MeshToonMaterial {
  if (bodyMaterial) return bodyMaterial;
  const m = new MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() });
  applyPainterly(m, {
    rim: 1.15,
    onBeforeCompile: (shader) => {
      // The camera rig's kick and rim (camera/creatureLight.ts), shared with the wyvern.
      Object.assign(shader.uniforms, creatureUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vDwGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDwGlow = glow;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDwGlow;\n' + CREATURE_LIGHT_PARS)
        .replace('#include <opaque_fragment>', RIDER_RIG_LIGHT + '#include <opaque_fragment>')
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vDwGlow * (0.45 + 1.8 * uNight);',
        );
    },
  });
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${key()}-rider-glow-rig`;
  bodyMaterial = m;
  return m;
}

export function buildRiderModel(look: RiderLook): RiderModel {
  const dims = rigDims(look.build);
  const rig = createRig(dims);
  const pal = riderPalette(look);
  const b = new SkinBuilder();
  const ctx = makeBodyCtx(b, dims, look, pal);
  const style = outfitStyle(look, pal, dims);
  buildBody(ctx, style);
  const covered = coversCrown(look.headgear);
  buildHair(ctx, look, covered);
  buildHeadgear(ctx, look);
  buildNeckwear(ctx, look);
  const geometry = b.build();
  const mesh = new SkinnedMesh(geometry, riderMaterial());
  mesh.add(rig.root);
  mesh.bind(rig.skeleton, mesh.matrixWorld.clone().identity());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Poses swing limbs far outside the bind-pose bounds; it's one small mesh, so skip culling.
  mesh.frustumCulled = false;
  return { rig, mesh, geometry, ctx, palette: pal, recipes: b.recipes };
}

/**
 * Recolor a built model for a look with the same shape (riderShapeKey) but new colors: rewrites
 * the vertex colors from their recipes, in place. ~1 ms instead of a ~20–40 ms rebuild.
 */
export function recolorRiderModel(model: RiderModel, look: RiderLook): void {
  const memo = new Map<ColorRecipe, Color>();
  const attr = model.geometry.getAttribute('color') as BufferAttribute;
  const arr = attr.array as Float32Array;
  const rs = model.recipes;
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i];
    if (!r) continue;
    const c = evalRecipe(r, look, memo);
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  attr.needsUpdate = true;
  model.palette = riderPalette(look);
  model.ctx.pal = model.palette;
  model.ctx.look = look;
}
