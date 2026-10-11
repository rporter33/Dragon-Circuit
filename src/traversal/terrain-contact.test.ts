import {describe,it,expect} from 'vitest';
import {Vector3 as V} from 'three';
import {Terrain} from '../world/terrain';
import {LAYOUT} from '../world/layout';
import {mulberry32} from '../core/rng';

describe('underside rejection preserves analytic collision',()=>{
  it('matches original point contacts across all islands',()=>{
    const rng=mulberry32(909);
    for(const def of LAYOUT.islands){
      const t=new Terrain({...LAYOUT,islands:[def],spires:[],arches:[]}),s=t.islands[0],push=new V(),normal=new V();
      for(let i=0;i<60;i++){
        const angle=rng()*Math.PI*2,rad=s.outlineRadius(angle)*(.01+.98*rng());
        const x=def.x+Math.cos(angle)*rad,z=def.z+Math.sin(angle)*rad,top=s.topHeight(x,z),bottom=s.bottomHeight(x,z);
        expect(s.minTopY).toBeLessThanOrEqual(top+1e-10);
        const radius=[.025,.09,.36][i%3],y=i%2===0?bottom+(rng()-.7)*8:top+(rng()-.3)*8;
        const p=new V(x,y,z),n=i%2===0?s.bottomNormal(x,z,new V()):s.topNormal(x,z,new V());
        // Original resolver chooses its surface by the column midpoint, independently of test setup.
        const upper=y>=(top+bottom)/2;
        if(upper)s.topNormal(x,z,n);else s.bottomNormal(x,z,n);
        const gap=upper?(y-top)*n.y:(bottom-y)*-n.y,expected=gap<radius;
        const actual=t.rockContact(p,radius,push,normal);
        expect(actual,`${def.id} contact ${i}`).toBe(expected);
        if(expected)expect(push.distanceTo(n.multiplyScalar(radius-gap))).toBeLessThan(1e-10);
      }
    }
  });
});
