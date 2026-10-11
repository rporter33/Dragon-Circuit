import { describe, it, expect, vi } from 'vitest';
import { Vector3 as V } from 'three';
import { SkyLance } from './SkyLance';
import { resolveTether } from './tether';
import { signedDistance } from '../world/colliders';
import { AnchorRegistry } from './anchors';
import { TraversalWorld, sweepShape, moveBody, SWEEP_LIMITS } from './sweep';
import { Terrain } from '../world/terrain';
import { LAYOUT } from '../world/layout';
import type { Collider } from '../core/types';
const target: Collider = { kind: 'sphere', x: 0, y: 1000, z: 12, radius: 1 };
function rig(valid = true) {
  const terrain = new Terrain({ ...LAYOUT, islands: [], spires: [], arches: [] }); terrain.colliders.add(target);
  return new SkyLance(new TraversalWorld(terrain, new AnchorRegistry(valid ? [{ id: 'test', collider: target }] : [])));
}
describe('Sky Lance projectile and recovery', () => {
  it('sweeps through a thin rotated box at high speed', () => {
    const box: Collider = { kind: 'box', x: 0, y: 1000, z: 5, hx: 2, hy: 2, hz: .01, yaw: .3 };
    const h = sweepShape(new V(0, 1000, 0), new V(0, 1000, 100), .08, box)!;
    expect(h).not.toBeNull(); expect(h.fraction).toBeLessThan(.06); expect(h.normal.z).toBeLessThan(-.9);
  });
  it('locks actual attachment distance and cannot recover or rethrow a live tether', () => {
    const l = rig(), origin = new V(0, 1000, 0); l.throw(origin, new V(0, 0, 1), new V());
    for (let i = 0; i < 100 && !l.rope; i++) l.step(1 / 120, origin);
    expect(l.state).toBe('anchored'); expect(l.rope!.length).toBe(l.position.distanceTo(origin)); expect(l.anchorId).toBe('test');
    expect(l.recover()).toBe(false); expect(l.throw(origin, new V(0, 1, 0), new V())).toBe(false);
  });
  it('a full windup reaches an approved anchor beyond the tap range', () => {
    const terrain = new Terrain({ ...LAYOUT, islands: [], spires: [], arches: [] });
    const far: Collider = { kind: 'box', x: 0, y: 1000, z: 80, hx: 3, hy: 12, hz: .1, yaw: 0 };
    terrain.colliders.add(far); const world = new TraversalWorld(terrain, new AnchorRegistry([{ id: 'far', collider: far }]));
    const tap = new SkyLance(world), charged = new SkyLance(world), origin = new V(0, 1000, 0);
    tap.throw(origin, new V(0, 0, 1), new V()); charged.throw(origin, new V(0, 0, 1), new V(), 1);
    for (let i = 0; i < 240; i++) { tap.step(1 / 120, origin); charged.step(1 / 120, origin); }
    expect(tap.rope).toBeNull(); expect(tap.state).toBe('ready');
    expect(charged.anchorId).toBe('far'); expect(charged.rope!.length).toBeGreaterThan(79);
    const length = charged.rope!.length; charged.windup(1); expect(charged.rope!.length).toBe(length);
  });
  it('blocks on invalid scenery rather than anchoring', () => {
    const l = rig(false), origin = new V(0, 1000, 0); l.throw(origin, new V(0, 0, 1), new V());
    for (let i = 0; i < 100 && l.state === 'projectile'; i++) l.step(1 / 120, origin);
    expect(l.state).toBe('spent'); expect(l.rope).toBeNull(); expect(l.reason).toBe('Not an anchor');
  });
  it('does not attach through an intervening wall', () => {
    const l = rig(); (l.world as TraversalWorld).terrain.colliders.add({ kind: 'box', x: 0, y: 1000, z: 5, hx: 4, hy: 4, hz: .03, yaw: 0 });
    l.throw(new V(0, 1000, 0), new V(0, 0, 1), new V()); for (let i = 0; i < 100 && l.state === 'projectile'; i++) l.step(1 / 120, new V(0, 1000, 0));
    expect(l.state).toBe('spent'); expect(l.rope).toBeNull();
  });
  it('rejects soft fixtures and duplicate IDs', () => {
    expect(() => new AnchorRegistry([{ id: 'bad', collider: { ...target, soft: true } }])).toThrow();
    expect(() => new AnchorRegistry([{ id: 'a', collider: target }, { id: 'a', collider: { ...target } }])).toThrow();
  });
  it.each(['removed', 'replaced', 'moved', 'resized', 'invalid', 'obstructed'] as const)('invalidates a %s anchor before further movement', change => {
    const terrain = new Terrain({ ...LAYOUT, islands: [], spires: [], arches: [] });
    const fixture = { kind: 'sphere' as const, x: 0, y: 1000, z: 12, radius: 1 };
    let source: Collider[] = [fixture]; terrain.colliders.addSource('anchors', () => source);
    const l = new SkyLance(new TraversalWorld(terrain, new AnchorRegistry([{ id: 'static', collider: fixture }]))), origin = new V(0, 1000, 0);
    l.throw(origin, new V(0, 0, 1), new V());
    for (let i = 0; i < 100 && !l.rope; i++) l.step(1 / 120, origin);
    expect(l.rope).not.toBeNull();
    if (change === 'removed') source.length = 0;
    if (change === 'replaced') source = [{ ...fixture }];
    if (change === 'moved') fixture.x += .001;
    if (change === 'resized') fixture.radius += .001;
    if (change === 'invalid') fixture.radius = NaN;
    if (change === 'obstructed') terrain.colliders.add({ kind: 'box', x: 0, y: 1000, z: 5, hx: 2, hy: 2, hz: .001, yaw: 0 });
    l.step(1 / 120, origin); expect(l.rope).toBeNull(); expect(l.anchorId).toBeNull(); expect(l.state).toBe('spent');
    expect(l.recover()).toBe(true); expect(l.state).toBe('ready');
  });
  it('rejects a clear projectile hit when the harness-to-anchor path is obstructed', () => {
    const terrain = new Terrain({ ...LAYOUT, islands: [], spires: [], arches: [] }); terrain.colliders.add(target);
    terrain.colliders.add({ kind: 'box', x: 0, y: 1000, z: 5, hx: 2, hy: 2, hz: .01, yaw: 0 });
    const l = new SkyLance(new TraversalWorld(terrain, new AnchorRegistry([{ id: 'test', collider: target }])));
    // Projectile begins beyond the wall; harness remains behind it.
    l.throw(new V(0, 1000, 7), new V(0, 0, 1), new V());
    for (let i = 0; i < 100 && l.state === 'projectile'; i++) l.step(1 / 120, new V(0, 1000, 0));
    expect(l.reason).toBe('Tether obstructed'); expect(l.rope).toBeNull(); expect(l.recover()).toBe(true);
  });
  it('resolves the first solid in one very fast projectile step, including thin intervening geometry', () => {
    const l = rig(); (l.world as TraversalWorld).terrain.colliders.add({ kind: 'box', x: 0, y: 1000, z: 5, hx: 2, hy: 2, hz: .0001, yaw: 0 });
    const origin = new V(0, 1000, 0); l.throw(origin, new V(0, 0, 1), new V(0, 0, 10000)); l.step(1 / 120, origin);
    expect(l.reason).toBe('Not an anchor'); expect(l.position.z).toBeLessThan(5); expect(l.rope).toBeNull();
  });
  it('misses and cancellation have bounded, immediately recoverable equipment states', () => {
    const l = rig(), origin = new V(0, 1000, 0);
    for (let cycle = 0; cycle < 20; cycle++) {
      l.beginCharge(); l.windup(.2); l.cancelCharge(); expect(l.charging).toBe(false);
      l.throw(origin, new V(1, 0, 0), new V());
      for (let i = 0; i <= 240; i++) l.step(1 / 120, origin);
      expect(l.state).toBe('ready'); expect(l.anchorId).toBeNull(); expect(l.rope).toBeNull();
    }
  });
  it('can repeatedly throw, release and recover without moving the rider', () => {
    const l = rig(), p = new V(0, 1000, 0);
    for (let n = 0; n < 20; n++) {
      expect(l.throw(p, new V(0, 0, 1), new V())).toBe(true);
      for (let i = 0; i < 100 && !l.rope; i++) l.step(1 / 120, p);
      expect(l.rope).not.toBeNull(); l.detach(); expect(l.recover()).toBe(true); expect(p.toArray()).toEqual([0, 1000, 0]);
    }
  });
});

