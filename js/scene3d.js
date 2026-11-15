/* Scene3D: the landing site rendered as continuous terrain at true scale, with a lander, a drivable rover with LED
   lamps, rocks, the Sun and a rotating Earth in the sky.
   Large shadows come from Terrain.shadow() (the same line-of-sight test the numbers use), uploaded as a texture.
   Fine surface relief (small craters, regolith texture) is added in the fragment shader for looks only: it is not in the model.
   Scene axes: x = grid east, y = up, z = grid south, metres. A local azimuth az is the grid bearing az + terrain.rot. */
var Scene3D = (function () {
  'use strict';
  var RAD = Math.PI / 180, DEG = 180 / Math.PI, ctx = null, gl = null, cv = null, labs = null, cb = {}, tr = null, st = null, planet = null;
  var tp = null, tb = null, plainBuf = null, litTex = null, litBuf = null, litBytes = null, amb = 0.04, expo = 1, occ = new Float32Array(40);
  var mStarsS, mStarsB, mSun, mGlow, mModels, mLander, mRover, mLines, mShadow, rocks = [], note = '', S_ = [0, 1, 0];
  var cam = { mode: 'orbit', yaw: 0, pitch: 0.2, dist: 85, fov: 50, fyaw: 0, fpitch: 4, ffov: 60, ryaw: 0, rpitch: 0.3, rdist: 14, lyaw: 0, lpitch: -4 };
  var rv = { x: 0, z: 0, head: 0, led: false, speed: 1 };
  var TVS = 'attribute vec3 aPos;attribute vec3 aNrm;uniform mat4 uMvp;uniform float uSpan;varying vec3 vW;varying vec3 vN;varying vec2 vUv;' +
    'void main(){vW=aPos;vN=aNrm;vUv=aPos.xz/uSpan+0.5;gl_Position=uMvp*vec4(aPos,1.0);}';
  var TFS = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
    'varying vec3 vW;varying vec3 vN;varying vec2 vUv;' +
    'uniform sampler2D uLit;uniform vec3 uSun;uniform vec3 uEye;uniform float uAmb;uniform float uPlain;uniform float uPlainLit;uniform float uExp;uniform float uPen;' +
    'uniform vec4 uOcc[10];uniform vec3 uLedPos;uniform vec3 uLedDir;uniform float uLed;' +
    'float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}' +
    'float vn(vec2 p){vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(h2(i),h2(i+vec2(1.0,0.0)),f.x),mix(h2(i+vec2(0.0,1.0)),h2(i+vec2(1.0,1.0)),f.x),f.y);}' +
    'float fbm(vec2 p){float a=0.5;float s=0.0;for(int i=0;i<3;i++){s+=a*vn(p);p=p*2.07+vec2(13.1,7.7);a*=0.5;}return s;}' +
    // bowl-shaped craters on a jittered grid of spacing G (metres); returns height in metres
    'float crat(vec2 p,float G){vec2 c=floor(p/G);float hh=0.0;' +
    'for(int a=-1;a<=1;a++){for(int b=-1;b<=1;b++){vec2 ci=c+vec2(float(a),float(b));if(h2(ci+3.7)<0.45)continue;' +
    'vec2 ctr=(ci+vec2(h2(ci+1.3),h2(ci+9.1)))*G;float rad=G*(0.12+0.30*h2(ci+5.5));float d=length(p-ctr)/rad;' +
    'if(d<1.6){hh+=rad*(d<1.0?(-0.22*(1.0-d*d)+0.05*d*d):0.05*(1.0-smoothstep(1.0,1.6,d)));}}}return hh;}' +
    'float bump(vec2 q,float a1,float a2){float b=0.0;if(a1>0.0)b+=a1*(0.10*fbm(q*1.1)+crat(q,11.0));if(a2>0.0)b+=a2*(1.4*fbm(q*0.06)+crat(q+vec2(31.7,11.3),64.0));return b;}' +
    'void main(){float dist=length(vW-uEye);vec2 q=vW.xz;' +
    'float a1=1.0-smoothstep(60.0,260.0,dist);float a2=1.0-smoothstep(500.0,1800.0,dist);vec2 ed=abs(vUv-0.5);float rim=smoothstep(0.36,0.49,max(ed.x,ed.y));vec3 n=normalize(mix(normalize(vN),vec3(0.0,1.0,0.0),rim));' +
    'if(a2>0.0){float e=max(0.2,dist*0.004);float b0=bump(q,a1,a2);float bx=bump(q+vec2(e,0.0),a1,a2);float bz=bump(q+vec2(0.0,e),a1,a2);n=normalize(n+vec3(b0-bx,0.0,b0-bz)/e);}' +
    'float lit=mix(smoothstep(0.3,0.7,texture2D(uLit,vUv).r),uPlainLit,max(uPlain,rim));float oc=1.0;' +
    // shadows of the lander, rover and boulders: is the ray to the Sun blocked by one of their bounding spheres?
    'for(int i=0;i<10;i++){vec3 c=uOcc[i].xyz-vW;float t=dot(c,uSun);if(t>0.0&&uOcc[i].w>0.0){float dd=length(c-t*uSun);oc*=smoothstep(uOcc[i].w*0.8,uOcc[i].w*1.1+t*uPen,dd);}}' +
    'float I=1.35*pow(max(dot(n,uSun),0.0),0.6);float alb=0.86+0.3*fbm(q*0.021)-0.06*fbm(q*0.35);vec3 base=vec3(0.60,0.585,0.56)*alb;' +
    'vec3 c=base*(uAmb+lit*oc*I*uExp);' +
    'if(uLed>0.5){vec3 L=uLedPos-vW;float dl=length(L);L/=dl;float cone=smoothstep(0.84,0.97,dot(-L,uLedDir));c+=base*vec3(0.86,0.93,1.0)*cone*(0.25+0.75*max(dot(n,L),0.0))*1.7/(1.0+dl*dl/90.0);}' +
    'c=c/(1.0+0.55*c)*1.55;gl_FragColor=vec4(c,1.0);}';
  // a once-subdivided octahedron: the shared shape of every rock, before each one is squashed and jittered
  var ROCK = (function () {
    var v = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], f = [], key = {};
    function mid(a, b) { var k = a < b ? a + '_' + b : b + '_' + a; if (key[k] == null) { var m = [v[a][0] + v[b][0], v[a][1] + v[b][1], v[a][2] + v[b][2]], l = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]); v.push([m[0] / l, m[1] / l, m[2] / l]); key[k] = v.length - 1; } return key[k]; }
    [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]].forEach(function (t) { var a = mid(t[0], t[1]), b = mid(t[1], t[2]), c = mid(t[2], t[0]); f.push([t[0], a, c], [a, t[1], b], [c, b, t[2]], [a, b, c]); });
    return { v: v, f: f };
  })();
  function dir(b, el) { b *= RAD; el *= RAD; return [Math.cos(el) * Math.sin(b), Math.sin(el), -Math.cos(el) * Math.cos(b)]; }
  function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function span() { return tr.N * tr.cell; }
  var meshHeights=null,landerY=0,roverLift=0;
  function ground(x,z){return SurfacePlacement.sample(tr,meshHeights,x,z);}
  function cellOf(x, z) { var N = tr.N, i = Math.max(0, Math.min(N - 1, Math.floor(x / tr.cell + N / 2))), j = Math.max(0, Math.min(N - 1, Math.floor(z / tr.cell + N / 2))); return j * N + i; }

  function init(canvas, labelEls, callbacks) {
    cv = canvas; labs = labelEls; cb = callbacks || {}; ctx = GLX.init(canvas); if (!ctx) return false; gl = ctx.gl;
    var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, TVS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, TFS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    tp = { p: p, u: {} }; ['aPos', 'aNrm'].forEach(function (n) { tp[n] = gl.getAttribLocation(p, n); });
    ['uMvp', 'uSpan', 'uLit', 'uSun', 'uEye', 'uAmb', 'uPlain', 'uPlainLit', 'uExp', 'uPen', 'uOcc', 'uLedPos', 'uLedDir', 'uLed'].forEach(function (n) { tp.u[n] = gl.getUniformLocation(p, n); });
    litTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, litTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    planet = Planet.create(ctx); GLX.use(ctx);
    // stars: a faint field plus a denser band for the Milky Way
    var r = 12345; function rnd() { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; }
    function stars(n, lo, hi, band) {
      var P = [], C = []; for (var i = 0; i < n; i++) {
        var z, a = rnd() * 6.2832; if (i < n * band) { z = (rnd() + rnd() + rnd() - 1.5) * 0.22; } else z = rnd() * 2 - 1; var s = Math.sqrt(Math.max(0, 1 - z * z)), x = s * Math.cos(a), y = s * Math.sin(a);
        var b = lo + Math.pow(rnd(), 3) * (hi - lo), w = rnd(); P.push(x * 0.8 + z * 0.6, y, -x * 0.6 + z * 0.8); C.push(b * (0.9 + 0.1 * w), b * 0.95, b * (1.05 - 0.15 * w), 1);
      } return GLX.mesh(ctx, P, C);
    }
    mStarsS = stars(2600, 0.1, 0.6, 0.55); mStarsB = stars(260, 0.45, 1, 0.3);
    mSun = GLX.mesh(ctx, [], [], true); mGlow = GLX.mesh(ctx, [], [], true); mModels = GLX.mesh(ctx, [], [], true); mLander = GLX.mesh(ctx, [], [], true); mRover = GLX.mesh(ctx, [], [], true); mLines = GLX.mesh(ctx, [], [], true); mShadow = GLX.mesh(ctx, [], [], true);
    // pointer: drag to look, pinch or wheel (when focused) to zoom
    var pts = {}, pinch = 0;
    cv.addEventListener('pointerdown', function (e) { pts[e.pointerId] = { x: e.clientX, y: e.clientY }; try { cv.setPointerCapture(e.pointerId); } catch (x) {} });
    function up(e) { delete pts[e.pointerId]; pinch = 0; }
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointermove', function (e) {
      var p0 = pts[e.pointerId]; if (!p0) return; var ids = Object.keys(pts), dx = e.clientX - p0.x, dy = e.clientY - p0.y; p0.x = e.clientX; p0.y = e.clientY;
      if (ids.length >= 2) { var a = pts[ids[0]], b = pts[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch > 0 && d > 0) zoom(pinch / d); pinch = d; return; }
      var m = cam.mode;
      if (m === 'orbit') { cam.yaw -= dx * 0.006; cam.pitch = Math.max(0.02, Math.min(1.5, cam.pitch + dy * 0.005)); }
      else if (m === 'rover') { cam.ryaw -= dx * 0.006; cam.rpitch = Math.max(0.03, Math.min(1.5, cam.rpitch + dy * 0.005)); }
      else { var k = 0.16 * cam.ffov / 60; if (m === 'ride') { cam.lyaw -= dx * k; cam.lpitch = Math.max(-50, Math.min(85, cam.lpitch + dy * k)); } else { cam.fyaw -= dx * k; cam.fpitch = Math.max(-40, Math.min(85, cam.fpitch + dy * k)); } }
      render();
    });
    cv.addEventListener('wheel', function (e) { if (document.activeElement !== cv) return; e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    cv.addEventListener('keydown', function (e) {
      var k = e.key.toLowerCase(), m = k === 'arrowup' || k === 'w' ? [0, 1] : k === 'arrowdown' || k === 's' ? [0, -1] : k === 'arrowleft' || k === 'a' ? [-1, 0] : k === 'arrowright' || k === 'd' ? [1, 0] : null;
      if (m) { e.preventDefault(); moveRover(m[0], m[1]); } else if (k === 'l') setLed(!rv.led); else if (k === 'u') setSpeed(rv.speed === 1 ? 6 : rv.speed === 6 ? 40 : 1); else if (k === '+' || k === '=') zoom(0.8); else if (k === '-') zoom(1.25);
    });
    return true;
  }

  function buildTerrain(t) {
    tr = t; var N = t.N, c = t.cell, base = t.mean - t.h0, y = new Float32Array(N * N), i, j, k = 0;
    y = meshHeights = SurfacePlacement.heights(t);
    var pos = new Float32Array(N * N * 3), nrm = new Float32Array(N * N * 3)  , idx = new Uint16Array((N - 1) * (N - 1) * 6);
    for (j = 0; j < N; j++) for (i = 0; i < N; i++) {
      var o = j * N + i, dx = (y[j * N + Math.min(N - 1, i + 1)] - y[j * N + Math.max(0, i - 1)]) / (2 * c), dz = (y[Math.min(N - 1, j + 1) * N + i] - y[Math.max(0, j - 1) * N + i]) / (2 * c), l = Math.sqrt(dx * dx + dz * dz + 1);
      pos[o * 3] = (i + 0.5 - N / 2) * c; pos[o * 3 + 1] = y[o]; pos[o * 3 + 2] = (j + 0.5 - N / 2) * c; nrm[o * 3] = -dx / l; nrm[o * 3 + 1] = 1 / l; nrm[o * 3 + 2] = -dz / l;
    }
    for (j = 0; j < N - 1; j++) for (i = 0; i < N - 1; i++) { var a = j * N + i; idx[k++] = a; idx[k++] = a + N; idx[k++] = a + 1; idx[k++] = a + 1; idx[k++] = a + N; idx[k++] = a + N + 1; }
    if (tb) { gl.deleteBuffer(tb.pos); gl.deleteBuffer(tb.nrm); gl.deleteBuffer(tb.idx); }
    tb = { pos: gl.createBuffer(), nrm: gl.createBuffer(), idx: gl.createBuffer(), n: idx.length };
    gl.bindBuffer(gl.ARRAY_BUFFER, tb.pos); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, tb.nrm); gl.bufferData(gl.ARRAY_BUFFER, nrm, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, tb.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    // the smooth plain beyond the grid: four rectangles around it
    var h = (N - 1) * c / 2, R = Math.max(180000, N * c * 4), P = [];
    function rect(x0, z0, x1, z1) { P.push(x0, base, z0, x0, base, z1, x1, base, z1, x0, base, z0, x1, base, z1, x1, base, z0); }
    rect(-R, -R, R, -h); rect(-R, h, R, R); rect(-R, -h, -h, h); rect(h, -h, R, h);
    if (!plainBuf) plainBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, plainBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P), gl.STATIC_DRAW);
    litBuf = new Float32Array(N * N); litBytes = new Uint8Array(N * N);
    // rocks near the lander, the same for a given terrain
    var seed = (Math.floor(Math.abs(t.h[7] * 977 + t.h[N * 40 + 9] * 131)) % 2147483000) + 11; function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    rocks = [];
    if (t.kind !== 'sphere' || true) for (k = 0; k < 230; k++) {
      var big = k < 6, an = rnd() * 6.2832, rr = big ? 22 + rnd() * 150 : 5 + 230 * Math.pow(rnd(), 1.6), sz = big ? 1.3 + rnd() * 1.8 : 0.1 + 0.75 * Math.pow(rnd(), 2.2), rx = Math.cos(an) * rr, rz = Math.sin(an) * rr, V = [];
      ROCK.v.forEach(function (u) { var s = sz * (0.62 + 0.38 * rnd()); V.push([u[0] * s, u[1] * s * 0.62, u[2] * s]); });
      rocks.push({ x: rx, z: rz, y: ground(rx, rz) - sz * 0.12, s: sz, v: V, tone: 0.42 + 0.2 * rnd() });
    }
    cam.dist = 85; cam.rdist = 14; cam.pitch = 0.2; cam.rpitch = 0.3;
    cam.yaw = Math.PI - (st.sunAz + tr.rot) * RAD + 1.0; cam.ryaw = cam.yaw; cam.fyaw = st.sunAz + tr.rot + 60; resetRover(true);
  }
  /* Park the rover close to the lander, preferring a sunlit spot. */
  function resetRover(silent) {
    var best = [12, 6], bs = -1;
    for (var r = 12; r <= 20; r += 4) for (var a = 0; a < 12; a++) { var x = Math.cos(a / 12 * 6.2832) * r, z = Math.sin(a / 12 * 6.2832) * r, sc = st && st.sunEl - (Terrain.horizonFrom(tr, x, -z, st.sunAz, 2) + st.mask) > st.rs ? 1 : 0; if (sc > bs) { bs = sc; best = [x, z]; } }
    rv.x = best[0]; rv.z = best[1]; rv.head = Math.atan2(best[1], -best[0]) + 2.2; note = ''; cam.lyaw = 90 - rv.head * DEG;
    if (!silent) { buildModels(); render(); emitRover(); }
  }

  /* ---- small mesh builders, lit per face on the CPU ---- */
  function tri(P, C, a, b, c, col, ctr, lit, emit) {
    var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2], nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (nx * ((a[0] + b[0] + c[0]) / 3 - ctr[0]) + ny * ((a[1] + b[1] + c[1]) / 3 - ctr[1]) + nz * ((a[2] + b[2] + c[2]) / 3 - ctr[2]) < 0) { nx = -nx; ny = -ny; nz = -nz; }
    var I = emit ? 1 : Math.min(1.25, amb * 1.6 + 0.035 + lit * Math.pow(Math.max(0, nx * S_[0] + ny * S_[1] + nz * S_[2]), 0.8) * 1.1 * Math.min(expo, 1.3));
    P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); for (var k = 0; k < 3; k++) C.push(col[0] * I, col[1] * I, col[2] * I, 1);
  }
  function box(P, C, ctr, size, yaw, col, lit, emit) {
    var co = Math.cos(yaw), si = Math.sin(yaw), v = [];
    for (var k = 0; k < 8; k++) { var x = (k & 1 ? 1 : -1) * size[0] / 2, y = (k & 2 ? 1 : -1) * size[1] / 2, z = (k & 4 ? 1 : -1) * size[2] / 2; v.push([ctr[0] + x * co + z * si, ctr[1] + y, ctr[2] - x * si + z * co]); }
    [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]].forEach(function (f) { tri(P, C, v[f[0]], v[f[1]], v[f[2]], col, ctr, lit, emit); tri(P, C, v[f[0]], v[f[2]], v[f[3]], col, ctr, lit, emit); });
  }
  function tube(P, C, p0, p1, r0, r1, n, col, lit, caps) {
    var ax = GLX.norm([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]), u = GLX.norm(GLX.cross(ax, Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), v = GLX.cross(ax, u), ctr = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2], A = [], B = [];
    for (var k = 0; k < n; k++) { var a = k / n * 6.2832, c = Math.cos(a), s = Math.sin(a); A.push([p0[0] + r0 * (c * u[0] + s * v[0]), p0[1] + r0 * (c * u[1] + s * v[1]), p0[2] + r0 * (c * u[2] + s * v[2])]); B.push([p1[0] + r1 * (c * u[0] + s * v[0]), p1[1] + r1 * (c * u[1] + s * v[1]), p1[2] + r1 * (c * u[2] + s * v[2])]); }
    for (k = 0; k < n; k++) { var m = (k + 1) % n; tri(P, C, A[k], A[m], B[m], col, ctr, lit); tri(P, C, A[k], B[m], B[k], col, ctr, lit); if (caps) { tri(P, C, p0, A[k], A[m], col, ctr, lit); tri(P, C, p1, B[k], B[m], col, ctr, lit); } }
  }

  /* What the rover can see from where it stands */
  function roverInfo() {
    var x = rv.x, yN = -rv.z, hzS = Terrain.horizonFrom(tr, x, yN, st.sunAz, 2) + st.mask, hzE = Terrain.horizonFrom(tr, x, yN, st.earthAz, 2) + st.mask;
    var xx = (st.sunEl - hzS) / st.rs, frac = xx <= -1 ? 0 : xx >= 1 ? 1 : (Math.acos(-xx) + xx * Math.sqrt(1 - xx * xx)) / Math.PI, h = Terrain.sample(tr, x, yN);
    return { dist: Math.sqrt(x * x + yN * yN), az: ((Math.atan2(x, yN) * DEG - tr.rot) % 360 + 360) % 360, dh: (h === null ? tr.h0 : h) - tr.h0,
      frac: frac, comm: st.earthEl > hzE + st.margin, los: Terrain.los(tr, x, yN, 2, 0, 0, 3), led: rv.led, speed: rv.speed, note: note };
  }
  function emitRover() { if (cb.onRover && st) cb.onRover(roverInfo()); }
  function roverFrame() { var gy = ground(rv.x, rv.z) + roverLift, co = Math.cos(rv.head), si = Math.sin(rv.head); return { gy: gy, f: [co, 0, -si], pt: function (a, h, b) { return [rv.x + a * co + b * si, gy + h, rv.z - a * si + b * co]; } }; }

  function buildModels(roverOnly) {
    var sb = st.sunAz + tr.rot, P = [], C = [], lit = st.frac, i; S_ = dir(sb, st.sunEl);
    var gold = [0.86, 0.66, 0.22], foil = [0.7, 0.55, 0.2], grey = [0.74, 0.74, 0.78], dark = [0.16, 0.17, 0.19], blue = [0.1, 0.18, 0.5], white = [0.9, 0.91, 0.93];
    if (!roverOnly) {
    // lander, about 5 m across the legs
    tube(P, C, [0, 1.0, 0], [0, 2.6, 0], 1.25, 1.25, 8, gold, lit, true); tube(P, C, [0, 2.6, 0], [0, 2.78, 0], 1.0, 0.9, 8, grey, lit, true); tube(P, C, [0, 1.0, 0], [0, 0.42, 0], 0.28, 0.58, 10, dark, lit, false);
    for (i = 0; i < 4; i++) { var a = i * Math.PI / 2 + 0.6, cx = Math.cos(a), cz = Math.sin(a), foot = [cx * 2.5, 0.14, cz * 2.5]; tube(P, C, [cx * 1.2, 1.3, cz * 1.2], foot, 0.06, 0.06, 5, grey, lit, false); tube(P, C, [cx * 1.2, 2.4, cz * 1.2], foot, 0.045, 0.045, 5, grey, lit, false); tube(P, C, [foot[0], 0.02, foot[2]], [foot[0], 0.14, foot[2]], 0.3, 0.26, 8, foil, lit, true); }
    box(P, C, [0.55, 2.95, -0.4], [0.5, 0.34, 0.4], 0.4, white, lit); box(P, C, [-0.5, 2.9, 0.3], [0.36, 0.24, 0.5], 1.1, dark, lit);
    tube(P, C, [0, 2.78, 0], [0, 4.0, 0], 0.045, 0.045, 5, grey, lit, false);
    box(P, C, [0, 3.45, 0], [2.7, 1.1, 0.05], Math.PI - sb * RAD, blue, lit);
    var eb = st.earthEl > 2 ? dir(st.earthAz + tr.rot, st.earthEl) : [0.3, 0.9, 0.3], d0 = [-0.75, 3.0, -0.55];
    tube(P, C, [d0[0], 2.78, d0[2]], d0, 0.035, 0.035, 5, grey, lit, false); tube(P, C, d0, [d0[0] + eb[0] * 0.3, d0[1] + eb[1] * 0.3, d0[2] + eb[2] * 0.3], 0.05, 0.5, 12, white, lit, false);
    landerY=ground(0,0);for(var v=1;v<P.length;v+=3)P[v]+=landerY;var lift=SurfacePlacement.clearance(P,ground,.035);landerY+=lift;for(var v=1;v<P.length;v+=3)P[v]+=lift;
    GLX.setPos(ctx, mLander, P); GLX.setCol(ctx, mLander, C); P = []; C = [];
    }
    // rover, about 2.4 m long
    roverLift=0;var ri = roverInfo(), F = roverFrame(), rl = ri.frac, th = rv.head;
    box(P, C, F.pt(0, 0.72, 0), [1.9, 0.36, 1.15], th, white, rl); box(P, C, F.pt(-0.2, 1.0, 0), [1.35, 0.05, 1.2], th, blue, rl);
    [-0.75, 0, 0.75].forEach(function (a2) { [-1, 1].forEach(function (s2) { tube(P, C, F.pt(a2, 0.3, s2 * 0.6), F.pt(a2, 0.3, s2 * 0.86), 0.3, 0.3, 10, dark, rl, true); tube(P, C, F.pt(a2, 0.3, s2 * 0.55), F.pt(a2, 0.62, s2 * 0.5), 0.035, 0.035, 4, grey, rl, false); }); });
    tube(P, C, F.pt(0.62, 0.9, 0), F.pt(0.62, 1.86, 0), 0.04, 0.04, 5, grey, rl, false); box(P, C, F.pt(0.66, 1.95, 0), [0.24, 0.2, 0.5], th, dark, rl);
    var lamp = rv.led ? [1, 0.98, 0.88] : [0.35, 0.35, 0.33]; box(P, C, F.pt(0.8, 1.95, 0.16), [0.06, 0.1, 0.12], th, lamp, rl, rv.led); box(P, C, F.pt(0.8, 1.95, -0.16), [0.06, 0.1, 0.12], th, lamp, rl, rv.led);
    tube(P, C, F.pt(-0.7, 0.9, 0.35), F.pt(-0.85, 1.6, 0.35), 0.02, 0.02, 4, grey, rl, false);
    roverLift=SurfacePlacement.clearance(P,ground,.025);for(var v=1;v<P.length;v+=3)P[v]+=roverLift;F.gy+=roverLift;
    GLX.setPos(ctx, mRover, P); GLX.setCol(ctx, mRover, C); P = []; C = [];
    if (!roverOnly) {
    // rocks, with stretched shadows for the small ones (the six boulders cast shadows in the terrain shader)
    var SP = [], SC = [], tanEl = Math.tan(st.sunEl * RAD), hl = Math.sqrt(S_[0] * S_[0] + S_[2] * S_[2]) || 1, hx = -S_[0] / hl, hz = -S_[2] / hl;
    rocks.forEach(function (r, k) {
      var rlit = litBuf[cellOf(r.x, r.z)], ctr = [r.x, r.y, r.z], v = r.v.map(function (q) { return [r.x + q[0], r.y + q[1], r.z + q[2]]; }), col = [r.tone, r.tone * 0.98, r.tone * 0.95];
      ROCK.f.forEach(function (f) { tri(P, C, v[f[0]], v[f[1]], v[f[2]], col, ctr, rlit); });
      if (k >= 6 && rlit > 0.5 && tanEl > 0.004) {
        var len = Math.min(r.s * 0.6 / tanEl, 70), w = r.s * 0.45, px = -hz, pz = hx, prev = null;
        for (var s = 0; s <= 4; s++) { var t2 = s / 4 * len, x = r.x + hx * t2, z = r.z + hz * t2, y = ground(x, z) + 0.03, al = 0.78 - 0.4 * s / 4, cur = [[x + px * w, y, z + pz * w], [x - px * w, y, z - pz * w], al];
          if (prev) { [[prev[0], prev[1], cur[1], prev[2], prev[2], cur[2]], [prev[0], cur[1], cur[0], prev[2], cur[2], cur[2]]].forEach(function (q) { for (var m = 0; m < 3; m++) { SP.push(q[m][0], q[m][1], q[m][2]); SC.push(0, 0, 0, q[m + 3]); } }); } prev = cur; }
      }
    });
    GLX.setPos(ctx, mModels, P); GLX.setCol(ctx, mModels, C); GLX.setPos(ctx, mShadow, SP); GLX.setCol(ctx, mShadow, SC);
    }
    // shadow casters for the terrain shader
    occ.fill(0); occ.set([0, landerY+1.9, 0, 1.55, 0, landerY+3.4, 0, 1.15, rv.x, F.gy + 0.9, rv.z, 1.05]);
    for (i = 0; i < 6 && i < rocks.length; i++) occ.set([rocks[i].x, rocks[i].y + rocks[i].s * 0.3, rocks[i].z, rocks[i].s * 0.72], 12 + i * 4);
    var top = span() * 0.08; GLX.setPos(ctx, mLines, [0, landerY+4.2, 0, 0, landerY+4.2 + top, 0, rv.x, F.gy + 2.2, rv.z, rv.x, F.gy + 2.2 + top * 0.7, rv.z]);
    GLX.setCol(ctx, mLines, [1, 0.42, 0.62, 1, 1, 0.42, 0.62, 1, 0.4, 0.9, 0.95, 1, 0.4, 0.9, 0.95, 1]);
  }

  /* state: {tr, sunAz, sunEl, rs, earthAz, earthEl, re, frac, extraH, mask, margin, earthRot, t} with angles in local degrees.
     earthRot is three column vectors: Earth's own axes expressed in scene coordinates. */
  function update(state) {
    if (!ctx) return; var fresh = state.tr !== tr; st = state; if (fresh) buildTerrain(state.tr);
    var s = dir(st.sunAz + tr.rot, st.sunEl), i;
    amb = 0.035 + (st.earthEl > 0 ? 0.02 : 0); expo = 1 / (0.22 + 0.78 * Math.pow(Math.max(Math.sin(st.sunEl * RAD), 0.03), 0.6));
    Terrain.shadow(tr, st.sunAz, st.sunEl, st.rs, st.extraH, litBuf);
    for (i = 0; i < litBuf.length; i++) litBytes[i] = litBuf[i] * 255;
    gl.bindTexture(gl.TEXTURE_2D, litTex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, tr.N, tr.N, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, litBytes);
    var u = GLX.norm(GLX.cross(s, Math.abs(s[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0])), v = GLX.cross(u, s), GP = [], GC = [];
    function fan(P, C, rad, cc, ce) { var t = Math.tan(rad * RAD), m = 36; for (var a = 0; a < m; a++) { var a0 = a / m * 6.2832, a1 = (a + 1) / m * 6.2832; P.push(s[0], s[1], s[2]); C.push(cc[0], cc[1], cc[2], cc[3]); [a0, a1].forEach(function (an) { P.push(s[0] + t * (Math.cos(an) * u[0] + Math.sin(an) * v[0]), s[1] + t * (Math.cos(an) * u[1] + Math.sin(an) * v[1]), s[2] + t * (Math.cos(an) * u[2] + Math.sin(an) * v[2])); C.push(ce[0], ce[1], ce[2], ce[3]); }); } }
    var SP = [], SC = []; fan(SP, SC, st.rs, [1, 0.99, 0.95, 1], [1, 0.96, 0.82, 1]); GLX.setPos(ctx, mSun, SP); GLX.setCol(ctx, mSun, SC);
    fan(GP, GC, st.rs * 4, [1, 0.93, 0.72, 0.6], [1, 0.85, 0.5, 0]); fan(GP, GC, st.rs * 16, [1, 0.86, 0.6, 0.22], [1, 0.8, 0.5, 0]); fan(GP, GC, st.rs * 60, [1, 0.85, 0.65, 0.07], [1, 0.8, 0.6, 0]);
    GLX.setPos(ctx, mGlow, GP); GLX.setCol(ctx, mGlow, GC);
    buildModels(); render(); emitRover();
  }

  function view() {
    var m = cam.mode, eye, fwd, fov = (m === 'lander' || m === 'ride' ? cam.ffov : cam.fov) * RAD, near, dist = null;
    if (m === 'lander') { eye = [0, landerY+3.0, 0]; fwd = dir(cam.fyaw, cam.fpitch); near = 0.15; }
    else if (m === 'ride') { var F = roverFrame(); eye = F.pt(0.75, 1.95, 0); fwd = dir(cam.lyaw, cam.lpitch); near = 0.12; }
    else {
      var rvm = m === 'rover', T = rvm ? [rv.x, roverFrame().gy + 1.0, rv.z] : [0, landerY+1.6, 0], yw = rvm ? cam.ryaw : cam.yaw, pt = rvm ? cam.rpitch : cam.pitch; dist = rvm ? cam.rdist : cam.dist;
      eye = [T[0] + dist * Math.cos(pt) * Math.sin(yw), T[1] + dist * Math.sin(pt), T[2] + dist * Math.cos(pt) * Math.cos(yw)]; eye[1] = Math.max(eye[1], ground(eye[0], eye[2]) + 0.6);
      fwd = GLX.norm([T[0] - eye[0], T[1] - eye[1], T[2] - eye[2]]); near = Math.max(0.2, dist * 0.03);
    }
    return { eye: eye, fwd: fwd, fov: fov, near: near, dist: dist };
  }
  function render() {
    if (!ctx || !st) return; GLX.resize(ctx);
    var V = view(), aspect = ctx.w / ctx.h, m = cam.mode, s = dir(st.sunAz + tr.rot, st.sunEl), e = dir(st.earthAz + tr.rot, st.earthEl);
    var sky = GLX.mul(GLX.persp(V.fov, aspect, 0.05, 10), GLX.lookAt([0, 0, 0], V.fwd, [0, 1, 0]));
    var mvp = GLX.mul(GLX.persp(V.fov, aspect, V.near, Math.max(400000, span() * 8)), GLX.lookAt(V.eye, [V.eye[0] + V.fwd[0], V.eye[1] + V.fwd[1], V.eye[2] + V.fwd[2]], [0, 1, 0]));
    gl.clearColor(0.004, 0.005, 0.01, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    GLX.draw(ctx, mStarsS, sky, gl.POINTS, 1.2, true); GLX.draw(ctx, mStarsB, sky, gl.POINTS, 2.1, true);
    planet.draw({ mvp: sky, center: e, radius: Math.tan(st.re * RAD), eye: [0, 0, 0], rot: st.earthRot, sun: s, kind: 'earth', t: st.t / 3.6e7 });
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); GLX.draw(ctx, mGlow, sky, gl.TRIANGLES); gl.disable(gl.BLEND);
    GLX.draw(ctx, mSun, sky, gl.TRIANGLES);
    gl.enable(gl.DEPTH_TEST);
    // terrain and the surrounding plain
    gl.useProgram(tp.p); gl.enableVertexAttribArray(tp.aPos); gl.enableVertexAttribArray(tp.aNrm); gl.uniform1f(tp.u.uSpan, span());
    gl.uniformMatrix4fv(tp.u.uMvp, false, mvp); gl.uniform3fv(tp.u.uSun, s); gl.uniform3fv(tp.u.uEye, V.eye); gl.uniform1f(tp.u.uAmb, amb); gl.uniform1f(tp.u.uExp, expo); gl.uniform1f(tp.u.uPen, Math.tan(st.rs * RAD));
    gl.uniform4fv(tp.u.uOcc, occ); gl.uniform1f(tp.u.uPlainLit, st.sunEl + st.rs > 0 ? 1 : 0); gl.uniform1f(tp.u.uLed, rv.led ? 1 : 0);
    var F = roverFrame(), lp = F.pt(0.85, 1.95, 0), ld = GLX.norm([F.f[0], -0.24, F.f[2]]); gl.uniform3fv(tp.u.uLedPos, lp); gl.uniform3fv(tp.u.uLedDir, ld);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, litTex); gl.uniform1i(tp.u.uLit, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, tb.pos); gl.vertexAttribPointer(tp.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, tb.nrm); gl.vertexAttribPointer(tp.aNrm, 3, gl.FLOAT, false, 0, 0);
    gl.uniform1f(tp.u.uPlain, 0); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, tb.idx); gl.drawElements(gl.TRIANGLES, tb.n, gl.UNSIGNED_SHORT, 0);
    gl.disableVertexAttribArray(tp.aNrm); gl.vertexAttrib3f(tp.aNrm, 0, 1, 0);
    gl.uniform1f(tp.u.uPlain, 1); gl.bindBuffer(gl.ARRAY_BUFFER, plainBuf); gl.vertexAttribPointer(tp.aPos, 3, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 24);
    gl.disableVertexAttribArray(tp.aPos); GLX.use(ctx);
    // rock shadows, then the models
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -2);
    GLX.draw(ctx, mShadow, mvp, gl.TRIANGLES); gl.disable(gl.POLYGON_OFFSET_FILL); gl.depthMask(true); gl.disable(gl.BLEND);
    GLX.draw(ctx, mModels, mvp, gl.TRIANGLES); if (m !== 'lander') GLX.draw(ctx, mLander, mvp, gl.TRIANGLES); if (m !== 'ride') GLX.draw(ctx, mRover, mvp, gl.TRIANGLES);
    var far = V.dist !== null && V.dist > 260; if (far) GLX.draw(ctx, mLines, mvp, gl.LINES);
    // HTML labels
    function place(el, p) { if (!el) return; if (!p || p.x < 4 || p.y < 14 || p.x > ctx.w - 4 || p.y > ctx.h - 4) { el.hidden = true; return; } el.hidden = false; el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; }
    place(labs.sun, GLX.project(sky, s, ctx.w, ctx.h)); place(labs.earth, GLX.project(sky, e, ctx.w, ctx.h));
    place(labs.north, GLX.project(sky, dir(tr.rot, 2), ctx.w, ctx.h));
    var top = far ? span() * 0.08 : 0;
    place(labs.lander, m === 'lander' ? null : GLX.project(mvp, [0, landerY+4.6 + top, 0], ctx.w, ctx.h));
    place(labs.rover, m === 'ride' ? null : GLX.project(mvp, [rv.x, F.gy + 2.6 + top * 0.7, rv.z], ctx.w, ctx.h));
    if (cb.onCam) cb.onCam(cam, V.dist, cam.ffov);
  }
  /* Drive the rover: right and fwd are -1, 0 or 1, relative to the camera. The step grows as you zoom out. */
  function moveRover(right, fwd) {
    if (!ctx || !st) return; var fx, fz, m = cam.mode, step;
    if (m === 'lander' || m === 'ride') { var d = dir(m === 'ride' ? cam.lyaw : cam.fyaw, 0); fx = d[0]; fz = d[2]; step = 1.2 * rv.speed; }
    else { var y = m === 'rover' ? cam.ryaw : cam.yaw; fx = -Math.sin(y); fz = -Math.cos(y); step = Math.max(0.6, Math.min(30, (m === 'rover' ? cam.rdist : cam.dist) * 0.04)) * rv.speed; }
    var mx = (fx * fwd - fz * right) * step, mz = (fz * fwd + fx * right) * step, nx = rv.x + mx, nz = rv.z + mz, lim = span() / 2 - tr.cell * 14;
    rv.head = Math.atan2(-mz, mx);
    if (Math.abs(nx) > lim || Math.abs(nz) > lim) note = 'Edge of the mapped area';
    else if (Math.abs(ground(nx, nz) - ground(rv.x, rv.z)) / step > 0.55) note = 'Too steep to drive that way';
    else if (Math.hypot(nx, nz) < 3.2) note = 'The lander is in the way';
    else { rv.x = nx; rv.z = nz; note = ''; }
    buildModels(true); render(); emitRover();
  }
  function setSpeed(mult) { rv.speed = mult; emitRover(); }
  function setLed(on) { rv.led = !!on; if (st) { buildModels(true); render(); emitRover(); } }
  function setMode(m) { cam.mode = m; if (m === 'lander' || m === 'ride') cam.ffov = 60; if (m === 'ride') { cam.lyaw = 90 - rv.head * DEG; cam.lpitch = -4; } render(); }
  function face(which) { if (!st) return; cam.mode = 'lander'; var az = which === 'sun' ? st.sunAz : st.earthAz, el = which === 'sun' ? st.sunEl : st.earthEl; cam.ffov = 30; cam.fyaw = az + tr.rot; cam.fpitch = Math.max(0, Math.min(80, Math.max(Math.min(el, 2), el - 9))); render(); }
  function zoom(f) {
    if (!tr) return; var m = cam.mode;
    if (m === 'orbit') cam.dist = Math.max(8, Math.min(span() * 2.4, cam.dist * f)); else if (m === 'rover') cam.rdist = Math.max(4, Math.min(span() * 0.6, cam.rdist * f)); else cam.ffov = Math.max(4, Math.min(85, cam.ffov * f));
    render();
  }
  return { init: init, update: update, render: render, setMode: setMode, face: face, zoom: zoom, moveRover: moveRover, setLed: setLed, setSpeed: setSpeed, setTexture: function (img) { if (planet && planet.setTexture('earth', img)) render(); }, resetRover: function () { if (tr && st) resetRover(false); }, cam: cam };
})();
