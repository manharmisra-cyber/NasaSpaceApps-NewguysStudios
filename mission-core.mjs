// Units: km, seconds, kg, N; delta-v is exposed in m/s.
import {MOON_MEAN_RADIUS_KM,centralAngleVectors} from './lunar-geometry.mjs';
import {crewAccelerationCheck,CREW_LIMIT_CURVES} from './crew-limits.mjs';
export const C=Object.freeze({mu:4902.800118,R:MOON_MEAN_RADIUS_KM,earthMu:398600.435507,earthR:6378.137,moonDistance:384400,g0:9.80665,rotation:27.3217*86400});
export const TAU=2*Math.PI,D=Math.PI/180;
export const mod=(x,n)=>((x%n)+n)%n;
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const norm=v=>Math.hypot(...v);
export const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export const scale=(v,s)=>v.map(x=>x*s);
export const sub=(a,b)=>a.map((x,i)=>x-b[i]);
export function llVector(lat,lon){return [Math.cos(lat*D)*Math.cos(lon*D),Math.cos(lat*D)*Math.sin(lon*D),Math.sin(lat*D)];}
export function vectorLL(v){return {lat:Math.asin(clamp(v[2]/norm(v),-1,1))/D,lon:mod(Math.atan2(v[1],v[0])/D+180,360)-180};}
export function rz(v,a){return [v[0]*Math.cos(a)-v[1]*Math.sin(a),v[0]*Math.sin(a)+v[1]*Math.cos(a),v[2]];}
export function oriented(u,p){const i=p.inc*D;return rz([Math.cos(u),Math.sin(u)*Math.cos(i),Math.sin(u)*Math.sin(i)],p.node*D);}
export function orbitalState(p){const ra=C.R+p.ap,rp=C.R+p.pe,a=(ra+rp)/2,e=(ra-rp)/(ra+rp),n=Math.sqrt(C.mu/a**3);return {ra,rp,a,e,n,period:TAU/n};}
export function validate(p){const issues=[];const limits={wet:[1,1e9],dry:[.1,1e9],thrust:[.001,1e8],isp:[10,10000],reserve:[0,95],allowance:[0,10000],ap:[10,50000],pe:[10,50000],inc:[0,180],node:[-360,360],arg:[-360,360],phase:[0,360],earthAp:[150,100000],earthPe:[150,100000],targetAp:[10,50000],targetPe:[10,50000],lat:[-90,90],lon:[-180,180],radius:[1,300]};
 // Only fields that the chosen route uses are checked; hidden, unused fields cannot block a result.
 const unused=new Set([...(p.origin==='earth'?[]:['earthAp','earthPe']),...(p.goal==='orbit'?[]:['targetAp','targetPe'])]);
 for(const [k,[a,b]]of Object.entries(limits))if(!unused.has(k)&&(!Number.isFinite(p[k])||p[k]<a||p[k]>b))issues.push(`${k}: enter a value from ${a} to ${b}.`);
 if(p.wet<=p.dry)issues.push('Wet mass must exceed dry mass.');if(p.ap<p.pe)issues.push('Lunar Ap must be at least Pe.');if(!unused.has('earthAp')&&p.earthAp<p.earthPe)issues.push('Earth Ap must be at least Pe.');if(!unused.has('targetAp')&&p.targetAp<p.targetPe)issues.push('Target Ap must be at least Pe.');
 if(!['moon','earth'].includes(p.origin)||!['land','orbit'].includes(p.goal)||!['crewed','robotic'].includes(p.crew))issues.push('Choose valid mission options.');
 if(p.goal==='orbit'&&p.targetInc!==undefined&&p.targetInc!==''&&!(Number.isNaN(p.targetInc))&&!(Number.isFinite(p.targetInc)&&p.targetInc>=0&&p.targetInc<=180))issues.push('targetInc: enter a value from 0 to 180, or leave it empty for the same plane.');
 if(p.crew==='crewed'&&p.crewLimit!==undefined&&p.crewLimit!==''&&!CREW_LIMIT_CURVES[p.crewLimit])issues.push('Choose a crew acceleration limit.');
 if(![p.epoch,p.from,p.to].every(t=>Number.isFinite(t)&&Number.isFinite(new Date(t*1000).getTime())))issues.push('Enter valid UTC dates.');else{if(p.to<=p.from)issues.push('Arrival end must follow its start.');if(p.from<p.epoch)issues.push('Arrival interval cannot start before the lunar orbit epoch.');}return issues;
}
export function earthLeg(p){const r=C.earthR+p.earthPe,a0=C.earthR+(p.earthAp+p.earthPe)/2,a=(r+C.moonDistance)/2;const dv=(Math.sqrt(C.earthMu*(2/r-1/a))-Math.sqrt(C.earthMu*(2/r-1/a0)))*1000;const vInf=Math.abs(Math.sqrt(C.earthMu/C.moonDistance)-Math.sqrt(C.earthMu*(2/C.moonDistance-1/a)));const lo=orbitalState(p),capture=(Math.sqrt(vInf*vInf+2*C.mu/lo.rp)-Math.sqrt(C.mu*(2/lo.rp-1/lo.a)))*1000;return {dv,capture,vInf,time:Math.PI*Math.sqrt(a**3/C.earthMu)};}
export function transfer(p){const o=orbitalState(p),r2=p.goal==='land'?C.R:C.R+p.targetPe,a=(o.ra+r2)/2;const va=Math.sqrt(C.mu*(2/o.ra-1/a)),vb=Math.sqrt(C.mu*(2/r2-1/a)),v0=Math.sqrt(C.mu*(2/o.ra-1/o.a));const vt=p.goal==='land'?0:Math.sqrt(C.mu*(2/r2-1/(C.R+(p.targetAp+p.targetPe)/2)));return {o,r2,a,first:Math.abs(va-v0)*1000,arrivalSpeed:vb,targetSpeed:vt,time:Math.PI*Math.sqrt(a**3/C.mu)};}
// Orbit-plane change for an orbit transfer, applied to the target orbit at one
// of its nodes. The target keeps the source's node line and apse line, so the
// change is a pure rotation about the line of nodes. Only the horizontal
// velocity rotates: dv = 2 * v_h * sin(|di| / 2), v_h = h / r. The node with the
// larger radius (smaller v_h) is used. Returns null when no change is asked.
export function trueToMean(nu,e){const E=2*Math.atan2(Math.sqrt(1-e)*Math.sin(nu/2),Math.sqrt(1+e)*Math.cos(nu/2));return mod(E-e*Math.sin(E),TAU);}
export function planeChange(p){if(p.goal!=='orbit'||!Number.isFinite(p.targetInc))return null;const di=p.targetInc-p.inc;if(Math.abs(di)<1e-9)return null;
 const ra=C.R+p.targetAp,rp=C.R+p.targetPe,a=(ra+rp)/2,e=(ra-rp)/(ra+rp),h=Math.sqrt(C.mu*a*(1-e*e)),w=p.arg*D;
 const nodes=[{node:'ascending',nu:mod(-w,TAU)},{node:'descending',nu:mod(Math.PI-w,TAU)}].map(x=>({...x,r:a*(1-e*e)/(1+e*Math.cos(x.nu))}));
 const n=nodes[1].r>nodes[0].r+1e-9?nodes[1]:nodes[0],vh=h/n.r,dv=2*vh*Math.sin(Math.abs(di)*D/2)*1000;
 const direction=(di>0)===(n.node==='ascending')?'normal':'anti-normal',mean=Math.sqrt(C.mu/a**3);
 return {di,dv,node:n.node,nu:n.nu,r:n.r,altitude:n.r-C.R,vh,direction,afterInsertion:trueToMean(n.nu,e)/mean,period:TAU/mean};}