describe('shared world swept traversal collision', () => {
  it('bounds pathological displacement and dense broad-phase queries, failing closed', () => {
    const terrain = new Terrain({ ...LAYOUT, islands: [], spires: [], arches: [] }), world = new TraversalWorld(terrain);
    const query = vi.spyOn(terrain.colliders, 'candidates');
    const origin = new V(0, 1000, 0);
    expect(world.sweep(origin, new V(0, 1000, 1e12), .08)?.fraction).toBe(0); expect(query).not.toHaveBeenCalled();
    for (let i = 0; i < SWEEP_LIMITS.candidates + 100; i++) terrain.colliders.add({ kind: 'sphere', x: 0, y: 1000, z: 5, radius: 1 });
    expect(world.sweep(origin, new V(0, 1000, 10), .08)?.exhausted).toBe(true);
    expect(query.mock.results[0].value).toHaveLength(SWEEP_LIMITS.candidates + 1);
    query.mockRestore();
  });
  it('sweeps the rider through a high-speed wall approach and retains sliding velocity', () => {
    const t = new Terrain({ ...LAYOUT, islands: [], spires: [], arches: [] });
    t.colliders.add({ kind: 'box', x: 0, y: 1001, z: 5, hx: 20, hy: 5, hz: .02, yaw: 0 });
    const world = new TraversalWorld(t), from = new V(0, 1000, 0), to = new V(4, 1000, 20), v = new V(80, 0, 400);
    moveBody(world, from, to, v); expect(to.z).toBeLessThan(4.64); expect(to.x).toBeCloseTo(4, 3);
    expect(v.z).toBeCloseTo(0, 8); expect(v.x).toBeCloseTo(80, 8);
  });
  it('rope correction cannot tunnel through a pillar or analytic island rock', () => {
    const terrain = new Terrain(LAYOUT), world = new TraversalWorld(terrain);
    const collision = (from: V, to: V, velocity: V) => {
      const feet = to.clone().add(new V(0, -1, 0));
      moveBody(world, from.clone().add(new V(0, -1, 0)), feet, velocity); to.copy(feet).add(new V(0, 1, 0));
    };
    const pillar: Collider = { x: 5004, z: 5000, radius: .5, y0: 980, y1: 1020 }; terrain.colliders.add(pillar);
    const p = new V(5006, 1001, 5000), v = new V(-100, 0, 0), rope = { anchor: new V(5000, 1001, 5000), length: 2 };
    resolveTether(p, v, rope, collision);
    expect(signedDistance(pillar, p, null)).toBeGreaterThanOrEqual(.35); expect(p.distanceTo(rope.anchor)).toBeGreaterThan(rope.length);
    const x = LAYOUT.spawn.position[0], z = LAYOUT.spawn.position[2], y = terrain.groundAt(x, z, 10000)!.y;
    p.set(x, y + 20, z); v.set(0, -100, 0); const buried = { anchor: new V(x, y - 40, z), length: 2 };
    resolveTether(p, v, buried, collision);
    expect(p.y).toBeGreaterThan(y); expect(p.distanceTo(buried.anchor)).toBeGreaterThan(buried.length);
  });
  it('stops at ceilings and can traverse tangent to a floor without sticking', () => {
    const t = new Terrain({ ...LAYOUT, islands: [], spires: [], arches: [] });
    t.colliders.add({ kind: 'box', x: 0, y: 1004, z: 0, hx: 20, hy: .02, hz: 20, yaw: 0 });
    t.colliders.add({ kind: 'box', x: 0, y: 999, z: 0, hx: 20, hy: 1, hz: 20, yaw: 0 });
    const w = new TraversalWorld(t), from = new V(0, 1000, 0), to = new V(4, 1000, 0), v = new V(4, 0, 0);
    moveBody(w, from, to, v); expect(to.x).toBeCloseTo(4, 8);
    const up = new V(4, 1010, 0); v.set(0, 100, 0); moveBody(w, to, up, v);
    expect(up.y).toBeLessThan(1002.2); expect(v.y).toBe(0);
  });
  it('hits analytic island terrain at high speed, matching its own contact geometry', () => {
    const t = new Terrain(LAYOUT), x = LAYOUT.spawn.position[0], z = LAYOUT.spawn.position[2];
    const y = t.groundAt(x, z, 10000)!.y;
    const hit = new TraversalWorld(t).sweep(new V(x, y + 20, z), new V(x, y - 20, z), .08)!;
    expect(hit).not.toBeNull(); expect(hit.anchorId).toMatch(/^rock-island-/); expect(hit.point.y).toBeGreaterThan(y);
    expect(hit.point.y).toBeLessThan(y + 1); expect(hit.normal.y).toBeGreaterThan(.5);
  });
  it('never ignores an entire attached solid, preventing the rope passing through its back', () => {
    const t = new Terrain({ ...LAYOUT, islands: [], spires: [], arches: [] });t.colliders.add(target);
    const w = new TraversalWorld(t,new AnchorRegistry([{id:'eye',collider:target}]));
    expect(w.sweep(new V(0,1000,0),new V(0,1000,20),.02,'eye')?.anchorId).toBe('eye');
    const endpoint=w.sweep(new V(0,1000,0),new V(0,1000,20),.08)!.point;
    expect(w.sweep(new V(0,1000,0),endpoint,.02,'eye')).toBeNull();
  });
});

