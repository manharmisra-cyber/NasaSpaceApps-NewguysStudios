/* Globe: a 3D Moon (real colour map when data/moon_2k.jpg loads, a sketch otherwise) with day and night, the Earth-visibility limit and the landing sites.
   Body-fixed frame: +x through lat 0 lon 0 (centre of the near side), +y through 90 deg E, +z through the north pole. */
var Globe = (function () {
  'use strict';
  var RAD = Math.PI / 180, DEG = 180 / Math.PI, ctx = null, cv = null, labs = null, st = null, onPick = null;
  var planet = null, mPts = null, mLines = null, cam = { yaw: 0, pitch: -60, dist: 3.3, fov: 38 };
  // Rough positions of the dark maria (lat, lon, angular radius, strength). Illustrative, drawn from memory, not a map product.
  var MARIA = [[33, -16, 17, 1], [28, 17, 11, 1], [8, 31, 12, 1], [17, 59, 8, 1], [18, -57, 24, .8], [-21, -17, 10, .8], [-8, 51, 9, .9], [-24, -39, 6, .9],
    [56, 1, 9, .6], [56, -30, 8, .6], [56, 30, 8, .5], [-15, 35, 5, .9], [-19, -93, 4, .8], [27, 148, 5, .8], [-3, -42, 14, .7], [12, -3, 7, .6], [-53, -169, 30, .22]];
  var MV = MARIA.map(function (m) { return [uv(m[0], m[1]), Math.cos(m[2] * RAD), Math.cos(m[2] * 0.7 * RAD), m[3]]; });
  function uv(lat, lon) { var a = lat * RAD, b = lon * RAD; return [Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)]; }
  function hash(i, j) { var x = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return x - Math.floor(x); }
  /* Surface brightness 0.55..1 at a point */
  function albedo(lat, lon) {
    if (typeof RealData !== 'undefined') { var L = RealData.moonLum(lat, lon); if (L !== null) return Math.min(1.12, 0.42 + 1.25 * L); }
    var u = uv(lat, lon), dark = 0;
    for (var i = 0; i < MV.length; i++) { var m = MV[i], d = u[0] * m[0][0] + u[1] * m[0][1] + u[2] * m[0][2]; if (d > m[1]) { var f = Math.min(1, (d - m[1]) / (m[2] - m[1])); dark = Math.max(dark, f * m[3]); } }
    return 1 - 0.42 * dark;
  }
  function init(canvas, labelEls, pickCb) {
    cv = canvas; labs = labelEls; onPick = pickCb; ctx = GLX.init(canvas); if (!ctx) return false;
    planet = Planet.create(ctx); mPts = GLX.mesh(ctx, [], [], true); mLines = GLX.mesh(ctx, [], [], true);
    var drag = null, moved = 0;
    cv.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY }; moved = 0; try { cv.setPointerCapture(e.pointerId); } catch (x) {} });
    cv.addEventListener('pointermove', function (e) { if (!drag) return; var dx = e.clientX - drag.x, dy = e.clientY - drag.y; moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY; cam.yaw -= dx * 0.4; cam.pitch = Math.max(-88, Math.min(88, cam.pitch + dy * 0.4)); render(); });
    cv.addEventListener('pointercancel', function () { drag = null; });
    cv.addEventListener('pointerup', function (e) {
      if (drag && moved < 5 && onPick) {
        var r = cv.getBoundingClientRect(), nx = ((e.clientX - r.left) / r.width * 2 - 1), ny = (1 - (e.clientY - r.top) / r.height * 2), E = eye(), f = GLX.norm([-E[0], -E[1], -E[2]]), rt = GLX.norm(GLX.cross(f, [0, 0, 1])), up = GLX.cross(rt, f), t = Math.tan(cam.fov * RAD / 2), a = r.width / r.height;
        var d = GLX.norm([f[0] + rt[0] * nx * t * a + up[0] * ny * t, f[1] + rt[1] * nx * t * a + up[1] * ny * t, f[2] + rt[2] * nx * t * a + up[2] * ny * t]);
        var b = GLX.dot(E, d), c = GLX.dot(E, E) - 1, disc = b * b - c;
        if (disc > 0) { var s = -b - Math.sqrt(disc), p = [E[0] + d[0] * s, E[1] + d[1] * s, E[2] + d[2] * s]; onPick(Math.asin(Math.max(-1, Math.min(1, p[2]))) * DEG, Math.atan2(p[1], p[0]) * DEG); }
      }
      drag = null;
    });
    return true;
  }
  function eye() { var p = cam.pitch * RAD, y = cam.yaw * RAD; return [cam.dist * Math.cos(p) * Math.cos(y), cam.dist * Math.cos(p) * Math.sin(y), cam.dist * Math.sin(p)]; }
  /* state: {sLat, sLon, eLat, eLon, sites:[{lat,lon}], sel:{lat,lon,n}} */
  function update(state) {
    if (!ctx) return; st = state; var s = uv(st.sLat, st.sLon), e = uv(st.eLat, st.eLon), i;
    var P = [], C = [];
    if(st.mission)st.mission.points.forEach(function(x){var p=uv(x.lat,x.lon),col=x.screen==='failed'?[.88,.43,.39]:x.screen==='conditional'?[.89,.71,.48]:[.77,.94,.58];P.push(p[0]*1.018,p[1]*1.018,p[2]*1.018);C.push(col[0],col[1],col[2],1);});
    st.sites.forEach(function (x) { if (x === st.sel) return; var p = uv(x.lat, x.lon); P.push(p[0] * 1.012, p[1] * 1.012, p[2] * 1.012); C.push(1, 1, 1, 1); });
    var sp = uv(st.sel.lat, st.sel.lon); P.push(sp[0] * 1.02, sp[1] * 1.02, sp[2] * 1.02); C.push(1, 0.72, 0.49, 1);
    GLX.setPos(ctx, mPts, P); GLX.setCol(ctx, mPts, C);
    var LP = [], LC = [];
    function line(a, b, c) { LP.push(a[0], a[1], a[2], b[0], b[1], b[2]); LC.push(c[0], c[1], c[2], 1, c[0], c[1], c[2], 1); }
    function sc(v, k) { return [v[0] * k, v[1] * k, v[2] * k]; }
    line(sc(e, 1), sc(e, 1.55), [0.3, 0.58, 0.94]); line(sc(s, 1), sc(s, 1.55), [1, 0.84, 0.4]); line(sc(sp, 1), sc(sp, 1.16), [1, 0.72, 0.49]);
    // limit of Earth visibility: the great circle 90 degrees from the sub-Earth point
    var a1 = GLX.norm(GLX.cross(e, Math.abs(e[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1])), a2 = GLX.cross(e, a1);
    for (i = 0; i < 90; i += 2) { var t0 = i / 90 * 6.2832, t1 = (i + 1) / 90 * 6.2832; line([1.006 * (Math.cos(t0) * a1[0] + Math.sin(t0) * a2[0]), 1.006 * (Math.cos(t0) * a1[1] + Math.sin(t0) * a2[1]), 1.006 * (Math.cos(t0) * a1[2] + Math.sin(t0) * a2[2])], [1.006 * (Math.cos(t1) * a1[0] + Math.sin(t1) * a2[0]), 1.006 * (Math.cos(t1) * a1[1] + Math.sin(t1) * a2[1]), 1.006 * (Math.cos(t1) * a1[2] + Math.sin(t1) * a2[2])], [0.3, 0.58, 0.94]); }
    if(st.mission){var ring=st.mission.ring;for(var ri=1;ri<ring.length;ri++)line(sc(uv(ring[ri-1].lat,ring[ri-1].lon),1.02),sc(uv(ring[ri].lat,ring[ri].lon),1.02),[1,.72,.49]);}
    GLX.setPos(ctx, mLines, LP); GLX.setCol(ctx, mLines, LC);
    render();
  }
  function render() {
    if (!ctx || !st) return; var gl = ctx.gl; GLX.resize(ctx);
    var mvp = GLX.mul(GLX.persp(cam.fov * RAD, ctx.w / ctx.h, 0.5, 20), GLX.lookAt(eye(), [0, 0, 0], [0, 0, 1]));
    gl.clearColor(0.012, 0.016, 0.03, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    planet.draw({ mvp: mvp, center: [0, 0, 0], radius: 1, eye: eye(), rot: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], sun: uv(st.sLat, st.sLon), kind: 'moon' });
    GLX.draw(ctx, mLines, mvp, gl.LINES);
    GLX.draw(ctx, mPts, mvp, gl.POINTS, 7, true);
    var E = eye();
    function place(el, v, k) { if (!el) return; var p = GLX.project(mvp, [v[0] * k, v[1] * k, v[2] * k], ctx.w, ctx.h), hid = k < 1.3 && GLX.dot(v, E) < 1; if (!p || hid || p.x < 4 || p.y < 12 || p.x > ctx.w - 4 || p.y > ctx.h - 4) { el.hidden = true; return; } el.hidden = false; el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; }
    place(labs.sun, uv(st.sLat, st.sLon), 1.6); place(labs.earth, uv(st.eLat, st.eLon), 1.6); place(labs.site, uv(st.sel.lat, st.sel.lon), 1.2);
    if (labs.site) labs.site.textContent = st.sel.n;
  }
  function focus(lat, lon) { cam.yaw = lon + 18; cam.pitch = Math.max(-80, Math.min(80, lat * 0.82)); render(); }
  return { init: init, update: update, render: render, focus: focus, albedo: albedo, setTexture: function (img) { if (planet && planet.setTexture('moon', img)) render(); } };
})();
