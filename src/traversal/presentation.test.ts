import { afterEach, describe, expect, it, vi } from 'vitest';
import { BufferAttribute, Matrix4, Mesh, PerspectiveCamera, Vector3 } from 'three';
import { DEFAULT_RIDER } from '../cosmetics/catalog';
import { Rider } from '../creatures/rider/Rider';
import { createRiderPose } from '../player/poses';
import { SkyLance } from './SkyLance';
import { SkyLanceVisuals } from './SkyLanceVisuals';
import { Terrain } from '../world/terrain';
import { LAYOUT } from '../world/layout';
import { TraversalWorld } from './sweep';
import { predictCenteredTarget } from './target';
afterEach(() => vi.unstubAllGlobals());
describe('render-only Windline equipment', () => {
  it.each(['slight', 'medium', 'broad'] as const)('%s follows rebuilt rigs and produces finite geometry without moving gameplay anchors', build => {
    vi.stubGlobal('window', { innerHeight: 720 });
    vi.stubGlobal('document', { getElementById: () => null });
    const rider = new Rider(DEFAULT_RIDER), visuals = new SkyLanceVisuals();
    const lance = new SkyLance({ anchorValid: () => true, sweep: () => null });
    const pose = createRiderPose(), camera = new PerspectiveCamera(50, 16/9, .1, 1000);
    pose.mounted = false; pose.position.set(12, 400, -60); pose.action = 'fall'; pose.equipment = 'tether';
    lance.rope = {anchor: new Vector3(12, 415, -50), length: 20}; lance.state = 'anchored';
    camera.position.set(15, 403, -65); camera.lookAt(pose.position); camera.updateMatrixWorld();
    try {
      rider.setLook({...DEFAULT_RIDER,build});
      const initial = new Matrix4();
      for (const motion of ['cast', 'recover'] as const) for (const t of [0, .25, .5, .75, 1]) {
        pose.lanceMotion = motion; pose.lanceMotionT = t; pose.lineTension = t; pose.airBoost = t; pose.freefallSteer = t;
        rider.update(1/120, pose, null);
        rider.equipmentFrame('bracer', initial); expect(initial.elements.every(Number.isFinite)).toBe(true);
        const anchor = lance.rope.anchor.toArray(), position = pose.position.toArray();
        visuals.update(lance, rider, pose, .5); visuals.updateReticle(camera,pose.position,pose.velocity,lance);
        expect(lance.rope.anchor.toArray()).toEqual(anchor); expect(lance.rope.length).toBe(20); expect(pose.position.toArray()).toEqual(position);
        visuals.group.traverse(object => {
          if (object instanceof Mesh) {
            const attribute = object.geometry.attributes.position as BufferAttribute;
            expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
          }
        });
      }
      // Rebuilt equipment frames must translate with the new model rather than retaining old bones.
      const before = new Vector3().setFromMatrixPosition(initial);
      pose.position.x += 7; rider.update(0, pose, null);
      rider.equipmentFrame('bracer', initial);
      expect(new Vector3().setFromMatrixPosition(initial).x - before.x).toBeCloseTo(7, 5);
    } finally { visuals.dispose(); rider.dispose(); }
  });
  it.each(['slight', 'medium', 'broad'] as const)('%s has a visible two-arm freefall brake and a bracer-fired filament', build => {
    vi.stubGlobal('window', { innerHeight: 720 }); vi.stubGlobal('document', { getElementById: () => null });
    const rider = new Rider({...DEFAULT_RIDER,build}), visuals = new SkyLanceVisuals();
    const lance = new SkyLance({ anchorValid: () => true, sweep: () => null }), pose = createRiderPose();
    pose.mounted = false; pose.action = 'fall'; pose.equipment = 'bracer'; pose.freefallTilt = -1;
    try {
      for (let i = 0; i < 120; i++) rider.update(1/120,pose,null);
      const hips = rider.group.getObjectByName('hips')!, left = rider.group.getObjectByName('handL')!, right = rider.group.getObjectByName('handR')!;
      expect(hips).toBeDefined();
      const l = left.getWorldPosition(new Vector3()), r = right.getWorldPosition(new Vector3());
      expect(l.distanceTo(r)).toBeGreaterThan(1.3); // Both arms spread; no lance-carry override.
      const before = lance.position.clone();
      lance.throw(pose.position.clone().add(new Vector3(0,1,0)),new Vector3(0,0,1),new Vector3());
      lance.step(1/120,pose.position.clone().add(new Vector3(0,1,0)));
      visuals.update(lance,rider,pose,1);
      const seed = visuals.group.getObjectByName('windline-seed')!;
      expect(seed.visible).toBe(true); expect(seed.position.toArray()).toEqual(lance.position.toArray());
      expect(lance.position.equals(before)).toBe(false);
      pose.mounted = true; visuals.update(lance,rider,pose,1); expect(seed.visible).toBe(false);
    } finally { visuals.dispose(); rider.dispose(); }
  });
  it('clears freefall lean on touchdown and teleport rather than moving planted feet', () => {
    const rider = new Rider(DEFAULT_RIDER), pose = createRiderPose();
    pose.mounted = false; pose.action = 'fall'; pose.equipment = 'bracer'; pose.freefallTilt = 1;
    try {
      for (let i=0;i<120;i++) rider.update(1/120,pose,null);
      const hips = rider.group.getObjectByName('hips')!;
      expect(hips.rotation.x).toBeGreaterThan(1);
      pose.action = 'land'; pose.freefallTilt = undefined; rider.update(1/120,pose,null);
      expect(Math.abs(hips.rotation.x)).toBeLessThan(.2);
      pose.action = 'fall'; pose.freefallTilt = 1;
      for (let i=0;i<120;i++) rider.update(1/120,pose,null);
      pose.position.x += 100; pose.freefallTilt = undefined; rider.update(1/120,pose,null);
      expect(Math.abs(hips.rotation.x)).toBeLessThan(.2);
    } finally {rider.dispose();}
  });
});


