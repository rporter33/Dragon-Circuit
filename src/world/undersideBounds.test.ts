import {describe,it,expect} from 'vitest';
import {Vector3} from 'three';
import {Terrain} from './terrain';
import {LAYOUT} from './layout';
import {mulberry32} from '../core/rng';
import {TraversalWorld} from '../traversal/sweep';
import {AnchorRegistry} from '../traversal/anchors';

describe('query-local underside empty-space certificates',()=>{
  it('encloses the actual contact-plane reach at crags, teeth, rims and angular seams',()=>{
    const t=new Terrain(LAYOUT),rng=mulberry32(823741),normal=new Vector3();
    const authored=t.islands.filter(s=>s.def.landmark||s.def.kind==='roost');
    for(let i=0;i<1500;i++){
      const s=authored[i%authored.length],a=i%7===0?Math.PI+(rng()-.5)*1e-6:rng()*Math.PI*2;
      const r=s.def.radius*(.01+1.1*rng()),x=s.def.x+r*Math.cos(a),z=s.def.z+r*Math.sin(a),q=.001+.025*rng(),radius=[.04,.09,.36][i%3];
      const floor=s.undersideContactFloor(x-q,x+q,z-q,z+q,radius);
      if(floor===null)continue;
      for(const [dx,dz] of [[-q,-q],[q,q],[q,-q],[-q,q],[0,0]]){
        const px=x+dx,pz=z+dz,b=s.bottomHeight(px,pz),ny=-s.bottomNormal(px,pz,normal).y;
        expect(floor,`plane ${i}/${dx}/${dz}`).toBeLessThanOrEqual(b-radius/ny);
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
    expect(filler.undersideContactFloor(filler.def.x+20,filler.def.x+20.01,filler.def.z,filler.def.z+.01,.09)).toBeNull();
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
});
