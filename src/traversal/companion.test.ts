import {describe,it,expect} from 'vitest';
import {Vector3 as V} from 'three';
import {Player} from '../player/Player';
import {Terrain} from '../world/terrain';
import {LAYOUT} from '../world/layout';
import {EventBus} from '../core/events';
import type {GameEvents} from '../core/types';
import {emptyFrame} from '../input/Input';
import {Wyvern} from '../creatures/wyvern/Wyvern';
import {look} from '../creatures/wyvern/wyvern.testkit';
import {TraversalWorld} from './sweep';
const dt=1/120;
describe('lower-island companion arrival',()=>{
  it.each(['harrier','skimmer','galewing','ironback'] as const)('%s keeps limbs below the body during steep descent and replants once on arrival',breed=>{
    const t=new Terrain({...LAYOUT,islands:[],spires:[],arches:[]});
    t.colliders.add({kind:'box',x:5000,y:999,z:5000,hx:30,hy:1,hz:25,yaw:0});
    t.colliders.add({kind:'box',x:5000,y:799,z:5070,hx:30,hy:1,hz:30,yaw:0});
    const p=new Player({terrain:t,env:{terrain:t,windAt:(_p,out)=>out.set(0,0,0)},events:new EventBus<GameEvents>(),breed});
    p.enableSkyLance(new TraversalWorld(t));p.teleport(new V(5000,1000,5000),0,'onFoot');
    const w=new Wyvern(look(breed),{terrain:t});
    const tick=()=>{const input=emptyFrame();p.latchPresses(input);p.fixedUpdate(dt,input,0);p.update(dt,1);w.update(dt,p.wyvernPose);};
    for(let i=0;i<120;i++)tick();
    p.foot.position.set(5000,800,5070);p.foot.velocity.set(0,0,0);p.foot.grounded=true;p.companion.called=true;tick();
    expect(p.companion.state).toBe('hop');const contact=p.wyvernPose.touchdown!.id;
    const bones=w.skinnedMesh!.skeleton.bones,world=(name:string)=>bones.find(b=>b.name===name)!.getWorldPosition(new V());
    let checked=0;
    for(let i=0;i<620;i++){
      tick();const c=p.companion;
      if(c.state==='hop' && p.model.state.velocity.y < -10 && i>180 && i<500){
        expect(p.wyvernPose.airborne).toBe(true);
        // Root stays upright; hind feet reach downward instead of tucking above a steeply diving torso.
        expect(new V(0,1,0).applyQuaternion(p.wyvernPose.orientation).y).toBeGreaterThan(.8);
        for(const side of ['L','R'])expect(world(`meta${side}`).y).toBeLessThan(world(`thigh${side}`).y);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);expect(p.companion.state).toBe('idle');expect(p.wyvernPose.airborne).toBe(false);
    expect(p.wyvernPose.touchdown!.id).toBe(contact+1);
    // Allow the existing settle spring and corrective foot steps to finish; do not demand
    // a fully planted idle pose 0.16 seconds after a 200 m hop.
    for(let i=0;i<240;i++)tick();
    const points=Array.from({length:4},()=>new V()),weights:number[]=[];w.footContacts(points,weights);
    for(const point of points)expect(Math.abs(point.y-800)).toBeLessThan(.1);
    for(const side of ['L','R'])expect(world(`hand${side}`).y).toBeLessThan(world(`humerus${side}`).y);
    w.dispose();
  });
});