describe('responsive aiming feedback',()=>{
  it('retains green for an unchanged proven pose, then clears a removed anchor without forecasting',()=>{
    vi.stubGlobal('window',{innerHeight:720});
    const el={hidden:false,closest:()=>null,classList:{toggle:vi.fn()},dataset:{} as Record<string,string>,style:{} as Record<string,string>,querySelector:()=>null};
    vi.stubGlobal('document',{getElementById:()=>el});let now=1000;
    const clock=vi.spyOn(performance,'now').mockImplementation(()=>now);
    const terrain=new Terrain({...LAYOUT,islands:[],spires:[],arches:[]});
    terrain.colliders.add({kind:'box',x:0,y:1000,z:26,hx:2,hy:5,hz:.001,yaw:0});
    const world=new TraversalWorld(terrain),lance=new SkyLance(world),camera=new PerspectiveCamera(50,16/9,.1,1000),feet=new Vector3(0,999,0),velocity=new Vector3();
    camera.position.set(0,1000,0);camera.lookAt(0,1000,1);camera.updateMatrixWorld();
    const visuals=new SkyLanceVisuals(),sweeps=vi.spyOn(world,'sweep');
    try{
      visuals.updateReticle(camera,feet,velocity,lance);const queries=sweeps.mock.calls.length;
      for(let i=0;i<30;i++){now+=1;visuals.updateReticle(camera,feet,velocity,lance);expect(el.style.color).toBe('#94d6a2');}
      expect(sweeps.mock.calls.length).toBe(queries);
      terrain.colliders.clear();now+=1;visuals.updateReticle(camera,feet,velocity,lance);
      expect(el.dataset.target).toBe('checking');expect(el.style.color).toBe('#a8ddec');expect(sweeps.mock.calls.length).toBe(queries);
    }finally{sweeps.mockRestore();clock.mockRestore();visuals.dispose();}
  });
  it.each(['thin-target edge','range boundary','camera translation','harness obstruction','inherited velocity'] as const)('never reuses green for an unproven %s change during cooldown',change=>{
    vi.stubGlobal('window',{innerHeight:720});
    const el={hidden:false,closest:()=>null,classList:{toggle:vi.fn()},dataset:{} as Record<string,string>,style:{} as Record<string,string>,querySelector:()=>null};
    vi.stubGlobal('document',{getElementById:()=>el});let now=1000;
    const clock=vi.spyOn(performance,'now').mockImplementation(()=>now);
    const terrain=new Terrain({...LAYOUT,islands:[],spires:[],arches:[]});
    terrain.colliders.add({kind:'box',x:0,y:1000,z:change==='range boundary'?65.06:26,hx:change==='thin-target edge'||change==='camera translation'?.005:2,hy:5,hz:.001,yaw:0});
    if(change==='harness obstruction')terrain.colliders.add({kind:'box',x:.2,y:1000,z:.2,hx:.04,hy:2,hz:.04,yaw:0});
    const world=new TraversalWorld(terrain),lance=new SkyLance(world),camera=new PerspectiveCamera(50,16/9,.1,1000),feet=new Vector3(0,999,0),velocity=new Vector3();
    camera.position.set(0,1000,0);camera.lookAt(0,1000,1);camera.updateMatrixWorld();
    const visuals=new SkyLanceVisuals(),sweeps=vi.spyOn(world,'sweep');
    try{
      visuals.updateReticle(camera,feet,velocity,lance);expect(el.dataset.target).toBe('reachable');expect(el.style.color).toBe('#94d6a2');
      if(change==='thin-target edge')camera.lookAt(Math.sin(.007),1000,Math.cos(.007));
      if(change==='range boundary')feet.z=-.03;
      if(change==='camera translation')camera.position.x=.12;
      if(change==='harness obstruction')feet.x=.14;
      if(change==='inherited velocity')velocity.x=.49;
      camera.updateMatrixWorld();
      const reference=predictCenteredTarget(world,camera.position,camera.getWorldDirection(new Vector3()),feet.clone().add(new Vector3(0,1,0)),velocity);
      if(change!=='inherited velocity')expect(reference.state).not.toBe('reachable');
      const queries=sweeps.mock.calls.length;now+=1;visuals.updateReticle(camera,feet,velocity,lance);
      expect(sweeps.mock.calls.length).toBe(queries); // Preserve the bounded forecast cadence.
      expect(el.dataset.target).toBe('checking');expect(el.style.color).toBe('#a8ddec');expect(el.classList.toggle).toHaveBeenLastCalledWith('is-valid',false);
      now+=300;visuals.updateReticle(camera,feet,velocity,lance);
      expect(el.dataset.target).toBe(reference.state); // Fresh proof restores green where still valid.
    }finally{sweeps.mockRestore();clock.mockRestore();visuals.dispose();}
  });
  it('yields gameplay time after a slow forecast and refreshes on equipment state changes',()=>{
    vi.stubGlobal('window',{innerHeight:720});
    const el={hidden:false,closest:()=>null,classList:{toggle:vi.fn()},dataset:{} as Record<string,string>,style:{} as Record<string,string>,querySelector:()=>null};
    vi.stubGlobal('document',{getElementById:()=>el});let now=1000,queries=0;
    const clock=vi.spyOn(performance,'now').mockImplementation(()=>now);
    const lance=new SkyLance({anchorValid:()=>true,sweep:()=>{queries++;now+=100;return null;}});
    const camera=new PerspectiveCamera(50,16/9,.1,1000),feet=new Vector3(0,1000,0),v=new Vector3();
    camera.position.set(0,1002,-6);camera.lookAt(0,1002,20);camera.updateMatrixWorld();
    const visuals=new SkyLanceVisuals();
    try{
      visuals.updateReticle(camera,feet,v,lance);expect(queries).toBe(1);
      for(let i=0;i<20;i++){now+=1;feet.x+=.01;visuals.updateReticle(camera,feet,v,lance);}
      expect(queries).toBe(1);expect(el.dataset.target).toBe('checking');
      lance.state='spent';visuals.updateReticle(camera,feet,v,lance);expect(queries).toBe(1);
      lance.state='ready';visuals.updateReticle(camera,feet,v,lance);expect(queries).toBe(2);
    }finally{clock.mockRestore();visuals.dispose();}
  });
  it('keeps the dot centred, bounds forecasts and clears stale eligibility',()=>{
    vi.stubGlobal('window',{innerHeight:720});
    const label={textContent:''},impact={style:{} as Record<string,string>};
    const el={hidden:false,closest:()=>null,classList:{toggle:vi.fn()},dataset:{} as Record<string,string>,style:{} as Record<string,string>,querySelector:(query:string)=>query==='[data-impact]'?impact:label};
    vi.stubGlobal('document',{getElementById:()=>el});let now=1000;const clock=vi.spyOn(performance,'now').mockImplementation(()=>now);
    let queries=0;
    const lance=new SkyLance({anchorValid:()=>true,sweep:(from,to,radius)=>{
      if(from.z===-6)queries++; // One centre-ray sweep per forecast.
      if(radius!==.08 || from.z>=20 || to.z<20)return null;
      const fraction=(20-from.z)/(to.z-from.z);
      return {fraction,point:from.clone().lerp(to,fraction),normal:new Vector3(0,0,-1),anchorId:'surface'};
    }});
    const camera=new PerspectiveCamera(50,16/9,.1,1000);camera.position.set(0,1002,-6);camera.lookAt(0,1002,20);camera.updateMatrixWorld();
    const visuals=new SkyLanceVisuals(),feet=new Vector3(0,1000,0),v=new Vector3();
    try{
      visuals.updateReticle(camera,feet,v,lance);expect(el.dataset.target).toBe('reachable');const left=el.style.left;const firstQueries=queries;
      camera.lookAt(5,1002,20);camera.updateMatrixWorld();now+=1;visuals.updateReticle(camera,feet,v,lance);
      expect(el.style.left).toBe(left);expect(el.style.left).toBe('50%');expect(el.style.top).toBe('50%');expect(el.dataset.target).toBe('checking');expect(queries).toBe(firstQueries);
      now+=50;visuals.updateReticle(camera,feet,v,lance);expect(el.dataset.target).toBe('reachable');
      const x=el.style.left,y=el.style.top;
      lance.state='spent';visuals.updateReticle(camera,feet,v,lance);expect(el.style.left).toBe(x);expect(el.style.top).toBe(y);
      lance.state='ready';now+=50;visuals.updateReticle(camera,feet,v,lance);const before=queries;
      for(let i=0;i<120;i++){now+=1000/120;visuals.updateReticle(camera,feet,v,lance);}
      expect(queries-before).toBeLessThanOrEqual(20); // At most 20 forecasts/sec.
      el.hidden=true;now+=100;const hiddenQueries=queries;visuals.updateReticle(camera,feet,v,lance);
      expect(queries).toBe(hiddenQueries); // Mounted/menu HUD does not forecast an unusable cast.
    }finally{clock.mockRestore();visuals.dispose();}
  });
});

