import {describe,it,expect} from 'vitest';
import {Vector3} from 'three';
import {Terrain} from './terrain';
import {LAYOUT} from './layout';
import {mulberry32} from '../core/rng';
import {TraversalWorld} from '../traversal/sweep';
import {AnchorRegistry} from '../traversal/anchors';
import {SIMPLEX_GRADIENT_BOUND} from './undersideBounds';
import simplexSource from '../../node_modules/simplex-noise/dist/esm/simplex-noise.js?raw';

describe('immutable analytic underside empty-space certificates',()=>{
  it('proves the installed simplex kernel gradient bound over whole domains, not sampled gradients',()=>{
    expect(simplexSource).toContain('const G2 = (3.0 - SQRT3) / 6.0');
    expect(simplexSource).toContain('let t0 = 0.5 - x0 * x0 - y0 * y0');
    expect(simplexSource).toContain('return 70.0 * (n0 + n1 + n2)');
    // The opposite simplex is a reflection and all cells are translations.
    // For s=|q|², max(t^4, |.5-9s|t³) bounds the derivative operator norm;
    // its only interior maximum is s=1/6. Each cell encloses every position,
    // and each kernel uses independent worst-case gradient direction <=sqrt(2).
    const G=(3-Math.sqrt(3))/6,centres=[[0,0],[1-G,-G],[1-2*G,1-2*G]],n=64;
    const kernel=(s:number)=>s>=.5?0:Math.max((.5-s)**4,Math.abs(.5-9*s)*(.5-s)**3);
    let largest=0;
    for(let i=0;i<n;i++)for(let j=0;j<n;j++){
      const x0=i*(1-G)/n,x1=(i+1)*(1-G)/n,z0=-G+j*(1-G)/n,z1=-G+(j+1)*(1-G)/n;
      let total=0;
      for(const [x,z] of centres){
        const nearX=x>=x0&&x<=x1?0:Math.min(Math.abs(x0-x),Math.abs(x1-x)),nearZ=z>=z0&&z<=z1?0:Math.min(Math.abs(z0-z),Math.abs(z1-z));
        const lo=Math.max(0,nearX**2+nearZ**2-1e-12),hi=Math.max(Math.abs(x0-x),Math.abs(x1-x))**2+Math.max(Math.abs(z0-z),Math.abs(z1-z))**2+1e-12;
        total+=Math.max(kernel(lo),kernel(hi),lo<=1/6&&hi>=1/6?kernel(1/6):0)+1e-10;
      }
      largest=Math.max(largest,total*70*Math.sqrt(2));
    }
    expect(largest).toBeGreaterThan(9.8);expect(largest).toBeLessThan(SIMPLEX_GRADIENT_BOUND);
  });
  it('encloses the actual contact-plane reach at crags, teeth, rims and angular seams',()=>{
    const t=new Terrain(LAYOUT),rng=mulberry32(823741),normal=new Vector3();
    for(let i=0;i<1500;i++){
      const s=t.islands[i%t.islands.length],a=i%7===0?Math.PI+(rng()-.5)*1e-6:rng()*Math.PI*2;
      const r=s.def.radius*(.01+1.1*rng()),x=s.def.x+r*Math.cos(a),z=s.def.z+r*Math.sin(a),q=.001+.025*rng(),radius=[.04,.09,.36][i%3];
      const floor=s.undersideContactFloor(x-q,x+q,z-q,z+q,radius);
      const coarse=s.undersideContactFloor(x-q,x+q,z-q,z+q,radius,-Infinity);
      if(floor===null)continue;
      for(const [dx,dz] of [[-q,-q],[q,q],[q,-q],[-q,q],[0,0]]){
        const px=x+dx,pz=z+dz,b=s.bottomHeight(px,pz),ny=-s.bottomNormal(px,pz,normal).y;
        expect(floor,`plane ${i}/${dx}/${dz}`).toBeLessThanOrEqual(b-radius/ny);
        if(coarse!==null)expect(coarse,`coarse plane ${i}/${dx}/${dz}`).toBeLessThanOrEqual(b-radius/ny);
        expect(t.rockContact(new Vector3(px,floor-1e-6,pz),radius,new Vector3(),new Vector3(),undefined,undefined,[{type:'island',shape:s,stamp:0}]),`empty ${i}`).toBe(false);
      }
    }
  });
  it('matches original hit, fraction, impact, normal and anchor on interrupted and boundary paths',{timeout:30000},()=>{
    const t=new Terrain(LAYOUT),fast=new TraversalWorld(t,new AnchorRegistry([],true),true),reference=new TraversalWorld(t,new AnchorRegistry([],true),false),rng=mulberry32(793120);
    for(let i=0;i<320;i++){
      const s=t.islands[i%t.islands.length],a=i%9===0?Math.PI+(rng()-.5)*1e-7:rng()*Math.PI*2;
      const r=s.def.radius*(.02+1.05*rng()),x=s.def.x+r*Math.cos(a),z=s.def.z+r*Math.sin(a),b=s.bottomHeight(x,z);
      const from=new Vector3(x,b+(i%4===0?.03:-rng()*60),z),to=from.clone().add(new Vector3((rng()-.5)*12,(rng()-.25)*80,(rng()-.5)*12));
      const radius=i%2?.08:.02,anchor=i%2?undefined:'line';
      const expected=reference.sweep(from,to,radius,anchor),actual=fast.sweep(from,to,radius,anchor);
      expect(actual,`complete parity ${i}`).toEqual(expected);
      // Repeated short/interrupted casts retain the same ordering and overlap handling.
      expect(fast.sweep(from,from.clone().lerp(to,.05),radius,anchor)).toEqual(reference.sweep(from,from.clone().lerp(to,.05),radius,anchor));
    }
  });
  it('falls back for unsupported geometry and definition revisions',()=>{
    const t=new Terrain(LAYOUT),s=t.islands[0];
    expect(s.undersideContactFloor(-.01,.01,-.01,.01,.09)).toBeNull();
    expect(s.undersideContactFloor(20,21,0,1,.09)).toBeNull();
    const filler=t.islands.find(s=>!s.def.landmark&&s.def.kind!=='roost')!;
    expect(filler.undersideContactFloor(filler.def.x+20,filler.def.x+20.01,filler.def.z,filler.def.z+.01,.09)).not.toBeNull();
    s.def.y+=1;
    expect(s.undersideContactFloor(50,50.01,0,.01,.09)).toBeNull();
    s.def.y-=1;
  });
  it('preserves thin primitive ordering, initial overlap, revisions and length exhaustion',()=>{
    const t=new Terrain({...LAYOUT,islands:[{...LAYOUT.islands[0]}],spires:[],arches:[]}),s=t.islands[0];
    const fast=new TraversalWorld(t,new AnchorRegistry([],true),true),reference=new TraversalWorld(t,new AnchorRegistry([],true),false);
    const x=s.def.radius*.35,z=0,y=s.bottomHeight(x,z);
    const thin={kind:'box' as const,x,y:y-2,z,hx:.005,hy:.001,hz:3,yaw:0};t.colliders.add(thin);
    for(const radius of [.02,.08,.35])for(const [from,to] of [
      [new Vector3(x,y-18,z),new Vector3(x+.002,y+1,z)],
      [new Vector3(x,y-2,z),new Vector3(x,y-1,z)],
      [new Vector3(x,y-.04,z),new Vector3(x,y-.03,z)],
      [new Vector3(x,y-200,z),new Vector3(x,y+1,z)],
    ])expect(fast.sweep(from,to,radius,'line')).toEqual(reference.sweep(from,to,radius,'line'));
    const a=new Vector3(x,y-18,z),b=new Vector3(x+.002,y+1,z);
    t.colliders.clear();expect(fast.sweep(a,b,.08)).toEqual(reference.sweep(a,b,.08));
    const longStart=new Vector3(x,Math.max(s.minY+1,y-80),z),longEnd=new Vector3(x+.001,y+1,z);
    const exhausted=reference.sweep(longStart,longEnd,.001);
    expect(exhausted?.exhausted).toBe(true);
    expect(fast.sweep(longStart,longEnd,.001)).toEqual(exhausted);
    s.def.seed+=1;expect(fast.sweep(a,b,.08)).toEqual(reference.sweep(a,b,.08));
  });
  it('reuses only geometry cells, invalidates changed definitions, and keeps newly inserted solids fresh',()=>{
    const t=new Terrain({...LAYOUT,islands:[{...LAYOUT.islands[0]}],spires:[],arches:[]}),s=t.islands[0];
    const fast=new TraversalWorld(t,new AnchorRegistry([],true),true),reference=new TraversalWorld(t,new AnchorRegistry([],true),false);
    const x=s.def.x+s.def.radius*.35,z=s.def.z,from=new Vector3(x,s.bottomHeight(x,z)-30,z),to=new Vector3(x+.05,s.bottomHeight(x+.05,z)+1,z+.003);
    expect(fast.sweep(from,to,.08)).toEqual(reference.sweep(from,to,.08));
    const misses=fast.certificateStats.misses,hits=fast.certificateStats.hits;
    expect(misses).toBeGreaterThan(0);
    expect(fast.sweep(from,to,.08)).toEqual(reference.sweep(from,to,.08));
    expect(fast.certificateStats.misses).toBe(misses);expect(fast.certificateStats.hits).toBeGreaterThan(hits);
    t.colliders.add({kind:'box',x,y:from.y+2,z,hx:2,hy:.001,hz:2,yaw:0});
    const blocked=fast.sweep(from,to,.08);expect(blocked).toEqual(reference.sweep(from,to,.08));expect(blocked!.fraction).toBeLessThan(.1);
    t.colliders.clear();s.def.y+=1;
    expect(fast.sweep(from,to,.08)).toEqual(reference.sweep(from,to,.08));expect(fast.certificateStats.definitionChanges).toBe(1);
    s.def.y-=1;
    expect(fast.sweep(from,to,.08)).toEqual(reference.sweep(from,to,.08));expect(fast.certificateStats.definitionChanges).toBe(2);
    fast.clearGeometryCertificates();const cold=fast.certificateStats.misses;
    expect(fast.sweep(from,to,.08)).toEqual(reference.sweep(from,to,.08));expect(fast.certificateStats.misses).toBeGreaterThan(cold);
  });
  it('keeps original contact ordering across cell boundaries, eviction and repopulation',{timeout:30000},()=>{
    const t=new Terrain({...LAYOUT,islands:[{...LAYOUT.islands[0]}],spires:[],arches:[]}),s=t.islands[0];
    const fast=new TraversalWorld(t,new AnchorRegistry([],true),true),reference=new TraversalWorld(t,new AnchorRegistry([],true),false);
    const path=(i:number)=>{const x=s.def.x+30+i*.037,z=s.def.z-.025+i*.0001,b=s.bottomHeight(x,z);return [new Vector3(x,b-20,z),new Vector3(x+.03,b+1,z+.02)] as const;};
    const first=path(0),expected=reference.sweep(...first,.02,'line');expect(fast.sweep(...first,.02,'line')).toEqual(expected);
    // Check contact ordering across cells, then cross the real production FIFO limit
    // with short empty sweeps. Long contact sweeps add no eviction coverage but can
    // exceed CI's timeout while duplicating the 320-path contact suite above.
    for(let i=1;i<96;i++){const p=path(i);expect(fast.sweep(...p,.02,'line'),`contact parity ${i}`).toEqual(reference.sweep(...p,.02,'line'));}
    for(let i=0;i<16500;i++){
      const from=new Vector3(64.01+(i%160)*.04,s.minY+1,-2.39+Math.floor(i/160)*.04),to=from.clone().add(new Vector3(.001,0,.001));
      const original=reference.sweep(from,to,.02,'line');expect(original).toBeNull();expect(fast.sweep(from,to,.02,'line'),`empty cell ${i}`).toEqual(original);
    }
    expect(fast.certificateStats.misses).toBeGreaterThan(16384);
    const before=fast.certificateStats.misses;expect(fast.sweep(...first,.02,'line')).toEqual(expected);expect(fast.certificateStats.misses).toBeGreaterThan(before);
  });
});
