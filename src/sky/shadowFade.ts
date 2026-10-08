// How the key light's shadow map is read, tuned to the sky's shadow camera (Sky.followShadow).
//
// The sun's shadow camera is an orthographic box that travels with the player. Two things made
// its shadows look wrong in a world of floating islands:
//   - the box's border: a shadow that reaches it stopped dead along a straight line;
//   - distant casters: an island hanging hundreds of meters overhead laid a crisp, full-strength
//     shadow over the hub, and popped in and out as the box moved.
// Both are handled where the shadow is read, by patching three's PCF `getShadow` once:
//   - shadows fade out over the outer band of the box (and near its depth limits), so the box's
//     edge is never visible;
//   - each PCF tap is tested a second time at a depth lifted toward the light (lifts spread over
//     the taps between OCCLUDER_FADE_FROM and OCCLUDER_FADE_TO). An occluder that is still in the
//     way from that lifted point is far up the light ray, and its share of the shadow is
//     dropped. Nearby casters (walls, trees, the wyvern overhead) keep full, crisp shadows; the
//     shadow of something 100+ m up the ray thins out and is gone by ~170 m, the way skylight
//     fills in under a distant overhang (and long golden-hour shadows soften toward their tips).
//     Partly-shadowed pixels pay for the extra taps; fully lit ones skip them.
// Depth in the shadow map is linear along the light ray (orthographic), so the lifts are fixed
// fractions of the camera's depth range, SHADOW_RANGE.

import { ShaderChunk } from 'three';

/** Shadow camera: how far up the light ray (toward the sun) from the focus casters are kept (m). */
export const SHADOW_UP = 260;
/** Shadow camera: how far down the ray below the focus receivers are covered (m). */
export const SHADOW_DOWN = 640;
/** Depth range of the shadow camera (m). */
export const SHADOW_RANGE = SHADOW_UP + SHADOW_DOWN;
/** Occluders closer than this along the light ray cast a full shadow (m). */
export const OCCLUDER_FADE_FROM = 70;
/** Occluders farther than this along the light ray cast none (m). */
export const OCCLUDER_FADE_TO = 170;
/** Width of the fade at the shadow box's border, as a fraction of the box. */
export const EDGE_FADE = 0.14;

const MARKER = 'DW_SHADOW_FADE';
const TAPS = 5;

function glslFloat(v: number): string {
  return Number.isInteger(v) ? `${v}.0` : `${v}`;
}

/** The PCF getShadow with the edge and occluder-distance fades. */
export function pcfShadowGlsl(): string {
  const lifts = Array.from({ length: TAPS }, (_, i) => {
    const m = OCCLUDER_FADE_FROM + ((OCCLUDER_FADE_TO - OCCLUDER_FADE_FROM) * (i + 0.5)) / TAPS;
    return glslFloat(+(m / SHADOW_RANGE).toFixed(6));
  });
  return /* glsl */ `
		// ${MARKER}: see src/sky/shadowFade.ts.
		float dwShadowLift( int i ) {
			return i == 0 ? ${lifts[0]} : i == 1 ? ${lifts[1]} : i == 2 ? ${lifts[2]} : i == 3 ? ${lifts[3]} : ${lifts[4]};
		}

		float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {

			float shadow = 1.0;

			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;

			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;

			if ( frustumTest ) {

				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				float radius = shadowRadius * texelSize.x;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;

				float lit = 0.0;
				for ( int i = 0; i < ${TAPS}; i ++ ) {
					lit += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( i, ${TAPS}, phi ) * radius, shadowCoord.z ) );
				}
				shadow = lit / ${glslFloat(TAPS)};

				if ( shadow < 0.999 ) {
					// Same taps, lifted toward the light: what still blocks them is far up the ray.
					float farLit = 0.0;
					for ( int i = 0; i < ${TAPS}; i ++ ) {
						farLit += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( i, ${TAPS}, phi ) * radius, shadowCoord.z - dwShadowLift( i ) ) );
					}
					shadow = min( 1.0, shadow + 1.0 - farLit / ${glslFloat(TAPS)} );
				}

				// Fade out toward the box's border and its depth limits: no hard straight edges.
				float edge = min( min( shadowCoord.x, 1.0 - shadowCoord.x ), min( shadowCoord.y, 1.0 - shadowCoord.y ) );
				float fade = smoothstep( 0.0, ${glslFloat(EDGE_FADE)}, edge ) * smoothstep( 0.0, 0.02, shadowCoord.z ) * ( 1.0 - smoothstep( 0.9, 1.0, shadowCoord.z ) );
				shadow = mix( 1.0, shadow, fade );

			}

			return mix( 1.0, shadow, shadowIntensity );

		}
`;
}

/**
 * Patch three's shadow-map chunk (once, before any lit material compiles). Returns false if the
 * chunk didn't have the expected shape (three changed, or someone else replaced getShadow), in
 * which case three's own shadows are left untouched.
 */
export function installShadowFade(): boolean {
  const chunk = ShaderChunk.shadowmap_pars_fragment;
  if (chunk.includes(MARKER)) return true;
  const start = chunk.indexOf('float getShadow( sampler2DShadow shadowMap');
  if (start < 0) return false;
  const ret = chunk.indexOf('return mix( 1.0, shadow, shadowIntensity );', start);
  if (ret < 0) return false;
  const close = chunk.indexOf('}', ret);
  if (close < 0) return false;
  (ShaderChunk as Record<string, string>).shadowmap_pars_fragment = chunk.slice(0, start) + pcfShadowGlsl().trim() + chunk.slice(close + 1);
  return true;
}
