export function createSurfaceEmbed(frame,origin,makeUrl){
 let selection=null,started=false;
 const send=()=>{if(selection)frame.contentWindow?.postMessage({type:'lunar-surface-selection',...selection},origin);};
 frame.addEventListener('load',send);
 return {update(q){if(!Number.isFinite(q.lat)||!Number.isFinite(q.lon)||Math.abs(q.lat)>90||Math.abs(q.lon)>180||!Number.isFinite(q.time))return;selection={lat:q.lat,lon:q.lon,time:q.time};if(!started){started=true;frame.src=makeUrl(selection)+'&embed=surface';}else send();},destroy(){frame.removeEventListener('load',send);selection=null;}};
}
