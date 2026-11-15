/* Preserve exact cached JPL samples; compute explicitly labeled estimates outside them. */
(function(root){
 const START=Date.UTC(2026,10,1),HOUR=3600000;
 function at(site,key,ms){const h=(ms-START)/HOUR;if(Number.isInteger(h)&&h>=0&&h<site[key].length)return {row:site[key][h],source:'JPL Horizons · cached hourly sample'};
  const e=root.Ephem,p=e.subPoints(e.jdFromMs(ms)),a=key==='sun'?e.altAz(site.lat,site.lon,p.sLon,p.sLat,p.sunR):e.altAz(site.lat,site.lon,p.eLon,p.eLat,p.dist);
  return {row:[new Date(ms).toISOString(),a.az,a.el],source:'Calculated sky estimate · outside exact JPL samples'};
 }
 root.SkyTime={START,HOUR,at};
})(globalThis);
