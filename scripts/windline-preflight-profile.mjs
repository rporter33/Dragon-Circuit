// Paired COMPLETE fresh preflights at changing poses. No cached/checking calls are averaged.
// The draft bounds candidate is opt-in; this script does not enable it in normal gameplay.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {browserEvidence} from './browser-evidence.mjs';
const url=new URL(process.argv[2]??'http://127.0.0.1:5175/');url.search='?manual=1&quality=low';
const out=process.argv.find(a=>a.startsWith('--output='))?.slice(9)??'/tmp/driftwing-complete-preflight-browser-check.json';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl']});
const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(url.href);await page.waitForFunction(()=>window.__dw?.ready,null,{timeout:180000});
 const metadata=await browserEvidence(page,url);
 const result=await page.evaluate(()=>{
  const g=__dw.game,p=g.player,w=p.skyLance.world,t=g.world.terrain,v=g.skyLanceVisuals,s=t.islands[0];g.startGame();g.save.data.firstLeadGuide='skipped';
  const originalMode=w.localUndersideBounds,sweep=w.sweep,rock=t.rockContact;let active=null,layer='';
  w.sweep=function(...args){layer=active?.first?'centreRay':args[2]===.02?'tether':'projectile';if(active)active.first=false;const slot=active?.layers[layer],start=performance.now();try{return sweep.apply(this,args);}finally{if(slot){slot.ms+=performance.now()-start;slot.sweeps++;}}};
  t.rockContact=function(...args){if(active)active.layers[layer].rockQueries++;return rock.apply(this,args);};
  const stat=values=>{const a=values.slice().sort((a,b)=>a-b);return {mean:a.reduce((a,b)=>a+b,0)/a.length,p95:a[Math.floor(a.length*.95)],max:a.at(-1)};};
  const target=()=>v.target?{state:v.target.state,anchor:v.target.anchorId,distance:v.target.distance,impact:v.target.point?.toArray()??null}:null;
  const cases=[],mismatches=[];
  try{for(const depth of [18,45,55]){
   g.placeAtSpawn();const x=s.def.x+s.def.radius*.35,z=s.def.z;p.foot.position.set(x,s.bottomHeight(x,z)-depth,z);p.foot.grounded=false;p.foot.velocity.set(0,0,0);g.frame(1/120,false);g.frame(1/120,false);g.cameraRig.snap(p);g.input.setScripted({lookActive:true,lookIsRate:false,lookX:g.cameraRig.yaw+Math.PI/2,lookY:-10});g.frame(1/120,false);g.input.setScripted(null);
   const feet=p.foot.position.clone(),camera=g.camera.position.clone(),quaternion=g.camera.quaternion.clone();
   const records={reference:[],candidate:[]};
   for(let i=-8;i<80;i++){
    const move=(i+9)*.001;p.foot.position.copy(feet);p.foot.position.x+=move;p.foot.position.z+=.002*Math.sin(i/8);p.foot.velocity.set(.1*Math.sin(i/17),-.2-.002*i,.08*Math.cos(i/13));
    g.camera.position.copy(camera);g.camera.position.x+=move;g.camera.position.z+=.002*Math.sin(i/8);g.camera.quaternion.copy(quaternion);g.camera.rotateY(.003*Math.sin(i/20));g.camera.updateMatrixWorld();
    const pair={};
    for(const mode of i%2?['reference','candidate']:['candidate','reference']){
     w.localUndersideBounds=mode==='candidate';const layers=Object.fromEntries(['centreRay','projectile','tether'].map(k=>[k,{ms:0,sweeps:0,rockQueries:0}]));active={first:true,layers};v.nextPreview=0;
     const start=performance.now();v.updateReticle(g.camera,p.foot.position,p.foot.velocity,p.skyLance);const ms=performance.now()-start;active=null;pair[mode]=target();
     if(i>=0)records[mode].push({ms,layers});
    }
    if(JSON.stringify(pair.reference)!==JSON.stringify(pair.candidate))mismatches.push({depth,index:i,...pair});
   }
   cases.push({depth,movingPoses:80,poseChangePerQueryMeters:.001,target:target(),reference:summary(records.reference),candidate:summary(records.candidate)});
  }}finally{active=null;w.sweep=sweep;t.rockContact=rock;w.localUndersideBounds=originalMode;}
  function summary(rows){return {completeMs:stat(rows.map(r=>r.ms)),layers:Object.fromEntries(['centreRay','projectile','tether'].map(k=>[k,{ms:stat(rows.map(r=>r.layers[k].ms)),sweeps:stat(rows.map(r=>r.layers[k].sweeps)),rockQueries:stat(rows.map(r=>r.layers[k].rockQueries))}]))};}
  return {cases,mismatches,normalBoundsEnabled:originalMode,ship:!!g.scene.getObjectByName('Windhaven'),errors:__dw.errors};
 });
 result.metadata=metadata;result.pageErrors=errors;result.budgetMs=2.5;result.candidateBudgetPass=result.cases.every(c=>c.candidate.completeMs.mean<=2.5);
 fs.writeFileSync(out,JSON.stringify(result,null,2));
 assert.deepEqual(errors,[]);assert.deepEqual(result.errors,[]);assert.deepEqual(result.mismatches,[]);assert.equal(result.ship,false);assert.equal(result.normalBoundsEnabled,false);
 assert.ok(result.cases.every(c=>c.target.state==='reachable'));
 console.log(JSON.stringify({output:out,budgetPass:result.candidateBudgetPass,cases:result.cases.map(c=>({depth:c.depth,reference:c.reference.completeMs,candidate:c.candidate.completeMs,rockQueries:Object.fromEntries(Object.entries(c.candidate.layers).map(([k,v])=>[k,v.rockQueries]))}))},null,2));
 if(process.argv.includes('--assert-budget'))assert.equal(result.candidateBudgetPass,true,'Complete fresh-query mean must be <=2.5 ms at every depth');
}finally{await browser.close();}
