/* RealData: loads the NASA data files in data/ and hands them to the rest of the app.
     data/sites.png        real LOLA elevation around the 17 preset sites (128 x 128 cells of 500 m, from the 64 px/deg grid)
     data/ldem16_R_C.png   the whole Moon at 16 px/deg (about 1.9 km), in 4 x 4 tiles, loaded only when a custom site needs them
     data/moon_2k.jpg      LROC colour map of the Moon (NASA SVS CGI Moon Kit)
     data/earth_2k.jpg     Blue Marble map of Earth (NASA SVS)
   Heights are stored in two colour channels: metres = (red * 256 + green) * 0.5 - 10000, relative to a 1737.4 km sphere.
   Browsers refuse to read image pixels from file:// pages, so real data needs the folder to be served over http(s).
   If a file is missing or unreadable terrain outputs are withheld until data loads or a different model is explicitly selected. */
var RealData = (function () {
  'use strict';
  var BASE = 'data/', RAD = Math.PI / 180, R = 1737400, SITE_N = 128, SITE_CELL = 500, GW = 5760, GH = 2880, TW = 1440, TH = 720;
  var sites = null, moon = null, earth = null, lum = null, tiles = {}, state = { sites: 'loading', moon: 'loading', earth: 'loading' };
  function load(src) { return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { rej(new Error('could not load ' + src)); }; i.src = BASE + src; }); }
  function pixels(im, w, h) { var c = document.createElement('canvas'); c.width = w || im.naturalWidth; c.height = h || im.naturalHeight; var g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, c.width, c.height); return g.getImageData(0, 0, c.width, c.height).data; }
  function heights(im) { var d = pixels(im), n = d.length / 4, o = new Uint16Array(n); for (var i = 0; i < n; i++) o[i] = d[i * 4] * 256 + d[i * 4 + 1]; return o; }
  function init(onChange) {
    load('sites.png').then(function (im) { if(im.naturalWidth!==2176||im.naturalHeight!==128)throw new Error('Unexpected preset grid dimensions');var a = heights(im), n = im.naturalWidth / SITE_N; sites = []; for (var s = 0; s < n; s++) { var h = new Float32Array(SITE_N * SITE_N); for (var j = 0; j < SITE_N; j++) for (var i = 0; i < SITE_N; i++) h[j * SITE_N + i] = a[j * im.naturalWidth + s * SITE_N + i] * 0.5 - 10000; sites.push(h); } state.sites = 'ready'; onChange('sites'); }).catch(function () { state.sites = 'missing'; onChange('sites'); });
    load('moon_2k.jpg').then(function (im) { moon = im; try { var d = pixels(im, 720, 360); lum = new Float32Array(720 * 360); for (var i = 0; i < lum.length; i++) lum[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255; } catch (e) { lum = null; } state.moon = 'ready'; onChange('moon'); }).catch(function () { state.moon = 'missing'; onChange('moon'); });
    load('earth_2k.jpg').then(function (im) { earth = im; state.earth = 'ready'; onChange('earth'); }).catch(function () { state.earth = 'missing'; onChange('earth'); });
  }
  /* Brightness of the real Moon map at a point, 0..1, or null before it has loaded */
  function moonLum(lat, lon) { if (!lum) return null; var x = Math.min(719, Math.max(0, Math.floor((((lon + 180) % 360) + 360) % 360 * 2))), y = Math.min(359, Math.max(0, Math.floor((90 - lat) * 2))); return lum[y * 720 + x]; }
  function tile(r, c) { var k = r + '_' + c; if (!tiles[k]) tiles[k] = load('ldem16_' + k + '.png').then(function(im){if(im.naturalWidth!==TW||im.naturalHeight!==TH)throw new Error('Invalid elevation tile dimensions');return heights(im);}).catch(function(err){delete tiles[k];throw err;}); return tiles[k]; }
  /* Real elevation (metres) on an N x N grid of `cell` metres centred on (lat, lon), north up, from the 16 px/deg global grid. */
  function patch(lat, lon, N, cell) {
    var p = lat * RAD, l0 = lon * RAD, pts = new Float64Array(N * N * 2), need = {}, i, j;
    for (j = 0; j < N; j++) for (i = 0; i < N; i++) {
      var x = (i + 0.5 - N / 2) * cell, y = (N / 2 - 0.5 - j) * cell, d = Math.sqrt(x * x + y * y) / R, th = Math.atan2(x, y);
      var la = Math.asin(Math.sin(p) * Math.cos(d) + Math.cos(p) * Math.sin(d) * Math.cos(th)), lo = l0 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p), Math.cos(d) - Math.sin(p) * Math.sin(la));
      var fr = Math.max(0, Math.min(GH - 1.001, (90 - la / RAD) * 16 - 0.5)), fc = ((((lo / RAD + 180) % 360) + 360) % 360) * 16 - 0.5; if (fc < 0) fc += GW;
      pts[(j * N + i) * 2] = fr; pts[(j * N + i) * 2 + 1] = fc;
      var r0 = Math.floor(fr), c0 = Math.floor(fc) % GW, c1 = (c0 + 1) % GW; [[r0, c0], [r0, c1], [r0 + 1, c0], [r0 + 1, c1]].forEach(function (q) { need[Math.floor(Math.min(GH - 1, q[0]) / TH) + '_' + Math.floor(q[1] / TW)] = 1; });
    }
    var keys = Object.keys(need);
    return Promise.all(keys.map(function (k) { var s = k.split('_'); return tile(+s[0], +s[1]); })).then(function (arr) {
      var T = {}; keys.forEach(function (k, n) { T[k] = arr[n]; });
      function px(r, c) { r = Math.min(GH - 1, r); return T[Math.floor(r / TH) + '_' + Math.floor(c / TW)][(r % TH) * TW + (c % TW)]; }
      var h = new Float32Array(N * N);
      for (var k = 0; k < N * N; k++) { var fr = pts[k * 2], fc = pts[k * 2 + 1], r0 = Math.floor(fr), tb = fr - r0, c0 = Math.floor(fc) % GW, ta = fc - Math.floor(fc), c1 = (c0 + 1) % GW; h[k] = ((px(r0, c0) * (1 - ta) + px(r0, c1) * ta) * (1 - tb) + (px(r0 + 1, c0) * (1 - ta) + px(r0 + 1, c1) * ta) * tb) * 0.5 - 10000; }
      return h;
    });
  }
  return { init: init, state: state, site: function (k) { return sites && sites[k] ? sites[k] : null; }, SITE_CELL: SITE_CELL, GLOBAL_CELL: 1895, patch: patch, moonLum: moonLum, moonImage: function () { return moon; }, earthImage: function () { return earth; } };
})();
