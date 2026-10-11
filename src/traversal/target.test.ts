import { describe,expect,it } from 'vitest';
import { Vector3 as V } from 'three';
import { Terrain } from '../world/terrain';
import { LAYOUT } from '../world/layout';
import { TraversalWorld } from './sweep';
import { predictTarget } from './target';
import { SkyLance } from './SkyLance';
describe('ballistic static-surface range indicator',()=>{
  it('forecasts the actual first solid and attachment point without moving live equipment',()=>{
    const t=new Terrain({...LAYOUT,islands:[],spires:[],arches:[]});
    t.colliders.add({kind:'box',x:0,y:1000,z:20,hx:4,hy:5,hz:.001,yaw:0});
    t.colliders.add({kind:'sphere',x:0,y:1000,z:30,radius:2});
    const world=new TraversalWorld(t),origin=new V(0,1000,0),aim=new V(0,0,1),v=new V(0,-4,3),live=new SkyLance(world);
    const forecast=predictTarget(world,origin,aim,v);expect(forecast.state).toBe('reachable');expect(forecast.distance).toBeLessThan(21);
    live.throw(origin,aim,v);for(let i=0;i<240&&live.state==='projectile';i++)live.step(1/120,origin);
    expect(live.anchorId).toBe(forecast.anchorId);expect(live.position.toArray()).toEqual(forecast.point.toArray());expect(origin.toArray()).toEqual([0,1000,0]);expect(v.toArray()).toEqual([0,-4,3]);
  });
  it('keeps physical anchor identity independent of render/preview discovery order',()=>{
    function run(preview:boolean){
      const t=new Terrain({...LAYOUT,islands:[],spires:[],arches:[]});
      t.colliders.add({kind:'sphere',x:0,y:1000,z:12,radius:2});t.colliders.add({kind:'sphere',x:10,y:1000,z:12,radius:2});
      const w=new TraversalWorld(t),p=new V(0,1000,0),aim=new V(0,0,1);
      if(preview)predictTarget(w,new V(10,1000,0),aim,new V());
      const live=new SkyLance(w);live.throw(p,aim,new V());for(let i=0;i<240&&live.state==='projectile';i++)live.step(1/120,p);
      return {id:live.anchorId,anchor:live.rope!.anchor.toArray(),length:live.rope!.length};
    }
    expect(run(true)).toEqual(run(false));
  });
  it('reports no in-range surface, too-close obstruction, and malformed aim',()=>{
    const t=new Terrain({...LAYOUT,islands:[],spires:[],arches:[]}),w=new TraversalWorld(t),p=new V(0,1000,0);
    expect(predictTarget(w,p,new V(0,0,1),new V()).state).toBe('out-of-range');
    t.colliders.add({kind:'box',x:0,y:1000,z:1,hx:2,hy:2,hz:.001,yaw:0});
    expect(predictTarget(w,p,new V(0,0,1),new V()).state).toBe('blocked');
    expect(predictTarget(w,p,new V(NaN,0,1),new V()).state).toBe('blocked');
  });
  it('predicts an island underside and respects the maximum line length',()=>{
    const t=new Terrain(LAYOUT),s=t.islands[0],y=s.bottomHeight(s.def.x,s.def.z),w=new TraversalWorld(t);
    const p=new V(s.def.x,y-20,s.def.z),near=predictTarget(w,p,new V(0,1,0),new V());
    expect(near.state).toBe('reachable');expect(near.anchorId).toMatch(/^rock-island-/);expect(near.distance).toBeLessThan(20);
    p.y=y-70;expect(predictTarget(w,p,new V(0,1,0),new V()).state).toBe('out-of-range');
  });
});
