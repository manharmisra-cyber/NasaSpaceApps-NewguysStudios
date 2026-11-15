import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const c=vm.createContext({URLSearchParams,Date,console});
for(const f of ['../shared-state.js','../js/ephem.js','../js/terrain.js'])vm.runInContext(fs.readFileSync(new URL(f,import.meta.url),'utf8'),c);
const {Ephem:E,Terrain:T,LunarContext:L}=c;
test('Shared URLs preserve exact coordinates, UTC and view and reject invalid pins',()=>{
 const t=Date.parse('2026-11-14T16:20:30Z'),url=L.href('index.html',{lat:-89.98765,lon:179.99999,time:t,days:7,view:'space'}),q=L.parse(url.split('?')[1]);
 assert.equal(q.lat,-89.98765);assert.equal(q.lon,179.99999);assert.equal(q.time,t);assert.equal(q.days,7);assert.equal(q.view,'space');
 for(const bad of ['?lat=91&lon=0','?lat=&lon=0','?lat=x&lon=0','?lat=0&lon=Infinity','?lon=0','?lat=0&lon=181'])assert.equal(L.parse(bad),null);
 assert.equal(L.parse('?lat=0&lon=0&time=wrong').time,null);assert.equal(L.parse('?lat=0&lon=0&days=365').days,14);
});
test('Terrain import rejects incomplete, nonfinite, nodata, fractional and excessive grids',()=>{
 const asc=values=>'ncols 2\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 500\nNODATA_value -9999\n'+values;
 for(const x of ['0 0 0','0 0 0 0 0','0 -9999 0 0','0 Infinity 0 0','0 NaN 0 0','0 0 1abc 0','0 25000 0 0'])assert.throws(()=>T.fromAsc(asc(x),'north',0,'test'));
 assert.throws(()=>T.fromAsc(asc('0 0 0 0').replace('ncols 2','ncols 2.5'),'north',0));
 assert.throws(()=>T.fromAsc(asc('0 0 0 0').replace('cellsize 500','cellsize 1000000'),'north',0));
 const t=T.fromAsc(asc('100 100 100 100'),'north',0,'tile.asc');assert.equal(t.h0,100);assert.equal(t.kind,'dem');assert.ok([...t.h].every(Number.isFinite));
 assert.equal(T.fromAsc(asc('100 100 100 100'),'spole',45).rot,45);
 assert.equal(T.fromAsc(asc('100 100 100 100'),'npole',45).rot,-45);
});
test('Near horizon responds to a measured ridge and azimuth wraps',()=>{
 const h=new Float32Array(T.N*T.N),base=T.fromHeights(h,100,'test');
 const baseline=T.horizon(base,90,0);for(let j=0;j<T.N;j++)h[j*T.N+80]=300;
 const ridge=T.fromHeights(h,100,'ridge');assert.ok(T.horizon(ridge,90,0)>5);assert.ok(T.horizon(ridge,90,0)>baseline);
 assert.equal(T.horizon(ridge,-270,0),T.horizon(ridge,450,0));
 assert.equal(T.sample(ridge,100000,0),null);
});
test('Rover line of sight accounts for lunar curvature and obstructing heights',()=>{
 const t=T.fromHeights(new Float32Array(T.N*T.N),500,'flat');
 assert.equal(T.los(t,0,0,2,100,0,2),true);
 assert.equal(T.los(t,-20000,0,2,20000,0,2),false);
 assert.equal(T.los(t,-20000,0,1000,20000,0,1000),true);
});
test('Shadow map finite and bounded for high and low Sun',()=>{
 const t=T.fromHeights(new Float32Array(T.N*T.N),500,'flat');
 const up=T.shadow(t,90,45,.27,0),down=T.shadow(t,90,-30,.27,0);
 assert.ok([...up].every(x=>x===1));assert.ok([...down].every(x=>x===0));
});
test('Approximate sky finite at poles and both sides of dateline',()=>{
 for(const lat of [-90,-89.99,0,89.99,90])for(const lon of [-180,0,180]){
  const p=E.subPoints(E.jdFromMs(Date.parse('2026-11-14T00:00:00Z'))),sun=E.altAz(lat,lon,p.sLon,p.sLat,p.sunR),earth=E.altAz(lat,lon,p.eLon,p.eLat,p.dist);
  for(const a of [sun,earth]){assert.ok(Number.isFinite(a.el)&&Math.abs(a.el)<=90);assert.ok(Number.isFinite(a.az)&&a.az>=0&&a.az<=360);}
 }
});
test('Illustrative transfer conserves two-body energy and reaches its ellipse endpoints',()=>{
 const t0=Date.parse('2026-11-14T00:00Z'),tr=E.transfer(t0),first=E.transferAt(tr,t0),last=E.transferAt(tr,t0+tr.tof*1000);
 assert.ok(tr.tof>2*86400&&tr.tof<8*86400);assert.ok(Math.abs(first.r-tr.rp)<1e-6);assert.ok(Math.abs(last.r-tr.ra)<1e-6);
 const energies=[];for(let i=0;i<=20;i++){const p=E.transferAt(tr,t0+tr.tof*1000*i/20);energies.push(p.speed*p.speed/2-398600.4418/p.r);assert.ok(p.f>=0&&p.f<=1);}
 assert.ok(Math.max(...energies)-Math.min(...energies)<1e-5);
});
test('Approximate directions agree within 0.15 deg with the bundled November JPL reference series',()=>{
 const ref=vm.createContext({window:{}});vm.runInContext(fs.readFileSync(new URL('../data.js',import.meta.url),'utf8'),ref);
 const report={count:0,maxSeparationDeg:0,maxElevationErrorDeg:0,period:'2026-11-01 through 2026-12-01 UTC',sites:[]},rad=Math.PI/180;
 for(const site of ref.window.LUNAR_DATA){report.sites.push([site.lat,site.lon]);for(const body of ['sun','earth'])for(const [when,az,el] of site[body]){
  const ms=Date.parse(when.replace(' ','T').replace(/-(\w{3})-/,(m,x)=>'-'+String(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(x)+1).padStart(2,'0')+'-')+':00Z');
  const p=E.subPoints(E.jdFromMs(ms)),a=body==='sun'?E.altAz(site.lat,site.lon,p.sLon,p.sLat,p.sunR):E.altAz(site.lat,site.lon,p.eLon,p.eLat,p.dist);
  const sep=Math.acos(Math.max(-1,Math.min(1,Math.sin(el*rad)*Math.sin(a.el*rad)+Math.cos(el*rad)*Math.cos(a.el*rad)*Math.cos((az-a.az)*rad))))/rad;
  assert.ok(Number.isFinite(sep));report.count++;report.maxSeparationDeg=Math.max(report.maxSeparationDeg,sep);report.maxElevationErrorDeg=Math.max(report.maxElevationErrorDeg,Math.abs(el-a.el));
 }}
 console.log('Bounded JPL comparison:',JSON.stringify(report));assert.equal(report.count,4326);assert.ok(report.maxSeparationDeg<.15);
});