function fire(l:SkyLance,origin:V,aim:V) { l.throw(origin,aim,new V());for(let i=0;i<240&&l.state==='projectile';i++)l.step(1/120,origin); }
describe('general static world surfaces',()=>{
  it.each(['box','sphere','cylinder'] as const)('anchors to an ordinary %s and rejects subsequent transform changes',kind=>{
    const t=new Terrain({...LAYOUT,islands:[],spires:[],arches:[]});
    const c:Collider=kind==='box'?{kind,x:0,y:1000,z:12,hx:2,hy:3,hz:.01,yaw:0}:kind==='sphere'?{kind,x:0,y:1000,z:12,radius:2}:{x:0,z:12,y0:997,y1:1003,radius:2};
    t.colliders.add(c);const l=new SkyLance(new TraversalWorld(t)),origin=new V(0,1000,0);fire(l,origin,new V(0,0,1));
    expect(l.state).toBe('anchored');expect(l.anchorId).toMatch(/^solid-/);c.x+=.01;l.step(1/120,origin);expect(l.rope).toBeNull();
  });
  it('anchors to the first wall rather than a fixture behind it; soft foliage remains non-solid',()=>{
    const t=new Terrain({...LAYOUT,islands:[],spires:[],arches:[]});
    t.colliders.add({...target,z:3,soft:true});t.colliders.add({kind:'box',x:0,y:1000,z:5,hx:4,hy:4,hz:.001,yaw:0});t.colliders.add(target);
    const l=new SkyLance(new TraversalWorld(t));fire(l,new V(0,1000,0),new V(0,0,1));expect(l.state).toBe('anchored');expect(l.position.z).toBeLessThan(5);
  });
  it('attaches to real island undersides, rejects a rope through the island, and invalidates removed rock',()=>{
    const t=new Terrain(LAYOUT),island=t.islands[0],x=island.def.x,z=island.def.z,y=island.bottomHeight(x,z);
    const origin=new V(x,y-20,z),l=new SkyLance(new TraversalWorld(t));fire(l,origin,new V(0,1,0));
    expect(l.state).toBe('anchored');expect(l.anchorId).toBe(`rock-island-${island.def.id}`);expect(l.position.y).toBeLessThan(y);
    expect(l.validate(origin)).toBe(true);
    expect(l.validate(new V(x,island.topHeight(x,z)+20,z))).toBe(false);expect(l.reason).toBe('Tether obstructed');
    l.reset();fire(l,origin,new V(0,1,0));t.islands.splice(0,1);l.step(1/120,origin);expect(l.reason).toBe('Anchor invalidated');
  });
  it.each(['spire','arch'] as const)('attaches to shared analytic %s surfaces',type=>{
    const t=new Terrain({...LAYOUT,islands:[],spires:type==='spire'?[LAYOUT.spires[0]]:[],arches:type==='arch'?[LAYOUT.arches[0]]:[]});
    const origin=new V(),aim=new V();
    if(type==='spire'){
      const shape=t.spires[0];origin.set(shape.def.x+shape.maxRadius+15,(shape.def.topY+shape.def.tipY)/2,shape.def.z);aim.set(-1,0,0);
    }else{
      const shape=t.arches[0];shape.pointAt((shape.def.arcStart+shape.def.arcEnd)/2,origin);origin.addScaledVector(shape.normal,15);aim.copy(shape.normal).negate();
    }
    const l=new SkyLance(new TraversalWorld(t));fire(l,origin,aim);expect(l.state).toBe('anchored');expect(l.anchorId).toMatch(new RegExp(`^rock-${type}-`));expect(l.validate(origin)).toBe(true);
  });
  it('invalidates changed analytic definitions and replacement colliders without trusting stale index entries',()=>{
    const t=new Terrain(LAYOUT),s=t.islands[0],origin=new V(s.def.x,s.bottomHeight(s.def.x,s.def.z)-20,s.def.z),l=new SkyLance(new TraversalWorld(t));
    fire(l,origin,new V(0,1,0));s.def.x+=1;expect(l.validate(origin)).toBe(false);s.def.x-=1;
    let c:Collider[]=[{...target}];const empty=new Terrain({...LAYOUT,islands:[],spires:[],arches:[]});empty.colliders.addSource('wall',()=>c);
    const other=new SkyLance(new TraversalWorld(empty)),p=new V(0,1000,0);fire(other,p,new V(0,0,1));c=[{...c[0]}];expect(other.validate(p)).toBe(false);
  });
});
