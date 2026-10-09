// Creature light: how the wyvern's hide and membranes take light, as GLSL chunks the creature
// materials (materials.ts) splice in. The world's painterly patch (render/painterly.ts) stays as
// it is; these replace, for creatures only:
//
//   the painterly lift   render/painterly.ts PAINTERLY_RIM_GLSL, swapped by exact text for
//                        CREATURE_LIGHT_BLOCK: a soft sun-and-sky wrap fill with form (the
//                        painterly lift is flat over the whole surface: its fresnel term is 1
//                        on every front face), a true fresnel rim that is strongest against
//                        the sun, the camera rig's kick and rim lights, the highlight shoulder
//                        and the ink contour;
//   the highlight        a soft knee under the palette's bloom threshold on all non-emissive
//   shoulder             light, so the hide never blooms (emissive eyes, embers, lanterns and
//                        the membrane's transmitted glow are added after it and still do).

/** Uniforms and globals the creature light reads (declared once, before main). */
export const CREATURE_LIGHT_PARS = /* glsl */ `
uniform float uDwBloomT;
uniform vec3 uKickDir;
uniform vec3 uKickColor;
uniform float uKickI;
uniform vec3 uRimDir;
uniform vec3 uRimColor;
uniform float uRimI;
// Per-fragment shaping set by the albedo pass: how much of the rim (anatomy: little on the
// belly, claws and saddle gear) and of the fill a fragment takes.
float dwRimScale = 1.0;
float dwFillScale = 1.0;
`;

/** Luminance weights (Rec. 709, linear). */
const LUMA = 'vec3(0.2126, 0.7152, 0.0722)';

/**
 * Tuning of the creature light. The fill keeps the painterly lift's warm, sun-tinted energy
 * (what makes a wyvern sit in the golden world) but gives it a terminator; pale albedos are
 * capped in it, since a cream belly under a flat lift is what bloomed into a neon tube.
 */
export const CREATURE_LIGHT = {
  /** Fill strength relative to the painterly lift. */
  fill: 0.78,
  /** Fill on the side away from the sun, as a fraction of the sunlit side. */
  fillFloor: 0.24,
  /** Albedo luminance the fill sees at most (pale bellies take the fill of a mid tone). */
  fillAlbedoCap: 0.4,
  /** Fresnel rim gain on a hue-normalised tint (luminance 0.35 for any albedo above 0.3). */
  rimGain: 1.7,
  /** Shoulder: knee and ceiling below the bloom threshold, slope at the knee. */
  kneeBelow: 0.16,
  ceilingBelow: 0.05,
  kneeSlope: 0.3,
  /** Ink contour where the surface turns away (pale palettes keep an outline on white cloud). */
  contour: 0.34,
} as const;

const f = (x: number) => x.toFixed(4);

/**
 * Replaces the painterly lift (spliced where PAINTERLY_RIM_GLSL was, right before
 * opaque_fragment). Splits off the emissive part, lights the rest, shoulders it under the bloom
 * threshold, inks the silhouette and puts the emissive back on top.
 */
export const CREATURE_LIGHT_BLOCK = /* glsl */ `
        vec3 dwLit = max(outgoingLight - totalEmissiveRadiance, vec3(0.0));
        {
          vec3 dwVv = normalize(vViewPosition);
          float dwNV = clamp(dot(normal, dwVv), 0.0, 1.0);
          vec3 dwSunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          float dwNL = dot(normal, dwSunV);
          vec3 dwTint = mix(uSunColor, vec3(0.55, 0.65, 0.9), 0.35);
          float dwAlb = dot(diffuseColor.rgb, ${LUMA});
          float dwStr = uRimStrength * uDwRim;
          // Sun-and-sky wrap fill: the world's painterly lift with a terminator.
          vec3 dwFillAlb = diffuseColor.rgb * min(1.0, ${f(CREATURE_LIGHT.fillAlbedoCap)} / max(dwAlb, 1e-3));
          float dwWrap = ${f(CREATURE_LIGHT.fillFloor)} + ${f(1 - CREATURE_LIGHT.fillFloor)} * smoothstep(-0.55, 0.95, dwNL);
          dwLit += dwFillAlb * dwTint * (dwStr * 1.6 * ${f(CREATURE_LIGHT.fill)} * dwFillScale) * dwWrap;
          // Rim: a true fresnel edge, strongest with the sun behind the wyvern (contre-jour), in
          // the skin's hue at a fixed value so pale skin does not flare.
          float dwFres = pow(1.0 - dwNV, 3.0);
          vec3 dwVw = normalize(vDwWorldPos - cameraPosition);
          float dwBack = 0.35 + 0.65 * smoothstep(-0.1, 0.7, dot(dwVw, uSunDir));
          vec3 dwHue = diffuseColor.rgb / max(0.3, dwAlb) * 0.35;
          dwLit += dwFres * dwStr * dwRimScale * dwBack * dwTint * dwHue * ${f(CREATURE_LIGHT.rimGain)};
          // Camera-rig kick (a soft wrap light) and directional rim (camera/creatureLight.ts).
          dwLit += diffuseColor.rgb * uKickColor * (uKickI * smoothstep(-0.1, 0.6, dot(normal, uKickDir)));
          dwLit += uRimColor * dwHue * (uRimI * dwRimScale * (1.0 - dwNV) * (1.0 - dwNV) * max(0.0, dot(normal, uRimDir)));
          // Highlight shoulder: a soft knee just under the bloom threshold; never above it.
          float dwL = dot(dwLit, ${LUMA});
          float dwKnee = uDwBloomT - ${f(CREATURE_LIGHT.kneeBelow)};
          float dwRoom = ${f(CREATURE_LIGHT.kneeBelow - CREATURE_LIGHT.ceilingBelow)};
          if (dwL > dwKnee) dwLit *= (dwKnee + dwRoom * (1.0 - exp(-(dwL - dwKnee) * ${f(CREATURE_LIGHT.kneeSlope)} / dwRoom))) / dwL;
          // Ink contour where the surface turns away from the camera.
          float dwInk = 1.0 - uContour * ${f(CREATURE_LIGHT.contour)} * smoothstep(0.55, 0.95, 1.0 - dwNV);
          dwLit *= dwInk;
          outgoingLight = dwLit + totalEmissiveRadiance * dwInk;
        }
        #ifdef DW_MATTE
        vec3 dwMatteLit = dwLit;
        #endif
        `;

/** The shoulder as a function (tests, and the matte report's expectations). */
export function shoulder(lum: number, threshold: number): number {
  const knee = threshold - CREATURE_LIGHT.kneeBelow;
  const room = CREATURE_LIGHT.kneeBelow - CREATURE_LIGHT.ceilingBelow;
  if (lum <= knee) return lum;
  return knee + room * (1 - Math.exp((-(lum - knee) * CREATURE_LIGHT.kneeSlope) / room));
}

