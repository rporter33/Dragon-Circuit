// How the finds look. Feathers: one procedural feather geometry, instanced; the shader bobs,
// spins and tilts each one (per-instance phase), paints a deep base hue running out to a gilded
// tip and edge with barb streaks, a cream-gold quill and a glint that sweeps up the vane, and
// plays the pickup (a rising flourish that fades out). Relics: a small,
// distinct artifact each, built from the dressing kit, on a stone pedestal (or a floating stone
// for the ones in open air), turning slowly. Every find carries a halo that pulses (gold for
// feathers), drawn so it reads on white cloud as well as at night, and catches the eye from a
// hundred meters off.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import { FOG_PARS_GLSL } from '../render/painterly';
import { globalUniforms } from '../render/uniforms';
import { GeoBuilder, displace, tube, under, xf } from '../world/dressing/geom';
import { PALETTE, jitter, resetJitter, stoneBlock } from '../world/dressing/structures/kit';
import { dressMaterial } from '../world/dressing/materials';

// ---------------------------------------------------------------------------------------------
// Feather geometry
// ---------------------------------------------------------------------------------------------

/** Length of a feather (m), base at y = 0, tip at y = FEATHER_LENGTH. */
export const FEATHER_LENGTH = 1.5;

/**
 * A contour feather: a quill with two curled vanes. uv.x = 0 at the shaft → 1 at the vane's
 * edge (negative on the left vane), uv.y = 0 at the base → 1 at the tip.
 */
export function featherGeometry(): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const L = FEATHER_LENGTH;
  const rows = 16;
  const cols = 4;
  const vane = (side: number) => {
    const base = pos.length / 3;
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      // Width: swells from the quill, a notch two-thirds up one side, a rounded tip.
      let w = 0.24 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.95)), 0.75) * (1 - 0.25 * t);
      if (side > 0) w *= 1 - 0.35 * Math.exp(-((t - 0.62) ** 2) / 0.0015);
      for (let c = 0; c <= cols; c++) {
        const u = c / cols;
        // Barbs sweep toward the tip; the vane curls gently.
        const y = 0.2 + t * (L - 0.2) + u * w * 0.55;
        pos.push(side * u * w, y, 0.09 * u * u - 0.03 * Math.sin(t * Math.PI));
        uv.push(side * u, t);
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = base + r * (cols + 1) + c;
        const b = a + cols + 1;
        if (side > 0) idx.push(a, b, a + 1, b, b + 1, a + 1);
        else idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  };
  vane(1);
  vane(-1);
  // The quill: a thin tapered tube from below the vanes to the tip.
  const q = tube(
    [new Vector3(0, -0.22, 0), new Vector3(0, 0.3, 0), new Vector3(0, L * 0.7, -0.02), new Vector3(0, L, 0)],
    [0.028, 0.022, 0.014, 0.004],
    5,
    true,
  );
  const qp = q.getAttribute('position');
  const base = pos.length / 3;
  for (let i = 0; i < qp.count; i++) {
    pos.push(qp.getX(i), qp.getY(i), qp.getZ(i));
    uv.push(0, Math.max(0, qp.getY(i) / L));
  }
  const qi = q.getIndex();
  if (qi) for (let i = 0; i < qi.count; i++) idx.push(base + qi.getX(i));
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Feather colorways: a deep, saturated base at the quill running out to a gold tip. Every find
 * shares the gilding (that is what makes a feather read as treasure, and gold holds its color
 * against white cloud where a pale feather vanishes); the base hue varies feather to feather.
 */
export const FEATHER_COLORS: [string, string][] = [
  ['#b06a18', '#ffd25e'], // amber
  ['#1c6a68', '#f4c65a'], // teal
  ['#a33c1c', '#ffbf4a'], // ember
  ['#4c3a8c', '#f2c25e'], // violet
  ['#d9c49a', '#eda93a'], // pearl
  ['#2c6a42', '#f6cf62'], // green
  ['#8c2c4c', '#ffc35a'], // rose
  ['#24568e', '#f6cb64'], // sky
];

/** The halo's glint color for feathers: warm gold, whatever the feather's base hue. */
export const FEATHER_GLINT = '#ffb238';

