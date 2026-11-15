/* Terrain: height grids, per-azimuth horizon profiles and sun-shadow maps.
   A grid is N x N cells of `cell` metres, row 0 at grid-north, heights in metres. The landing site is the grid centre.
   `rot` (deg) is the bearing of local north measured in the grid, so a local azimuth az is the grid bearing az + rot. */
var Terrain = (function () {
  'use strict';
  var RAD = Math.PI / 180, DEG = 180 / Math.PI, RM = 1737400, N = 128;
  function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function dipRad(h) { return h > 0 ? Math.acos(RM / (RM + h)) : 0; }

  function sample(t, x, y) { // metres east / north of the site, in grid axes
    var fi = x / t.cell + t.N / 2 - 0.5, fj = t.N / 2 - 0.5 - y / t.cell;
    if (fi < 0 || fj < 0 || fi > t.N - 1 || fj > t.N - 1) return null;
    var i = Math.min(t.N - 2, Math.floor(fi)), j = Math.min(t.N - 2, Math.floor(fj)), u = fi - i, v = fj - j, h = t.h, n = t.N;
    return (h[j * n + i] * (1 - u) + h[j * n + i + 1] * u) * (1 - v) + (h[(j + 1) * n + i] * (1 - u) + h[(j + 1) * n + i + 1] * u) * v;
  }
  function finish(t) {
    var n = t.N, h = t.h, mn = Infinity, mx = -Infinity, sum = 0, i;
    for (i = 0; i < h.length; i++) { if (h[i] < mn) mn = h[i]; if (h[i] > mx) mx = h[i]; sum += h[i]; }
    t.min = mn; t.max = mx; t.mean = sum / h.length; t.eye = 2;
    t.h0 = sample(t, 0, 0); t.rel = t.h0 + t.eye - t.mean;
    var relief = mx - mn; t.bh = relief < 1 ? t.cell / 2 : Math.max(4, Math.min(t.cell, relief / 22));
    t.q = new Int16Array(h.length); for (i = 0; i < h.length; i++) t.q[i] = Math.round((h[i] - t.h0) / t.bh);
    // horizon profile seen from the site, one value per degree of local azimuth
    t.prof = new Float32Array(360); var z0 = t.h0 + t.eye, half = n * t.cell / 2;
    for (var a = 0; a < 360; a++) {
      var b = (a + t.rot) * RAD, sx = Math.sin(b), sy = Math.cos(b), m = -Infinity;
      for (var d = t.cell * 0.75; d < half * 1.42; d += t.cell * 0.5) { var hh = sample(t, sx * d, sy * d); if (hh === null) break; var tn = (hh - z0 - d * d / (2 * RM)) / d; if (tn > m) m = tn; }
      t.prof[a] = m === -Infinity ? -90 : Math.atan(m) * DEG;
    }
    return t;
  }
  function farAt(t, az) { var a = ((az % 360) + 360) % 360, i = Math.floor(a) % 360, f = a - Math.floor(a); return t.far[i] * (1 - f) + t.far[(i + 1) % 360] * f; }
  /* Horizon elevation (deg) in local azimuth az. Beyond the grid: the far-horizon profile if the terrain has one (t.far, real
     terrain out to 400 km), otherwise a smooth sphere at the grid's mean height. */
  function horizon(t, az, extraH) {
    var a = ((az % 360) + 360) % 360, i = Math.floor(a) % 360, f = a - Math.floor(a), p = t.prof[i] * (1 - f) + t.prof[(i + 1) % 360] * f;
    return Math.max(p, t.far ? farAt(t, az) : -dipRad(t.rel + (extraH || 0)) * DEG);
  }
  /* Horizon elevation (deg) in local azimuth az, seen from any point of the grid (x east, y north, metres from the site). */
  function horizonFrom(t, x, y, az, eye) {
    var z0 = sample(t, x, y); if (z0 === null) z0 = t.mean; z0 += eye;
    var b = (az + t.rot) * RAD, sx = Math.sin(b), sy = Math.cos(b), m = -Infinity, lim = t.N * t.cell * 1.5;
    for (var d = t.cell * 0.75; d < lim; d += t.cell * 0.5) { var hh = sample(t, x + sx * d, y + sy * d); if (hh === null) break; var tn = (hh - z0 - d * d / (2 * RM)) / d; if (tn > m) m = tn; }
    return Math.max(m === -Infinity ? -90 : Math.atan(m) * DEG, t.far ? farAt(t, az) : -dipRad(z0 - t.mean) * DEG);
  }
  /* True when two points on the grid (each `e` metres above the ground) can see each other. */
  function los(t, xa, ya, ea, xb, yb, eb) {
    var za = sample(t, xa, ya), zb = sample(t, xb, yb); if (za === null || zb === null) return false; za += ea; zb += eb;
    var dist = Math.sqrt((xb - xa) * (xb - xa) + (yb - ya) * (yb - ya)), n = Math.ceil(dist / (t.cell * 0.4));
    // On a spherical reference surface the ground rises above the endpoint chord.
    for (var k = 1; k < n; k++) { var f = k / n, h = sample(t, xa + (xb - xa) * f, ya + (yb - ya) * f); if (h !== null && h + dist * dist * f * (1-f) / (2*RM) > za + (zb - za) * f) return false; }
    return true;
  }
  /* Fraction of the solar disc visible from every cell (0..1). */
  function shadow(t, sunAz, sunEl, rs, extraH, out) {
    var n = t.N, h = t.h, b = (sunAz + t.rot) * RAD, di = Math.sin(b), dj = -Math.cos(b), cell = t.cell;
    var tanHi = Math.tan(Math.min(89, sunEl + rs) * RAD), mx = t.max, eh = extraH || 0, farTan = t.far ? Math.tan(farAt(t, sunAz) * RAD) : null;
    out = out || new Float32Array(n * n);
    for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
      var idx = j * n + i, hc = h[idx] + 1, rel = hc - t.mean + eh, m = farTan !== null ? farTan : rel > 0 ? -Math.sqrt(2 * rel / RM) : 0, x = i + 0.5, y = j + 0.5;
      for (var k = 1; k < 2 * n; k++) {
        x += di; y += dj; if (x < 0 || y < 0 || x >= n || y >= n) break;
        var d = k * cell, tn = (h[(y | 0) * n + (x | 0)] - hc - d * d / (2 * RM)) / d; if (tn > m) m = tn;
        if (m >= tanHi || (mx - hc) / d < m) break;
      }
      var xx = (sunEl - Math.atan(m) * DEG) / rs;
      out[idx] = xx <= -1 ? 0 : xx >= 1 ? 1 : (Math.acos(-xx) + xx * Math.sqrt(1 - xx * xx)) / Math.PI;
    }
    return out;
  }
  /* A grid of real heights (metres), N x N cells of `cell` metres, north up, site at the centre. */
  function fromHeights(h, cell, label, far) { return finish({ N: N, cell: cell, h: h, rot: 0, kind: 'real', label: label, far: far || null }); }
  function flat() { return finish({ N: N, cell: 40, h: new Float32Array(N * N), rot: 0, kind: 'sphere', label: 'Smooth sphere, no terrain' }); }

  /* Generated demo terrain: rolling ground plus craters, seeded by the coordinates so a site always looks the same. NOT real data. */
  function synthetic(lat, lon) {
    var rnd = rng(Math.round(lat * 100) * 73856093 ^ Math.round(lon * 100) * 19349663), cell = 40, h = new Float32Array(N * N), rough = 0.35 + 0.65 * Math.abs(lat) / 90, i, j;
    [[6, 90], [11, 40], [23, 16], [47, 6]].forEach(function (o) {
      var G = o[0], amp = o[1] * rough, g = new Float32Array(G * G); for (var k = 0; k < g.length; k++) g[k] = rnd() * 2 - 1;
      for (j = 0; j < N; j++) for (i = 0; i < N; i++) {
        var u = i / (N - 1) * (G - 1), v = j / (N - 1) * (G - 1), a = Math.min(G - 2, Math.floor(u)), b = Math.min(G - 2, Math.floor(v)), fu = u - a, fv = v - b;
        fu = fu * fu * (3 - 2 * fu); fv = fv * fv * (3 - 2 * fv);
        h[j * N + i] += amp * ((g[b * G + a] * (1 - fu) + g[b * G + a + 1] * fu) * (1 - fv) + (g[(b + 1) * G + a] * (1 - fu) + g[(b + 1) * G + a + 1] * fu) * fv);
      }
    });
    var half = N * cell / 2, mound = 420 * rough;
    // landing sites are picked on high ground: raise a broad rise under the site
    for (j = 0; j < N; j++) for (i = 0; i < N; i++) { var mx0 = (i + 0.5) * cell - half, my0 = half - (j + 0.5) * cell; h[j * N + i] += mound * Math.exp(-(mx0 * mx0 + my0 * my0) / (2 * 850 * 850)); }
    var nc = 26 + Math.floor(rnd() * 16);
    for (var c = 0; c < nc; c++) {
      var r = Math.min(900, 50 / Math.pow(0.008 + rnd() * 0.992, 0.6)), cx = (rnd() * 2 - 1) * half * 1.05, cy = (rnd() * 2 - 1) * half * 1.05;
      if (Math.sqrt(cx * cx + cy * cy) < r * 1.15 + 120) continue; // keep the landing pad out of crater bowls
      var depth = 0.22 * r * (0.4 + 0.6 * rnd()), rim = 0.2 * depth; // depth/diameter 0.04 to 0.11, like worn lunar craters
      for (j = 0; j < N; j++) for (i = 0; i < N; i++) {
        var dx = (i + 0.5) * cell - half - cx, dy = half - (j + 0.5) * cell - cy, dd = Math.sqrt(dx * dx + dy * dy) / r;
        if (dd < 1) h[j * N + i] += -depth + (depth + rim) * dd * dd; else if (dd < 2.6) h[j * N + i] += rim / (dd * dd * dd);
      }
    }
    var t = { N: N, cell: cell, h: h, rot: 0, kind: 'synthetic', label: 'Generated demo terrain · NOT measured lunar relief' };
    var hc = sample(t, 0, 0); // level a small pad under the lander
    for (j = 0; j < N; j++) for (i = 0; i < N; i++) { var px = (i + 0.5) * cell - half, py = half - (j + 0.5) * cell, w = 1 - Math.sqrt(px * px + py * py) / 170; if (w > 0) { w = w * w * (3 - 2 * w); h[j * N + i] = h[j * N + i] * (1 - w) + hc * w; } }
    return finish(t);
  }

  /* ESRI ASCII grid (.asc), heights in metres, site at the centre. Make one with: gdal_translate -of AAIGrid tile.tif tile.asc
     projection: 'north' (north is up), 'spole' or 'npole' (polar stereographic, longitude 0 on the y axis). */
  function fromAsc(text, projection, siteLon, name) {
    var hd = {}, pos = 0, m, re = /^\s*([A-Za-z_]+)\s+(-?[\d.eE+-]+)\s*\r?\n/;
    while ((m = re.exec(text.slice(pos, pos + 200)))) { hd[m[1].toLowerCase()] = parseFloat(m[2]); pos += m[0].length; }
    var nc = hd.ncols, nr = hd.nrows, cs = hd.cellsize || hd.dx;
    if (!Number.isInteger(nc) || !Number.isInteger(nr) || nc<2 || nr<2 || nc*nr>4000000 || !Number.isFinite(cs) || cs<=0 || Math.min(nc,nr)*cs>1000000) throw new Error('This does not look like an ESRI ASCII grid: ncols, nrows and cellsize are required in the header.');
    var tok = text.slice(pos).trim().split(/\s+/); if (tok.length !== nc * nr) throw new Error('The file has ' + tok.length + ' values but the header promises ' + nc * nr + '.');
    var src = new Float32Array(nc * nr), nod = hd.nodata_value, sum = 0, cnt = 0, i, j;
    for (i = 0; i < src.length; i++) { var v = Number(tok[i]); if(v===nod||!Number.isFinite(v)||v < -20000 || v > 20000)throw new Error('Grid has missing, invalid or out-of-range heights. Supply complete lunar elevations in metres (−20,000 to 20,000).');else {sum+=v;cnt++;} src[i] = v; }
    if (!cnt) throw new Error('The grid contains no valid heights.');
    var mean = sum / cnt; for (i = 0; i < src.length; i++) if (isNaN(src[i])) src[i] = mean;
    var side = Math.min(nc, nr) * cs, cell = side / N, h = new Float32Array(N * N);
    for (j = 0; j < N; j++) for (i = 0; i < N; i++) {
      var fx = nc / 2 + (i + 0.5 - N / 2) * cell / cs - 0.5, fy = nr / 2 + (j + 0.5 - N / 2) * cell / cs - 0.5;
      var a = Math.max(0, Math.min(nc - 2, Math.floor(fx))), b = Math.max(0, Math.min(nr - 2, Math.floor(fy))), u = Math.max(0, Math.min(1, fx - a)), w = Math.max(0, Math.min(1, fy - b));
      h[j * N + i] = (src[b * nc + a] * (1 - u) + src[b * nc + a + 1] * u) * (1 - w) + (src[(b + 1) * nc + a] * (1 - u) + src[(b + 1) * nc + a + 1] * u) * w;
    }
    return finish({ N: N, cell: cell, h: h, rot: projection === 'spole' ? siteLon : projection === 'npole' ? -siteLon : 0, kind: 'dem',
      label: 'Your elevation tile: ' + (name || 'grid') + ' (' + (side / 1000).toFixed(1) + ' km across)' });
  }
  return { N: N, flat: flat, fromHeights: fromHeights, synthetic: synthetic, fromAsc: fromAsc, horizon: horizon, horizonFrom: horizonFrom, los: los, shadow: shadow, sample: sample, finish: finish };
})();
if (typeof module !== 'undefined') module.exports = Terrain;
