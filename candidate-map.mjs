import {budget} from './mission-core.mjs';
import {radiusRing} from './mission-context.mjs';
export function projection(mode,width,height){const cx=width/2,cy=height/2,R=Math.min(width,height)/2-16;
 return {forward(lat,lon){if(mode==='pole'){if(lat> -60)return null;const r=(90+lat)/30*R,a=lon*Math.PI/180;return {x:cx+r*Math.sin(a),y:cy-r*Math.cos(a)};}return {x:(lon+180)/360*width,y:(90-lat)/180*height};},inverse(x,y){if(mode==='pole'){const r=Math.hypot(x-cx,y-cy)/R*30;if(r>30)return null;return {lat:-90+r,lon:Math.atan2(x-cx,cy-y)*180/Math.PI};}return {lat:90-y/height*180,lon:x/width*360-180};}};
}
export function createCandidateMap(canvas,onPick){let p=null,r=null,all=true,mode='flat',coords=null;
 const image=new canvas.ownerDocument.defaultView.Image();image.onload=()=>render();image.src='./assets/terrain/moon-color.jpg';
 function render(){if(canvas.hidden)return;const w=canvas.clientWidth||600,h=mode==='pole'?Math.min(w,460):Math.max(220,w/2),d=Math.min(globalThis.devicePixelRatio||1,2);canvas.width=w*d;canvas.height=h*d;canvas.style.height=h+'px';const c=canvas.getContext('2d');if(!c)return;c.setTransform(d,0,0,d,0,0);c.fillStyle='#0b1315';c.fillRect(0,0,w,h);coords=projection(mode,w,h);const f=coords.forward;
  if(mode==='flat'&&image.complete&&image.naturalWidth){c.globalAlpha=.5;c.drawImage(image,0,0,w,h);c.globalAlpha=1;}
  c.strokeStyle='#2b3e40';c.lineWidth=1;c.font='11px sans-serif';c.fillStyle='#a8b8b5';
  if(mode==='flat'){for(let lon=-180;lon<=180;lon+=30){const q=f(0,lon);c.beginPath();c.moveTo(q.x,0);c.lineTo(q.x,h);c.stroke();if(lon<180)c.fillText(lon+'°',q.x+4,h-8);}for(let lat=-60;lat<=60;lat+=30){const q=f(lat,0);c.beginPath();c.moveTo(0,q.y);c.lineTo(w,q.y);c.stroke();c.fillText(lat+'°',4,q.y-5);}}else{const q=f(-60,0),R=h/2-q.y;for(const n of [1/3,2/3,1]){c.beginPath();c.arc(w/2,h/2,R*n,0,Math.PI*2);c.stroke();}c.fillText('60–90° S · 0° E at top',12,18);}
  if(!p||!r)return;for(const x of p.goal==='land'?(r.samples||[]):[]){if(!all&&x.distance>p.radius)continue;const q=f(x.lat,x.lon);if(!q)continue;const b=budget(p,x,r.tr);c.fillStyle=!b.fuelOK||!b.thrustOK?'#e8776f':p.origin==='earth'?'#e2b67a':'#6cc48a';c.beginPath();c.arc(q.x,q.y,2.4,0,Math.PI*2);c.fill();}
  c.strokeStyle='#ffb77d';c.lineWidth=2;c.beginPath();let prev=null;for(const x of radiusRing(p.lat,p.lon,p.radius)){const q=f(x.lat,x.lon);if(!q){prev=null;continue;}if(!prev||Math.abs(q.x-prev.x)>w/2)c.moveTo(q.x,q.y);else c.lineTo(q.x,q.y);prev=q;}c.stroke();const pin=f(p.lat,p.lon);if(pin){c.fillStyle='#ffb77d';c.beginPath();c.arc(pin.x,pin.y,5,0,Math.PI*2);c.fill();}
  if(r.errors?.length||r.blocked||p.goal!=='land'||!r.samples?.length){c.fillStyle='#e9eeeb';c.fillText(r.errors?.length?'Correct mission inputs to see candidate areas':p.goal!=='land'?'No surface footprint for this destination':'No arrivals in this interval',15,42);}
 }
 canvas.onclick=e=>{if(!coords)return;const b=canvas.getBoundingClientRect(),q=coords.inverse(e.clientX-b.left,e.clientY-b.top);if(q)onPick(q.lat,q.lon);};
 new ResizeObserver(render).observe(canvas);
 return {update(input,result,areaMode){p=input;r=result;all=areaMode;render();},show(value){mode=value;render();},clear(){p=null;r=null;render();}};
}
