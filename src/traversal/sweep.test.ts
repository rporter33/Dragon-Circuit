import {describe,it,expect,vi} from 'vitest';
import {Vector3 as V} from 'three';
import {Terrain} from '../world/terrain';
import {LAYOUT} from '../world/layout';
import {TraversalWorld} from './sweep';
import {mulberry32} from '../core/rng';

/** Retained fine-sample reference: acceleration must not skip a previously detected rock. */
function dense(t:Terrain,from:V,to:V,radius:number):number|null {
  const spacing=Math.min(.02,Math.max(radius/2,.002)),r=radius+spacing/2;
  const count=Math.max(1,Math.ceil(from.distanceTo(to)/spacing)),p=new V(),push=new V(),normal=new V();
  for(let i=0;i<=count;i++)if(t.rockContact(p.lerpVectors(from,to,i/count),r,push,normal))return i/count;
  return null;
}
describe('accelerated analytic rock sweeps',()=>{
  it('matches the original fine lattice on seeded underside, rim and cross-island segments', {timeout:30000},()=>{
    const t=new Terrain(LAYOUT),w=new TraversalWorld(t),rng=mulberry32(1827);
    for(let i=0;i<120;i++){
      const s=t.islands[i%t.islands.length],a=rng()*Math.PI*2,rad=s.def.radius*(.15+.95*rng());
      const x=s.def.x+Math.cos(a)*rad,z=s.def.z+Math.sin(a)*rad,b=s.bottomHeight(x,z);
      const from=new V(x,b-5-rng()*20,z),to=from.clone().add(new V((rng()-.5)*30,10+rng()*35,(rng()-.5)*30));
      const expected=dense(t,from,to,.02),actual=w.sweep(from,to,.02);
      expect(actual?.exhausted,`query budget ${i}`).not.toBe(true);
      expect(!!actual,`hit ${i}: ${from.toArray()} -> ${to.toArray()}`).toBe(expected!==null);
      if(expected!==null)expect(actual!.fraction,`first contact ${i}`).toBeLessThanOrEqual(expected+1e-8);
    }
  });
  it('skips known empty intervals and reuses exact columns without skipping near-surface samples',()=>{
    const t=new Terrain(LAYOUT),s=t.islands[0],x=s.def.x+s.def.radius*.35,z=s.def.z,y=s.bottomHeight(x,z);
    const w=new TraversalWorld(t),from=new V(x,Math.min(y-20,s.minY-20),z),hit=w.sweep(from,new V(x,y+2,z),.08)!;
    const query=vi.spyOn(t,'rockContact'),height=vi.spyOn(s,'bottomHeight'),normal=vi.spyOn(s,'bottomNormal');
    expect(w.sweep(from,hit.point,.02)).toBeNull();
    // Start at least 20 m below the enclosing bounds. At least 19 m of empty lattice
    // must be culled; retain the full near-surface lattice and its original contact radius.
    expect(query.mock.calls.length).toBeLessThan(Math.ceil(from.distanceTo(hit.point)/.01)-1900);
    // Preserve the fine lattice but evaluate the exact, immutable vertical column only once.
    expect(height.mock.calls.length).toBeLessThanOrEqual(5);expect(normal).toHaveBeenCalledTimes(1);
    expect(w.sweep(from,hit.point,.02)).toBeNull();
    expect(normal).toHaveBeenCalledTimes(2); // Cache expires at the end of each synchronous sweep.

  });
});
