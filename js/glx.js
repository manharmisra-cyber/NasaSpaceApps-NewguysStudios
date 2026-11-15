/* GLX: a very small WebGL helper (one shader: position + RGBA vertex colour). No dependencies. */
var GLX = (function () {
  'use strict';
  var VS = 'attribute vec3 aPos;attribute vec4 aCol;uniform mat4 uMvp;uniform float uSize;varying vec4 vCol;' +
    'void main(){vCol=aCol;gl_Position=uMvp*vec4(aPos,1.0);gl_PointSize=uSize;}';
  var FS = 'precision mediump float;varying vec4 vCol;uniform float uRound;' +
    'void main(){if(uRound>0.5){vec2 d=gl_PointCoord-vec2(0.5);if(dot(d,d)>0.25)discard;}gl_FragColor=vCol;}';
  function sh(gl, type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function init(canvas) {
    var gl = null;
    try { gl = canvas.getContext('webgl', { antialias: true, alpha: false }) || canvas.getContext('experimental-webgl'); } catch (e) { gl = null; }
    if (!gl) return null;
    var p = gl.createProgram(); gl.attachShader(p, sh(gl, gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl, gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p); gl.useProgram(p);
    var c = { gl: gl, canvas: canvas, prog: p, aPos: gl.getAttribLocation(p, 'aPos'), aCol: gl.getAttribLocation(p, 'aCol'),
      uMvp: gl.getUniformLocation(p, 'uMvp'), uSize: gl.getUniformLocation(p, 'uSize'), uRound: gl.getUniformLocation(p, 'uRound'), w: 1, h: 1 };
    gl.enableVertexAttribArray(c.aPos); gl.enableVertexAttribArray(c.aCol);
    return c;
  }
  /* Re-select this helper's shader after another program has been used on the same context. */
  function use(c) { var gl = c.gl; gl.useProgram(c.prog); gl.enableVertexAttribArray(c.aPos); gl.enableVertexAttribArray(c.aCol); }
  function resize(c, cssH) {
    var cv = c.canvas, w = cv.clientWidth || (cv.parentNode && cv.parentNode.clientWidth) || 600, d = Math.min(2, window.devicePixelRatio || 1);
    if (cssH) cv.style.height = cssH + 'px';
    var h = cssH || cv.clientHeight || 300, W = Math.round(w * d), H = Math.round(h * d);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    c.w = w; c.h = h; c.gl.viewport(0, 0, W, H);
  }
  function mesh(c, pos, col, dynamic) {
    var gl = c.gl, m = { pb: gl.createBuffer(), cb: gl.createBuffer(), n: 0, dyn: dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW };
    setPos(c, m, pos); setCol(c, m, col); return m;
  }
  function f32(a) { return a instanceof Float32Array ? a : new Float32Array(a); }
  function setPos(c, m, pos) { var gl = c.gl; gl.bindBuffer(gl.ARRAY_BUFFER, m.pb); gl.bufferData(gl.ARRAY_BUFFER, f32(pos), m.dyn); m.n = pos.length / 3; }
  function setCol(c, m, col) { var gl = c.gl; gl.bindBuffer(gl.ARRAY_BUFFER, m.cb); gl.bufferData(gl.ARRAY_BUFFER, f32(col), gl.DYNAMIC_DRAW); }
  function free(c, m) { if (m) { c.gl.deleteBuffer(m.pb); c.gl.deleteBuffer(m.cb); } }
  function draw(c, m, mvp, mode, size, round) {
    var gl = c.gl; if (!m || !m.n) return;
    gl.uniformMatrix4fv(c.uMvp, false, mvp); gl.uniform1f(c.uSize, (size || 1) * Math.min(2, window.devicePixelRatio || 1)); gl.uniform1f(c.uRound, round ? 1 : 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.pb); gl.vertexAttribPointer(c.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.cb); gl.vertexAttribPointer(c.aCol, 4, gl.FLOAT, false, 0, 0);
    gl.drawArrays(mode, 0, m.n);
  }
  /* column-major 4x4 matrices */
  function persp(fovy, aspect, near, far) { var f = 1 / Math.tan(fovy / 2), o = new Float32Array(16); o[0] = f / aspect; o[5] = f; o[10] = (far + near) / (near - far); o[11] = -1; o[14] = 2 * far * near / (near - far); return o; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { var l = Math.sqrt(dot(a, a)) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function lookAt(eye, target, up) {
    var z = norm([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]), x = norm(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  }
  function mul(a, b) { var o = new Float32Array(16); for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
  function project(m, p, w, h) {
    var x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], ww = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (ww <= 1e-6) return null; return { x: (x / ww * .5 + .5) * w, y: (1 - (y / ww * .5 + .5)) * h };
  }
  return { init: init, use: use, resize: resize, mesh: mesh, setPos: setPos, setCol: setCol, free: free, draw: draw, persp: persp, lookAt: lookAt, mul: mul, project: project, cross: cross, dot: dot, norm: norm };
})();
