import { describe, expect, it, vi } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import type { BreedId, WyvernLook, WyvernPose } from '../../core/types';
import { BREEDS, BREED_ORDER } from '../../flight/breeds';
import { COSMETICS, DEFAULT_WYVERN, cosmeticsFor } from '../../cosmetics/catalog';
import { createWyvernPose } from '../../player/poses';
import { mulberry32 } from '../../core/rng';
import { Wyvern } from './Wyvern';
import { buildRig } from './rig';
import { PATTERN_IDS } from './materials';
import { aimRotation, solveTwoBone } from './ik';
import { Gait, footPhase, type GaitContext } from './gait';
import { flapPose, heavyStroke, stroke, strokeLoad, upstrokeFold, W } from './wingPoses';
import { STAND_ROOT_PITCH } from './animator';

const look = (breed: BreedId, extra: Partial<WyvernLook> = {}): WyvernLook => ({ ...DEFAULT_WYVERN, breed, ...extra });

/** A standing pose with the body center at standHeight above a flat ground at y = 10. */
function standing(breed: BreedId): WyvernPose {
  const p = createWyvernPose();
  p.position.set(0, 10 + BREEDS[breed].standHeight, 0);
  p.airborne = false;
  p.wingSpread = 0.22;
  p.gait = 'idle';
  p.groundY = 10;
  p.lookTarget.set(0, 13, 40);
  return p;
}

function gliding(): WyvernPose {
  const p = createWyvernPose();
  p.position.set(0, 300, 0);
  p.velocity.set(0, 0, 24);
  p.airspeed = 24;
  p.airborne = true;
  p.wingSpread = 1;
  p.lookTarget.set(0, 300, 40);
  return p;
}

const _p = new Vector3();
const _q = new Vector3();

function boneWorld(w: Wyvern, name: string): Vector3 {
  const mesh = w.skinnedMesh!;
  const bone = mesh.skeleton.bones.find((b) => b.name === name)!;
  return bone.getWorldPosition(new Vector3());
}

describe('proportions', { timeout: 30000 }, () => {
  it('honors the true wingspan (bind pose, tip to tip)', () => {
    for (const breed of BREED_ORDER) {
      const rig = buildRig(breed);
      expect(rig.fingerTips[0].x * 2).toBeCloseTo(BREEDS[breed].wingspan, 3);
    }
  });

  it('is about 14 m nose to tail for the harrier, smaller for the skimmer', () => {
    const len = (b: BreedId) => {
      const r = buildRig(b);
      return r.mouth.z - r.tailTip.z;
    };
    expect(len('harrier')).toBeGreaterThan(12.5);
    expect(len('harrier')).toBeLessThan(15.5);
    expect(len('skimmer')).toBeLessThan(len('harrier'));
    expect(len('galewing')).toBeGreaterThan(len('skimmer'));
  });

  it('gives each breed its build: ironback stockiest, galewing slimmest for its span', () => {
    const girth = (b: BreedId) => buildRig(b).props.shape.torsoHalfWidth;
    expect(girth('ironback')).toBeGreaterThan(girth('harrier'));
    expect(girth('harrier')).toBeGreaterThan(girth('skimmer'));
    const slim = (b: BreedId) => girth(b) / BREEDS[b].wingspan;
    for (const b of ['harrier', 'skimmer', 'ironback'] as const) expect(slim('galewing')).toBeLessThan(slim(b));
  });

  it('plants the feet on the ground when standing at standHeight', () => {
    for (const breed of BREED_ORDER) {
      const w = new Wyvern(look(breed));
      const pose = standing(breed);
      for (let i = 0; i < 90; i++) w.update(1 / 60, pose);
      const sole = w.rigDef.props.leg.sole;
      for (const n of ['toesL', 'toesR']) {
        const ball = boneWorld(w, n);
        // The ball of the foot sits one sole thickness above the ground.
        expect(ball.y - 10).toBeGreaterThan(sole - 0.03);
        expect(ball.y - 10).toBeLessThan(sole + 0.03);
      }
      // Wing claws rest on the ground too (quadrupedal stance).
      for (const n of ['clawL', 'clawR']) {
        const wrist = boneWorld(w, n);
        expect(wrist.y - 10).toBeLessThan(0.3 * BREEDS[breed].standHeight);
        expect(wrist.y - 10).toBeGreaterThan(0);
      }
      w.dispose();
    }
  });
});

