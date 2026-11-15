/* Shared location/time and saved spacecraft form. No network storage. */
(function (root) {
  'use strict';
  const KEY = 'lunar-horizon-mission-v2';
  const date = value => { const n = Date.parse(value); return Number.isFinite(n) ? n : null; };
  function parse(search) {
    const q = new URLSearchParams(search), lat = Number(q.get('lat')), lon = Number(q.get('lon'));
    if (!q.has('lat') || !q.has('lon') || !q.get('lat').trim() || !q.get('lon').trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return {lat,lon,time:date(q.get('time')),days:Math.max(1,Math.min(14,Number(q.get('days'))||1)),view:q.get('view')==='space'?'space':'surface'};
  }
  function href(base, value) {
    const q = new URLSearchParams({lat:String(value.lat),lon:String(value.lon)});
    if(Number.isFinite(value.time))q.set('time',new Date(value.time).toISOString());
    if(value.days)q.set('days',String(value.days));
    if(value.view)q.set('view',value.view);
    return base+'?'+q;
  }
  function save(form) { try { const data={}; for(const el of form.elements) if(el.name)data[el.name]=el.value; root.sessionStorage.setItem(KEY,JSON.stringify(data)); } catch {} }
  function restore(form) { try { const data=JSON.parse(root.sessionStorage.getItem(KEY)||'null'); if(!data||typeof data!=='object')return; for(const el of form.elements)if(el.name&&typeof data[el.name]==='string'){el.value=data[el.name];if(el.tagName==='SELECT'&&el.selectedIndex<0){const d=[...el.options].findIndex(o=>o.defaultSelected);el.selectedIndex=d<0?0:d;}} } catch {} }
  function apply(form,value) {
    if(!value)return;
    const set=(name,v)=>{const el=form.elements.namedItem(name);if(el)el.value=v;};
    set('lat',value.lat);set('lon',value.lon);
    if(value.time!==null){set('from',new Date(value.time).toISOString().slice(0,16));set('to',new Date(value.time+value.days*86400000).toISOString().slice(0,16));}
  }
  root.LunarContext={parse,href,save,restore,apply};
})(globalThis);