export function candidateAt(arrival,p,tr=transfer(p)){const burn=arrival-tr.time,dt=burn-p.epoch;const u=tr.o.e<1e-9?p.arg*D+p.phase*D+tr.o.n*dt:p.arg*D+Math.PI;const inertial=scale(oriented(u,p),-1);const elapsed=arrival-p.epoch,angle=-TAU*elapsed/C.rotation,body=rz(inertial,angle),ll=vectorLL(body);const tangent=oriented(u+Math.PI+Math.PI/2,p),surface=[-TAU/C.rotation*C.R*inertial[1],TAU/C.rotation*C.R*inertial[0],0];const last=p.goal==='land'?norm(sub(scale(tangent,tr.arrivalSpeed),surface))*1000:Math.abs(tr.arrivalSpeed-tr.targetSpeed)*1000;const target=llVector(p.lat,p.lon),distance=centralAngleVectors(body,target)*C.R;return {arrival,burn,body,...ll,distance,last};}
export function budget(p,c,tr=transfer(p)){const pre=p.origin==='earth'?earthLeg(p):null;const burns=[];if(pre){const captureEpoch=p.epoch-mod(p.phase*D,TAU)/tr.o.n;burns.push({name:'Earth departure / TLI',dv:pre.dv,time:captureEpoch-pre.time,kind:'conditional'});burns.push({name:'Lunar capture',dv:pre.capture,time:captureEpoch,kind:'conditional'});}burns.push({name:p.goal==='land'?'Deorbit impulse':'Orbit-transfer impulse',dv:tr.first,time:c.burn,kind:'ideal'});burns.push({name:p.goal==='land'?'Terminal stop impulse':'Target-orbit insertion',dv:c.last,time:c.arrival,kind:'ideal'});
 const pc=planeChange(p);if(pc)burns.push({name:'Plane change',dv:pc.dv,time:c.arrival+pc.afterInsertion,kind:'ideal'});
 const ve=C.g0*p.isp,prop=p.wet-p.dry,floor=p.dry+prop*p.reserve/100,available=ve*Math.log(p.wet/floor),needed=burns.reduce((s,b)=>s+b.dv,0),required=needed+p.allowance,flow=p.thrust*1000/ve;// Burns run in order until usable propellant (above the locked reserve) is gone.
 // A burn that would need more is cut at the reserve: it gets the delta-v it can
 // actually deliver, its shortfall, and status 'infeasible'; later burns are
 // 'not-reached' with no propellant, duration or mass change. Masses never fall
 // below the reserve floor, so no later figure uses an impossible mass.
 let m=p.wet;for(const b of burns){b.before=m;const full=m*Math.exp(-b.dv/ve);
  if(m<=floor+1e-9&&b.dv>1e-9){b.status='not-reached';b.after=m;b.achievedDv=0;}
  else if(full>=floor-1e-9){b.status='planned';b.after=full;b.achievedDv=b.dv;}
  else{b.status='infeasible';b.after=floor;b.achievedDv=ve*Math.log(m/floor);}
  b.shortfallDv=b.dv-b.achievedDv;b.propellant=m-b.after;b.duration=b.propellant/flow;b.fuelValid=b.status==='planned';m=b.after;}
 const last=burns.at(-1),g=C.mu/C.R**2*1000,twr=p.thrust*1000/(last.before*g),twrMinimumMass=p.thrust*1000/(floor*g),touchdownMass=Math.max(last.after,floor),twrTouchdown=p.thrust*1000/(touchdownMass*g),finalMass=p.wet*Math.exp(-required/ve),longBurn=burns.some(b=>b.duration>tr.o.period*.05);const crew=crewAccelerationCheck(p,burns,{lunarSurfaceGravity:g});
 return {period:tr.o.period,burns,pre,available,needed,required,margin:available-required,remaining:m-p.dry,reserved:floor-p.dry,finalMass,flow,twr,twrMinimumMass,longBurn,fuelOK:available>=required,touchdownMass,twrTouchdown,thrustOK:p.goal!=='land'||twrTouchdown>1,crew,crewOK:crew.ok};
}
// The arrival search lives in arrival-search.mjs; re-exported here for existing callers.
export {search} from './arrival-search.mjs';
