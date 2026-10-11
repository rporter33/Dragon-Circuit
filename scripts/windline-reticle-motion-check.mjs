// Actual Game RAF/input/physics/camera/DOM evidence. Software 3D and painted-UI
// phases are reported separately; suppressing 3D submission cannot certify GPU FPS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {browserEvidence} from './browser-evidence.mjs';
const url=new URL(process.argv[2]??'http://127.0.0.1:5175/');url.search='?debug=1&quality=low';
const out='/tmp/driftwing-reticle-motion-browser-check.json',shots='shots/windline-reticle-motion';fs.mkdirSync(shots,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl']});
const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[],evidence={phases:[]};
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(url.href);await page.waitForFunction(()=>window.__dw?.ready&&!document.querySelector('#boot:not(.done)'),null,{timeout:180000});evidence.metadata=await browserEvidence(page,url);
 await page.evaluate(()=>{
  const g=__dw.game,p=g.player,v=g.skyLanceVisuals;g.startGame();g.save.data.firstLeadGuide='skipped';g.applySettings({...g.settings,reducedMotion:true});
  const pad=window.__motionPad={id:'Xbox standard controller movement QA',index:0,mapping:'standard',connected:true,timestamp:0,axes:[.9,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,touched:false,value:0}))};
  Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[pad]});g.frame(1/120,false);pad.axes[0]=0;g.frame(1/120,false);
  window.__motionPhase=null;
  const update=v.updateReticle.bind(v);v.updateReticle=(...args)=>{const start=performance.now();try{return update(...args);}finally{const phase=window.__motionPhase;if(phase){phase.lastQueryMs=performance.now()-start;phase.reticleMs+=phase.lastQueryMs;phase.updates++;if(p.skyLance.state==='ready')phase.forecasts++;}}};
  const render=g.renderer.render.bind(g.renderer);g.renderer.render=(...args)=>{
   const phase=window.__motionPhase;if(!phase?.uiOnly)render(...args);
   if(phase){const now=performance.now(),el=document.querySelector('#sky-lance-reticle'),t=v.target;phase.frames.push({ms:now,queryMs:phase.lastQueryMs,state:el.dataset.target,valid:el.classList.contains('is-valid'),target:t?{state:t.state,anchor:t.anchorId,distance:t.distance,point:t.point.toArray()}:null,feet:p.foot.position.toArray(),velocity:p.foot.velocity.toArray(),camera:g.camera.position.toArray(),quaternion:g.camera.quaternion.toArray(),yaw:g.cameraRig.yaw,revision:p.skyLance.world.revision});
    // Exercise the native standard-pad path above its deadzones. Alternate small
    // real look/steer inputs so the continuously eligible target remains in view.
    if(phase.uiOnly){const sign=Math.floor((now-phase.start)/120)%2?1:-1;__motionPad.axes[2]=sign*.22;__motionPad.axes[0]=sign*.22;}
   }
  };
 });
 assert.equal(await page.evaluate(()=>__dw.game.input.device),'gamepad');
 for(const scenario of ['stationary-software-3d','freefall-software-3d','freefall-look-painted-ui']){
  const initial=await page.evaluate(scenario=>{
   window.__motionPhase=null;const g=__dw.game,p=g.player,pad=__motionPad,s=g.world.terrain.islands[0];pad.axes.fill(0);g.debug.freeze=false;g.cameraRig.setOverride(null);g.placeAtSpawn();g.startGame();
   const x=s.def.x+s.def.radius*.35,z=s.def.z;p.foot.position.set(x,s.bottomHeight(x,z)-18,z);p.foot.grounded=false;p.foot.velocity.set(0,0,0);
   g.frame(1/120,false);g.frame(1/120,false);g.cameraRig.snap(p);g.input.setScripted({lookActive:true,lookIsRate:false,lookX:g.cameraRig.yaw+Math.PI/2,lookY:-10});g.frame(1/120,false);g.input.setScripted(null);
   if(scenario.startsWith('stationary')){g.debug.freeze=true;g.cameraRig.setOverride({position:g.camera.position.clone(),target:g.camera.position.clone().addScaledVector(g.camera.getWorldDirection(p.foot.position.clone()),100)});}
   if(scenario.includes('painted-ui')){pad.axes[2]=.22;pad.axes[0]=.22;}
   g.skyLanceVisuals.nextPreview=0;g.frame(0,true);
   window.__motionPhase={scenario,uiOnly:scenario.includes('painted-ui'),frames:[],reticleMs:0,updates:0,forecasts:0,start:performance.now()};
   return {cue:document.querySelector('#sky-lance-reticle').dataset.target,ship:!!g.scene.getObjectByName('Windhaven')};
  },scenario);
  // Let already submitted software-3D work drain before the UI-only measurement.
  // The initial complete validation is separately included in the cold/query profile.
  if(scenario.includes('painted-ui')){await page.waitForTimeout(500);await page.evaluate(()=>{const p=window.__motionPhase;p.frames=[];p.reticleMs=0;p.updates=0;p.forecasts=0;p.start=performance.now();p.settlingMs=500;});}
  await page.waitForTimeout(scenario.includes('painted-ui')?2000:4000);
  const data=await page.evaluate(()=>{const phase=window.__motionPhase;window.__motionPhase=null;phase.end=performance.now();return phase;});
  await page.screenshot({path:`${shots}/${scenario}.png`});
  // Replay every captured current pose against the complete original adapter after
  // timing/painting. No reference-query time is hidden inside the measured RAF phase.
  const parity=await page.evaluate(frames=>{
   const g=__dw.game,p=g.player,v=g.skyLanceVisuals,w=p.skyLance.world,feet=p.foot.position.clone(),velocity=p.foot.velocity.clone(),camera=g.camera.position.clone(),quaternion=g.camera.quaternion.clone(),mode=w.localUndersideBounds;
   const mismatches=[];try{w.localUndersideBounds=false;for(const [i,f] of frames.entries()){
    p.foot.position.fromArray(f.feet);p.foot.velocity.fromArray(f.velocity);g.camera.position.fromArray(f.camera);g.camera.quaternion.fromArray(f.quaternion);g.camera.updateMatrixWorld();v.nextPreview=0;v.updateReticle(g.camera,p.foot.position,p.foot.velocity,p.skyLance);
    const t=v.target,reference=t?{state:t.state,anchor:t.anchorId,distance:t.distance,point:t.point.toArray()}:null;
    if(JSON.stringify(reference)!==JSON.stringify(f.target)||f.valid!==(reference?.state==='reachable'))mismatches.push({index:i,reference,actual:f.target,green:f.valid});
   }}finally{w.localUndersideBounds=mode;p.foot.position.copy(feet);p.foot.velocity.copy(velocity);g.camera.position.copy(camera);g.camera.quaternion.copy(quaternion);g.camera.updateMatrixWorld();v.nextPreview=0;v.updateReticle(g.camera,p.foot.position,p.foot.velocity,p.skyLance);}
   return {mismatches,checked:frames.length,geometryStable:frames.every(f=>f.revision===w.revision)};
  },data.frames);
  const frames=data.frames,span=data.end-data.start,green=frames.filter(f=>f.valid).length,checking=frames.filter(f=>f.state==='checking').length,intervals=frames.slice(1).map((f,i)=>f.ms-frames[i].ms).sort((a,b)=>a-b);
  let transitions=0;for(let i=1;i<frames.length;i++)if(frames[i].valid!==frames[i-1].valid)transitions++;
  const extent=values=>Math.max(...values)-Math.min(...values),yawSpan=extent(frames.map(f=>f.yaw)),horizontalSpan=Math.hypot(extent(frames.map(f=>f.feet[0])),extent(frames.map(f=>f.feet[2]))),verticalSpan=extent(frames.map(f=>f.feet[1]));
  const summary={scenario,uiOnly:data.uiOnly,settlingMs:data.settlingMs??0,elapsedMs:span,frames:frames.length,callbacksPerSecond:frames.length/span*1000,green,checking,validityTransitions:transitions,reticleMsPerUpdate:data.reticleMs/data.updates,forecasts:data.forecasts,yawSpan,horizontalSpan,verticalSpan,p50CallbackMs:intervals[Math.floor(intervals.length*.5)],p95CallbackMs:intervals[Math.floor(intervals.length*.95)]};
  evidence.phases.push({initial,summary,parity,frames});console.log('Movement cue:',JSON.stringify(summary));
  assert.equal(initial.ship,false);assert.equal(initial.cue,'reachable');assert.ok(frames.length>10);assert.equal(checking,0);assert.equal(parity.geometryStable,true);assert.deepEqual(parity.mismatches,[]);
  if(data.uiOnly){assert.ok(summary.callbacksPerSecond>=45,'high-refresh painted UI callback rate');assert.equal(green,frames.length,'continuously eligible moving poses stay green');assert.equal(transitions,0);assert.ok(summary.reticleMsPerUpdate<=2.5,'complete current-query mean budget');assert.ok(yawSpan>.005,'native right stick produces real camera yaw');assert.ok(horizontalSpan>.01,'native left stick produces real steering');assert.ok(verticalSpan>.1,'actual falling poses move');}
 }
 evidence.errors=errors;assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>__dw.errors),[]);
}finally{fs.writeFileSync(out,JSON.stringify(evidence,null,2));await browser.close();}
