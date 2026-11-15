import {readMission,arrivalAssessment,landingScore,radiusRing} from '../mission-context.mjs';
export function installMissionLink(win=window){
 const api=win.__lunar,doc=win.document,$=id=>doc.getElementById(id);
 if(!api||doc.body.classList.contains('surface-embedded'))return;
 let cached=null,cacheKey='',bestKey='',lastBest=[];
 const scenario=()=>readMission(win.sessionStorage);
 function assess(S){const m=scenario(),hours=Number($('candidateHours').value)||24,key=JSON.stringify(m.params)+S.site.lat+','+S.site.lon+':'+Math.floor(S.t/60000)+':'+hours;
  if(key!==cacheKey){cacheKey=key;cached={...arrivalAssessment(m.params,S.site,Math.floor(S.t/60000)*60000,hours),saved:m.saved};}return cached;
 }
 function map(S){const a=assess(S),only=$('candidateOnly').checked,points=a.samples.filter(x=>!only||x.distance<=a.input.radius),stride=Math.max(1,Math.ceil(points.length/10000));
  $('candidateSummary').textContent=(a.saved?'Using your saved Mission designer inputs. ':'Example spacecraft; set your own in Mission designer. ')+a.reason+'. '+points.length.toLocaleString()+' samples'+(a.best?' · nearest '+a.result.best.distance.toFixed(1)+' km from pin':'')+'. Selected time → next '+$('candidateHours').value+' hours.';
  $('nearestCandidate').disabled=!a.result.best;
  return {points:points.filter((_,i)=>i%stride===0),ring:radiusRing(S.site.lat,S.site.lon,a.input.radius)};
 }
 function drawMap(c,fwd,S,width){const m=map(S);
  for(const x of m.points){const q=fwd(x.lat,x.lon);if(!q)continue;c.fillStyle=x.screen==='failed'?'#e8776f':x.screen==='conditional'?'#e2b67a':'#6cc48a';c.globalAlpha=.85;c.beginPath();c.arc(q.x,q.y,2.5,0,Math.PI*2);c.fill();}c.globalAlpha=1;
  c.strokeStyle='#ffb77d';c.lineWidth=2;c.beginPath();let prev=null;for(const x of m.ring){const q=fwd(x.lat,x.lon);if(!q){prev=null;continue;}if(!prev||Math.abs(q.x-prev.x)>width/2)c.moveTo(q.x,q.y);else c.lineTo(q.x,q.y);prev=q;}c.stroke();
 }
 function renderBest(S){const m=scenario(),ready=api.terrainReady(S.site,S.cfg),key=JSON.stringify(m.params)+S.site.lat+','+S.site.lon+':'+Math.floor(S.t/86400000)+JSON.stringify(S.cfg)+S.win+':'+ready+':'+api.terr(S.site,S.cfg)?.label;
  if(key===bestKey)return;bestKey=key;lastBest=[];$('best').replaceChildren();
  $('landingMethod').textContent='Screen first, rank second: a route must enter the pin radius and pass fuel/thrust checks. Ranking = 60% sunlight + Earth overlap, 25% proximity to pin, 15% delta-v margin. Earth routes remain conditional. Resources are evaluated at the pin; an offset arrival can differ. Terrain hazards and powered descent are unverified.';
  if(!ready){$('bestHead').textContent='Elevation data pending — landing rankings withheld.';return;}
  if(m.errors.length||m.params.goal!=='land'){$('bestHead').textContent=m.errors.join(' ')||'Choose Land on the Moon in Mission designer for landing rankings.';return;}
  const probes=api.bestDates(S.site,S.cfg,S.t,S.win);
  lastBest=probes.map(x=>{const a=arrivalAssessment(m.params,S.site,x.t,24),t=a.best?.arrival*1000||x.t,w=api.windowStats(S.site,S.cfg,t,S.win),score=landingScore(a,w.bothPct);return {t,a,w,score};}).sort((a,b)=>(b.score??-1)-(a.score??-1)||a.t-b.t);
  $('bestHead').textContent='12 environmental date probes, each checked for arrivals over the following 24 hours. '+lastBest.filter(x=>x.score!==null).length+' pass preliminary orbital screening. This is a ranked shortlist, not an exhaustive search.';
  for(const x of lastBest){const li=doc.createElement('li');li.className='landing-result';const button=doc.createElement('button');button.className='link';button.dataset.t=x.t;button.textContent=new Date(x.t).toISOString().slice(0,16).replace('T',' ')+' UTC';const strong=doc.createElement('strong');strong.textContent=x.score===null?'Not viable in model':x.score+'/100'+(x.a.status==='conditional'?' · conditional':'');strong.className=x.score===null?'bad':'good';const detail=doc.createElement('p');detail.textContent=x.a.reason+(Number.isFinite(x.a.distance)?' · '+x.a.distance.toFixed(1)+' km from pin (radius '+x.a.input.radius+' km)':'')+' · '+Math.round(x.w.bothPct)+'% Sun + Earth overlap'+(x.a.budget?' · Δv margin '+Math.round(x.a.budget.margin)+' m/s':'');li.append(button,strong,detail);$('best').append(li);}
 }
 const refresh=()=>{cacheKey='';bestKey='';api.renderGlobeOrMap();if(!doc.querySelector('[data-panel="best"]').hidden)renderBest(api.S);};
 function compare(rows){const m=scenario();rows.forEach((r,i)=>{if(r.pending)return;const a=arrivalAssessment(m.params,r.sc.site,r.sc.t,24),score=landingScore(a,r.w.bothPct),cell=doc.createElement('td');cell.className='landing-compare';cell.textContent=(score===null?'Not viable in model':score+'/100 · '+a.status)+(Number.isFinite(a.distance)?' · '+a.distance.toFixed(1)+' km':'')+' · '+a.reason;$('cmpBody').children[i].append(cell);});}
 win.SurfaceMission={map,drawMap,renderBest,assess,refresh,compare,get rankings(){return lastBest;}};
 const exportButton=doc.createElement('button');exportButton.id='exportLandingRanks';exportButton.textContent='Export ranked dates';$('landingMethod').after(exportButton);exportButton.onclick=()=>{if(!lastBest.length)return;const rows=['utc,status,rank_score,distance_from_pin_km,delta_v_margin_m_s,sun_earth_overlap_pct',...lastBest.map(x=>[new Date(x.t).toISOString(),x.a.status,x.score??'',x.a.distance??'',x.a.budget?.margin??'',x.w.bothPct].join(','))];const url=win.URL.createObjectURL(new win.Blob([rows.join('\n')],{type:'text/csv'})),a=doc.createElement('a');a.href=url;a.download='lunar-ranked-arrival-dates.csv';a.click();win.setTimeout(()=>win.URL.revokeObjectURL(url),1000);};
 const th=doc.createElement('th');th.textContent='Arrival screen / rank';$('cmpBody').closest('table').querySelector('thead tr').append(th);
 $('candidateHours').onchange=refresh;$('candidateOnly').onchange=()=>api.renderGlobeOrMap();
 $('nearestCandidate').onclick=()=>{const best=assess(api.S).result.best;if(best)api.setSite({g:'Custom',n:'Arrival candidate',lat:best.lat,lon:best.lon,d:'Preliminary arrival; terrain safety unassessed'});};
 win.addEventListener('focus',refresh);refresh();api.renderCompare();return win.SurfaceMission;
}
if(typeof window!=='undefined')installMissionLink(window);
