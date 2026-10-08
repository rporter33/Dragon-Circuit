// Everything a race draws: the start gates (always there, so explorers find races), the active
// course's rings and, for sprints, the finish beacon's column of light.
//
// Rings are one instanced mesh whose torus shape is computed in the vertex shader from
// per-instance radius/tube attributes, so a whole course is one draw call. The next ring blazes,
// the one after glows, the rest are embers; a ring flown through bursts outward and vanishes.

import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type PerspectiveCamera,
  type Scene,
  type ShaderMaterial,
} from 'three';
import type { RaceDef } from '../game/contracts';
import type { QualityProfile } from '../render/quality';
import { damp } from '../core/math';
import { dressMaterial, swayDepthMaterial } from '../world/dressing/materials';
import { lightPoolMesh } from '../world/dressing/structures/lightPools';
import { beaconMaterial, curtainMaterial, discMaterial, ringMaterial } from './raceMaterials';
import { buildGate, courseColors, curtainMesh } from './gateMesh';
import { ringGeom } from './ringMath';

const MAX_RINGS = 24;
/** Seconds a passed ring takes to burst and vanish. */
const BURST_TIME = 0.7;
/** Height of a finish beacon's column of light above its ring (m). */
const BEACON_HEIGHT = 1300;

export interface RaceVisualState {
  /** Index into defs of the race being shown, or -1. */
  activeIndex: number;
  state: 'idle' | 'countdown' | 'running' | 'finished';
  nextRing: number;
}

const UP = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const _q = new Quaternion();
const _m = new Matrix4();
const _n = new Vector3();
const _p = new Vector3();
const _s = new Vector3(1, 1, 1);

