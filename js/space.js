/* Space: the Earth-Moon-Sun system at true scale in one Earth-centred ecliptic frame (1 unit = 1000 km),
   with third-person cameras, first-person views from Earth, the Moon and the Sun, and a first-person ride
   along a transfer ellipse from Earth to the Moon. */
var Space = (function () {
  'use strict';
  var RAD = Math.PI / 180, K = 0.001, ctx = null, gl = null, cv = null, labs = null, cb = {}, planet = null, st = null;
  var mStarsS, mStarsB, mSun, mGlow, mOrbit, mPath, mPts, orbitT = null, pathOf = null;
  var cam = { mode: 'system', yaw: 0.9, pitch: 0.5, dist: { system: 1150, earth: 24, moon: 7 }, fov: 45, zoom: 1, ox: 0, oy: 0, look: 'ahead' };
  var FOV = { fromEarth: 2.4, fromMoon: 14, fromSun: 2.8, flight: 55 };
  function add(a, b, k) { return [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]; }
  function len(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
  function init(canvas, labelEls, callbacks) {
    cv = canvas; labs = labelEls; cb = callbacks || {}; ctx = GLX.init(canvas); if (!ctx) return false; gl = ctx.gl; planet = Planet.create(ctx);
    var r = 777; function rnd() { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; }
    function stars(n, lo, hi, band) { var P = [], C = []; for (var i = 0; i < n; i++) { var z, a = rnd() * 6.2832; if (i < n * band) z = (rnd() + rnd() + rnd() - 1.5) * 0.22; else z = rnd() * 2 - 1; var s = Math.sqrt(Math.max(0, 1 - z * z)), x = s * Math.cos(a), y = s * Math.sin(a), b = lo + Math.pow(rnd(), 3) * (hi - lo), w = rnd(); P.push(x * 0.5 + z * 0.866, y, -x * 0.866 + z * 0.5); C.push(b * (0.9 + 0.1 * w), b * 0.95, b * (1.05 - 0.15 * w), 1); } return GLX.mesh(ctx, P, C); }
    mStarsS = stars(2800, 0.1, 0.6, 0.55); mStarsB = stars(280, 0.45, 1, 0.3);
    mSun = GLX.mesh(ctx, [], [], true); mGlow = GLX.mesh(ctx, [], [], true); mOrbit = GLX.mesh(ctx, [], [], true); mPath = GLX.mesh(ctx, [], [], true); mPts = GLX.mesh(ctx, [], [], true);
    var pts = {}, pinch = 0;
    cv.addEventListener('pointerdown', function (e) { pts[e.pointerId] = { x: e.clientX, y: e.clientY }; try { cv.setPointerCapture(e.pointerId); } catch (x) {} });
    function up(e) { delete pts[e.pointerId]; pinch = 0; }
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointermove', function (e) {
      var p0 = pts[e.pointerId]; if (!p0) return; var ids = Object.keys(pts), dx = e.clientX - p0.x, dy = e.clientY - p0.y; p0.x = e.clientX; p0.y = e.clientY;
      if (ids.length >= 2) { var a = pts[ids[0]], b = pts[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch > 0 && d > 0) zoom(pinch / d); pinch = d; return; }
      if (cam.dist[cam.mode]) { cam.yaw -= dx * 0.006; cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch + dy * 0.005)); }
      else { var k = (FOV[cam.mode] * cam.zoom) / ctx.h; cam.ox -= dx * k; cam.oy += dy * k; }
      render();
    });
    cv.addEventListener('wheel', function (e) { if (document.activeElement !== cv) return; e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    cv.addEventListener('keydown', function (e) { if (e.key === '+' || e.key === '=') zoom(0.8); else if (e.key === '-') zoom(1.25); });
    return true;
  }
  function line(P, C, pts, col, dashed) { for (var i = 0; i + 1 < pts.length; i += dashed ? 2 : 1) { P.push(pts[i][0], pts[i][1], pts[i][2], pts[i + 1][0], pts[i + 1][1], pts[i + 1][2]); C.push(col[0], col[1], col[2], 1, col[0], col[1], col[2], 1); } }
  /* state: {t (ms), vec (Ephem.vectors), site {lat, lon}, flight (Ephem.transfer or null)} */
  function update(state) {
    if (!ctx) return; st = state; var v = st.vec, i, P, C;
    st.moonP = [v.moon[0] * K, v.moon[1] * K, v.moon[2] * K];
    var b = Ephem.uv(st.site.lat, st.site.lon), R = v.moonRot; st.siteN = [R[0][0] * b[0] + R[1][0] * b[1] + R[2][0] * b[2], R[0][1] * b[0] + R[1][1] * b[1] + R[2][1] * b[2], R[0][2] * b[0] + R[1][2] * b[1] + R[2][2] * b[2]];
    st.siteP = add(st.moonP, st.siteN, 1.7374);
    if (orbitT === null || Math.abs(st.t - orbitT) > 6 * 3600000) { orbitT = st.t; P = []; C = []; var pts = []; for (i = 0; i <= 96; i++) { var m = Ephem.moonVec(st.t + (i / 96 - 0.5) * 27.32 * 86400000); pts.push([m[0] * K, m[1] * K, m[2] * K]); } line(P, C, pts, [0.32, 0.36, 0.46]); GLX.setPos(ctx, mOrbit, P); GLX.setCol(ctx, mOrbit, C); }
    if (st.flight !== pathOf) { pathOf = st.flight; P = []; C = []; if (st.flight) { var pp = []; for (i = 0; i <= 120; i++) { var q = Ephem.transferAt(st.flight, st.flight.t0 + i / 120 * st.flight.tof * 1000).pos; pp.push([q[0] * K, q[1] * K, q[2] * K]); } line(P, C, pp, [0.45, 0.9, 0.95]); } GLX.setPos(ctx, mPath, P); GLX.setCol(ctx, mPath, C); }
    st.craft = null; if (st.flight) { var c = Ephem.transferAt(st.flight, st.t).pos; st.craft = [c[0] * K, c[1] * K, c[2] * K]; }
    P = st.siteP.slice(); C = [1, 0.42, 0.62, 1]; if (st.craft) { P.push(st.craft[0], st.craft[1], st.craft[2]); C.push(0.5, 0.95, 1, 1); } GLX.setPos(ctx, mPts, P); GLX.setCol(ctx, mPts, C);
    var s = v.sun, u = GLX.norm(GLX.cross(s, [0, 0, 1])), w = GLX.cross(u, s), rs = Math.asin(695700 / v.sunR) / RAD, GP = [], GC = [], SP = [], SC = [];
    function fan(P2, C2, rad, cc, ce) { var t = Math.tan(rad * RAD), n = 36; for (var a = 0; a < n; a++) { var a0 = a / n * 6.2832, a1 = (a + 1) / n * 6.2832; P2.push(s[0], s[1], s[2]); C2.push(cc[0], cc[1], cc[2], cc[3]); [a0, a1].forEach(function (an) { P2.push(s[0] + t * (Math.cos(an) * u[0] + Math.sin(an) * w[0]), s[1] + t * (Math.cos(an) * u[1] + Math.sin(an) * w[1]), s[2] + t * (Math.cos(an) * u[2] + Math.sin(an) * w[2])); C2.push(ce[0], ce[1], ce[2], ce[3]); }); } }
    fan(SP, SC, rs, [1, 0.99, 0.95, 1], [1, 0.96, 0.82, 1]); fan(GP, GC, rs * 4, [1, 0.93, 0.72, 0.6], [1, 0.85, 0.5, 0]); fan(GP, GC, rs * 16, [1, 0.86, 0.6, 0.22], [1, 0.8, 0.5, 0]); fan(GP, GC, rs * 60, [1, 0.85, 0.65, 0.07], [1, 0.8, 0.6, 0]);
    GLX.setPos(ctx, mSun, SP); GLX.setCol(ctx, mSun, SC); GLX.setPos(ctx, mGlow, GP); GLX.setCol(ctx, mGlow, GC);
    if (!st.inited) { st.inited = 1; }
    if (!cam.set) { cam.set = 1; cam.yaw = Math.atan2(v.sun[1], v.sun[0]) + 0.75; }
    render();
  }
  function view() {
    var m = cam.mode, E = [0, 0, 0], M = st.moonP, eye, tgt, up = [0, 0, 1], fov, near, orbit = cam.dist[m];
    if (orbit) { tgt = m === 'moon' ? M : E; eye = add(tgt, [Math.cos(cam.pitch) * Math.cos(cam.yaw), Math.cos(cam.pitch) * Math.sin(cam.yaw), Math.sin(cam.pitch)], orbit); fov = cam.fov; near = Math.max(0.05, orbit * 0.01); }
    else {
      if (m === 'fromEarth') { eye = E; tgt = M; }
      else if (m === 'fromMoon') { eye = add(st.moonP, st.siteN, 1.7374 + 0.004); tgt = E; var d0 = GLX.norm(add(tgt, eye, -1)); if (Math.abs(GLX.dot(d0, st.siteN)) < 0.95) up = st.siteN; }
      else if (m === 'fromSun') { eye = add(E, st.vec.sun, 20000); tgt = [M[0] / 2, M[1] / 2, M[2] / 2]; }
      else { eye = st.craft || add(E, GLX.norm(M), -6.578); tgt = cam.look === 'back' ? E : M; if (len(add(tgt, eye, -1)) < 0.05) tgt = add(eye, GLX.norm(M), 1); }
      fov = FOV[m] * cam.zoom; near = m === 'fromSun' ? 1000 : 0.0008;
      // let the viewer look around a little
      var f = GLX.norm(add(tgt, eye, -1)), rt = GLX.norm(GLX.cross(f, up)), u2 = GLX.cross(rt, f), ax = Math.tan(cam.ox * RAD), ay = Math.tan(cam.oy * RAD); tgt = add(add(add(eye, f, 1), rt, ax), u2, ay);
    }
    return { eye: eye, tgt: tgt, up: up, fov: fov * RAD, near: near };
  }
  function render() {
    if (!ctx || !st) return; GLX.resize(ctx);
    var V = view(), aspect = ctx.w / ctx.h, v = st.vec, m = cam.mode, fwd = GLX.norm(add(V.tgt, V.eye, -1));
    var sky = GLX.mul(GLX.persp(V.fov, aspect, 0.05, 10), GLX.lookAt([0, 0, 0], fwd, V.up)), mvp = GLX.mul(GLX.persp(V.fov, aspect, V.near, 2000000), GLX.lookAt(V.eye, V.tgt, V.up));
    gl.clearColor(0.004, 0.005, 0.01, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    GLX.draw(ctx, mStarsS, sky, gl.POINTS, 1.2, true); GLX.draw(ctx, mStarsB, sky, gl.POINTS, 2.1, true);
    if (m !== 'fromSun') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); GLX.draw(ctx, mGlow, sky, gl.TRIANGLES); gl.disable(gl.BLEND); GLX.draw(ctx, mSun, sky, gl.TRIANGLES); }
    gl.enable(gl.DEPTH_TEST);
    planet.draw({ mvp: mvp, center: [0, 0, 0], radius: 6.371, eye: V.eye, rot: v.earthRot, sun: v.sun, kind: 'earth', t: st.t / 3.6e7 });
    planet.draw({ mvp: mvp, center: st.moonP, radius: 1.7374, eye: V.eye, rot: v.moonRot, sun: v.sun, kind: 'moon' });
    if (m !== 'fromEarth' && m !== 'fromMoon') { GLX.draw(ctx, mOrbit, mvp, gl.LINES); }
    if (m !== 'flight') GLX.draw(ctx, mPath, mvp, gl.LINES);
    if (m !== 'fromMoon' && m !== 'flight') GLX.draw(ctx, mPts, mvp, gl.POINTS, 6, true);
    function big(c, r) { var a = GLX.project(mvp, c, ctx.w, ctx.h), b = GLX.project(mvp, add(c, V.up, r), ctx.w, ctx.h); return a && b && Math.hypot(a.x - b.x, a.y - b.y) > 30; }
    function place(el, p3, hide) { if (!el) return; var p = hide ? null : GLX.project(mvp, p3, ctx.w, ctx.h); if (!p || p.x < 4 || p.y < 16 || p.x > ctx.w - 4 || p.y > ctx.h - 4) { el.hidden = true; return; } el.hidden = false; el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; }
    place(labs.earth, [0, 0, 0], m === 'fromEarth' || big([0, 0, 0], 6.371)); place(labs.moon, st.moonP, m === 'fromMoon' || big(st.moonP, 1.7374));
    place(labs.site, st.siteP, m === 'fromMoon' || m === 'flight' || m === 'system' || m === 'fromSun' || GLX.dot(st.siteN, add(V.eye, st.moonP, -1)) < 1.7374);
    place(labs.craft, st.craft || [0, 0, 0], !st.craft || m === 'flight');
    var sp = m === 'fromSun' ? null : GLX.project(sky, v.sun, ctx.w, ctx.h); if (labs.sun) { if (!sp || sp.x < 4 || sp.y < 16 || sp.x > ctx.w - 4 || sp.y > ctx.h - 4) labs.sun.hidden = true; else { labs.sun.hidden = false; labs.sun.style.left = sp.x + 'px'; labs.sun.style.top = sp.y + 'px'; } }
    if (cb.onCam) cb.onCam(cam);
  }
  function setMode(m) { cam.mode = m; cam.zoom = 1; cam.ox = 0; cam.oy = 0; if (cam.dist[m] && st) { cam.yaw = Math.atan2(st.vec.sun[1], st.vec.sun[0]) + 0.75; cam.pitch = m === 'system' ? 0.5 : 0.28; } render(); }
  function setLook(l) { cam.look = l; cam.ox = 0; cam.oy = 0; render(); }
  function zoom(f) { var m = cam.mode; if (cam.dist[m]) { var lim = m === 'system' ? [40, 6000] : m === 'earth' ? [8, 400] : [2.2, 200]; cam.dist[m] = Math.max(lim[0], Math.min(lim[1], cam.dist[m] * f)); } else cam.zoom = Math.max(0.05, Math.min(m === 'flight' ? 1.6 : 6, cam.zoom * f)); render(); }
  return { init: init, update: update, render: render, setMode: setMode, setLook: setLook, zoom: zoom, cam: cam, setTexture: function (kind, img) { if (planet && planet.setTexture(kind, img)) render(); } };
})();
