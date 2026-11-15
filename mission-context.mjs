import {search,budget,validate} from './mission-core.mjs';
export const DEFAULT_MISSION={origin:'moon',goal:'land',crew:'robotic',wet:15000,dry:6500,thrust:45,isp:320,reserve:10,allowance:300,earthAp:200,earthPe:200,ap:100,pe:100,inc:90,node:0,arg:0,phase:0,targetAp:200,targetPe:200,targetInc:NaN,crewLimit:'B',lat:-89,lon:0,radius:50,epoch:Date.parse('2026-11-14T00:00Z')/1000,from:Date.parse('2026-11-14T01:00Z')/1000,to:Date.parse('2026-11-15T01:00Z')/1000};
export function readMission(storage){
 let raw=null;try{raw=JSON.parse(storage.getItem('lunar-horizon-mission-v2'));}catch{}
 const p={...DEFAULT_MISSION};
 if(raw&&typeof raw==='object')for(const k of Object.keys(p))if(raw[k]!==undefined)p[k]=['origin','goal','crew','crewLimit'].includes(k)?raw[k]:['epoch','from','to'].includes(k)?Date.parse(raw[k]+'Z')/1000:String(raw[k]).trim()===''?NaN:Number(raw[k]);
 // A saved choice that no longer exists (such as the retired Moon-stationary goal) falls back to the default.
 const choices={origin:['moon','earth'],goal:['land','orbit'],crew:['robotic','crewed'],crewLimit:['A','B','C','D','E']};for(const k in choices)if(!choices[k].includes(p[k]))p[k]=DEFAULT_MISSION[k];
 return {params:p,saved:!!raw,errors:validate(p)};
}
export function arrivalAssessment(p,site,timeMs,hours=24){
 const input={...p,lat:site.lat,lon:site.lon,from:timeMs/1000,to:timeMs/1000+hours*3600};
 const r=search(input);
 if(r.errors.length)return {input,result:r,status:'invalid',reason:r.errors.join(' '),samples:[]};
 if(p.goal!=='land')return {input,result:r,status:'not-landing',reason:'Select Land on the Moon in Mission designer to assess surface arrivals.',samples:[]};
 const samples=r.samples.map(c=>{const b=budget(input,c,r.tr);return {...c,screen:!b.fuelOK||!b.thrustOK||!b.crewOK?'failed':p.origin==='earth'?'conditional':'candidate'};});
 const best=r.windows[0]||r.best;
 if(!best)return {input,result:r,status:'no-arrivals',reason:r.empty||'No modeled arrival in this time window.',samples};
 const b=budget(input,best,r.tr),inside=best.distance<=p.radius,status=!b.fuelOK?'fuel':!b.thrustOK?'thrust':!b.crewOK?'crew':!inside?'miss':p.origin==='earth'?'conditional':'candidate';
 return {input,result:r,samples,best,budget:b,status,distance:best.distance,inside,
 reason:{fuel:'Insufficient delta-v',thrust:'Insufficient minimum-mass hover thrust',crew:'Felt acceleration exceeds the crew limit',miss:'Arrival track misses the search radius',conditional:'Conditional on Earth encounter and lunar capture',candidate:'Preliminary orbital and fuel checks pass'}[status]};
}
export function landingScore(assessment,bothPct){
 // A failed orbital screen cannot be rescued by favorable sunlight.
 if(!['candidate','conditional'].includes(assessment.status))return null;
 const proximity=Math.max(0,1-assessment.distance/assessment.input.radius);
 const margin=Math.max(0,Math.min(1,assessment.budget.margin/Math.max(1,assessment.budget.required)));
 return Math.round(60*Math.max(0,Math.min(100,bothPct))/100+25*proximity+15*margin);
}
export function radiusRing(lat,lon,km,steps=96){if(![lat,lon,km].every(Number.isFinite)||Math.abs(lat)>90||km<0)return [];const rad=Math.PI/180,a=km/1737.4,p=lat*rad,l=lon*rad;return Array.from({length:steps+1},(_,i)=>{const b=i/steps*2*Math.PI,q=Math.asin(Math.max(-1,Math.min(1,Math.sin(p)*Math.cos(a)+Math.cos(p)*Math.sin(a)*Math.cos(b)))),r=l+Math.atan2(Math.sin(b)*Math.sin(a)*Math.cos(p),Math.cos(a)-Math.sin(p)*Math.sin(q));return {lat:q/rad,lon:((r/rad+540)%360)-180};});}
