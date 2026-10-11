import {smoothstep} from '../core/math';
import type {Noise2} from '../core/noise';

type I = readonly [number,number];
const arena:[number,number][]=[];let cursor=0;
function pair(lo:number,hi:number):I {const out=arena[cursor]??(arena[cursor]=[0,0]);cursor++;out[0]=lo;out[1]=hi;return out;}
// Outward rounding at every operation; unsupported or large domains use the full sweep.
const box = (lo:number,hi:number): I => {const e=1e-12*(1+Math.max(Math.abs(lo),Math.abs(hi)));return pair(lo-e,hi+e);};
const add=(a:I,b:I):I=>box(a[0]+b[0],a[1]+b[1]);
const scale=(a:I,b:number):I=>b>=0?box(a[0]*b,a[1]*b):box(a[1]*b,a[0]*b);
const mul=(a:I,b:I):I=>{const aa=a[0]*b[0],ab=a[0]*b[1],ba=a[1]*b[0],bb=a[1]*b[1];return box(Math.min(aa,ab,ba,bb),Math.max(aa,ab,ba,bb));};
const square=(a:I):I=>box(a[0]<=0&&a[1]>=0?0:Math.min(a[0]*a[0],a[1]*a[1]),Math.max(a[0]*a[0],a[1]*a[1]));
const ss=(a:I,lo:number,hi:number):I=>box(smoothstep(lo,hi,a[0]),smoothstep(lo,hi,a[1]));
const pow=(a:I,p:number):I=>box(Math.pow(Math.max(0,a[0]),p),Math.pow(Math.max(0,a[1]),p));
const constant=(v:number):I=>pair(v,v);
const exp=(a:I):I=>box(Math.exp(a[0]),Math.exp(a[1]));
const cosAround=(a:number,spread:number):I=>box(Math.max(-1,Math.cos(a)-spread),Math.min(1,Math.cos(a)+spread));

/** simplex-noise 4.x uses three kernels 70 (1/2-|q|²)^4 g·q, |g|<=sqrt(2).
 * The gradient matrix has eigenvalues t^4 and t^3(t-8|q|²), t=.5-|q|².
 * Their three support centres form the same equilateral triangle for every seed.
 * The accompanying interval proof encloses the sum of operator norms over its
 * entire bounding rectangle by <9.87. Use 10, including seams and rounding. */
export const SIMPLEX_GRADIENT_BOUND=10;
function noise(n:Noise2,x:I,z:I):I {
  const cx=(x[0]+x[1])/2,cz=(z[0]+z[1])/2;
  const radius=Math.hypot((x[1]-x[0])/2,(z[1]-z[0])/2),v=n(cx,cz);
  return box(v-SIMPLEX_GRADIENT_BOUND*radius,v+SIMPLEX_GRADIENT_BOUND*radius);
}
const ridge=(v:I):I=>square(add(constant(1),scale(pow(add(square(v),constant(.03)),.5),-1)));
function softRidge(n:Noise2,x:I,z:I):I {
  const a=ridge(noise(n,x,z)),b=ridge(noise(n,add(scale(x,2.03),constant(5.3)),add(scale(z,2.03),constant(-2.1))));
  return scale(add(scale(a,.67),scale(b,.33)),1/((1-Math.sqrt(.03))**2));
}

export interface AnalyticUnderside {
  x:number;z:number;y:number;radius:number;outline:number;depth:number;lip:number;
  ridgeFreq:number;lumpFreq:number;toothCell:number;
  outlineRadius:(theta:number)=>number;noise:Noise2;tooth:(dx:number,dz:number)=>number;
  coneExp:number;skew:number;skewDir:number;twin:number;twinDir:number;
  tiltX:number;tiltZ:number;rag:number;lipVar:number;toothScale:number;
  lipAt:(theta:number)=>number;
}
/** Natural interval extension of the shared bottomHeight, including seeded deformation.
 * The origin singularity and broad queries remain unsupported. */