const FEATHER_VERT = /* glsl */ `
attribute vec4 aInst;     // phase, collect progress (0..1, 2 = gone), scale, unused
attribute vec3 aColorA;
attribute vec3 aColorB;
uniform float uTime;
varying vec3 vDwWorldPos;
varying vec3 vN;
varying vec2 vUv2;
varying vec3 vColA;
varying vec3 vColB;
varying float vGlow;
varying float vPhase;
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
void main() {
  float ph = aInst.x;
  float c = aInst.y;
  float t = uTime + ph * 11.0;
  float gone = step(1.5, c);
  c = clamp(c, 0.0, 1.0); // -1 = waiting

  // Lean, sway and a slow turn; the pickup spins it up and lifts it away.
  mat3 r = rotY(t * 0.7 + ph * 6.283 + c * c * 14.0) * rotZ(0.5 + 0.12 * sin(t * 1.3));
  float s = aInst.z * (1.0 + 0.5 * c) * (1.0 - smoothstep(0.55, 1.0, c)) * (1.0 - gone);
  vec3 p = r * (position - vec3(0.0, 0.75, 0.0)) * s;
  p.y += 0.22 * sin(t * 1.7) + c * c * 3.5;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vDwWorldPos = wp.xyz;
  vN = normalize(mat3(modelMatrix) * (r * normal));
  vUv2 = uv;
  vColA = aColorA;
  vColB = aColorB;
  // Breathes with the halo's pulse (0.8 Hz), flares on pickup.
  vGlow = 0.65 + 0.35 * sin(uTime * 5.03 + ph * 17.0) + c * 2.0;
  vPhase = ph;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FEATHER_FRAG = /* glsl */ `
${FOG_PARS_GLSL}
varying vec3 vDwWorldPos;
varying vec3 vN;
varying vec2 vUv2;
varying vec3 vColA;
varying vec3 vColB;
varying float vGlow;
varying float vPhase;
void main() {
  float u = abs(vUv2.x);
  float v = vUv2.y;
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vDwWorldPos);
  if (dot(N, V) < 0.0) N = -N;
  // Base hue at the quill running out to gold at the tip and along the vane's outer edge.
  vec3 col = mix(vColA, vColB, smoothstep(0.3, 1.0, v * 0.85 + u * 0.25));
  // Barbs: fine streaks sweeping out toward the tip, with real contrast.
  float barbs = 0.75 + 0.25 * sin((v * 46.0 - u * 9.0) * 3.14159);
  col *= barbs;
  // Gilded edge and a cream-gold quill.
  vec3 gilt = vec3(1.0, 0.78, 0.36);
  col = mix(col, gilt, smoothstep(0.82, 0.98, u) * 0.85);
  col = mix(vec3(0.95, 0.83, 0.55), col, smoothstep(0.02, 0.08, u));
  // Soft painterly light: two bands and a warm rim.
  float ndl = dot(N, uSunDir) * 0.5 + 0.5;
  float band = 0.62 + 0.25 * smoothstep(0.4, 0.5, ndl) + 0.13 * smoothstep(0.75, 0.85, ndl);
  vec3 lit = col * band * (0.65 + 0.35 * uSunColor);
  float fres = pow(1.0 - abs(dot(N, V)), 2.0);
  // A glint sweeping up the vane now and then, like light on lacquer.
  float sweep = pow(max(0.0, sin(v * 5.0 - uTime * 1.7 + vPhase * 9.0)), 16.0);
  // It glows: the gilded edge most, breathing with the halo, brighter at night.
  vec3 glow = gilt * (0.06 + 0.35 * smoothstep(0.7, 1.0, u)) * vGlow * (1.0 + 1.5 * uNight);
  vec3 outc = lit + glow + gilt * (fres * 0.3 + sweep * 0.45);
  outc = mix(dwApplyFog(outc, vDwWorldPos, cameraPosition), outc, 0.3);
  gl_FragColor = vec4(outc, 1.0);
}
`;

export function featherMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'collectible-feather',
    uniforms: { ...globalUniforms },
    vertexShader: FEATHER_VERT,
    fragmentShader: FEATHER_FRAG,
    side: DoubleSide,
  });
}

// ---------------------------------------------------------------------------------------------
// Halos: a soft glow and a four-point twinkle on every find
// ---------------------------------------------------------------------------------------------

const HALO_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute vec2 aState; // phase, fade (0 = gone, 1 = full)
uniform float uTime;
uniform float uPixelScale;
varying vec3 vColor;
varying float vFade;
varying float vTw;
varying float vFar;
varying vec3 vDwWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDwWorldPos = wp.xyz;
  vec4 mv = viewMatrix * wp;
  float dist = -mv.z;
  vColor = aColor;
  // A slow pulse (0.8 Hz), each find on its own beat.
  vTw = 0.5 + 0.5 * sin(uTime * 5.03 + aState.x * 17.0);
  // Glints fade out far away (a hint, not a map marker).
  vFade = aState.y * (1.0 - smoothstep(180.0, 320.0, dist));
  // Up close the find speaks for itself: the soft glow gives way to the star.
  vFar = smoothstep(4.0, 16.0, dist);
  gl_PointSize = clamp(aSize * (0.9 + 0.2 * vTw) * uPixelScale / max(dist, 1.0), 2.0, 160.0);
  gl_Position = projectionMatrix * mv;
}
`;