describe('head-down dive to flat braking silhouette',()=>{
  it.each(['slight','medium','broad'] as const)('%s rotates the whole limb chain smoothly and leaves supported poses unchanged',build=>{
    const rider=new Rider({...DEFAULT_RIDER,build}),pose=createRiderPose();pose.mounted=false;pose.action='fall';pose.equipment='bracer';pose.freefallTilt=-1;pose.velocity.set(0,-9,0);
    const point=(name:string)=>rider.group.getObjectByName(name)!.getWorldPosition(new Vector3());
    try{
      for(let i=0;i<120;i++)rider.update(1/120,pose,null);
      const flat=point('head').sub(point('hips'));expect(Math.abs(flat.y)).toBeLessThan(.25);expect(flat.z).toBeGreaterThan(.35);
      const spread=point('handL').distanceTo(point('handR'));expect(spread).toBeGreaterThan(1.3);
      let previous=point('head'),maxStep=0;
      for(let i=0;i<120;i++){
        pose.freefallTilt=-1+2*(i+1)/120;rider.update(1/120,pose,null);const head=point('head');maxStep=Math.max(maxStep,head.distanceTo(previous));previous=head;
      }
      const dive=point('head').sub(point('hips'));expect(dive.y).toBeLessThan(-.4);expect(Math.abs(dive.z)).toBeLessThan(.25);expect(maxStep).toBeLessThan(.04);
      expect(point('footL').y).toBeGreaterThan(point('hips').y);expect(point('handL').distanceTo(point('handR'))).toBeLessThan(spread*.6);
      pose.action='land';pose.freefallTilt=undefined;rider.update(1/120,pose,null);expect(point('head').y).toBeGreaterThan(point('hips').y);
    }finally{rider.dispose();}
  });
});