// Building ~150 meshes is quick (a few seconds) but give a loaded shared machine headroom.
describe('model budget and cosmetics', { timeout: 60000 }, () => {
  const slots = { wyvernPattern: 'pattern', wyvernHorns: 'horns', wyvernFrill: 'frill', wyvernTail: 'tail', saddle: 'saddle' } as const;

  it('builds every catalog id for every breed within budget', () => {
    for (const breed of BREED_ORDER) {
      for (const c of COSMETICS) {
        const key = slots[c.slot as keyof typeof slots];
        if (!key) continue;
        const w = new Wyvern(look(breed, { [key]: c.id }));
        const s = w.stats;
        expect(s.bones).toBeLessThanOrEqual(80);
        expect(s.triangles).toBeGreaterThan(9000);
        expect(s.triangles).toBeLessThan(25000);
        const g = w.skinnedMesh!.geometry;
        const pos = g.getAttribute('position').array;
        let finite = true;
        for (let i = 0; i < pos.length; i++) finite &&= Number.isFinite(pos[i]);
        expect(finite).toBe(true);
        const si = g.getAttribute('skinIndex').array;
        const sw = g.getAttribute('skinWeight').array;
        let worstSum = 0;
        let maxIndex = 0;
        for (let v = 0; v < sw.length; v += 4) {
          worstSum = Math.max(worstSum, Math.abs(sw[v] + sw[v + 1] + sw[v + 2] + sw[v + 3] - 1));
          for (let k = 0; k < 4; k++) maxIndex = Math.max(maxIndex, si[v + k]);
        }
        expect(worstSum).toBeLessThan(1e-4);
        expect(maxIndex).toBeLessThan(s.bones);
        expect(g.groups.length).toBe(2);
        w.dispose();
      }
    }
  });

  it('gives every shape cosmetic its own geometry', () => {
    for (const [slot, key] of [
      ['wyvernHorns', 'horns'],
      ['wyvernFrill', 'frill'],
      ['wyvernTail', 'tail'],
      ['saddle', 'saddle'],
    ] as const) {
      const counts = new Set<number>();
      const ids = cosmeticsFor(slot);
      for (const c of ids) {
        const w = new Wyvern(look('harrier', { [key]: c.id }));
        counts.add(w.stats.vertices);
        w.dispose();
      }
      expect(counts.size).toBe(ids.length);
    }
  });

  it('maps every pattern id to a distinct shader pattern', () => {
    const ids = cosmeticsFor('wyvernPattern').map((c) => PATTERN_IDS[c.id]);
    expect(ids.every((v) => v !== undefined)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('builds a membrane area in proportion to the breed', () => {
    const area = (b: BreedId) => {
      const w = new Wyvern(look(b));
      const a = w.stats.membraneArea * 2;
      w.dispose();
      return a;
    };
    for (const b of BREED_ORDER) {
      const a = area(b);
      // Visual membranes cover most of the physical wing area (the rest is body and arm).
      expect(a / BREEDS[b].wingArea).toBeGreaterThan(0.35);
      expect(a / BREEDS[b].wingArea).toBeLessThan(1.1);
    }
  });
});

describe('setLook', () => {
  it('only touches uniforms for colors and patterns', () => {
    const w = new Wyvern(look('harrier'));
    const g = w.skinnedMesh!.geometry;
    w.setLook(look('harrier', { primary: '#ff0000', pattern: 'stripes', membrane: '#00ff00' }));
    expect(w.skinnedMesh!.geometry).toBe(g);
    expect(w.uniforms.uPrimary.value.r).toBeCloseTo(1, 3);
    expect(w.uniforms.uPattern.value).toBe(PATTERN_IDS.stripes);
    w.dispose();
  });

  it('rebuilds and disposes the old resources on a shape or breed change', () => {
    const w = new Wyvern(look('harrier'));
    const g = w.skinnedMesh!.geometry;
    const sk = w.skinnedMesh!.skeleton;
    const gd = vi.spyOn(g, 'dispose');
    const sd = vi.spyOn(sk, 'dispose');
    w.setLook(look('harrier', { horns: 'ram' }));
    expect(gd).toHaveBeenCalled();
    expect(sd).toHaveBeenCalled();
    expect(w.skinnedMesh!.geometry).not.toBe(g);
    // Exactly one mesh and one bone root under the group.
    expect(w.group.children.filter((c) => (c as { isSkinnedMesh?: boolean }).isSkinnedMesh).length).toBe(1);
    expect(w.group.children.filter((c) => (c as { isBone?: boolean }).isBone).length).toBe(1);
    const before = w.rigDef;
    w.setLook(look('ironback'));
    expect(w.rigDef).not.toBe(before);
    expect(w.rigDef.props.breed).toBe('ironback');
    // The saddle anchor survives rebuilds (the rider holds a reference to it).
    expect(w.saddle.parent).not.toBeNull();
    w.dispose();
  });
});

describe('ghost', () => {
  it('is translucent and casts no shadows', () => {
    const w = new Wyvern(look('galewing'), { ghost: true });
    const m = w.skinnedMesh!;
    expect(m.castShadow).toBe(false);
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
    }
    w.update(1 / 60, gliding());
    w.dispose();
  });
});

describe('accessors', () => {
  it('reports wingtips about a span apart in a glide and close together in a tuck', () => {
    for (const breed of BREED_ORDER) {
      const w = new Wyvern(look(breed));
      const pose = gliding();
      for (let i = 0; i < 30; i++) w.update(1 / 60, pose);
      const l = new Vector3();
      const r = new Vector3();
      w.getWingtips(l, r);
      const span = BREEDS[breed].wingspan;
      expect(l.distanceTo(r)).toBeGreaterThan(0.85 * span);
      expect(l.distanceTo(r)).toBeLessThan(1.01 * span);
      // Left wing is +X in body space.
      expect(l.x).toBeGreaterThan(r.x);
      pose.wingSpread = 0.25;
      pose.airspeed = 60;
      for (let i = 0; i < 60; i++) w.update(1 / 60, pose);
      w.getWingtips(l, r);
      expect(l.distanceTo(r)).toBeLessThan(0.45 * span);
      w.dispose();
    }
  });

  it('puts the head in front of the body and the saddle on top of it', () => {
    const w = new Wyvern(look('harrier'));
    const pose = standing('harrier');
    for (let i = 0; i < 30; i++) w.update(1 / 60, pose);
    const head = w.getHead(new Vector3());
    expect(head.z - pose.position.z).toBeGreaterThan(2);
    expect(head.y).toBeGreaterThan(pose.position.y);
    const seat = w.saddle.getWorldPosition(new Vector3());
    expect(seat.y - pose.position.y).toBeGreaterThan(0.6);
    expect(seat.y - pose.position.y).toBeLessThan(1.6);
    expect(Math.abs(seat.x - pose.position.x)).toBeLessThan(0.05);
    expect(w.saddle.userData.halfWidth).toBeGreaterThan(0.2);
    expect(w.saddle.userData.halfWidth).toBeLessThan(0.9);
    expect(w.saddle.userData.gripOffset).toBeInstanceOf(Vector3);
    w.dispose();
  });
});

describe('animator robustness', { timeout: 60000 }, () => {
  it('never produces NaN under random poses, gaits, dt and teleports', () => {
    const rnd = mulberry32(42);
    const gaits = ['idle', 'walk', 'run', 'takeoff', 'landing', 'jump'] as const;
    for (const breed of BREED_ORDER) {
      const w = new Wyvern(look(breed, { tail: 'ribbon', frill: 'fan' }));
      const pose = createWyvernPose();
      const q = new Quaternion();
      for (let i = 0; i < 400; i++) {
        if (i % 50 === 0) pose.position.set((rnd() - 0.5) * 2000, 200 + rnd() * 400, (rnd() - 0.5) * 2000);
        else pose.position.addScaledVector(pose.velocity, 1 / 60);
        q.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
        pose.orientation.slerp(q, 0.05);
        pose.velocity.set((rnd() - 0.5) * 60, (rnd() - 0.5) * 30, (rnd() - 0.5) * 60);
        pose.angularVelocity.set((rnd() - 0.5) * 4, (rnd() - 0.5) * 4, (rnd() - 0.5) * 4);
        pose.airborne = rnd() > 0.3;
        pose.airspeed = rnd() * 80;
        pose.wingSpread = 0.2 + rnd() * 0.8;
        pose.flapPhase = rnd();
        pose.flapStrength = rnd();
        pose.flare = rnd();
        pose.stall = rnd();
        pose.fatigue = rnd();
        pose.gait = gaits[Math.floor(rnd() * gaits.length)];
        pose.gaitTime = rnd() * 2;
        pose.groundSpeed = rnd() * 10;
        pose.groundY = rnd() > 0.5 ? pose.position.y - BREEDS[breed].standHeight : null;
        pose.lookTarget.set(rnd() * 100, rnd() * 100, rnd() * 100);
        const dt = [0, 1 / 144, 1 / 60, 1 / 30, 0.1, 0.5][Math.floor(rnd() * 6)];
        w.update(dt, pose);
        let ok = true;
        for (const b of w.skinnedMesh!.skeleton.bones) {
          ok &&= Number.isFinite(b.quaternion.x + b.quaternion.y + b.quaternion.z + b.quaternion.w);
          ok &&= Number.isFinite(b.position.x + b.position.y + b.position.z + b.scale.x);
        }
        w.getWingtips(_p, _q);
        ok &&= Number.isFinite(_p.x + _p.y + _p.z + _q.x + _q.y + _q.z);
        if (!ok) throw new Error(`non-finite pose at step ${i} (${breed})`);
      }
      w.dispose();
    }
  });

  it('keeps the tail attached and its segments rigid while whipping through turns', () => {
    const w = new Wyvern(look('harrier'));
    const pose = gliding();
    const yaw = new Quaternion();
    for (let i = 0; i < 240; i++) {
      // Hard yaw back and forth.
      yaw.setFromAxisAngle(new Vector3(0, 1, 0), Math.sin(i / 20) * 1.2);
      pose.orientation.copy(yaw);
      pose.angularVelocity.set(0, Math.cos(i / 20) * 1.2 * 3, 0);
      pose.position.addScaledVector(pose.velocity, 1 / 60);
      w.update(1 / 60, pose);
    }
    const bones = w.skinnedMesh!.skeleton.bones;
    const names = Array.from({ length: 10 }, (_, i) => `tail${i}`);
    const rig = w.rigDef;
    for (let i = 0; i < names.length - 1; i++) {
      const a = bones.find((b) => b.name === names[i])!.getWorldPosition(new Vector3());
      const b = bones.find((b) => b.name === names[i + 1])!.getWorldPosition(new Vector3());
      const bind = rig.bones[rig.idx.tail[i]].pos.distanceTo(rig.bones[rig.idx.tail[i + 1]].pos);
      expect(a.distanceTo(b)).toBeCloseTo(bind, 3);
    }
    w.dispose();
  });
});

describe('pure helpers', () => {
  it('two-bone IK preserves segment lengths and bends toward the pole', () => {
    const root = new Vector3(0, 0, 0);
    const target = new Vector3(0, -1.5, 0.3);
    const mid = new Vector3();
    solveTwoBone(root, 1, 1, target, new Vector3(0, 0, 1), mid);
    expect(mid.distanceTo(root)).toBeCloseTo(1, 5);
    expect(mid.distanceTo(target)).toBeCloseTo(1, 5);
    expect(mid.z).toBeGreaterThan(0.3);
    // Out of reach: stays straight toward the target.
    const far = solveTwoBone(root, 1, 1, new Vector3(0, -5, 0), new Vector3(0, 0, 1), mid);
    expect(far).toBeGreaterThan(2.9);
    expect(mid.y).toBeLessThan(-0.99);
  });

  it('aimRotation maps a rest direction onto a target direction', () => {
    const q = new Quaternion();
    const rest = new Vector3(1, 0, 0);
    const dir = new Vector3(0.2, -0.9, 0.4).normalize();
    aimRotation(rest, new Vector3(0, 1, 0), dir, new Vector3(0, 0, 1), q);
    const out = rest.clone().applyQuaternion(q);
    expect(out.distanceTo(dir)).toBeLessThan(1e-6);
  });

  it('flap cycle: wings high at 0, low at 0.5, folded on the upstroke', () => {
    expect(stroke(0)).toBeCloseTo(0);
    expect(stroke(0.5)).toBeCloseTo(1);
    expect(upstrokeFold(0.25)).toBe(0);
    expect(upstrokeFold(0.75)).toBeCloseTo(1, 3);
    const top = flapPose(0, 0, new Float32Array(26));
    const bottom = flapPose(0.5, 0, new Float32Array(26));
    const up = flapPose(0.75, 0, new Float32Array(26));
    expect(top[W.humEl]).toBeGreaterThan(0.6);
    expect(bottom[W.humEl]).toBeLessThan(-0.4);
    // Upstroke: elbow flexed forward, wrist folded back.
    expect(up[W.foreSw]).toBeLessThan(-0.4);
    expect(up[W.handSw]).toBeGreaterThan(0.5);
  });

  it('gait: planted feet never slide while the body walks and turns', () => {
    const rest = [new Vector3(0.5, -2.6, -0.8), new Vector3(-0.5, -2.6, -0.8), new Vector3(1.2, -2.6, 1.5), new Vector3(-1.2, -2.6, 1.5)];
    const gait = new Gait(rest);
    const body = new Vector3(0, 2.6, 0);
    let yaw = 0;
    const q = new Quaternion();
    const ctx: GaitContext = {
      dt: 1 / 60,
      toWorld: (m, out) => out.copy(m).applyQuaternion(q).add(body),
      groundAt: () => 0,
      velocity: new Vector3(),
      yawRate: 0.4,
      standHeight: 2.6,
      runBlend: 0,
      moving: true,
    };
    const last = rest.map(() => new Vector3());
    const wasPlanted = [false, false, false, false];
    let swings = 0;
    for (let i = 0; i < 600; i++) {
      yaw += 0.4 / 60;
      q.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
      ctx.velocity.set(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(3);
      body.addScaledVector(ctx.velocity, 1 / 60);
      gait.update(ctx);
      gait.feet.forEach((f, k) => {
        if (!f.swinging && wasPlanted[k]) expect(f.pos.distanceTo(last[k])).toBeLessThan(1e-9);
        if (f.swinging && wasPlanted[k]) swings++;
        // Feet stay near the body.
        expect(Math.hypot(f.pos.x - body.x, f.pos.z - body.z)).toBeLessThan(4);
        wasPlanted[k] = !f.swinging;
        last[k].copy(f.pos);
      });
    }
    expect(swings).toBeGreaterThan(20);
    expect(footPhase(0.1, 0, 0.6).swing).toBe(false);
    expect(footPhase(0.7, 0, 0.6).swing).toBe(true);
  });
});

describe('weight and life (client direction: a big, heavy dragon)', { timeout: 60000 }, () => {
  /** Saddle and head heights (relative to the body center) over the last wingbeat of a flight. */
  function beat(breed: BreedId) {
    const w = new Wyvern(look(breed));
    const pose = gliding();
    pose.flapStrength = 1;
    const rate = BREEDS[breed].flapRate;
    const samples: { phase: number; saddle: number; head: number }[] = [];
    const n = Math.round(60 / rate);
    for (let i = 0; i < 600; i++) {
      pose.flapPhase = ((i / 60) * rate) % 1;
      pose.position.z += 24 / 60;
      pose.lookTarget.z += 24 / 60;
      w.update(1 / 60, pose);
      if (i >= 600 - n) {
        samples.push({
          phase: pose.flapPhase,
          saddle: w.saddle.getWorldPosition(_p).y - pose.position.y,
          head: w.getHead(_q).y - pose.position.y,
        });
      }
    }
    w.dispose();
    const range = (k: 'saddle' | 'head') => Math.max(...samples.map((s) => s[k])) - Math.min(...samples.map((s) => s[k]));
    const peak = (k: 'saddle' | 'head') => samples.reduce((a, b) => (b[k] > a[k] ? b : a)).phase;
    return { saddleRange: range('saddle'), headRange: range('head'), saddlePeak: peak('saddle'), headPeak: peak('head') };
  }

  it('heaves the saddle up through the downstroke and lets it sink on the recovery; heavier breeds heave more', () => {
    const h = beat('harrier');
    // Highest around the bottom of the stroke (phase 0.5), lowest near the top.
    expect(h.saddlePeak).toBeGreaterThan(0.35);
    expect(h.saddlePeak).toBeLessThan(0.65);
    expect(h.saddleRange).toBeGreaterThan(0.15);
    expect(h.saddleRange).toBeLessThan(0.6);
    expect(beat('ironback').saddleRange).toBeGreaterThan(beat('skimmer').saddleRange * 1.4);
  });

  it('holds the head steadier than the body, trailing it (neck lag)', () => {
    const h = beat('harrier');
    expect(h.headRange).toBeLessThan(h.saddleRange * 0.8);
    // The head's high point comes after the body's (modulo the cycle).
    const lag = (h.headPeak - h.saddlePeak + 1) % 1;
    expect(lag).toBeGreaterThan(0.01);
    expect(lag).toBeLessThan(0.3);
  });

  it('hangs at the top of the stroke and loads the wing hardest on the way down', () => {
    // Same endpoints as the plain stroke, so the flap event still lands at the bottom.
    expect(heavyStroke(0, 1)).toBeCloseTo(0);
    expect(heavyStroke(0.5, 1)).toBeCloseTo(1);
    // The heavy wing has barely left the top a fifth of the way into the downstroke.
    expect(heavyStroke(0.1, 1)).toBeLessThan(stroke(0.1) * 0.75);
    // Load: positive through the downstroke, slack (negative) on the recovery.
    expect(strokeLoad(0.3)).toBeGreaterThan(0.8);
    expect(strokeLoad(0.75)).toBeLessThan(0);
    // A loaded wing bows its membrane up (billow uniform) on the downstroke.
    const w = new Wyvern(look('harrier'));
    const pose = gliding();
    pose.flapStrength = 1;
    let down = 0;
    let up = 0;
    for (let i = 0; i < 240; i++) {
      pose.flapPhase = ((i / 60) * 1.6) % 1;
      w.update(1 / 60, pose);
      const b = w.uniforms.uWingLoad.value.x;
      if (pose.flapPhase > 0.3 && pose.flapPhase < 0.45) down = Math.max(down, b);
      if (pose.flapPhase > 0.75 && pose.flapPhase < 0.95) up = Math.max(up, b);
    }
    expect(down).toBeGreaterThan(0.15);
    expect(up).toBeLessThan(down * 0.5);
    w.dispose();
  });

  it('folds the wings back along the flank on the ground: tips up off the ground, behind the shoulder (VIS-17)', () => {
    for (const breed of BREED_ORDER) {
      const w = new Wyvern(look(breed));
      const pose = standing(breed);
      for (let i = 0; i < 120; i++) w.update(1 / 60, pose);
      const l = new Vector3();
      const r = new Vector3();
      w.getWingtips(l, r);
      const sh = BREEDS[breed].standHeight;
      const shoulder = boneWorld(w, 'humerusL');
      for (const tip of [l, r]) {
        // Not a second pair of stilts: the tips ride well above the ground...
        expect(tip.y - 10).toBeGreaterThan(0.5 * sh);
        // ...back along the body, behind the shoulder, and close in to the flank.
        expect(tip.z).toBeLessThan(shoulder.z - 0.4);
        expect(Math.abs(tip.x)).toBeLessThan(BREEDS[breed].wingspan * 0.2);
      }
      expect(w.uniforms.uFold.value).toBeGreaterThan(0.95);
      w.dispose();
    }
  });

  it('settles on landing: the body sinks into the legs and springs back', () => {
    const w = new Wyvern(look('harrier'));
    const sh = BREEDS.harrier.standHeight;
    const pose = standing('harrier');
    pose.airborne = true;
    pose.wingSpread = 1;
    pose.velocity.set(0, -6, 6);
    for (let i = 0; i < 30; i++) w.update(1 / 60, pose);
    pose.airborne = false;
    pose.wingSpread = 0.22;
    pose.velocity.set(0, 0, 0);
    const ys: number[] = [];
    for (let i = 0; i < 150; i++) {
      w.update(1 / 60, pose);
      ys.push(w.saddle.getWorldPosition(_p).y);
    }
    const rest = ys[ys.length - 1];
    const low = Math.min(...ys.slice(0, 40));
    // A visible sink (several cm on a hard landing), then back to rest.
    expect(rest - low).toBeGreaterThan(0.04);
    expect(rest - low).toBeLessThan(0.5 * sh);
    expect(Math.abs(ys[ys.length - 2] - rest)).toBeLessThan(0.005);
    w.dispose();
  });

  it('shakes out on the ruffle (head, wings, tail) and settles back to the folded stance', () => {
    const w = new Wyvern(look('harrier'));
    const pose = standing('harrier');
    for (let i = 0; i < 120; i++) w.update(1 / 60, pose);
    const l0 = new Vector3();
    const r0 = new Vector3();
    w.getWingtips(l0, r0);
    const head0 = w.getHead(new Vector3());
    let headSwing = 0;
    let wingLift = 0;
    for (let i = 0; i <= 84; i++) {
      pose.ruffle = Math.min(1, i / 84);
      w.update(1 / 60, pose);
      headSwing = Math.max(headSwing, Math.abs(w.getHead(_p).x - head0.x));
      w.getWingtips(_p, _q);
      wingLift = Math.max(wingLift, _p.y - l0.y);
    }
    expect(headSwing).toBeGreaterThan(0.15);
    expect(wingLift).toBeGreaterThan(1);
    pose.ruffle = 0;
    for (let i = 0; i < 120; i++) w.update(1 / 60, pose);
    w.getWingtips(_p, _q);
    expect(_p.distanceTo(l0)).toBeLessThan(0.1);
    w.dispose();
  });

  it('builds up exertion on a long climb and pants it off at rest', () => {
    const w = new Wyvern(look('harrier'));
    const pose = gliding();
    pose.flapStrength = 1;
    for (let i = 0; i < 60 * 12; i++) {
      pose.flapPhase = ((i / 60) * 1.6) % 1;
      w.update(1 / 60, pose);
    }
    const anim = (w as unknown as { animator: { exertion: number } }).animator;
    const after = anim.exertion;
    expect(after).toBeGreaterThan(0.4);
    const rest = standing('harrier');
    for (let i = 0; i < 60 * 10; i++) w.update(1 / 60, rest);
    expect(anim.exertion).toBeLessThan(after - 0.4);
    w.dispose();
  });
});

describe('seat', () => {
  it('reports the standing seat in the body frame, matching the saddle anchor (mount/dismount line-up)', () => {
    for (const breed of BREED_ORDER) {
      for (const saddle of ['rider', 'racing', 'royal', 'nomad']) {
        const w = new Wyvern(look(breed, { saddle }));
        const pose = standing(breed);
        for (let i = 0; i < 90; i++) w.update(1 / 60, pose);
        const seat = w.seatOffset(new Vector3());
        const anchor = w.saddle.getWorldPosition(new Vector3()).sub(pose.position);
        // Within a couple of cm (breathing moves the body a hair).
        expect(seat.distanceTo(anchor)).toBeLessThan(0.025);
        expect(seat.y).toBeGreaterThan(0.5);
        expect(seat.z).toBeGreaterThan(0);
        w.dispose();
      }
    }
    expect(STAND_ROOT_PITCH).toBeLessThan(0);
  });

  it('straddles a horse-like width at the seat and holds the grip up and forward', () => {
    for (const breed of BREED_ORDER) {
      const w = new Wyvern(look(breed));
      expect(w.saddle.userData.halfWidth).toBeGreaterThan(0.4);
      expect(w.saddle.userData.halfWidth).toBeLessThanOrEqual(0.5);
      const g = w.saddle.userData.gripOffset as Vector3;
      expect(g.y).toBeGreaterThan(0.32);
      expect(g.z).toBeGreaterThan(0.45);
      w.dispose();
    }
  });
});