const HALO_FRAG = /* glsl */ `
${FOG_PARS_GLSL}
varying vec3 vColor;
varying float vFade;
varying float vTw;
varying float vFar;
varying vec3 vDwWorldPos;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  float soft = exp(-r * r * 5.0);
  // A four-point star that twinkles with the pulse.
  float star = (exp(-abs(p.x) * 26.0) * exp(-abs(p.y) * 3.0) + exp(-abs(p.y) * 26.0) * exp(-abs(p.x) * 3.0)) * (0.35 + 0.65 * vTw);
  float a = clamp((soft * 0.8 * (0.25 + 0.75 * vFar) + star * 0.9) * vFade * (1.0 + uNight), 0.0, 1.5);
  // Haze takes light away, never adds fog color.
  float clear = dwApplyFog(vec3(1.0), vDwWorldPos, cameraPosition).g - dwApplyFog(vec3(0.0), vDwWorldPos, cameraPosition).g;
  a *= max(clear, 0.0);
  // Premultiplied: glowing light that also tints what is behind it by day, so a gold glint
  // still reads on white cloud (pure additive light vanishes there); at night, all glow.
  float cover = min(1.0, a) * 0.75 * (1.0 - uNight);
  // A little over white, so the glint blooms.
  gl_FragColor = vec4(vColor * a * 1.15, cover);
}
`;

export function haloMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'collectible-halo',
    uniforms: { ...globalUniforms, uPixelScale: { value: 600 } },
    vertexShader: HALO_VERT,
    fragmentShader: HALO_FRAG,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    premultipliedAlpha: true,
  });
}

// ---------------------------------------------------------------------------------------------
// Relics
// ---------------------------------------------------------------------------------------------

/** Artifacts are modeled about a meter across and shown larger than life. */
export const RELIC_SCALE = 1.9;

export interface RelicMeshes {
  /** The artifact itself (turns slowly); origin at its resting point. */
  artifact: Group;
  /** The pedestal or floating stone it rests on (static). */
  base: Group;
  /** Halo color. */
  light: Color;
}

function meshesFrom(b: GeoBuilder, glow: GeoBuilder | null, solidMat: Material, glowMat: Material): Group {
  const group = new Group();
  if (!b.isEmpty()) {
    const m = new Mesh(b.build(true), solidMat);
    m.castShadow = true;
    group.add(m);
  }
  if (glow && !glow.isEmpty()) group.add(new Mesh(glow.build(true), glowMat));
  return group;
}

const I = new IcosahedronGeometry(1, 2);

