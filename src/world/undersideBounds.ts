import {smoothstep} from '../core/math';
import type {Noise2} from '../core/noise';

type I = readonly [number,number];
// Outward rounding at every operation; unsupported or large domains use the full sweep.
const box = (lo:number,hi:number): I => {const e=1e-12*(1+Math.max(Math.abs(lo),Math.abs(hi)));return [lo-e,hi+e];};
const add=(a:I,b:I):I=>box(a[0]+b[0],a[1]+b[1]);
const scale=(a:I,b:number):I=>b>=0?box(a[0]*b,a[1]*b):box(a[1]*b,a[0]*b);
const mul=(a:I,b:I):I=>{const v=[a[0]*b[0],a[0]*b[1],a[1]*b[0],a[1]*b[1]];return box(Math.min(...v),Math.max(...v));};
const square=(a:I):I=>box(a[0]<=0&&a[1]>=0?0:Math.min(a[0]*a[0],a[1]*a[1]),Math.max(a[0]*a[0],a[1]*a[1]));
const ss=(a:I,lo:number,hi:number):I=>box(smoothstep(lo,hi,a[0]),smoothstep(lo,hi,a[1]));
const pow=(a:I,p:number):I=>box(Math.pow(Math.max(0,a[0]),p),Math.pow(Math.max(0,a[1]),p));
const constant=(v:number):I=>[v,v];

/** simplex-noise 4.x uses three kernels 70 (1/2-|q|²)^4 g·q, |g|<=sqrt(2).
 * Each gradient has norm <=70 sqrt(2)/16; their sum is <19. We use 24,
 * including across cell/support seams. This bounds the actual seeded function. */
function noise(n:Noise2,x:I,z:I):I {
  const cx=(x[0]+x[1])/2,cz=(z[0]+z[1])/2;
  const radius=Math.hypot((x[1]-x[0])/2,(z[1]-z[0])/2),v=n(cx,cz);
  return box(v-24*radius,v+24*radius);
}
function softRidge(n:Noise2,x:I,z:I):I {
  const ridge=(v:I)=>square(add(constant(1),scale(pow(add(square(v),constant(.03)),.5),-1)));
  const a=ridge(noise(n,x,z)),b=ridge(noise(n,add(scale(x,2.03),constant(5.3)),add(scale(z,2.03),constant(-2.1))));
  return scale(add(scale(a,.67),scale(b,.33)),1/((1-Math.sqrt(.03))**2));
}

export interface AuthoredUnderside {
  x:number;z:number;y:number;radius:number;outline:number;depth:number;lip:number;
  ridgeFreq:number;lumpFreq:number;toothCell:number;
  outlineRadius:(theta:number)=>number;noise:Noise2;tooth:(dx:number,dz:number)=>number;
}
/** Natural interval extension of the existing authored bottomHeight, over an XZ box.
 * Filler deformation, the origin singularity and broad queries remain unsupported. */
export function authoredBottomBounds(s:AuthoredUnderside,minX:number,maxX:number,minZ:number,maxZ:number):I|null {
  const dx=(minX+maxX)/2-s.x,dz=(minZ+maxZ)/2-s.z;
  const q=Math.hypot((maxX-minX)/2,(maxZ-minZ)/2),r=Math.hypot(dx,dz);
  if(![dx,dz,q,r,s.depth,s.lip].every(Number.isFinite)||q>.1||r<=q+1e-6||r>1e5||s.depth<s.lip||s.outline<0||s.outline>=1)return null;
  const theta=Math.atan2(dz,dx),angle=Math.asin(Math.min(1,q/r))+1e-12;
  const outline=s.outlineRadius(theta),dr=s.radius*s.outline*6*angle;
  const R=box(Math.max(s.radius*(1-s.outline),outline-dr),Math.min(s.radius*(1+s.outline),outline+dr));
  if(R[0]<=0)return null;
  const radial=box(Math.min(1,Math.max(0,r-q)/R[1]),Math.min(1,(r+q)/R[0]));
  const profile=pow(add(constant(1),scale(square(radial),-1)),.6);
  const cos=box(Math.max(-1,Math.cos(theta)-angle),Math.min(1,Math.cos(theta)+angle));
  const sin=box(Math.max(-1,Math.sin(theta)-angle),Math.min(1,Math.sin(theta)+angle));
  const ridge=add(constant(.5),mul(add(softRidge(s.noise,add(scale(cos,s.ridgeFreq),scale(radial,1.7)),add(scale(sin,s.ridgeFreq),scale(radial,-1.3))),constant(-.5)),ss(radial,.03,.3)));
  const nx=box((minX-s.x)*s.lumpFreq+31.7,(maxX-s.x)*s.lumpFreq+31.7),nz=box((minZ-s.z)*s.lumpFreq-12.3,(maxZ-s.z)*s.lumpFreq-12.3);
  const lump=add(constant(.5),scale(add(noise(s.noise,nx,nz),scale(noise(s.noise,scale(nx,2),scale(nz,2)),.5)),1/3));
  // Every tooth cone is 6.25/cell Lipschitz; max and zero extension preserve it.
  const tooth=s.tooth(dx,dz),te=6.25/s.toothCell*q;
  const teeth=mul(mul(box(Math.max(0,tooth-te),Math.min(1,tooth+te)),ss(profile,.05,.35)),ss(radial,.06,.2));
  const cone=add(constant(.72),scale(pow(add(constant(1),scale(ss(radial,0,1),-1)),1.5),.46));
  const toothLen=box(Math.min(.26,1.3-cone[1]),Math.min(.26,1.3-cone[0]));
  const stal0=add(mul(cone,add(constant(.74),scale(add(scale(ridge,.6),scale(lump,.4)),.26))),mul(toothLen,teeth));
  const stal=box(Math.min(1.3,stal0[0]),Math.min(1.3,stal0[1]));
  return add(constant(s.y-s.lip),scale(mul(profile,stal),-(s.depth-s.lip)));
}
