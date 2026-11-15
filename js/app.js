/* App: state, the visibility / power / thermal model, 2D charts, and wiring for the 3D views. */
(function () {
  'use strict';
  var EMBED=new URLSearchParams(location.search).get('embed')==='surface';
  if(EMBED){document.body.classList.add('surface-embedded');document.querySelectorAll('.app-nav,.topbar,.sidebar,.dock,.insptabs').forEach(function(el){el.hidden=true;});document.querySelector('.integration-context').appendChild(document.getElementById('retryData'));document.getElementById('planMission').hidden=true;}

  var RAD = Math.PI / 180, DEG = 180 / Math.PI, HR = 3600000, DAY = 86400000, SYN = 29.530589;
  var FONT = '"DM Sans", system-ui, sans-serif';
  var SITES = globalThis.LUNAR_SITES;
  var S = { site: SITES[0], t: Math.round(Date.now() / 60000) * 60000, viewStart: 0, span: 30, win: 14,
    cfg: { mask: 0, height: 0, margin: 0, tracking: true, terrain: 'terrain' }, view: 'globe', grp: SITES[0].g, scen: [], playing: null, hoverT: null, tl: null, bestKey: '' };
  S.viewStart = S.t - 2 * DAY;
  var has3D = false, hasGlobe = false, hasSpace = false, FLAT = Terrain.flat(), TR = new WeakMap();
  var SPEEDS = [[60, '1 min'], [600, '10 min'], [3600, '1 hour'], [10800, '3 hours'], [43200, '12 hours'], [86400, '1 day'], [259200, '3 days']];
  S.sp = 4; S.hero = 'surface'; S.flight = null; S.last = 0; S.lastHeavy = 0;
  var $ = function (id) { return document.getElementById(id); };
  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  /* ---------- model ---------- */
  var spCache = new Map();
  function spHour(k) { var v = spCache.get(k); if (!v) { if (spCache.size > 60000) spCache.clear(); v = Ephem.subPoints(Ephem.jdFromMs(k * HR)); spCache.set(k, v); } return v; }
  // Measured terrain never silently falls back to a generated landing site.
  var DEMO = new WeakMap();
  function pendingTerrain(label){var t=Terrain.flat();t.kind='unavailable';t.label=label;return t;}
  function terr(site,cfg){
    if(cfg.terrain==='sphere')return null;
    if(cfg.terrain==='demo'){if(!DEMO.has(site))DEMO.set(site,Terrain.synthetic(site.lat,site.lon));return DEMO.get(site);}
    var t=TR.get(site);if(t)return t;
    var k=SITES.indexOf(site),h=k>=0?RealData.site(k):null;
    if(h)t=Terrain.fromHeights(h,RealData.SITE_CELL,'Imported LOLA preset · 500 m sampled grid',typeof FAR_HORIZON!=='undefined'?FAR_HORIZON[k]:null);
    else {
      t=pendingTerrain(k>=0&&RealData.state.sites==='missing'?'Preset elevation unavailable · retry data':'Loading measured elevation…');
      if(k<0&&!site._req){site._req=1;RealData.patch(site.lat,site.lon,Terrain.N,RealData.GLOBAL_CELL).then(function(hh){
        if(site._user)return;TR.set(site,Terrain.fromHeights(hh,RealData.GLOBAL_CELL,'LOLA global elevation · 1.9 km grid; distant terrain beyond patch unmodelled'));S.bestKey='';if(S.site===site)renderAll();renderCompare();
      }).catch(function(){if(site._user)return;TR.set(site,pendingTerrain('Elevation unavailable · retry data'));if(S.site===site)renderAll();renderCompare();});}
    }
    TR.set(site,t);return t;
  }
  function terrainReady(site,cfg){var t=terr(site,cfg);return !t||t.kind!=='unavailable';}
  function onRealData(kind){
    if(kind==='sites'){SITES.forEach(function(s){var t=TR.get(s);if(t&&t.kind==='unavailable')TR.delete(s);});S.bestKey='';renderAll();renderCompare();}
    else if(kind==='moon'&&RealData.moonImage()){if(hasGlobe)Globe.setTexture(RealData.moonImage());if(hasSpace)Space.setTexture('moon',RealData.moonImage());renderGlobeOrMap();}
    else if(kind==='earth'&&RealData.earthImage()){if(has3D)Scene3D.setTexture(RealData.earthImage());if(hasSpace)Space.setTexture('earth',RealData.earthImage());}
  }
  function syncMissionLinks(){
    var q={lat:S.site.lat,lon:S.site.lon,time:S.t,days:Math.min(14,S.win)};
    document.querySelectorAll('[data-mission-link]').forEach(function(a){a.href=LunarContext.href('mission.html',q);});
    var t=terr(S.site,S.cfg),notice=$('dataNotice'),ready=terrainReady(S.site,S.cfg);
    notice.dataset.state=ready?'ready':(t.label.indexOf('unavailable')>=0?'missing':'loading');
    notice.textContent=(t?t.label:'Smooth reference sphere · terrain omitted')+(ready?(S.cfg.terrain==='demo'?' · DEMO ONLY: generated relief, not a measured landing site.':' · Small hazards below grid resolution are unresolved.'):' · Terrain-dependent outputs are withheld. The flat preview is only a loading surface.');
  }
  function pendingChart(id,height){if(terrainReady(S.site,S.cfg))return false;var g=prep($(id),height);g.c.fillStyle=css('--ink-2');g.c.font='14px '+FONT;g.c.fillText('Waiting for elevation data. Retry in Terrain and hardware.',12,32);return true;}
  function dipDeg(h) { return h > 0 ? Math.acos(Ephem.R_MOON / (Ephem.R_MOON + h / 1000)) * DEG : 0; }
  function hzAt(t, cfg, az) { return (t ? Terrain.horizon(t, az, 0) : -dipDeg(cfg.height)) + cfg.mask; }
  function look(site, cfg, p) {
    var t = terr(site, cfg), s = Ephem.altAz(site.lat, site.lon, p.sLon, p.sLat, p.sunR), e = Ephem.altAz(site.lat, site.lon, p.eLon, p.eLat, p.dist);
    var Hz = hzAt(t, cfg, s.az), HzE = hzAt(t, cfg, e.az), rs = Math.asin(695700 / p.sunR) * DEG, x = (s.el - Hz) / rs;
    var frac = x <= -1 ? 0 : x >= 1 ? 1 : (Math.acos(-x) + x * Math.sqrt(1 - x * x)) / Math.PI;
    // ground temperature: radiative equilibrium of flat regolith (albedo 0.12, emissivity 0.95), floored at a typical night value
    var flux = 1361 * Math.pow(149597870.7 / p.sunR, 2) * 0.88 * Math.max(0, Math.sin(s.el * RAD)) * frac;
    return { sunEl: s.el, sunAz: s.az, earthEl: e.el, earthAz: e.az, frac: frac, lit: frac > 0, comm: e.el > HzE + cfg.margin,
      power: frac * (cfg.tracking ? 1 : Math.max(0, Math.sin(s.el * RAD))), Hz: Hz, HzE: HzE, rs: rs, re: Math.asin(6371 / p.dist) * DEG,
      tempK: Math.max(95, Math.pow(flux / (0.95 * 5.670374e-8), 0.25)) };
  }
  function at(site, cfg, t) { return look(site, cfg, Ephem.subPoints(Ephem.jdFromMs(t))); }
  function nextChange(site, cfg, t, key, maxDays) {
    var v0 = at(site, cfg, t)[key], k = Math.floor(t / HR) + 1, prev = t;
    for (var i = 0; i < maxDays * 24; i++, k++) {
      if (look(site, cfg, spHour(k))[key] !== v0) { var lo = prev, hi = k * HR; while (hi - lo > 60000) { var mid = (lo + hi) / 2; if (at(site, cfg, mid)[key] === v0) lo = mid; else hi = mid; } return hi; }
      prev = k * HR;
    }
    return null;
  }
  function windowStats(site, cfg, t, days) {
    var k0 = Math.ceil(t / HR), n = Math.round(days * 24), lit = new Uint8Array(n), comm = new Uint8Array(n), nl = 0, nc = 0, nb = 0, pw = 0, run = 0, best = 0;
    for (var i = 0; i < n; i++) { var s = look(site, cfg, spHour(k0 + i)); lit[i] = s.lit ? 1 : 0; comm[i] = s.comm ? 1 : 0; nl += lit[i]; nc += comm[i]; nb += lit[i] & comm[i]; pw += s.power; run = s.lit ? run + 1 : 0; if (run > best) best = run; }
    return { n: n, lit: lit, comm: comm, litPct: 100 * nl / n, commPct: 100 * nc / n, bothPct: 100 * nb / n, power: 100 * pw / n, longestLitH: best };
  }
  /* Best landing time in each of the next 12 lunar days: the start that maximises hours with both power and an Earth visibility. */
  function bestDates(site, cfg, t0, days) {
    var k0 = Math.ceil(t0 / HR), w = Math.round(days * 24), chunk = Math.round(SYN * 24), n = chunk * 12 + w, pre = new Int32Array(n + 1), out = [];
    for (var i = 0; i < n; i++) { var s = look(site, cfg, spHour(k0 + i)); pre[i + 1] = pre[i] + (s.lit && s.comm ? 1 : 0); }
    for (var c = 0; c < 12; c++) { var bi = c * chunk, bv = -1; for (i = c * chunk; i < (c + 1) * chunk; i++) { var v = pre[i + w] - pre[i]; if (v > bv) { bv = v; bi = i; } } out.push({ t: (k0 + bi) * HR, pct: 100 * bv / w }); }
    return out;
  }

  /* ---------- formatting ---------- */
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(t) { var d = new Date(t); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  function fmtTime(t) { var d = new Date(t); return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ' UTC'; }
  function fmtDT(t) { return fmtDate(t) + ', ' + fmtTime(t); }
  function fmtDur(ms) { var m = Math.round(ms / 60000); if (m < 60) return m + ' min'; var h = Math.floor(m / 60); if (h < 48) return h + ' h ' + (m % 60) + ' min'; return Math.floor(h / 24) + ' d ' + (h % 24) + ' h'; }
  function deg(x, n) { return (x < 0 ? '−' : '') + Math.abs(x).toFixed(n == null ? 1 : n) + '°'; }
  function compass(az) { return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(az / 45) % 8]; }
  function coord(s) { return Math.abs(s.lat).toFixed(2) + '°' + (s.lat < 0 ? 'S' : 'N') + ', ' + Math.abs(s.lon).toFixed(2) + '°' + (s.lon < 0 ? 'W' : 'E'); }
  function chip(cls, glyph, text) { return '<span class="chip ' + cls + '"><span aria-hidden="true">' + glyph + '</span> ' + text + '</span>'; }
  function terrLabel(site, cfg) { var t = terr(site, cfg); return t ? t.label : FLAT.label; }

  function prep(cv, h) {
    var w = cv.clientWidth || cv.parentNode.clientWidth || 600, d = window.devicePixelRatio || 1;
    cv.width = Math.round(w * d); cv.height = Math.round(h * d); cv.style.height = h + 'px';
    var c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, w, h); return { c: c, w: w, h: h };
  }
  function niceStep(range, maxTicks) { var st = [0.5, 1, 2, 5, 10, 15, 30, 45]; for (var i = 0; i < st.length; i++) if (range / st[i] <= maxTicks) return st[i]; return 90; }

  /* ---------- status tiles ---------- */
  function renderTiles() {
    if(!terrainReady(S.site,S.cfg)){
      ['tSun','tEarth','tPower','tTemp','tWin'].forEach(function(id){$(id).textContent='Terrain data pending — no current result';});
      $('verdict').textContent='Load elevation data or explicitly choose the smooth-sphere model.';$('siteName').textContent=S.site.n;$('siteCoord').textContent=coord(S.site)+' · '+fmtDT(S.t);$('sens').replaceChildren();return;
    }
    var s = at(S.site, S.cfg, S.t), cfg = S.cfg, site = S.site;
    var sunNext = nextChange(site, cfg, S.t, 'lit', 120), earthNext = nextChange(site, cfg, S.t, 'comm', 120);
    var sunChip = s.frac >= 1 ? chip('good', '●', 'Sun up') : s.frac > 0 ? chip('warn', '◐', Math.round(s.frac * 100) + '% of disc showing') : s.sunEl > 0 ? chip('bad', '○', 'Behind terrain') : chip('bad', '○', 'Sun down');
    var sunEvt = sunNext ? (s.lit ? 'Sets in ' : 'Rises in ') + '<b>' + fmtDur(sunNext - S.t) + '</b>' : (s.lit ? 'No sunset' : 'No sunrise') + ' within 120 days';
    $('tSun').innerHTML = '<div class="k">Sun elevation</div><div class="v">' + deg(s.sunEl) + '</div>' + sunChip +
      '<div class="sub">Azimuth ' + s.sunAz.toFixed(0) + '° ' + compass(s.sunAz) + ' · horizon there ' + deg(s.Hz) + '<br>' + sunEvt + '</div>';
    var eChip = s.comm ? chip('good', '●', 'Earth in view') : s.earthEl > s.HzE ? chip('warn', '◐', 'Under antenna margin') : s.earthEl > 0 ? chip('bad', '○', 'Behind terrain') : chip('bad', '○', 'Earth hidden');
    var eEvt = earthNext ? (s.comm ? 'Earthset in ' : 'Earthrise in ') + '<b>' + fmtDur(earthNext - S.t) + '</b>' : (s.comm ? 'No Earthset within 120 days' : 'No Earth view within 120 days: relay needed');
    $('tEarth').innerHTML = '<div class="k">Earth elevation</div><div class="v">' + deg(s.earthEl) + '</div>' + eChip +
      '<div class="sub">Azimuth ' + s.earthAz.toFixed(0) + '° ' + compass(s.earthAz) + ' · horizon there ' + deg(s.HzE) + '<br>' + eEvt + '</div>';
    $('tPower').innerHTML = '<div class="k">Ideal solar output</div><div class="v">' + Math.round(s.power * 100) + '<small>% of peak</small></div>' +
      '<div class="meter"><i style="width:' + Math.round(s.power * 100) + '%"></i></div><div class="sub">' + (cfg.tracking ? 'Sun-tracking panel' : 'Flat deck panel, scales with sin(elevation)') + '</div>';
    $('tTemp').innerHTML = '<div class="k">Equilibrium temperature</div><div class="v">' + (s.tempK - 273.15 < 0 ? '−' : '') + Math.abs(Math.round(s.tempK - 273.15)) + '<small>°C</small></div>' +
      '<div class="sub">' + Math.round(s.tempK) + ' K. ' + (s.lit ? 'Estimate for flat sunlit regolith' : 'Typical value for unlit ground; permanent shadow is colder') + '</div>';
    var w = windowStats(site, cfg, S.t, S.win);
    $('tWin').innerHTML = '<div class="k">Next ' + S.win + ' days</div><div class="v">' + Math.round(w.bothPct) + '<small>% both</small></div>' +
      '<div class="sub">of hours have sunlight and an Earth visibility. Sunlit ' + Math.round(w.litPct) + '%, Earth visibility ' + Math.round(w.commPct) + '%<br>Longest unbroken sunlight <b>' + fmtDur(w.longestLitH * HR) + '</b></div>';
    var v;
    if (s.lit && s.comm) { var first = sunNext && (!earthNext || sunNext <= earthNext) ? 'the Sun sets in ' + fmtDur(sunNext - S.t) : earthNext ? 'Earth sets in ' + fmtDur(earthNext - S.t) : null; v = 'Sunlight and a geometric view of Earth are both present. ' + (first ? 'First to go: ' + first + '.' : 'Neither ends within 120 days.'); }
    else if (s.lit) v = 'The site is sunlit but Earth is out of view. ' + (earthNext ? 'Earth returns to view in ' + fmtDur(earthNext - S.t) + '.' : 'Operations here need a relay satellite.');
    else if (s.comm) v = 'Earth is in view but the site is dark. ' + (sunNext ? 'Sunrise in ' + fmtDur(sunNext - S.t) + '.' : 'No sunrise within 120 days.');
    else v = 'No sunlight and no direct link to Earth right now. ' + (sunNext ? 'Sunrise in ' + fmtDur(sunNext - S.t) + '. ' : '') + (earthNext ? 'Earthrise in ' + fmtDur(earthNext - S.t) + '.' : '');
    $('verdict').textContent = v; $('siteName').textContent = site.n; $('siteCoord').textContent = coord(site) + ' · ' + fmtDT(S.t);
    // sensitivity notes
    var s2 = at(site, cfg, S.t + HR), rate = (s2.sunEl - s.sunEl) * 24, mx = -90, mn = 90, emx = -90, emn = 90, k0 = Math.ceil(S.t / HR);
    for (var i = 0; i < 709; i += 2) { var q = look(site, cfg, spHour(k0 + i)); mx = Math.max(mx, q.sunEl); mn = Math.min(mn, q.sunEl); emx = Math.max(emx, q.earthEl); emn = Math.min(emn, q.earthEl); }
    var per = Math.abs(rate) > 1e-4 ? 24 / Math.abs(rate) : Infinity;
    $('sens').innerHTML =
      '<li>Over the coming lunar day the Sun ranges from <b>' + deg(mn) + '</b> to <b>' + deg(mx) + '</b>; Earth from <b>' + deg(emn) + '</b> to <b>' + deg(emx) + '</b>.</li>' +
      '<li>The Sun is ' + (rate >= 0 ? 'climbing' : 'sinking') + ' at <b>' + Math.abs(rate).toFixed(2) + '° per Earth day</b>. One degree of extra terrain on the horizon moves sunrise or sunset by about <b>' + (isFinite(per) ? fmtDur(per * HR) : 'a very long time') + '</b>.</li>' +
      '<li>Toward the Sun the horizon sits at <b>' + deg(s.Hz, 2) + '</b>, toward Earth at <b>' + deg(s.HzE, 2) + '</b>. The Sun’s disc is ' + (2 * s.rs).toFixed(2) + '° wide, Earth’s ' + (2 * s.re).toFixed(2) + '°.</li>';
    return s;
  }

  /* ---------- 3D views ---------- */
  function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  /* Earth's own axes (x through 0N 0E, z through its north pole) expressed in the 3D scene's axes at a site */
  function earthRotScene(site, rotDeg, vec) {
    var up = Ephem.uv(site.lat, site.lon), Lr = site.lon * RAD, p = site.lat * RAD, east = [-Math.sin(Lr), Math.cos(Lr), 0], north = [-Math.sin(p) * Math.cos(Lr), -Math.sin(p) * Math.sin(Lr), Math.cos(p)], r = rotDeg * RAD, R = vec.moonRot;
    return vec.earthRot.map(function (c) { var b = [dot3(R[0], c), dot3(R[1], c), dot3(R[2], c)], e = dot3(b, east), n = dot3(b, north), u = dot3(b, up); return [e * Math.cos(r) + n * Math.sin(r), u, -(n * Math.cos(r) - e * Math.sin(r))]; });
  }
  function fmtDist(m) { return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km'; }
  function fmtKm(k) { return Math.round(k).toLocaleString('en-US') + ' km'; }
  function render3D(s, vec) {
    var t = terr(S.site, S.cfg) || FLAT; S.terrText = t.label + ' \u00b7 ' + (t.N * t.cell / 1000).toFixed(1) + ' km across';
    if (has3D && S.hero === 'surface') Scene3D.update({ tr: t, sunAz: s.sunAz, sunEl: s.sunEl, rs: s.rs, earthAz: s.earthAz, earthEl: s.earthEl, re: s.re, frac: s.frac, extraH: S.cfg.terrain === 'sphere' ? S.cfg.height : 0, mask: S.cfg.mask, margin: S.cfg.margin, earthRot: earthRotScene(S.site, t.rot, vec), t: S.t });
  }
  var SPDESC = { system: 'The whole Earth\u2013Moon system at true scale. The grey loop is the Moon\u2019s path this month. Drag to turn, zoom to approach.',
    earth: 'Earth close up, turned to the correct face for this moment, with the day and night sides where they really are.', moon: 'The Moon close up with its current phase. The pink dot is your landing site.',
    fromEarth: 'First person from Earth: the Moon as it looks tonight, with its real phase and tilt. Zoom works like a telescope.',
    fromMoon: 'First person from your landing site, looking toward Earth. If the ground fills the view, Earth is below the horizon there.',
    fromSun: 'First person from the Sun: Earth and the Moon are always fully lit from here. The gap between them is to scale.',
    flight: 'First person from the spacecraft. Launch, then watch Earth shrink and the Moon grow.' };
  function renderSpace(vec) {
    if (!hasSpace || S.hero !== 'space') return;
    Space.update({ t: S.t, vec: vec, site: S.site, flight: S.flight });
    var f = S.flight, h = '';
    if (f) {
      var c = Ephem.transferAt(f, S.t), el = Math.max(0, Math.min(f.tof * 1000, S.t - f.t0)), dm = Math.sqrt(Math.pow(c.pos[0] - vec.moon[0], 2) + Math.pow(c.pos[1] - vec.moon[1], 2) + Math.pow(c.pos[2] - vec.moon[2], 2)) - 1737.4;
      var state = S.t < f.t0 ? 'Waiting in Earth orbit: launch is ' + fmtDur(f.t0 - S.t) + ' away' : c.f >= 1 ? 'Arrived: ' + fmtKm(Math.max(0, dm)) + ' above the Moon after ' + fmtDur(f.tof * 1000) : 'Coasting to the Moon';
      h = '<div class="meter"><i style="width:' + (c.f * 100).toFixed(1) + '%"></i></div><dl><dt>Status</dt><dd>' + state + '</dd><dt>Elapsed</dt><dd>' + fmtDur(el) + ' of ' + fmtDur(f.tof * 1000) + '</dd><dt>Above Earth</dt><dd>' + fmtKm(c.r - 6371) + '</dd><dt>To the Moon</dt><dd>' + fmtKm(Math.max(0, dm)) + '</dd><dt>Speed</dt><dd>' + c.speed.toFixed(2) + ' km/s</dd></dl>';
    }
    $('flHud').innerHTML = h; $('flClear').hidden = !f; $('launch').textContent = f ? 'Launch again from now' : 'Launch from Earth now';
    $('cockpit').hidden = !(Space.cam.mode === 'flight'); $('lookSeg').hidden = Space.cam.mode !== 'flight'; $('spDesc').textContent = SPDESC[Space.cam.mode];
  }
  function renderGlobeOrMap() {
    var mission=window.SurfaceMission?window.SurfaceMission.map(S):null;
    var g = S.view === 'globe' && hasGlobe; $('globeWrap').hidden = !g; $('map').hidden = g; if (!shown('mapNote')) return;
    if (g) { var p = Ephem.subPoints(Ephem.jdFromMs(S.t)), all = SITES.slice(); if (all.indexOf(S.site) < 0) all.push(S.site); Globe.update({ sLat: p.sLat, sLon: p.sLon, eLat: p.eLat, eLon: p.eLon, sites: all, sel: S.site, mission:mission }); }
    else renderMap();
    $('mapNote').textContent = g ? 'Drag to turn the Moon, click to drop a site. The blue ring is the limit of Earth visibility; the blue and yellow rays point to Earth and the Sun.' : 'Light is day, dark is night. The blue dotted line is the limit of Earth visibility. Click to drop a site.';
  }

  /* ---------- sky panorama ---------- */
  function renderSky() { if(!shown('sky'))return;if(pendingChart('sky',240))return;
    var g = prep($('sky'), +$('sky').dataset.h||320), c = g.c, site = S.site, cfg = S.cfg, s = at(site, cfg, S.t), t = terr(site, cfg);
    var k0 = Math.ceil(S.t / HR), n = Math.round(SYN * 24), trk = [], maxEl = Math.max(s.sunEl, s.earthEl), maxHz = -90, a;
    for (var i = 0; i <= n; i += 2) { var q = look(site, cfg, spHour(k0 + i)); trk.push(q); maxEl = Math.max(maxEl, q.sunEl, q.earthEl); }
    for (a = 0; a < 360; a += 2) maxHz = Math.max(maxHz, hzAt(t, cfg, a));
    var lo, hi; if (maxEl < 22) { lo = -8; hi = Math.max(14, Math.ceil(maxEl + 4), Math.ceil(maxHz + 3)); } else { lo = -20; hi = 90; }
    var x0 = 44, x1 = g.w - 10, y0 = 12, y1 = g.h - 26, pw = x1 - x0, ph = y1 - y0, ctr = site.lat < 0 ? 0 : 180;
    function X(az) { return x0 + ((((az - ctr) % 360) + 540) % 360) / 360 * pw; }
    function Y(el) { return y1 - (el - lo) / (hi - lo) * ph; }
    c.fillStyle = '#05070b'; c.fillRect(0, 0, g.w, g.h);
    c.save(); c.beginPath(); c.rect(x0, y0, pw, ph); c.clip();
    var st = niceStep(hi - lo, 7), e; c.lineWidth = 1;
    for (e = Math.ceil(lo / st) * st; e <= hi; e += st) { c.strokeStyle = 'rgba(255,255,255,' + (e === 0 ? .28 : .08) + ')'; c.setLineDash(e === 0 ? [4, 4] : []); c.beginPath(); c.moveTo(x0, Y(e)); c.lineTo(x1, Y(e)); c.stroke(); }
    c.setLineDash([]);
    function track(key, col) {
      c.strokeStyle = col; c.lineWidth = 1.5; c.globalAlpha = .75; c.beginPath(); var px = null;
      for (var i = 0; i < trk.length; i++) { var x = X(trk[i][key + 'Az']), y = Y(trk[i][key + 'El']); if (px === null || Math.abs(x - px) > pw / 2) c.moveTo(x, y); else c.lineTo(x, y); px = x; }
      c.stroke(); c.globalAlpha = 1; c.fillStyle = col; for (i = 12; i < trk.length; i += 12) { c.beginPath(); c.arc(X(trk[i][key + 'Az']), Y(trk[i][key + 'El']), 2, 0, 7); c.fill(); }
    }
    var ppd = ph / (hi - lo);
    function body(az, el, r, fill, glow, hidden) {
      var x = X(az), y = Y(el);
      if (glow && !hidden) { var gr = c.createRadialGradient(x, y, r, x, y, r * 5); gr.addColorStop(0, 'rgba(255,214,102,.5)'); gr.addColorStop(1, 'rgba(255,214,102,0)'); c.fillStyle = gr; c.beginPath(); c.arc(x, y, r * 5, 0, 7); c.fill(); }
      c.beginPath(); c.arc(x, y, r, 0, 7); c.fillStyle = fill; c.fill(); c.strokeStyle = '#05070b'; c.lineWidth = 2; c.stroke();
    }
    var sunIn = s.sunEl > lo, earthIn = s.earthEl > lo;
    if (earthIn) body(s.earthAz, s.earthEl, Math.max(7, s.re * ppd), '#4d94f0', false, false);
    if (sunIn) body(s.sunAz, s.sunEl, Math.max(5, s.rs * ppd), '#ffd666', true, s.frac === 0);
    // ground silhouette from the horizon profile, drawn over the bodies so terrain hides them
    c.beginPath(); c.moveTo(x0, y1 + 2);
    for (var px2 = 0; px2 <= pw; px2 += 2) c.lineTo(x0 + px2, Y(hzAt(t, cfg, ctr - 180 + px2 / pw * 360)));
    c.lineTo(x1, y1 + 2); c.closePath(); c.fillStyle = s.lit ? 'rgba(112,114,118,.94)' : 'rgba(40,42,48,.94)'; c.fill();
    c.beginPath(); for (px2 = 0; px2 <= pw; px2 += 2) { var yy = Y(hzAt(t, cfg, ctr - 180 + px2 / pw * 360)); if (px2) c.lineTo(x0 + px2, yy); else c.moveTo(x0, yy); } c.strokeStyle = s.lit ? '#b4b6ba' : '#565a62'; c.lineWidth = 1.5; c.stroke();
    track('sun', '#f2b632'); track('earth', '#5b9bf0');
    c.font = '10px ' + FONT; c.fillStyle = 'rgba(242,182,50,.95)'; c.textAlign = 'center';
    [7, 14, 21, 28].forEach(function (d) { var q = trk[d * 12]; if (q && q.sunEl > lo + 1 && q.sunEl < hi - 1 && X(q.sunAz) > x0 + 16 && X(q.sunAz) < x1 - 16) c.fillText('+' + d + ' d', X(q.sunAz), Y(q.sunEl) - 7); });
    c.restore();
    c.font = '600 12px ' + FONT;
    function lab(txt, az, el, inView, dy, col) { var x = X(az), y = inView ? Y(el) + dy : y1 - 8, w = c.measureText(txt).width; x = Math.max(x0 + w / 2 + 4, Math.min(x1 - w / 2 - 4, x)); y = Math.max(y0 + 12, Math.min(y1 - 6, y)); c.textAlign = 'center'; c.lineWidth = 3; c.strokeStyle = 'rgba(5,7,11,.85)'; c.strokeText(txt, x, y); c.fillStyle = col; c.fillText(txt, x, y); }
    lab(sunIn ? 'Sun ' + deg(s.sunEl) : '▼ Sun ' + deg(s.sunEl), s.sunAz, s.sunEl, sunIn, -Math.max(5, s.rs * ppd) - 8, '#ffe08a');
    lab(earthIn ? 'Earth ' + deg(s.earthEl) : '▼ Earth ' + deg(s.earthEl), s.earthAz, s.earthEl, earthIn, -Math.max(7, s.re * ppd) - 8, '#a8cbff');
    c.font = '11px ' + FONT; c.fillStyle = 'rgba(255,255,255,.62)'; c.textAlign = 'right';
    for (e = Math.ceil(lo / st) * st; e <= hi; e += st) c.fillText(deg(e, st < 1 ? 1 : 0), x0 - 6, Y(e) + 4);
    c.textAlign = 'center'; var names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    for (a = -180; a <= 180; a += 45) { var az = ((ctr + a) % 360 + 360) % 360, xx = x0 + (a + 180) / 360 * pw; c.fillText(names[az / 45], Math.max(x0 + 6, Math.min(x1 - 6, xx)), g.h - 8); }
    $('skyNote').textContent = (hi < 90 ? 'Zoomed to the horizon band (' + lo + '° to ' + hi + '°). ' : '') + 'The grey silhouette is the horizon in every compass direction' + (t ? ', measured from the terrain' : '') + '. Lines trace the next lunar day with a dot every 24 hours.';
  }

  /* ---------- timeline (height above the local horizon) ---------- */
  function buildTimeline() {
    var hrs = S.span * 24, step = Math.max(1, Math.ceil(hrs / 1400)), k0 = Math.floor(S.viewStart / HR), tl = { t: [], sun: [], earth: [], lit: [], comm: [] }, lo = 0, hi = S.cfg.margin;
    for (var k = 0; k <= hrs; k += step) { var q = look(S.site, S.cfg, spHour(k0 + k)), a = q.sunEl - q.Hz, b = q.earthEl - q.HzE; tl.t.push((k0 + k) * HR); tl.sun.push(a); tl.earth.push(b); tl.lit.push(q.lit); tl.comm.push(q.comm); lo = Math.min(lo, a, b); hi = Math.max(hi, a, b); }
    var pad = Math.max(1, (hi - lo) * .08); tl.lo = lo - pad; tl.hi = hi + pad; S.tl = tl;
  }
  var TLG = null;
  function renderTimeline() { if(!shown('tl'))return;if(pendingChart('tl',250))return;
    if (!S.tl) buildTimeline();
    var tl = S.tl, g = prep($('tl'), +$('tl').dataset.h||320), c = g.c, x0 = 46, x1 = g.w - 60, y0 = 10, y1 = g.h - 64, pw = x1 - x0, ph = y1 - y0, tA = tl.t[0], tB = tl.t[tl.t.length - 1];
    function X(t) { return x0 + (t - tA) / (tB - tA) * pw; }
    function Y(v) { return y1 - (v - tl.lo) / (tl.hi - tl.lo) * ph; }
    TLG = { x0: x0, x1: x1, tA: tA, tB: tB };
    var ink2 = css('--ink-2'), ink3 = css('--ink-3'), line = css('--line'), sun = css('--sun'), earth = css('--earth');
    c.fillStyle = css('--panel-2'); c.fillRect(x0, Y(0), pw, y1 - Y(0));
    var wa = Math.max(tA, S.t), wb = Math.min(tB, S.t + S.win * DAY);
    if (wb > wa) { c.fillStyle = css('--accent'); c.globalAlpha = .1; c.fillRect(X(wa), y0, X(wb) - X(wa), y1 - y0 + 44); c.globalAlpha = 1; }
    var st = niceStep(tl.hi - tl.lo, 6); c.font = '11px ' + FONT; c.textAlign = 'right'; c.lineWidth = 1;
    for (var v = Math.ceil(tl.lo / st) * st; v <= tl.hi; v += st) { c.strokeStyle = line; c.beginPath(); c.moveTo(x0, Y(v)); c.lineTo(x1, Y(v)); c.stroke(); c.fillStyle = ink3; c.fillText(deg(v, st < 1 ? 1 : 0), x0 - 6, Y(v) + 4); }
    c.strokeStyle = ink2; c.setLineDash([5, 4]); c.beginPath(); c.moveTo(x0, Y(0)); c.lineTo(x1, Y(0)); c.stroke(); c.setLineDash([]);
    c.textAlign = 'left'; c.fillStyle = ink2; c.fillText('horizon', x1 + 6, Y(0) + 4);
    if (S.cfg.margin > 0) { c.strokeStyle = earth; c.setLineDash([2, 4]); c.beginPath(); c.moveTo(x0, Y(S.cfg.margin)); c.lineTo(x1, Y(S.cfg.margin)); c.stroke(); c.setLineDash([]); c.fillText('antenna', x1 + 6, Y(S.cfg.margin) + 4); }
    c.textAlign = 'center'; var d0 = Math.ceil(tA / DAY) * DAY, every = S.span <= 30 ? 5 : S.span <= 90 ? 15 : 0, lastX = -99;
    for (var t = d0, i = 0; t <= tB; t += DAY, i++) { var d = new Date(t), show = every ? i % every === 0 : d.getUTCDate() === 1, x = X(t); if (show && x - lastX > 44) { c.strokeStyle = line; c.beginPath(); c.moveTo(x, y1 + 40); c.lineTo(x, y1 + 46); c.stroke(); c.fillStyle = ink3; c.fillText(every ? d.getUTCDate() + ' ' + MON[d.getUTCMonth()] : MON[d.getUTCMonth()] + (d.getUTCMonth() === 0 ? ' ' + d.getUTCFullYear() : ''), x, g.h - 6); lastX = x; } }
    function ln(arr, col) { c.strokeStyle = col; c.lineWidth = 2; c.lineJoin = 'round'; c.beginPath(); for (var i = 0; i < arr.length; i++) { var x = X(tl.t[i]), y = Y(arr[i]); if (i) c.lineTo(x, y); else c.moveTo(x, y); } c.stroke(); }
    ln(tl.earth, earth); ln(tl.sun, sun);
    function strip(arr, y, col, label) { c.fillStyle = css('--panel-2'); c.fillRect(x0, y, pw, 10); c.fillStyle = col; var a = -1; for (var i = 0; i <= arr.length; i++) { if (i < arr.length && arr[i]) { if (a < 0) a = i; } else if (a >= 0) { var xa = X(tl.t[a]), xb = X(tl.t[Math.min(i, arr.length - 1)]); c.fillRect(xa, y, Math.max(1, xb - xa), 10); a = -1; } } c.fillStyle = ink2; c.textAlign = 'left'; c.fillText(label, x1 + 6, y + 9); }
    strip(tl.lit, y1 + 10, sun, 'sunlit'); strip(tl.comm, y1 + 26, earth, 'Earth');
    function cur(t, col, w) { if (t < tA || t > tB) return; c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(X(t), y0); c.lineTo(X(t), y1 + 38); c.stroke(); }
    cur(S.t, css('--ink'), 1.5);
    var s = at(S.site, S.cfg, S.t);
    if (S.t >= tA && S.t <= tB) [[s.earthEl - s.HzE, earth], [s.sunEl - s.Hz, sun]].forEach(function (p) { c.fillStyle = p[1]; c.strokeStyle = css('--panel'); c.lineWidth = 2; c.beginPath(); c.arc(X(S.t), Y(p[0]), 4.5, 0, 7); c.fill(); c.stroke(); });
    if (S.hoverT != null) cur(S.hoverT, ink3, 1);
  }
  function tlTime(ev) { var r = $('tl').getBoundingClientRect(), x = ev.clientX - r.left; if (!TLG) return null; var f = (x - TLG.x0) / (TLG.x1 - TLG.x0); return f < 0 || f > 1 ? null : TLG.tA + f * (TLG.tB - TLG.tA); }
  function bindTimeline() {
    var cv = $('tl'), tip = $('tip'), down = false;
    cv.addEventListener('pointerdown', function (ev) { var t = tlTime(ev); if (t == null) return; down = true; try { cv.setPointerCapture(ev.pointerId); } catch (x) {} setTime(t, true); });
    cv.addEventListener('pointerup', function () { down = false; });
    cv.addEventListener('pointermove', function (ev) {
      var t = tlTime(ev); if (t == null) { S.hoverT = null; tip.hidden = true; renderTimeline(); return; }
      if (down) setTime(t, true);
      S.hoverT = t; var s = at(S.site, S.cfg, t), r = cv.getBoundingClientRect(), x = ev.clientX - r.left;
      tip.innerHTML = '<b>' + fmtDT(t) + '</b><span><i class="sw sun"></i>Sun ' + deg(s.sunEl - s.Hz) + ' above horizon' + (s.lit ? '' : ' (dark)') + '</span><span><i class="sw earth"></i>Earth ' + deg(s.earthEl - s.HzE) + (s.comm ? '' : ' (no link)') + '</span>';
      tip.hidden = false; tip.style.left = Math.min(r.width - 220, Math.max(0, x + 12)) + 'px'; renderTimeline();
    });
    cv.addEventListener('pointerleave', function () { S.hoverT = null; tip.hidden = true; renderTimeline(); });
  }

  /* ---------- flat maps ---------- */
  var MG = null;
  function renderMap() {
    var cv = $('map'), w = cv.clientWidth || 360, pole = S.view !== 'flat', h = pole ? Math.min(w, 400) : Math.round(w / 2);
    var g = prep(cv, h), c = g.c, p = Ephem.subPoints(Ephem.jdFromMs(S.t)), B = 4, cx = g.w / 2, cy = h / 2, R = h / 2 - 16;
    function inv(x, y) { if (pole) { var dx = x - cx, dy = y - cy, r = Math.sqrt(dx * dx + dy * dy) / R * 30; return r > 30 ? null : { lat: -90 + r, lon: Math.atan2(dx, -dy) * DEG }; } return { lat: 90 - y / h * 180, lon: x / g.w * 360 - 180 }; }
    function fwd(lat, lon) { if (pole) { var r = (90 + lat) / 30 * R; return lat > -60 ? null : { x: cx + r * Math.sin(lon * RAD), y: cy - r * Math.cos(lon * RAD) }; } return { x: (lon + 180) / 360 * g.w, y: (90 - lat) / 180 * h }; }
    MG = { inv: inv, fwd: fwd };
    function uv(lat, lon) { var a = lat * RAD, b = lon * RAD; return [Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)]; }
    var us = uv(p.sLat, p.sLon), ue = uv(p.eLat, p.eLon), nx = Math.ceil(g.w / B), ny = Math.ceil(h / B), vis = new Int8Array(nx * ny), soft = pole ? 1.6 : 6, i, j;
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
      var q = inv(i * B + B / 2, j * B + B / 2); if (!q) { vis[j * nx + i] = -1; continue; }
      var u = uv(q.lat, q.lon), el = Math.asin(u[0] * us[0] + u[1] * us[1] + u[2] * us[2]) * DEG, f = Math.max(0, Math.min(1, (el + soft) / (2 * soft)));
      f = f * f * (3 - 2 * f); var gy = Math.round((26 + f * 160) * Globe.albedo(q.lat, q.lon)); c.fillStyle = 'rgb(' + gy + ',' + gy + ',' + (gy + 4) + ')'; c.fillRect(i * B, j * B, B, B);
      vis[j * nx + i] = (u[0] * ue[0] + u[1] * ue[1] + u[2] * ue[2]) * p.dist > Ephem.R_MOON ? 1 : 0;
    }
    c.fillStyle = '#4d94f0';
    for (j = 0; j < ny - 1; j++) for (i = 0; i < nx - 1; i++) { var a = vis[j * nx + i]; if (a < 0) continue; var b = vis[j * nx + i + 1], d = vis[(j + 1) * nx + i]; if ((b >= 0 && b !== a) || (d >= 0 && d !== a)) c.fillRect(i * B + B - 1, j * B + B - 1, 2.5, 2.5); }
    c.strokeStyle = 'rgba(255,255,255,.22)'; c.lineWidth = 1; c.font = '10px ' + FONT;
    if (pole) {
      [10, 20, 30].forEach(function (r) { c.beginPath(); c.arc(cx, cy, r / 30 * R, 0, 7); c.stroke(); });
      for (var l = 0; l < 360; l += 45) { c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + R * Math.sin(l * RAD), cy - R * Math.cos(l * RAD)); c.stroke(); }
      c.textAlign = 'center'; c.fillStyle = css('--ink-3'); c.fillText('0° (Earth side)', cx, cy - R - 4); c.fillText('180° (far side)', cx, cy + R + 12);
      c.textAlign = 'left'; c.fillStyle = 'rgba(255,255,255,.8)'; c.fillText('80°S', cx + 3, cy - R / 3 - 3); c.fillText('70°S', cx + 3, cy - 2 * R / 3 - 3);
      [[p.sLon, '#ffd666', 'Sun'], [p.eLon, '#4d94f0', 'Earth']].forEach(function (z) { var sx = Math.sin(z[0] * RAD), sy = -Math.cos(z[0] * RAD); c.strokeStyle = z[1]; c.lineWidth = 3; c.beginPath(); c.moveTo(cx + sx * (R - 12), cy + sy * (R - 12)); c.lineTo(cx + sx * (R + 6), cy + sy * (R + 6)); c.stroke(); c.fillStyle = z[1]; c.textAlign = 'center'; c.font = '600 11px ' + FONT; c.lineWidth = 3; c.strokeStyle = 'rgba(5,7,11,.9)'; c.strokeText(z[2], cx + sx * (R - 26), cy + sy * (R - 26) + 4); c.fillText(z[2], cx + sx * (R - 26), cy + sy * (R - 26) + 4); });
    } else {
      for (var lo = -120; lo <= 120; lo += 60) { c.beginPath(); c.moveTo(fwd(0, lo).x, 0); c.lineTo(fwd(0, lo).x, h); c.stroke(); }
      for (var la = -60; la <= 60; la += 30) { c.beginPath(); c.moveTo(0, fwd(la, 0).y); c.lineTo(g.w, fwd(la, 0).y); c.stroke(); }
      [[p.sLat, p.sLon, '#ffd666', 'Sun overhead'], [p.eLat, p.eLon, '#4d94f0', 'Earth overhead']].forEach(function (z) { var q = fwd(z[0], z[1]), rt = q.x > g.w - 100; c.fillStyle = z[2]; c.strokeStyle = '#05070b'; c.lineWidth = 2; c.beginPath(); c.arc(q.x, q.y, 6, 0, 7); c.fill(); c.stroke(); c.font = '600 11px ' + FONT; c.textAlign = rt ? 'right' : 'left'; c.lineWidth = 3; c.strokeText(z[3], q.x + (rt ? -9 : 9), q.y + 4); c.fillText(z[3], q.x + (rt ? -9 : 9), q.y + 4); });
    }
    if(window.SurfaceMission)window.SurfaceMission.drawMap(c,fwd,S,g.w);
    var all = SITES.slice(); if (all.indexOf(S.site) < 0) all.push(S.site);
    all.forEach(function (s) { var q = fwd(s.lat, s.lon); if (!q) return; var sel = s === S.site; c.beginPath(); c.arc(q.x, q.y, sel ? 6 : 3.5, 0, 7); c.fillStyle = sel ? '#ffb77d' : '#ffffff'; c.strokeStyle = '#05070b'; c.lineWidth = 2; c.fill(); c.stroke(); if (sel) { c.font = '600 11px ' + FONT; var right = q.x > g.w * .6; c.textAlign = right ? 'right' : 'left'; c.lineWidth = 3; c.strokeStyle = 'rgba(5,7,11,.9)'; c.strokeText(s.n, q.x + (right ? -10 : 10), q.y - 8); c.fillStyle = '#fff'; c.fillText(s.n, q.x + (right ? -10 : 10), q.y - 8); } });
  }
  function pickSite(lat, lon) {
    setSite({ g: 'Custom', n: 'Custom site', lat: +lat.toFixed(5), lon: +lon.toFixed(5), d: '' }, true);
  }

  /* ---------- mission calculator ----------
     Hour by hour over the mission: the panel makes power in proportion to how much of the Sun is showing, the lander draws
     its working power while sunlit and its dark-time power otherwise, and the battery makes up the difference. */
  function missionSim(site, cfg, t, days, m) {
    var k0 = t / HR, n = Math.round(days * 24), soc = m.batt, out = { n: n, soc: new Float32Array(n), lit: new Uint8Array(n), minSoc: m.batt, minAt: 0, empty: 0, firstEmpty: -1, dark: 0, gen: 0, used: 0, commH: 0, gap: 0 }, dr = 0, gp = 0;
    for (var i = 0; i < n; i++) {
      var s = at(site, cfg, t + (i + .5)*HR), g = m.panel * s.power, ld = s.lit ? m.awake : m.surv;
      var unmet = ld - g - soc; soc += g - ld; if (soc > m.batt) soc = m.batt; if (soc <= 0) { soc = 0; if (unmet > 1e-9) { out.empty++; if (out.firstEmpty < 0) out.firstEmpty = i; } }
      if (soc < out.minSoc) { out.minSoc = soc; out.minAt = i; }
      out.soc[i] = soc; out.lit[i] = s.lit ? 1 : 0; out.gen += g; out.used += ld;
      dr = s.lit ? 0 : dr + 1; if (dr > out.dark) out.dark = dr; if (s.comm) { out.commH++; gp = 0; } else { gp++; if (gp > out.gap) out.gap = gp; }
    }
    out.capGB = out.commH * 3600 * m.rate / 8 / 1000; out.t0 = k0 * HR; return out;
  }
  function missionInputs() { var v = function (id) { return Number($(id).value); }; return { panel: v('mPanel'), batt: v('mBatt'), awake: v('mAwake'), surv: v('mSurv'), data: v('mData'), rate: v('mRate') }; }
  function renderMission() {
    if (!shown('msRows')) return;
    if(!terrainReady(S.site,S.cfg)){$('msVerdict').textContent='Elevation unavailable — resource estimate withheld.';$('msRows').replaceChildren();$('msChips').replaceChildren();prep($('msChart'),120);return;}
    var m = missionInputs(); if(Object.values(m).some(function(v){return !Number.isFinite(v)||v<0;})||Array.from($('msForm').querySelectorAll('input')).some(function(e){return e.value.trim()==='';})){$('msVerdict').textContent='Enter finite, non-negative resource values.';$('msRows').replaceChildren();$('msChips').replaceChildren();prep($('msChart'),120);return;} var r = missionSim(S.site, S.cfg, S.t, S.win, m), pOK = r.empty === 0, cOK = r.capGB >= m.data, pct = m.batt > 0 ? 100 * r.minSoc / m.batt : 0;
    $('msVerdict').textContent = pOK && cOK ? 'Ideal resource screen passes: the battery never drops below ' + Math.round(pct) + '% and there is enough Earth contact for the data.'
      : !pOK && !cOK ? 'Ideal resource screen fails: the battery runs flat and there is not enough Earth contact for the data.'
      : !pOK ? 'Power fails: the battery runs flat ' + fmtDur(r.firstEmpty * HR) + ' into the mission, on ' + fmtDate(r.t0 + r.firstEmpty * HR) + '.'
      : 'Ideal power budget passes, but Earth contact can only carry ' + r.capGB.toFixed(1) + ' GB of the ' + m.data + ' GB you need.';
    $('msChips').innerHTML = (pOK ? chip('good', '\u25cf', 'Power holds for all ' + S.win + ' days') : chip('bad', '\u25cb', 'Battery flat for ' + fmtDur(r.empty * HR))) + (cOK ? chip('good', '\u25cf', 'Sufficient ideal downlink time') : chip('bad', '\u25cb', 'Insufficient ideal downlink time'));
    var need = r.dark * m.surv;
    $('msRows').innerHTML = '<dt>Longest stretch without sunlight</dt><dd>' + fmtDur(r.dark * HR) + '</dd>' +
      '<dt>Energy needed to get through it</dt><dd class="' + (need <= m.batt ? '' : 'bad') + '">' + Math.round(need).toLocaleString('en-US') + ' Wh of ' + Math.round(m.batt).toLocaleString('en-US') + '</dd>' +
      '<dt>Lowest battery charge</dt><dd class="' + (pOK ? 'good' : 'bad') + '">' + Math.round(pct) + '%, ' + fmtDate(r.t0 + r.minAt * HR) + '</dd>' +
      '<dt>Energy made / used</dt><dd>' + (r.gen / 1000).toFixed(1) + ' / ' + (r.used / 1000).toFixed(1) + ' kWh</dd>' +
      '<dt>Hours with Earth in view</dt><dd>' + r.commH + ' of ' + r.n + '</dd>' +
      '<dt>Longest gap without Earth</dt><dd>' + fmtDur(r.gap * HR) + '</dd>' +
      '<dt>Data that fits / needed</dt><dd class="' + (cOK ? 'good' : 'bad') + '">' + r.capGB.toFixed(1) + ' / ' + m.data + ' GB</dd>';
    $('msChartTitle').textContent = 'Battery charge over the ' + S.win + '-day mission';
    // chart: charge in percent, dark periods shaded
    var g = prep($('msChart'), +$('msChart').dataset.h || 120), c = g.c, x0 = 42, x1 = g.w - 6, y0 = 8, y1 = g.h - 20, i;
    function X(k) { return x0 + k / (r.n - 1) * (x1 - x0); } function Y(v) { return y1 - (m.batt > 0 ? v / m.batt : 0) * (y1 - y0); }
    c.fillStyle = css('--panel-2'); var a0 = -1; for (i = 0; i <= r.n; i++) { if (i < r.n && !r.lit[i]) { if (a0 < 0) a0 = i; } else if (a0 >= 0) { c.fillRect(X(a0), y0, Math.max(1, X(Math.min(i, r.n - 1)) - X(a0)), y1 - y0); a0 = -1; } }
    c.strokeStyle = css('--line'); c.lineWidth = 1; c.font = '11px ' + FONT; c.fillStyle = css('--ink-3'); c.textAlign = 'right';
    [0, 50, 100].forEach(function (p) { var y = Y(m.batt * p / 100); c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); c.fillText(p + '%', x0 - 5, y + 4); });
    c.textAlign = 'left'; c.fillText(fmtDate(r.t0).slice(0, -5), x0, g.h - 5); c.textAlign = 'right'; c.fillText(fmtDate(r.t0 + r.n * HR).slice(0, -5), x1, g.h - 5); c.textAlign = 'center'; c.fillText('shaded: no sunlight', (x0 + x1) / 2, g.h - 5);
    c.strokeStyle = css('--ink'); c.lineWidth = 2; c.lineJoin = 'round'; c.beginPath(); for (i = 0; i < r.n; i++) { if (i) c.lineTo(X(i), Y(r.soc[i])); else c.moveTo(X(i), Y(r.soc[i])); } c.stroke();
    if (!pOK) { c.strokeStyle = css('--bad'); c.lineWidth = 3; c.beginPath(); for (i = 0; i < r.n; i++) if (r.soc[i] <= 0) { c.moveTo(X(i) - 1, Y(0)); c.lineTo(X(i) + 1, Y(0)); } c.stroke(); }
  }

  /* ---------- best dates ---------- */
  function renderBest() { if(!shown('best'))return;if(window.SurfaceMission){window.SurfaceMission.renderBest(S);return;}if(!terrainReady(S.site,S.cfg)){$('best').replaceChildren();$('bestHead').textContent='Date scoring needs elevation data. Use Retry elevation data.';S.bestKey='';return;}
    var key = S.site.lat + ',' + S.site.lon + JSON.stringify(S.cfg) + S.win + Math.floor(S.t / DAY) + (TR.get(S.site) || {}).label; if (key === S.bestKey) return; S.bestKey = key;
    var b = bestDates(S.site, S.cfg, S.t, S.win);
    $('best').innerHTML = b.map(function (x, i) { return '<li><button class="link" data-t="' + x.t + '">' + fmtDate(x.t) + ', ' + fmtTime(x.t).slice(0, 5) + '</button><span class="bar"><i style="width:' + Math.max(1, x.pct) + '%"></i></span><b>' + Math.round(x.pct) + '%</b></li>'; }).join('');
    $('bestHead').textContent = 'Best sunlight/visibility start in each of the next 12 lunar days, scored by the share of a ' + S.win + '-day mission with both sunlight and an Earth visibility.';
  }

  /* ---------- comparison ---------- */
  function addScen(site, t) { S.scen.push({ site: site, t: t, cfg: Object.assign({}, S.cfg), win: S.win }); }
  function stripSvg(w) {
    function runs(arr, y, cls) { var o = '', a = -1; for (var i = 0; i <= arr.length; i++) { if (i < arr.length && arr[i]) { if (a < 0) a = i; } else if (a >= 0) { o += '<rect class="' + cls + '" x="' + a + '" y="' + y + '" width="' + (i - a) + '" height="6"/>'; a = -1; } } return o; }
    return '<svg class="strip" viewBox="0 0 ' + w.n + ' 14" preserveAspectRatio="none" role="img" aria-label="Sunlit ' + Math.round(w.litPct) + '%, Earth visibility ' + Math.round(w.commPct) + '%"><rect class="bgr" x="0" y="0" width="' + w.n + '" height="6"/><rect class="bgr" x="0" y="8" width="' + w.n + '" height="6"/>' + runs(w.lit, 0, 'fs') + runs(w.comm, 8, 'fe') + '</svg>';
  }
  function scenRows() { return S.scen.map(function (sc) { if(!terrainReady(sc.site,sc.cfg))return {sc:sc,pending:true,w:{bothPct:0}};return { sc: sc, s: at(sc.site, sc.cfg, sc.t), w: windowStats(sc.site, sc.cfg, sc.t, sc.win), sn: nextChange(sc.site, sc.cfg, sc.t, 'lit', 120), en: nextChange(sc.site, sc.cfg, sc.t, 'comm', 120) }; }); }
  function renderCompare() { if(EMBED)return;
    var rows = scenRows(), best = Math.max.apply(null, rows.map(function (r) { return r.w.bothPct; }).concat([0]));
    $('cmpBody').innerHTML = rows.length ? rows.map(function (r, i) {
      if(r.pending)return '<tr><td>'+r.sc.site.n+'</td><td colspan="8">Elevation pending — no result</td><td><button data-del="'+i+'">Remove</button></td></tr>';
      var s = r.s, sc = r.sc, top = rows.length > 1 && r.w.bothPct === best && best > 0;
      var sunEvt = r.sn ? (s.lit ? 'sets in ' : 'rises in ') + fmtDur(r.sn - sc.t) : (s.lit ? 'no sunset in 120 d' : 'no sunrise in 120 d');
      var eEvt = r.en ? (s.comm ? 'sets in ' : 'rises in ') + fmtDur(r.en - sc.t) : (s.comm ? 'no Earthset in 120 d' : 'never in view');
      var tk = (TR.get(sc.site) || terr(sc.site, sc.cfg) || {}).kind, tn = sc.cfg.terrain === 'sphere' ? 'smooth sphere' : tk === 'dem' ? 'your elevation tile' : tk === 'real' ? 'real LOLA terrain' : 'generated terrain';
      return '<tr><td><button class="link" data-load="' + i + '">' + sc.site.n + '</button><div class="dim">' + coord(sc.site) + ' · ' + tn + '</div></td>' +
        '<td>' + fmtDate(sc.t) + '<div class="dim">' + fmtTime(sc.t) + '</div></td>' +
        '<td class="num">' + deg(s.sunEl) + '<div class="dim">' + sunEvt + '</div></td><td class="num">' + deg(s.earthEl) + '<div class="dim">' + eEvt + '</div></td>' +
        '<td class="num">' + Math.round(r.w.litPct) + '%</td><td class="num">' + Math.round(r.w.commPct) + '%</td>' +
        '<td class="num' + (top ? ' best' : '') + '">' + Math.round(r.w.bothPct) + '%' + (top ? '<div class="dim">best</div>' : '') + '</td>' +
        '<td class="stripcell">' + stripSvg(r.w) + '<div class="dim">next ' + sc.win + ' d</div></td>' +
        '<td><button class="x" data-del="' + i + '" aria-label="Remove ' + sc.site.n + '">×</button></td></tr>';
    }).join('') : '<tr><td colspan="10" class="dim">No scenarios yet. Pick a site and date, then add it here.</td></tr>';
    if(window.SurfaceMission)window.SurfaceMission.compare(rows);
  }
  function csv() {
    var out = ['site,lat,lon,start_utc,terrain,sun_elev_deg,earth_elev_deg,sunlit_pct,earth_visibility_pct,both_pct,window_days'];
    scenRows().forEach(function (r) { if(r.pending)return;var sc = r.sc; out.push(['"' + sc.site.n + '"', sc.site.lat, sc.site.lon, new Date(sc.t).toISOString(), sc.cfg.terrain, r.s.sunEl.toFixed(2), r.s.earthEl.toFixed(2), r.w.litPct.toFixed(1), r.w.commPct.toFixed(1), r.w.bothPct.toFixed(1), sc.win].join(',')); });
    return out.join('\n');
  }

  /* ---------- state changes ---------- */
  function fast() {
    $('siteName').textContent=S.site.n;
    syncMissionLinks();
    var s = at(S.site, S.cfg, S.t), vec = Ephem.vectors(Ephem.jdFromMs(S.t)); render3D(s, vec); renderSpace(vec);
    $('hudSun').innerHTML = (s.lit ? '\u25cf' : '\u25cb') + ' Sun ' + deg(s.sunEl); $('hudSun').className = 'pill ' + (s.frac >= 1 ? 'good' : s.lit ? 'warn' : 'bad');
    $('hudEarth').innerHTML = (s.comm ? '\u25cf' : '\u25cb') + ' Earth ' + deg(s.earthEl); $('hudEarth').className = 'pill ' + (s.comm ? 'good' : 'bad');
    $('siteCoord').textContent = coord(S.site) + ' · ' + fmtDT(S.t);
    if(!terrainReady(S.site,S.cfg)){['hudSun','hudEarth','rvChips'].forEach(function(id){$(id).textContent='Elevation pending';});}
  }
  function heavy() { if(EMBED){$('dt').value=new Date(S.t).toISOString().slice(0,16);return;} renderTiles(); renderSky(); renderTimeline(); renderGlobeOrMap(); renderBest(); renderMission(); $('dt').value = new Date(S.t).toISOString().slice(0, 16); }
  function renderT() { fast(); heavy(); }
  function renderAll() { S.tl = null; renderSites(); syncControls(); renderT(); }
  function keepInView() { if (S.t < S.viewStart || S.t > S.viewStart + S.span * DAY * .92) { S.viewStart = S.t - S.span * DAY * .08; S.tl = null; } }
  function setTime(t, keepView) { if(!Number.isFinite(t)||!Number.isFinite(new Date(t).getTime()))return; S.t = Math.round(t / 1000) * 1000; if (!keepView) keepInView(); renderT(); }
  /* playback: simulated time advances by the chosen amount per real second */
  function showSpeed() { $('speedOut').textContent = SPEEDS[S.sp][1] + '/s'; $('slower').disabled = S.sp === 0; $('faster').disabled = S.sp === SPEEDS.length - 1; }
  function stopPlay() { S.playing = false; cancelAnimationFrame(S.frame); S.frame=null; $('play').innerHTML = '&#9654; Play'; heavy(); }
  function startPlay() { if (S.playing) return; S.playing = true; S.last = performance.now(); $('play').innerHTML = '&#10074;&#10074; Pause'; S.frame=requestAnimationFrame(tick); }
  function tick(now) {
    if (!S.playing) return; var dt = Math.min(0.25, Math.max(0, (now - S.last) / 1000)), t = S.t + SPEEDS[S.sp][0] * 1000 * dt, f = S.flight; S.last = now;
    if (f && S.hero === 'space' && S.t < f.t0 + f.tof * 1000 && t >= f.t0 + f.tof * 1000) { S.t = f.t0 + f.tof * 1000; keepInView(); fast(); stopPlay(); return; }
    S.t = t; keepInView(); fast(); if (now - S.lastHeavy > 180) { heavy(); S.lastHeavy = now; }
    S.frame=requestAnimationFrame(tick);
  }
  function setHero(h) {
    S.hero = h; var sp = h === 'space';
    $('surfView').hidden = sp; $('spaceView').hidden = !sp; $('roverCard').hidden = sp || !has3D; $('flightCard').hidden = !sp; $('camSeg').hidden = sp || !has3D; $('spSeg').hidden = !sp; $('terrBadge').hidden = sp;
    Array.prototype.forEach.call($('heroSeg').children, function (b) { b.setAttribute('aria-pressed', b.dataset.v === h); }); fast();
  }
  function setSite(s, keepGlobe) { S.site = s; S.grp = s.g; $('clat').value = s.lat; $('clon').value = s.lon; if (hasGlobe && !keepGlobe) Globe.focus(s.lat, s.lon); renderAll(); }
  function renderSites() {
    var h = '', g = '';
    SITES.forEach(function (s, i) { if (s.g !== g) { if (g) h += '</div>'; g = s.g; h += '<div class="grp"><h3>' + g + '</h3>'; } h += '<button class="site' + (s === S.site ? ' on' : '') + '" data-site="' + i + '" aria-pressed="' + (s === S.site) + '"><span>' + s.n + '</span><small>' + coord(s) + (s.d ? ', ' + s.d : '') + '</small></button>'; });
    h += '</div>'; if (S.site.g === 'Custom') h += '<div class="grp"><h3>Your site</h3><button class="site on" aria-pressed="true"><span>Custom site</span><small>' + coord(S.site) + '</small></button></div>';
    $('sites').innerHTML = h;
  }
  /* Tabs: buttons with data-tab switch the panels with the matching data-panel inside the same [data-tabs] group. */
  function bindTabs() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-tabs]'), function (grp) {
      grp.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-tab]'); if (!b || b.closest('[data-tabs]') !== grp) return; var name = b.dataset.tab;
        Array.prototype.forEach.call(grp.querySelectorAll('[data-tab]'), function (x) { x.setAttribute('aria-selected', x === b); });
        Array.prototype.forEach.call(grp.querySelectorAll('[data-panel]'), function (p) { if (p.closest('[data-tabs]') === grp) p.hidden = p.dataset.panel !== name; });
        Array.prototype.forEach.call(grp.querySelectorAll('[data-for]'), function (p) { p.hidden = p.dataset.for !== name; });
        if (name === 'timeline') renderTimeline(); else if (name === 'horizon') renderSky(); else if (name === 'moon') renderGlobeOrMap(); else if (name === 'best') { S.bestKey = ''; renderBest(); } else if (name === 'mission') renderMission();
      });
    });
  }
  function shown(id) { return !!$(id) && !$(id).closest('[hidden]'); }
  function syncControls() {
    var c = S.cfg; $('mask').value = c.mask; $('height').value = c.height; $('margin').value = c.margin; $('panel').value = c.tracking ? 'track' : 'flat'; $('terrainSel').value = c.terrain;
    $('maskOut').textContent = c.mask.toFixed(1) + '°'; $('heightOut').textContent = c.height + ' m'; $('marginOut').textContent = c.margin.toFixed(1) + '°';
    $('height').disabled = c.terrain !== 'sphere'; $('heightField').classList.toggle('off', c.terrain !== 'sphere');
    $('demStatus').textContent = terrLabel(S.site, c);
  }
  function seg(id, key, cast, after) {
    $(id).addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b) return; S[key] = cast(b.dataset.v); Array.prototype.forEach.call($(id).children, function (x) { x.setAttribute('aria-pressed', x === b); }); after(); });
  }
  function bind() {
    $('retryData').onclick=function(){var site=S.site;TR.delete(site);site._req=0;S.bestKey='';if(SITES.indexOf(site)>=0)RealData.init(onRealData);renderAll();};
    $('downloadCsv').onclick=function(){var a=document.createElement('a'),url=URL.createObjectURL(new Blob([csv()],{type:'text/csv;charset=utf-8'}));a.href=url;a.download='lunar-surface-comparison.csv';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);};
    window.addEventListener('pagehide',stopPlay);
    document.addEventListener('visibilitychange',function(){if(document.hidden&&S.playing)stopPlay();});
    $('sites').addEventListener('click', function (ev) { var b = ev.target.closest('[data-site]'); if (b) setSite(SITES[+b.dataset.site]); });
    $('customForm').addEventListener('submit', function (ev) {
      ev.preventDefault(); var la = parseFloat($('clat').value), lo = parseFloat($('clon').value), err = $('cerr');
      if (!(la >= -90 && la <= 90) || !(lo >= -180 && lo <= 360)) { err.textContent = 'Enter latitude from −90 to 90 and longitude from −180 to 180 (east positive).'; return; }
      err.textContent = ''; if (lo > 180) lo -= 360; setSite({ g: 'Custom', n: 'Custom site', lat: la, lon: lo, d: '' });
    });
    $('dt').addEventListener('change', function () { var t = Date.parse($('dt').value + ':00Z'); if (!isNaN(t)) setTime(t); });
    $('steps').addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.d) setTime(S.t + parseFloat(b.dataset.d) * DAY); else if (b.id === 'now') setTime(Date.now());
      else if (b.id === 'play') { if (S.playing) stopPlay(); else startPlay(); }
      else if (b.id === 'slower' || b.id === 'faster') { S.sp = Math.max(0, Math.min(SPEEDS.length - 1, S.sp + (b.id === 'faster' ? 1 : -1))); showSpeed(); }
    });
    ['mask', 'height', 'margin'].forEach(function (k) { $(k).addEventListener('input', function () { S.cfg[k] = parseFloat($(k).value) || 0; renderAll(); }); });
    $('panel').addEventListener('change', function () { S.cfg.tracking = $('panel').value === 'track'; renderAll(); });
    $('terrainSel').addEventListener('change', function () { S.cfg.terrain = $('terrainSel').value; renderAll(); });
    $('demFile').addEventListener('change', function () {
      var f = $('demFile').files[0], err = $('demErr'); if (!f) return; err.textContent = '';
      if (f.size > 60e6) { err.textContent = 'That file is over 60 MB. Crop or downsample the tile first (see the README).'; return; }
      var targetSite=S.site,orientation=$('demProj').value,rd = new FileReader();
      rd.onload = function () { try { TR.set(targetSite, Terrain.fromAsc(String(rd.result), orientation, targetSite.lon, f.name)); targetSite._user = 1; S.cfg.terrain = 'terrain'; renderAll(); } catch (e) { err.textContent = e.message; } };
      rd.onerror = function () { err.textContent = 'The file could not be read.'; }; rd.readAsText(f);
    });
    seg('spanSeg', 'span', Number, function () { S.viewStart = S.t - S.span * DAY * .08; S.tl = null; renderTimeline(); });
    seg('winSeg', 'win', Number, function () { renderTiles(); renderTimeline(); renderBest(); renderMission(); });
    $('msForm').addEventListener('input', renderMission);
    seg('viewSeg', 'view', String, renderGlobeOrMap);
    $('camSeg').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b || !has3D) return; var v = b.dataset.v; if (v === 'orbit' || v === 'lander' || v === 'rover' || v === 'ride') Scene3D.setMode(v); else if (v === 'sun' || v === 'earth') Scene3D.face(v); else if (v === 'in') Scene3D.zoom(0.75); else if (v === 'out') Scene3D.zoom(1.33); $('scene').focus({ preventScroll: true }); });
    var hold = null, stop = function () { clearInterval(hold); hold = null; };
    $('dpad').addEventListener('pointerdown', function (ev) {
      var b = ev.target.closest('button'); if (!b || !has3D) return; ev.preventDefault();
      var m = { f: [0, 1], b: [0, -1], l: [-1, 0], r: [1, 0] }[b.dataset.m]; Scene3D.moveRover(m[0], m[1]); stop(); hold = setInterval(function () { Scene3D.moveRover(m[0], m[1]); }, 90);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (e) { $('dpad').addEventListener(e, stop); });
    window.addEventListener('blur',stop);window.addEventListener('pagehide',stop);
    $('dpad').addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { var b = ev.target.closest('button'); if (b && has3D) { ev.preventDefault(); var m = { f: [0, 1], b: [0, -1], l: [-1, 0], r: [1, 0] }[b.dataset.m]; Scene3D.moveRover(m[0], m[1]); } } });
    $('rvReset').addEventListener('click', function () { if (has3D) { Scene3D.resetRover(); $('scene').focus({ preventScroll: true }); } });
    var refocus = function () { try { $('scene').focus({ preventScroll: true }); } catch (e) {} }; // keep the arrow keys driving after a button press
    $('rvSpeed').addEventListener('click', function () { if (has3D) { var v = +$('rvSpeed').dataset.v; Scene3D.setSpeed(v === 1 ? 6 : v === 6 ? 40 : 1); refocus(); } });
    $('ledBtn').addEventListener('click', function () { if (has3D) { Scene3D.setLed($('ledBtn').getAttribute('aria-pressed') !== 'true'); refocus(); } });
    $('heroSeg').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (b) setHero(b.dataset.v); });
    $('spSeg').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b || !hasSpace) return; var v = b.dataset.v; if (v === 'in') Space.zoom(0.75); else if (v === 'out') Space.zoom(1.33); else Space.setMode(v); fast(); });
    $('lookSeg').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b || !hasSpace) return; Space.setLook(b.dataset.v); Array.prototype.forEach.call($('lookSeg').children, function (x) { x.setAttribute('aria-pressed', x === b); }); });
    $('launch').addEventListener('click', function () { if (!hasSpace) return; S.flight = Ephem.transfer(S.t); Space.setMode('flight'); S.sp = 3; showSpeed(); fast(); startPlay(); });
    $('flClear').addEventListener('click', function () { S.flight = null; if (hasSpace && Space.cam.mode === 'flight') Space.setMode('system'); fast(); });
    $('best').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (b) { setTime(+b.dataset.t); } });
    $('addOne').addEventListener('click', function () { addScen(S.site, S.t); renderCompare(); });
    $('addPole').addEventListener('click', function () { SITES.filter(function (s) { return s.g === 'South pole targets'; }).forEach(function (s) { addScen(s, S.t); }); renderCompare(); });
    $('addDays').addEventListener('click', function () { for (var i = 1; i <= 6; i++) addScen(S.site, S.t + i * SYN * DAY); renderCompare(); });
    $('clear').addEventListener('click', function () { S.scen = []; renderCompare(); });
    $('copyCsv').addEventListener('click', function () { var b = $('copyCsv'), done = function (m) { b.textContent = m; setTimeout(function () { b.textContent = 'Copy as CSV'; }, 1800); }; try { navigator.clipboard.writeText(csv()).then(function () { done('Copied'); }, function () { done('Copy blocked by the browser'); }); } catch (e) { done('Copy blocked by the browser'); } });
    $('cmpBody').addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.del !== undefined) { S.scen.splice(+b.dataset.del, 1); renderCompare(); }
      else if (b.dataset.load !== undefined) { var sc = S.scen[+b.dataset.load]; S.cfg = Object.assign({}, sc.cfg); S.site = sc.site; S.grp = sc.site.g; S.tl = null; if (hasGlobe) Globe.focus(sc.site.lat, sc.site.lon); renderSites(); syncControls(); $('clat').value = sc.site.lat; $('clon').value = sc.site.lon; setTime(sc.t); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    });
    $('map').addEventListener('click', function (ev) { if (!MG) return; var r = $('map').getBoundingClientRect(), q = MG.inv(ev.clientX - r.left, ev.clientY - r.top); if (q) pickSite(q.lat, q.lon); });
    bindTimeline(); bindTabs();
    var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { renderSky(); renderTimeline(); renderGlobeOrMap(); if (has3D && S.hero === 'surface') Scene3D.render(); if (hasSpace && S.hero === 'space') Space.render(); }, 120); });
    var redraw = function () { renderTimeline(); if (!(S.view === 'globe' && hasGlobe)) renderMap(); };
    if (window.matchMedia) { var mq = matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', redraw); }
    new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { renderSky(); renderTimeline(); if (!(S.view === 'globe' && hasGlobe)) renderMap(); });
  }

  function onRover(r) {
    if(!terrainReady(S.site,S.cfg)){$('rvChips').textContent='Elevation pending — rover visibility unassessed';return;}
    $('rvWhere').textContent = r.dist < 4 ? 'At the lander' : fmtDist(r.dist) + ' ' + compass(r.az) + ' of the lander, ' + (Math.abs(r.dh) < 0.5 ? 'level with it' : Math.abs(r.dh).toFixed(Math.abs(r.dh) < 10 ? 1 : 0) + ' m ' + (r.dh > 0 ? 'higher' : 'lower'));
    $('rvChips').innerHTML = (r.frac >= 1 ? chip('good', '\u25cf', 'In sunlight') : r.frac > 0 ? chip('warn', '\u25d0', Math.round(r.frac * 100) + '% of the Sun showing') : chip('bad', '\u25cb', 'In shadow')) +
      (r.comm ? chip('good', '\u25cf', 'Earth in view') : chip('bad', '\u25cb', 'Earth hidden')) +
      (r.los ? chip('good', '\u25cf', 'Lander in geometric view') : chip('bad', '\u25cb', 'Lander out of sight'));
    $('rvNote').textContent = r.note || ''; $('rvSpeed').dataset.v = r.speed; $('rvSpeed').textContent = 'Speed: ' + (r.speed === 1 ? 'normal' : r.speed === 6 ? 'fast' : 'ultra'); $('rvSpeed').setAttribute('aria-pressed', r.speed > 1); $('ledBtn').setAttribute('aria-pressed', r.led); $('ledBtn').textContent = r.led ? 'LED lamps: on' : 'LED lamps: off';
  }
  function pressed(seg, sel, mode) { Array.prototype.forEach.call($(seg).querySelectorAll(sel), function (b) { b.setAttribute('aria-pressed', b.dataset.v === mode); }); }
  try { has3D = Scene3D.init($('scene'), { sun: $('l3Sun'), earth: $('l3Earth'), north: $('l3N'), lander: $('l3Lander'), rover: $('l3Rover') }, { onRover: onRover, onCam: function (cam, dist, fov) {
    pressed('camSeg', '[data-v="orbit"],[data-v="lander"],[data-v="rover"],[data-v="ride"]', cam.mode);
    $('terrBadge').textContent = (S.terrText || '') + ' \u00b7 ' + (dist !== null ? 'camera ' + fmtDist(dist) + ' away' : 'field of view ' + Math.round(fov) + '\u00b0');
  } }); } catch (e) { has3D = false; if (window.console) console.error(e); }
  try { hasSpace = !EMBED && Space.init($('space'), { sun: $('sSun'), earth: $('sEarth'), moon: $('sMoon'), site: $('sSite'), craft: $('sCraft') }, { onCam: function (cam) { pressed('spSeg', 'button:not([data-v="in"]):not([data-v="out"])', cam.mode); } }); } catch (e) { hasSpace = false; if (window.console) console.error(e); }
  try { hasGlobe = !EMBED && Globe.init($('globe'), { sun: $('gSun'), earth: $('gEarth'), site: $('gSite') }, pickSite); } catch (e) { hasGlobe = false; }
  if (!has3D) { $('scene').hidden = true; $('noGl').hidden = false; $('roverCard').hidden = true; $('camSeg').hidden = true; }
  if (!hasSpace) $('heroSeg').hidden = true;
  if (!hasGlobe) { S.view = 'pole'; $('viewSeg').querySelector('[data-v="globe"]').hidden = true; $('viewSeg').querySelector('[data-v="pole"]').setAttribute('aria-pressed', 'true'); }
  var incoming=LunarContext.parse(location.search);
  if(incoming){S.site=SITES.find(function(s){return Math.abs(s.lat-incoming.lat)<1e-7&&Math.abs(s.lon-incoming.lon)<1e-7;})||{g:'Custom',n:'Mission pin',lat:incoming.lat,lon:incoming.lon,d:''};S.grp=S.site.g;if(incoming.time!==null)S.t=incoming.time;S.viewStart=S.t-2*DAY;}
  addScen(SITES[0], S.t); addScen(SITES[3], S.t); addScen(SITES[5], S.t); addScen(SITES[11], S.t);
  bind(); $('clat').value = S.site.lat; $('clon').value = S.site.lon; if (hasGlobe) Globe.focus(S.site.lat, S.site.lon); showSpeed(); renderAll(); renderCompare(); RealData.init(onRealData); if(incoming&&incoming.view==='space'&&hasSpace)setHero('space');
  if(EMBED)window.addEventListener('message',function(event){
    if(event.source!==window.parent||event.origin!==location.origin)return;var q=event.data;
    if(!q||q.type!=='lunar-surface-selection'||!Number.isFinite(q.lat)||!Number.isFinite(q.lon)||Math.abs(q.lat)>90||Math.abs(q.lon)>180||!Number.isFinite(q.time)||Math.abs(q.time)>8640000000000000)return;
    S.t=q.time;
    if(S.site.lat!==q.lat||S.site.lon!==q.lon){var site=SITES.find(function(s){return s.lat===q.lat&&s.lon===q.lon;})||{g:'Custom',n:'Mission pin',lat:q.lat,lon:q.lon,d:''};setSite(site);}else renderT();
  });
  window.__lunar = { SITES:SITES, setSite:setSite, terrainReady:terrainReady, terr:terr, csv:csv, renderGlobeOrMap:renderGlobeOrMap,renderBest:renderBest,renderAll:renderAll, renderCompare:renderCompare, S: S, at: at, windowStats: windowStats, nextChange: nextChange, bestDates: bestDates, missionSim:missionSim, renderMission:renderMission, setTime: setTime, earthRotScene: earthRotScene, setHero: setHero };
})();