/** The seven artifacts, each about a meter across. */
function buildArtifact(id: string, b: GeoBuilder, gl: GeoBuilder): void {
  const O = xf(0, 0, 0);
  switch (id) {
    case 'relic-ember': {
      // A great scale: a flattened teardrop with a ridge, its veins glowing like coals.
      const scale = displace(new SphereGeometry(1, 20, 14), 0.04, 3, 41);
      const p = scale.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        p.setX(i, p.getX(i) * (0.75 - 0.35 * y));
        p.setZ(i, p.getZ(i) * 0.16 + 0.12 * (1 - Math.abs(p.getX(i))));
      }
      scale.computeVertexNormals();
      b.add(scale, under(O, xf(0, 0.55, 0, 0.2, 0, 0, 0.55, 0.62, 0.55)), { color: (pp, _n, out) => out.set('#7a2a1e').lerp(new Color('#c2502a'), Math.max(0, pp.y - 0.3)) });
      for (let k = -2; k <= 2; k++) {
        const pts = [new Vector3(0, 0.12, 0.1), new Vector3(k * 0.09, 0.55, 0.13), new Vector3(k * 0.17, 0.9, 0.09)];
        gl.add(tube(pts, [0.03, 0.022, 0.01], 4, true), null, { color: '#ffb04a', glow: 1 });
      }
      break;
    }
    case 'relic-antler': {
      // A shed antler: a curving main beam with three tines, worn smooth.
      const beam = [new Vector3(0, 0.05, 0), new Vector3(0.12, 0.45, 0.05), new Vector3(0.05, 0.9, 0.12), new Vector3(-0.15, 1.25, 0.05)];
      const bone = '#e2d4b4';
      b.add(tube(beam, [0.09, 0.075, 0.06, 0.03], 7, true), null, { color: bone });
      for (const [i, dx, dz, len] of [[1, 0.35, 0.18, 0.4], [2, -0.32, 0.22, 0.45], [2, 0.3, -0.12, 0.35]] as const) {
        const s = beam[i];
        b.add(tube([s.clone(), s.clone().add(new Vector3(dx * 0.6, len * 0.6, dz * 0.6)), s.clone().add(new Vector3(dx, len, dz))], [0.05, 0.035, 0.012], 6, true), null, { color: bone });
      }
      b.add(I, xf(0, 0.03, 0, 0, 0, 0, 0.14, 0.07, 0.14), { color: '#a89a7a' });
      break;
    }
    case 'relic-mane': {
      // A plume of long feathers bound at the quill, fanned like a crest.
      const f = featherGeometry();
      for (let k = 0; k < 7; k++) {
        const a = (k - 3) * 0.22;
        const c = new Color(k % 2 ? '#e8e0d0' : '#8fb8d8');
        const m = xf(0, 0.1, 0, 0.05 * k, 0, a, 1.15, 0.75 + 0.1 * (3 - Math.abs(k - 3)), 1.0);
        // Both faces: the vanes are single sheets.
        b.add(f, m, { color: c });
        b.add(f, m, { color: c, invert: true });
      }
      b.add(new TorusGeometry(0.06, 0.025, 6, 12), xf(0, 0.12, 0, Math.PI / 2, 0, 0), { color: PALETTE.gold });
      gl.add(I, xf(0, 0.12, 0.02, 0, 0, 0, 0.05), { color: '#bfe8ff', glow: 1 });
      break;
    }
    case 'relic-ribbon': {
      // A rosette of pleated cloth with two long tails, gold at the heart.
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        b.add(new SphereGeometry(1, 6, 4), xf(Math.cos(a) * 0.2, 0.75 + Math.sin(a) * 0.2, 0, 0, 0, a, 0.14, 0.05, 0.03), { color: k % 2 ? '#a8322e' : '#c8463a' });
      }
      b.add(new CylinderGeometry(0.13, 0.13, 0.05, 18), xf(0, 0.75, 0.02, Math.PI / 2, 0, 0), { color: PALETTE.gold });
      for (const side of [-1, 1]) {
        const pts: Vector3[] = [];
        for (let i = 0; i <= 6; i++) pts.push(new Vector3(side * (0.05 + i * 0.04) + Math.sin(i) * 0.02, 0.62 - i * 0.1, 0.02 * Math.sin(i * 1.3)));
        b.add(tube(pts, pts.map(() => 0.035), 4, true), null, { color: '#a8322e' });
      }
      gl.add(I, xf(0, 0.75, 0.06, 0, 0, 0, 0.06), { color: '#ffd27a', glow: 1 });
      break;
    }
    case 'relic-howdah': {
      // A carved, gilded finial: bulb, collar, spire.
      const prof: Vector2[] = [];
      const shape = [
        [0.0, 0],
        [0.16, 0],
        [0.17, 0.05],
        [0.09, 0.12],
        [0.11, 0.22],
        [0.22, 0.38],
        [0.24, 0.5],
        [0.19, 0.62],
        [0.08, 0.7],
        [0.12, 0.76],
        [0.05, 0.84],
        [0.035, 1.05],
        [0.0, 1.25],
      ];
      for (const [r, y] of shape) prof.push(new Vector2(r, y));
      b.add(new LatheGeometry(prof, 16), null, { color: (pp, _n, out) => out.set(pp.y > 0.35 && pp.y < 0.66 ? PALETTE.lacquer : PALETTE.gold) });
      gl.add(I, xf(0, 0.5, 0.235, 0, 0, 0, 0.045), { color: '#7fe0ff', glow: 1 });
      gl.add(I, xf(0, 0.5, -0.235, 0, 0, 0, 0.045), { color: '#7fe0ff', glow: 1 });
      break;
    }
    case 'relic-charts': {
      // A rolled chart, one sheet half unrolled with inked wind lines, and a brass compass.
      b.add(new CylinderGeometry(0.07, 0.07, 0.8, 12), xf(-0.1, 0.1, -0.12, 0, 0, Math.PI / 2), { color: '#e6d6b0' });
      const sheet = new GeoBuilder();
      sheet.addTriangles([-0.45, 0, -0.05, 0.45, 0, -0.05, -0.45, 0, 0.45, 0.45, 0, -0.05, 0.45, 0, 0.45, -0.45, 0, 0.45]);
      b.add(sheet.build(), xf(0, 0.04, 0.12, -0.05, 0, 0), {
        color: (pp, _n, out) => {
          out.set('#efe2c4');
          const swirl = Math.sin(pp.x * 18 + Math.sin(pp.z * 9) * 2) * Math.sin(pp.z * 14);
          if (Math.abs(swirl) < 0.08) out.set('#5a4a3a');
        },
      });
      b.add(new TorusGeometry(0.11, 0.02, 6, 20), xf(0.28, 0.07, 0.3, Math.PI / 2, 0, 0), { color: PALETTE.brass });
      b.add(new CylinderGeometry(0.1, 0.1, 0.02, 20), xf(0.28, 0.06, 0.3), { color: '#d8c8a0' });
      gl.add(new CylinderGeometry(0.008, 0.008, 0.16, 4), xf(0.28, 0.08, 0.3, Math.PI / 2, 0.6, 0), { color: '#ff7a4a', glow: 1 });
      break;
    }
    case 'relic-circlet': {
      // A thin gold band set with a stone that holds the lantern's light.
      b.add(new TorusGeometry(0.32, 0.03, 8, 40), xf(0, 0.55, 0, 0.25, 0, 0), { color: PALETTE.gold });
      b.add(new TorusGeometry(0.06, 0.02, 6, 16), xf(0, 0.55 + 0.31, 0.08, 0.25, 0, 0), { color: PALETTE.gold });
      gl.add(new IcosahedronGeometry(1, 0), xf(0, 0.55 + 0.31, 0.1, 0, 0.3, 0, 0.06, 0.08, 0.06), { color: '#ffb459', glow: 1 });
      break;
    }
  }
}