/** Torus parameterization for the ring shader: (around the ring, around the tube). */
function ringGeometry(segments = 72, sides = 10): BufferGeometry {
  const ang: number[] = [];
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    for (let j = 0; j <= sides; j++) {
      ang.push((i / segments) * Math.PI * 2, (j / sides) * Math.PI * 2);
      pos.push(0, 0, 0); // placeholder: the vertex shader builds the shape
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j;
      const b = (i + 1) * (sides + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aAng', new BufferAttribute(new Float32Array(ang), 2));
  g.setIndex(idx);
  return g;
}

interface GateVisual {
  curtain: ShaderMaterial;
  armed: number;
  flash: number;
}

export class RaceVisuals {
  readonly group = new Group();
  private defs: RaceDef[];
  private rings: InstancedMesh;
  private ringAttr: InstancedBufferAttribute;
  private tintAttr: InstancedBufferAttribute;
  /** Per ring of the shown course: current brightness and burst progress (-1 = not bursting). */
  private bright = new Float32Array(MAX_RINGS);
  private burst = new Float32Array(MAX_RINGS).fill(-1);
  private shownIndex = -1;
  private disc: Mesh;
  private discMat: ShaderMaterial;
  private beacon: Group;
  private beaconMats: ShaderMaterial[] = [];
  private beaconLevel = 0;
  private gates: GateVisual[] = [];
  private discLevel = 0;

  constructor(scene: Scene, defs: RaceDef[], _quality: QualityProfile) {
    this.defs = defs;
    this.group.name = 'races';

    // Rings.
    const geo = ringGeometry();
    this.ringAttr = new InstancedBufferAttribute(new Float32Array(MAX_RINGS * 4), 4);
    this.tintAttr = new InstancedBufferAttribute(new Float32Array(MAX_RINGS * 3), 3);
    this.ringAttr.setUsage(DynamicDrawUsage);
    geo.setAttribute('aRing', this.ringAttr);
    geo.setAttribute('aTint', this.tintAttr);
    this.rings = new InstancedMesh(geo, ringMaterial(), MAX_RINGS);
    this.rings.count = 0;
    this.rings.frustumCulled = false; // instances span kilometers; the shape is built in the shader
    this.rings.renderOrder = 3;
    this.group.add(this.rings);

    // The next ring's membrane.
    this.discMat = discMaterial(new Color('#ffffff'));
    this.disc = new Mesh(new CircleGeometry(1, 48), this.discMat);
    this.disc.visible = false;
    this.disc.renderOrder = 4;
    this.group.add(this.disc);

    // Finish beacon: a bright core and a wide soft halo, both open cylinders.
    this.beacon = new Group();
    for (const [radius, core, opacity] of [
      [4.5, 1.5, 1.0],
      [16, 3.0, 0.45],
    ] as const) {
      const g = new CylinderGeometry(radius, radius * 1.6, BEACON_HEIGHT, 24, 1, true);
      g.translate(0, BEACON_HEIGHT / 2 - 6, 0);
      const mat = beaconMaterial(new Color('#ffd27a'), core, opacity);
      this.beaconMats.push(mat);
      const mesh = new Mesh(g, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      this.beacon.add(mesh);
    }
    this.beacon.visible = false;
    this.group.add(this.beacon);

    this.buildGates();
    scene.add(this.group);
  }

  /** All seven gates, merged by material: stone, glow, cloth, plus a curtain each. */
  private buildGates(): void {
    const solid = dressMaterial({});
    const glow = dressMaterial({ glow: true, glowDay: 0.6, glowNight: 3.2, rim: 0 });
    const cloth = dressMaterial({ sway: 'cloth', doubleSide: true, keepNormals: true });
    const pools: number[] = [];
    for (const def of this.defs) {
      const parts = buildGate(def, true);
      const add = (b: { isEmpty(): boolean; build(force?: boolean): BufferGeometry }, mat: import('three').Material, shadow: boolean, depth?: import('three').Material) => {
        if (b.isEmpty()) return;
        const m = new Mesh(b.build(true), mat);
        m.castShadow = shadow;
        m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        if (depth) m.customDepthMaterial = depth;
        this.group.add(m);
      };
      add(parts.site.solid, solid, true);
      add(parts.site.glow, glow, false);
      add(parts.site.cloth, cloth, true, swayDepthMaterial('cloth'));
      pools.push(...parts.site.pools);
      const curtain = curtainMaterial(new Color(courseColors(def.id).light), def.id.length * 1.37);
      this.group.add(curtainMesh(parts.curtain, curtain));
      this.gates.push({ curtain, armed: 0, flash: 0 });
    }
    const poolMesh = lightPoolMesh(pools);
    if (poolMesh) this.group.add(poolMesh);
  }

  /** Lay out the rings of race `index` (instances, colors). */
  private show(index: number): void {
    this.shownIndex = index;
    if (index < 0) {
      this.rings.count = 0;
      this.disc.visible = false;
      this.beacon.visible = false;
      return;
    }
    const def = this.defs[index];
    const color = new Color(courseColors(def.id).light);
    const gold = new Color('#ffd27a');
    const n = Math.min(def.rings.length, MAX_RINGS);
    for (let i = 0; i < n; i++) {
      const r = def.rings[i];
      const g = ringGeom(r);
      _n.set(g.nx, g.ny, g.nz);
      _q.setFromUnitVectors(Z, _n);
      _p.fromArray(r.position);
      this.rings.setMatrixAt(i, _m.compose(_p, _q, _s));
      const last = i === n - 1;
      const c = last ? gold : color;
      this.tintAttr.setXYZ(i, c.r, c.g, c.b);
      const tube = Math.max(0.9, r.radius * 0.09) * (last ? 1.3 : 1);
      this.ringAttr.setXYZW(i, r.radius, tube, 0, 0);
      this.bright[i] = 0;
      this.burst[i] = -1;
    }
    this.rings.count = n;
    this.rings.instanceMatrix.needsUpdate = true;
    this.tintAttr.needsUpdate = true;
    this.ringAttr.needsUpdate = true;
    // Sprints end at a beacon.
    const last = def.rings[def.rings.length - 1];
    this.beacon.visible = def.kind === 'sprint';
    this.beacon.position.fromArray(last.position);
    this.beaconLevel = 0;
    this.discMat.uniforms.uTint.value.copy(color);
  }

  ringPassed(raceIndex: number, ringIndex: number): void {
    if (raceIndex !== this.shownIndex || ringIndex >= MAX_RINGS) return;
    this.burst[ringIndex] = 0;
  }

  gatePassed(raceIndex: number): void {
    const g = this.gates[raceIndex];
    if (g) g.flash = 1;
  }

  clear(raceIndex: number): void {
    if (raceIndex === this.shownIndex) this.show(-1);
  }

  update(dt: number, camera: PerspectiveCamera, s: RaceVisualState): void {
    const showing = s.activeIndex >= 0 && s.state !== 'idle';
    if (showing && s.activeIndex !== this.shownIndex) this.show(s.activeIndex);
    if (!showing && this.shownIndex >= 0) this.show(-1);

    // Gates: the armed one brightens; a crossing flashes.
    for (let i = 0; i < this.gates.length; i++) {
      const g = this.gates[i];
      const armed = i === s.activeIndex && s.state === 'countdown' ? 1 : 0;
      g.armed = damp(g.armed, armed, 3, dt);
      g.flash = Math.max(0, g.flash - dt * 1.4);
      g.curtain.uniforms.uArmed.value = g.armed;
      g.curtain.uniforms.uFlash.value = g.flash;
    }

    if (this.shownIndex < 0) return;
    const def = this.defs[this.shownIndex];
    const n = this.rings.count;
    const next = s.state === 'running' ? s.nextRing : s.state === 'countdown' ? 0 : n;
    for (let i = 0; i < n; i++) {
      let target = i === next ? 1 : i === next + 1 ? 0.5 : i > next ? 0.12 : 0;
      if (this.burst[i] >= 0) {
        this.burst[i] += dt / BURST_TIME;
        if (this.burst[i] >= 1) this.burst[i] = 2; // done: stays hidden
        target = 1;
      }
      this.bright[i] = damp(this.bright[i], target, 5, dt);
      const b = this.burst[i];
      const burst = b < 0 ? 0 : Math.min(1, b);
      this.ringAttr.setZ(i, i < next && b < 0 ? 0 : this.bright[i]);
      this.ringAttr.setW(i, b >= 1.5 || (i < next && b < 0) ? 1 : burst);
    }
    this.ringAttr.needsUpdate = true;

    // Membrane in the next ring.
    const nextDef = next < def.rings.length ? def.rings[next] : null;
    this.discLevel = damp(this.discLevel, nextDef ? 1 : 0, 4, dt);
    this.disc.visible = !!nextDef || this.discLevel > 0.02;
    if (nextDef) {
      const g = ringGeom(nextDef);
      _n.set(g.nx, g.ny, g.nz);
      this.disc.quaternion.setFromUnitVectors(Z, _n);
      this.disc.position.fromArray(nextDef.position);
      this.disc.scale.setScalar(nextDef.radius);
    }
    this.discMat.uniforms.uOpacity.value = this.discLevel;

    // Beacon: fades in when the race is on, brightest while it's the next target.
    if (this.beacon.visible) {
      const target = s.state === 'finished' ? 0.25 : 1;
      this.beaconLevel = damp(this.beaconLevel, target, 1.5, dt);
      this.beaconMats[0].uniforms.uOpacity.value = 1.0 * this.beaconLevel;
      this.beaconMats[1].uniforms.uOpacity.value = 0.45 * this.beaconLevel;
    }
    void camera;
    void UP;
  }
}