export function analyticBottomBounds(s:AnalyticUnderside,minX:number,maxX:number,minZ:number,maxZ:number,out:[number,number]):I|null {
  // Scratch intervals never escape: copy the final range before the next stencil call.
  cursor=0;
  const dx=(minX+maxX)/2-s.x,dz=(minZ+maxZ)/2-s.z;
  const q=Math.hypot((maxX-minX)/2,(maxZ-minZ)/2),r=Math.hypot(dx,dz);
  // Static parameters are validated once when the shape supplies its immutable solver.
  // Avoid allocating a validation array for every cell and normal-stencil interval.
  if(!Number.isFinite(dx)||!Number.isFinite(dz)||!Number.isFinite(q)||!Number.isFinite(r)||q>.1||r<=q+1e-6||r>1e5)return null;
  const theta=Math.atan2(dz,dx),angle=Math.asin(Math.min(1,q/r))+1e-12;
  // periodicNoise weights sum to one, harmonics <=6 (lip <=12). The clipped
  // ragged field has harmonics <=24 and the 1.8 gain, hence <=43.2/radian.
  const outline=s.outlineRadius(theta),dr=s.radius*(s.outline*6+s.rag*43.2)*angle;
  const R=box(Math.max(s.radius*(1-s.outline-s.rag),outline-dr),Math.min(s.radius*(1+s.outline+s.rag),outline+dr));
  if(R[0]<=0)return null;
  let radial=box(Math.min(1,Math.max(0,r-q)/R[1]),Math.min(1,(r+q)/R[0]));
  if(s.skew!==0){const exponent=exp(scale(cosAround(theta-s.skewDir,angle),s.skew));radial=box(Math.pow(Math.max(0,radial[0]),exponent[1]),Math.pow(Math.min(1,radial[1]),exponent[0]));}
  const profile=pow(add(constant(1),scale(square(radial),-1)),s.coneExp);
  const lip=s.lipAt(theta),le=s.lip*s.lipVar*1.6*12*angle;
  const lips=s.lipVar===0?constant(s.lip):box(Math.max(s.lip*.8,7,lip-le),lip+le);
  const cos=box(Math.max(-1,Math.cos(theta)-angle),Math.min(1,Math.cos(theta)+angle));
  const sin=box(Math.max(-1,Math.sin(theta)-angle),Math.min(1,Math.sin(theta)+angle));
  const ridge=add(constant(.5),mul(add(softRidge(s.noise,add(scale(cos,s.ridgeFreq),scale(radial,1.7)),add(scale(sin,s.ridgeFreq),scale(radial,-1.3))),constant(-.5)),ss(radial,.03,.3)));
  const nx=box((minX-s.x)*s.lumpFreq+31.7,(maxX-s.x)*s.lumpFreq+31.7),nz=box((minZ-s.z)*s.lumpFreq-12.3,(maxZ-s.z)*s.lumpFreq-12.3);
  const lump=add(constant(.5),scale(add(noise(s.noise,nx,nz),scale(noise(s.noise,scale(nx,2),scale(nz,2)),.5)),1/3));
  // Every tooth cone is 6.25/cell Lipschitz; max and zero extension preserve it.
  const tooth=s.tooth(dx,dz),te=6.25/s.toothCell*q;
  const teeth=mul(mul(box(Math.max(0,tooth-te),Math.min(1,tooth+te)),ss(profile,.05,.35)),ss(radial,.06,.2));
  const cone=add(constant(.72),scale(pow(add(constant(1),scale(ss(radial,0,1),-1)),1.5),.46));
  const toothLen=box(Math.min(.26*s.toothScale,1.3-cone[1]),Math.min(.26*s.toothScale,1.3-cone[0]));
  let stal0=add(mul(cone,add(constant(.74),scale(add(scale(ridge,.6),scale(lump,.4)),.26))),mul(toothLen,teeth));
  if(s.twin>0){
    const lobe=mul(exp(scale(square(scale(add(radial,constant(-.42)),1/.22)),-1)),box(Math.max(0,Math.cos(2*(theta-s.twinDir))-2*angle),Math.max(0,Math.min(1,Math.cos(2*(theta-s.twinDir))+2*angle))));
    const saddle=exp(scale(square(scale(radial,1/.3)),-1));
    stal0=mul(stal0,add(constant(1),scale(add(scale(lobe,1.2),scale(saddle,-1)),s.twin)));
  }
  const stal=box(Math.min(1.3,stal0[0]),Math.min(1.3,stal0[1]));
  let result=s.lipVar===0?add(constant(s.y-s.lip),scale(mul(profile,stal),-(s.depth-s.lip))):add(add(constant(s.y),scale(lips,-1)),scale(mul(add(constant(s.depth),scale(lips,-1)),mul(profile,stal)),-1));
  if(s.tiltX!==0||s.tiltZ!==0)result=add(result,add(scale(box(minX-s.x,maxX-s.x),s.tiltX),scale(box(minZ-s.z,maxZ-s.z),s.tiltZ)));
  out[0]=result[0];out[1]=result[1];return out;
}