/** A pedestal on the ground, or a small floating stone in open air. */
function buildBase(b: GeoBuilder, floating: boolean, seed: number): void {
  if (!floating) {
    const O = xf(0, 0, 0);
    stoneBlock(b, O, 0, 0.12, 0, 0.95, 0.24, 0.95, seed, PALETTE.stoneDark, 0.6);
    b.add(new CylinderGeometry(0.28, 0.34, 0.6, 10), xf(0, 0.54, 0), { color: jitter(PALETTE.stoneWarm) });
    stoneBlock(b, O, 0, 0.9, 0, 0.75, 0.14, 0.75, seed + 3, PALETTE.stoneWarm, 0.2);
    return;
  }
  const rock = displace(new IcosahedronGeometry(1, 2), 0.22, 1.7, seed, 3);
  const p = rock.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setY(i, y > 0 ? y * 0.3 : y * (2.2 + 0.5 * Math.sin(seed + i)));
  }
  rock.computeVertexNormals();
  b.add(rock, xf(0, -0.15, 0, 0, seed, 0, 1.25, 1.0, 1.25), {
    color: (pp, n, out) => {
      if (n.y > 0.55) out.set('#6f9a4a');
      else out.set('#8c7f70').lerp(new Color('#5f574f'), Math.min(1, -pp.y / 2));
    },
  });
}

const RELIC_LIGHT: Record<string, string> = {
  'relic-ember': '#ff9a4a',
  'relic-antler': '#fff0c8',
  'relic-mane': '#bfe8ff',
  'relic-ribbon': '#ffd27a',
  'relic-howdah': '#7fe0ff',
  'relic-charts': '#ffe0a0',
  'relic-circlet': '#ffb459',
};

export function buildRelic(id: string, floating: boolean, index: number): RelicMeshes {
  resetJitter(0x2e1c + index * 31);
  const solid = dressMaterial({});
  const glow = dressMaterial({ glow: true, glowDay: 0.9, glowNight: 3.0, rim: 0 });
  const art = new GeoBuilder();
  const artGlow = new GeoBuilder();
  buildArtifact(id, art, artGlow);
  const base = new GeoBuilder();
  buildBase(base, floating, 17 + index * 5);
  const artifact = meshesFrom(art, artGlow, solid, glow);
  // Artifacts read bigger than life on their pedestals.
  artifact.scale.setScalar(RELIC_SCALE);
  return { artifact, base: meshesFrom(base, null, solid, glow), light: new Color(RELIC_LIGHT[id] ?? '#ffe0a0') };
}
