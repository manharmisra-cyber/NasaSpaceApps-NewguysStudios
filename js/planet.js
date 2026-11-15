/* Planet: draws Earth or the Moon as a shaded sphere with a procedural surface. One instance per WebGL context.
   Earth's land comes from a very coarse hand-made land mask (10 degree cells, softened with noise): good enough to
   recognise the continents, not a map. The Moon's dark maria come from Globe.albedo(), which is also a sketch. */
var Planet = (function () {
  'use strict';
  // land cells per 10-degree latitude row, north to south; column c is centred on longitude -175 + 10c
  var LAND = [[], [[6, 9], [12, 15], [23, 23], [27, 28]], [[0, 11], [13, 14], [16, 16], [19, 35]], [[2, 2], [4, 11], [17, 17], [19, 31], [33, 33]],
    [[5, 11], [18, 32]], [[6, 10], [17, 18], [21, 29], [31, 31]], [[7, 7], [16, 29]], [[8, 9], [16, 22], [25, 25], [28, 28]],
    [[10, 12], [17, 22], [27, 30]], [[10, 14], [19, 21], [28, 29], [31, 32]], [[10, 13], [19, 22], [30, 32]], [[11, 12], [19, 22], [29, 32]],
    [[11, 12], [20, 20], [29, 29], [31, 32], [35, 35]], [[10, 11], [34, 34]], [[11, 11]], [[11, 11], [22, 32]], [[0, 35]], [[0, 35]]];
  var VS = 'attribute vec3 aPos;uniform mat4 uMvp;uniform vec3 uC;uniform float uR;varying vec3 vN;varying vec3 vW;' +
    'void main(){vN=aPos;vW=uC+uR*aPos;gl_Position=uMvp*vec4(vW,1.0);}';
  var FS = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
    'varying vec3 vN;varying vec3 vW;uniform vec3 uEye;uniform vec3 uSun;uniform mat3 uInv;uniform sampler2D uTex;uniform float uKind;uniform float uT;uniform float uReal;' +
    'float h3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}' +
    'float vn(vec3 p){vec3 i=floor(p);vec3 f=fract(p);f=f*f*(3.0-2.0*f);' +
    'return mix(mix(mix(h3(i),h3(i+vec3(1.0,0.0,0.0)),f.x),mix(h3(i+vec3(0.0,1.0,0.0)),h3(i+vec3(1.0,1.0,0.0)),f.x),f.y),' +
    'mix(mix(h3(i+vec3(0.0,0.0,1.0)),h3(i+vec3(1.0,0.0,1.0)),f.x),mix(h3(i+vec3(0.0,1.0,1.0)),h3(i+vec3(1.0,1.0,1.0)),f.x),f.y),f.z);}' +
    'float fbm(vec3 p){float a=0.5;float s=0.0;for(int i=0;i<4;i++){s+=a*vn(p);p=p*2.03+vec3(1.7,9.2,5.1);a*=0.5;}return s;}' +
    'void main(){vec3 n=normalize(vN);vec3 v=normalize(uEye-vW);if(dot(n,v)<0.0)discard;' +
    'vec3 p=uInv*n;float lat=asin(clamp(p.z,-1.0,1.0));float lon=atan(p.y,p.x);vec2 uv=vec2(lon/6.2831853+0.5,0.5-lat/3.14159265);vec3 c;' +
    'if(uKind<0.5){' +                                                         // Earth
    'float alat=abs(lat)*57.2958;float nz=fbm(p*5.0);vec2 w=vec2(fbm(p*9.0+1.7),fbm(p*9.0+5.3))-0.47;' +
    'float land=texture2D(uTex,uv+0.02*w).r;land=smoothstep(0.40,0.56,land+0.25*(nz-0.47));' +
    'float dry=smoothstep(10.0,20.0,alat)*(1.0-smoothstep(30.0,42.0,alat))*smoothstep(0.35,0.6,fbm(p*3.0+9.1)+0.15);' +
    'vec3 lc=mix(vec3(0.07,0.20,0.06),vec3(0.50,0.40,0.24),dry);lc=mix(lc,vec3(0.18,0.20,0.10),smoothstep(45.0,62.0,alat)*0.6);' +
    'vec3 col=mix(vec3(0.015,0.06,0.20),lc,land);float ia=alat+8.0*(nz-0.47);' +
    'col=mix(col,vec3(0.85,0.88,0.92),mix(smoothstep(68.0,78.0,ia),smoothstep(58.0,70.0,ia),land));' +
    'float cl=smoothstep(0.60,0.80,fbm(p*5.0+vec3(3.1,0.0,uT))+0.28*fbm(p*17.0));col=mix(col,vec3(0.95),cl*0.8);' +
    'if(uReal>0.5){vec3 t=texture2D(uTex,uv).rgb;col=t*t;land=1.0-smoothstep(0.02,0.10,t.b-max(t.r,t.g));cl=0.0;}' +   // real Blue Marble map, no invented clouds
    'float d=dot(n,uSun);float day=smoothstep(-0.10,0.20,d);' +
    'float spec=pow(max(dot(n,normalize(uSun+v)),0.0),50.0)*(1.0-land)*(1.0-cl)*0.6;float rim=pow(1.0-max(dot(n,v),0.0),2.5);' +
    'c=col*(0.012+1.25*max(d,0.0))+vec3(spec*day)+vec3(0.25,0.45,0.95)*rim*(0.15+0.85*day)*0.55*smoothstep(-0.25,0.1,d);' +
    '}else{' +                                                                 // Moon
    'float alb=texture2D(uTex,uv).r*(0.82+0.36*fbm(p*7.0));' +
    'vec3 g=vec3(fbm(p*26.0+1.3),fbm(p*26.0+4.7),fbm(p*26.0+8.9))-0.47;vec3 nb=normalize(n+0.55*g);' +
    'float I=pow(max(dot(nb,uSun),0.0),0.75)*smoothstep(-0.02,0.06,dot(n,uSun));' +
    'c=vec3(0.30,0.29,0.28)*alb*(0.004+1.5*I);' +
    'if(uReal>0.5){vec3 t=texture2D(uTex,uv).rgb;vec3 nb2=normalize(n+0.22*g);float I2=pow(max(dot(nb2,uSun),0.0),0.7)*smoothstep(-0.02,0.06,dot(n,uSun));c=t*t*(0.004+1.25*I2);}}' +
    'gl_FragColor=vec4(pow(c,vec3(0.5)),1.0);}';
  function sh(gl, type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function tex(gl, w, h, data) {
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, w, h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t;
  }
  function landAt(row, col) { row = Math.max(0, Math.min(17, row)); col = ((col % 36) + 36) % 36; var r = LAND[row]; for (var i = 0; i < r.length; i++) if (col >= r[i][0] && col <= r[i][1]) return 1; return 0; }
  function create(ctx) {
    var gl = ctx.gl, p = gl.createProgram(); gl.attachShader(p, sh(gl, gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl, gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var aPos = gl.getAttribLocation(p, 'aPos'), u = {}; ['uMvp', 'uC', 'uR', 'uEye', 'uSun', 'uInv', 'uTex', 'uKind', 'uT', 'uReal'].forEach(function (n) { u[n] = gl.getUniformLocation(p, n); });
    var P = [], NL = 64, NB = 32, i, j;
    function pt(a, b) { return [Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b)]; }
    for (j = 0; j < NB; j++) for (i = 0; i < NL; i++) { var a0 = i / NL * 6.2831853, a1 = (i + 1) / NL * 6.2831853, b0 = (j / NB - 0.5) * Math.PI, b1 = ((j + 1) / NB - 0.5) * Math.PI, q = [pt(a0, b0), pt(a1, b0), pt(a1, b1), pt(a0, b1)]; [0, 1, 2, 0, 2, 3].forEach(function (k) { P.push(q[k][0], q[k][1], q[k][2]); }); }
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P), gl.STATIC_DRAW);
    // Earth land mask, 64 x 32, bilinear from the 36 x 18 table
    var E = new Uint8Array(64 * 32), M = new Uint8Array(128 * 64);
    for (j = 0; j < 32; j++) for (i = 0; i < 64; i++) { var fx = (i + 0.5) / 64 * 36 - 0.5, fy = (j + 0.5) / 32 * 18 - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0; E[j * 64 + i] = 255 * ((landAt(y0, x0) * (1 - tx) + landAt(y0, x0 + 1) * tx) * (1 - ty) + (landAt(y0 + 1, x0) * (1 - tx) + landAt(y0 + 1, x0 + 1) * tx) * ty); }
    for (j = 0; j < 64; j++) for (i = 0; i < 128; i++) M[j * 128 + i] = 255 * (typeof Globe !== 'undefined' ? Globe.albedo(90 - (j + 0.5) / 64 * 180, (i + 0.5) / 128 * 360 - 180) : 1);
    var tE = tex(gl, 64, 32, E), tM = tex(gl, 128, 64, M), real = { earth: null, moon: null };
    /* Swap in a real equirectangular map (an Image, 2048 x 1024, centred on longitude 0). Returns false if the browser refuses. */
    function setTexture(kind, img) {
      try {
        var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img); gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); real[kind] = t; return true;
      } catch (e) { return false; }
    }
    GLX.use(ctx);
    /* o: {mvp, center, radius, eye, rot (three column vectors: body axes in scene coordinates), sun, kind: 'earth'|'moon', t} */
    function draw(o) {
      var r = o.rot; gl.useProgram(p); gl.disableVertexAttribArray(ctx.aPos); gl.disableVertexAttribArray(ctx.aCol); gl.enableVertexAttribArray(aPos); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(u.uMvp, false, o.mvp); gl.uniform3fv(u.uC, o.center); gl.uniform1f(u.uR, o.radius); gl.uniform3fv(u.uEye, o.eye); gl.uniform3fv(u.uSun, o.sun);
      gl.uniformMatrix3fv(u.uInv, false, [r[0][0], r[1][0], r[2][0], r[0][1], r[1][1], r[2][1], r[0][2], r[1][2], r[2][2]]);
      var rk = real[o.kind === 'moon' ? 'moon' : 'earth']; gl.uniform1f(u.uKind, o.kind === 'moon' ? 1 : 0); gl.uniform1f(u.uT, o.t || 0); gl.uniform1f(u.uReal, rk ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, rk || (o.kind === 'moon' ? tM : tE)); gl.uniform1i(u.uTex, 0);
      gl.drawArrays(gl.TRIANGLES, 0, P.length / 3); gl.disableVertexAttribArray(aPos); GLX.use(ctx);
    }
    return { draw: draw, setTexture: setTexture };
  }
  return { create: create };
})();
