// Fixed screen-centre feedback, fresh physical casts and bounded preview CPU.
// Uses the ordinary Game and existing Roost. Standard controller input is simulated.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {browserEvidence} from './browser-evidence.mjs';
const url=new URL(process.argv[2]??'http://127.0.0.1:5175/');url.search='?manual=1&quality=low';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl']});
const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[],evidence={captures:[]};let metadata=null;
page.on('pageerror',e=>errors.push(e.message));fs.mkdirSync('shots/windline-reticle',{recursive:true});
const cue=()=>page.locator('#sky-lance-reticle').evaluate(el=>{const r=el.getBoundingClientRect();return {target:el.dataset.target,color:getComputedStyle(el).color.replaceAll(' ',''),ring:getComputedStyle(el.querySelector('[data-valid-ring]')).opacity,centre:[r.left+r.width/2,r.top+r.height/2],size:[r.width,r.height],viewport:[innerWidth,innerHeight]};});
async function capture(name,clip){const path=`shots/windline-reticle/${name}.png`;await page.screenshot({path,...(clip?{clip}:{})});evidence.captures.push({path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')});}
async function readyPose(depth=18){await page.evaluate(depth=>{
 const g=__dw.game,p=g.player,s=g.world.terrain.islands[0],x=s.def.x+s.def.radius*.35,z=s.def.z;
 __reticlePad.buttons[7]={pressed:false,touched:false,value:0};g.placeAtSpawn();p.foot.position.set(x,s.bottomHeight(x,z)-depth,z);p.foot.grounded=false;p.foot.velocity.set(0,0,0);g.frame(1/120,false);g.cameraRig.snap(p);
 g.input.setScripted({lookActive:true,lookIsRate:false,lookX:g.cameraRig.yaw+Math.PI/2,lookY:-10});g.frame(1/120,false);g.input.setScripted(null);
 for(let i=0;i<60;i++)g.frame(1/120,false);g.skyLanceVisuals.nextPreview=0;g.frame(0,true);
 },depth);}
try{
 await page.goto(url.href);await page.waitForFunction(()=>window.__dw?.ready,null,{timeout:180000});metadata=await browserEvidence(page,url);
 await page.evaluate(()=>{
  const g=__dw.game;g.save.data.firstLeadGuide='skipped';g.startGame();__dw.advance(.1);g.applySettings({...g.settings,reducedMotion:true});
  const pad=window.__reticlePad={id:'Xbox standard controller reticle QA',mapping:'standard',connected:true,index:0,timestamp:0,axes:[.3,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,touched:false,value:0}))};
  Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[pad]});g.frame(1/120,false);pad.axes[0]=0;g.frame(1/120,false);
 });
 evidence.green=[];
 for(const [width,height] of [[1280,720],[1920,1080],[617,380]]){
  await page.setViewportSize({width,height});await readyPose();const c=await cue();evidence.green.push(c);
  assert.equal(c.target,'reachable');assert.equal(c.color,'rgb(148,214,162)');assert.equal(c.ring,'1');assert.deepEqual(c.size,[20,20]);
  assert.ok(Math.abs(c.centre[0]-width/2)<.25&&Math.abs(c.centre[1]-height/2)<.25);
  await capture(`green-${width}`);if(width===1280)await capture('green-dot-zoom-source',{x:width/2-14,y:height/2-14,width:28,height:28});
 }
 await page.setViewportSize({width:1280,height:720});
 await page.evaluate(()=>{const g=__dw.game,p=g.player;g.placeAtSpawn();p.foot.position.set(5000,1000,5000);p.foot.grounded=false;p.foot.velocity.set(0,0,0);g.frame(1/120,false);g.cameraRig.snap(p);g.skyLanceVisuals.nextPreview=0;g.frame(0,true);});
 evidence.blue=await cue();assert.equal(evidence.blue.target,'out-of-range');assert.equal(evidence.blue.color,'rgb(168,221,236)');assert.equal(evidence.blue.ring,'0');
 await capture('blue-1280');await capture('blue-dot-zoom-source',{x:626,y:346,width:28,height:28});
 await readyPose();
 evidence.budget=await page.evaluate(()=>{
  const g=__dw.game,p=g.player,v=g.skyLanceVisuals,w=p.skyLance.world,original=w.sweep,position=p.foot.position.clone();let queried=false,forecasts=0;
  w.sweep=function(...args){queried=true;return original.apply(this,args);};const start=performance.now();
  try{for(let i=0;i<100;i++){queried=false;p.foot.position.x+=.001;v.updateReticle(g.camera,p.foot.position,p.foot.velocity,p.skyLance);if(queried)forecasts++;}}
  finally{w.sweep=original;p.foot.position.copy(position);}
  const elapsed=performance.now()-start;v.nextPreview=performance.now()+500;p.foot.position.x+=1;v.updateReticle(g.camera,p.foot.position,p.foot.velocity,p.skyLance);
  const el=document.querySelector('#sky-lance-reticle'),invalidated={target:el.dataset.target,valid:el.classList.contains('is-valid'),color:getComputedStyle(el).color};p.foot.position.copy(position);
  return {calls:100,forecasts,elapsed,invalidated};
 });
 assert.ok(evidence.budget.forecasts<=Math.ceil(evidence.budget.elapsed/50)+2,'20 Hz forecast budget despite changing poses');
 assert.equal(evidence.budget.invalidated.target,'checking');assert.equal(evidence.budget.invalidated.valid,false);
 await readyPose();
 evidence.cast=await page.evaluate(()=>{
  const g=__dw.game,p=g.player,target=g.skyLanceVisuals.target,point=target.point.clone(),anchor=target.anchorId;
  __reticlePad.buttons[7]={pressed:true,touched:true,value:.8};let steps=0;g.frame(1/120,false);steps++;
  while(steps<240&&p.skyLance.state==='projectile'){g.frame(1/120,false);steps++;}
  return {anchor,actualAnchor:p.skyLance.anchorId,attached:!!p.skyLance.rope,impactError:p.skyLance.position.distanceTo(point),seconds:steps/120,ship:!!g.scene.getObjectByName('Windhaven')};
 });
 assert.equal(evidence.cast.attached,true);assert.equal(evidence.cast.actualAnchor,evidence.cast.anchor);assert.ok(evidence.cast.impactError<.16);assert.equal(evidence.cast.ship,false);
 const attached=await cue();assert.equal(attached.target,'attached');assert.equal(attached.color,'rgb(168,221,236)');assert.equal(attached.ring,'0');
 // Combine moving look, real centred RT casting and a long retained swing. CPU
 // timings exclude renderer submission; they do not certify physical frame rate.
 await readyPose(45);
 evidence.movingCamera=await page.evaluate(()=>{
  const g=__dw.game,p=g.player,v=g.skyLanceVisuals,original=v.updateReticle;let active=null;
  v.updateReticle=function(...args){const start=performance.now(),before=this.nextPreview;try{return original.apply(this,args);}finally{if(active){active.reticleMs+=performance.now()-start;if(p.skyLance.state==='ready'&&this.nextPreview!==before)active.forecasts++;}}};
  const tick=(input={})=>{g.input.setScripted(input);g.frame(1/120,false);g.input.setScripted(null);};
  const sample=(n,held)=>{
   active={frames:[],reticleMs:0,forecasts:0};const start=performance.now();
   for(let i=0;i<n;i++){const step=performance.now();tick({lanceHeld:held,lookActive:true,lookIsRate:true,lookX:.35*Math.sin(i/30),lookY:.08*Math.sin(i/45),...(held?{foot:{moveX:.25,moveY:0,sprint:false}}:{})});active.frames.push(performance.now()-step);}
   const d=active;active=null;const elapsed=performance.now()-start,sorted=d.frames.sort((a,b)=>a-b);
   return {samples:n,elapsedMs:elapsed,meanMs:sorted.reduce((a,b)=>a+b,0)/n,p95Ms:sorted[Math.floor(n*.95)],maxMs:sorted[n-1],reticlePerStepMs:d.reticleMs/n,forecasts:d.forecasts};
  };
  try{
   const ready=sample(120,false),s=g.world.terrain.islands[0],x=s.def.x+s.def.radius*.35,z=s.def.z;
   __reticlePad.buttons[7]={pressed:false,touched:false,value:0};g.placeAtSpawn();p.foot.position.set(x,s.bottomHeight(x,z)-45,z);p.foot.grounded=false;p.foot.velocity.set(0,0,0);tick();g.cameraRig.snap(p);
   tick({lookActive:true,lookIsRate:false,lookX:g.cameraRig.yaw+Math.PI/2,lookY:-10});for(let i=0;i<60;i++)tick();v.nextPreview=0;g.frame(0,false);
   const candidate=v.target?.anchorId,cue=v.target?.state;__reticlePad.buttons[7]={pressed:true,touched:true,value:.8};g.frame(1/120,false);
   for(let i=0;i<240&&p.skyLance.state==='projectile';i++)g.frame(1/120,false);
   if(!p.skyLance.rope)throw Error('Long centred cast failed: '+p.skyLance.reason);
   const anchor=p.skyLance.anchorId,length=p.skyLance.rope.length,hanging=sample(360,true);p.foot.velocity.set(8,0,4);
   const swinging=sample(480,true),retained=!!p.skyLance.rope,yaw=g.cameraRig.yaw;
   __reticlePad.buttons[7]={pressed:false,touched:false,value:0};g.frame(1/120,false);const released=sample(180,false);
   return {ready,candidate,cue,anchor,length,hanging,swinging,retained,released,releasedRope:!!p.skyLance.rope,yaw};
  }finally{v.updateReticle=original;}
 });
 const moving=evidence.movingCamera;
 assert.equal(moving.cue,'reachable');assert.equal(moving.candidate,moving.anchor);assert.ok(moving.length>45&&moving.length<=65);
 assert.equal(moving.retained,true);assert.equal(moving.releasedRope,false);
 assert.ok(moving.ready.forecasts<=Math.ceil(moving.ready.elapsedMs/50)+2,'moving-camera ready forecast budget');
 assert.ok(moving.ready.reticlePerStepMs<2.5,'bounded ready preview average CPU cost');
 assert.equal(moving.swinging.forecasts,0,'attached line never runs a ready-target forecast');
 assert.ok(moving.swinging.p95Ms<20,'sustained moving-camera swing CPU budget');
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>__dw.errors),[]);
 console.log('Fixed-dot and fresh controller cast checks passed:',JSON.stringify(evidence));
}finally{fs.writeFileSync('/tmp/driftwing-windline-reticle-browser-check.json',JSON.stringify({metadata,evidence,errors},null,2));await browser.close();}
