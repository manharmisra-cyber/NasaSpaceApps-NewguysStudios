/* Lunar site ephemeris: where the Sun and Earth sit in the sky of a point on the Moon.
   Moon position: truncated ELP series (Meeus, Astronomical Algorithms ch. 47).
   Sub-Earth / sub-solar points: optical libration (Meeus ch. 53). Physical libration (<0.04 deg) ignored. */
var Ephem = (function () {
  var RAD = Math.PI / 180, DEG = 180 / Math.PI;
  var R_MOON = 1737.4, AU = 149597870.7, INCL = 1.54242 * RAD;
  // D, M, M', F, sin coeff (1e-6 deg), cos coeff (1e-3 km)
  var LR = [
    [0,0,1,0,6288774,-20905355],[2,0,-1,0,1274027,-3699111],[2,0,0,0,658314,-2955968],[0,0,2,0,213618,-569925],
    [0,1,0,0,-185116,48888],[0,0,0,2,-114332,-3149],[2,0,-2,0,58793,246158],[2,-1,-1,0,57066,-152138],
    [2,0,1,0,53322,-170733],[2,-1,0,0,45758,-204586],[0,1,-1,0,-40923,-129620],[1,0,0,0,-34720,108743],
    [0,1,1,0,-30383,104755],[2,0,0,-2,15327,10321],[0,0,1,2,-12528,0],[0,0,1,-2,10980,79661],
    [4,0,-1,0,10675,-34782],[0,0,3,0,10034,-23210],[4,0,-2,0,8548,-21636],[2,1,-1,0,-7888,24208],
    [2,1,0,0,-6766,30824],[1,0,-1,0,-5163,-8379],[1,1,0,0,4987,-16675],[2,-1,1,0,4036,-12831],
    [2,0,2,0,3994,-10445],[4,0,0,0,3861,-11650],[2,0,-3,0,3665,14403],[0,1,-2,0,-2689,-7003],
    [2,0,-1,2,-2602,0],[2,-1,-2,0,2390,10056],[1,0,1,0,-2348,6322],[2,-2,0,0,2236,-9884],
    [0,1,2,0,-2120,5751],[0,2,0,0,-2069,0],[2,-2,-1,0,2048,-4950],[2,0,1,-2,-1773,4130],
    [2,0,0,2,-1595,0],[4,-1,-1,0,1215,-3958],[0,0,2,2,-1110,0],[3,0,-1,0,-892,3258],
    [2,1,1,0,-810,2616],[4,-1,-2,0,759,-1897],[0,2,-1,0,-713,-2117],[2,2,-1,0,-700,2354],
    [2,1,-2,0,691,0],[2,-1,0,-2,596,0],[4,0,1,0,549,-1423],[0,0,4,0,537,-1117],
    [4,-1,0,0,520,-1571],[1,0,-2,0,-487,-1739]
  ];
  var B = [
    [0,0,0,1,5128122],[0,0,1,1,280602],[0,0,1,-1,277693],[2,0,0,-1,173237],[2,0,-1,1,55413],
    [2,0,-1,-1,46271],[2,0,0,1,32573],[0,0,2,1,17198],[2,0,1,-1,9266],[0,0,2,-1,8822],
    [2,-1,0,-1,8216],[2,0,-2,-1,4324],[2,0,1,1,4200],[2,1,0,-1,-3359],[2,-1,-1,1,2463],
    [2,-1,0,1,2211],[2,-1,-1,-1,2065],[0,1,-1,-1,-1870],[4,0,-1,-1,1828],[0,1,0,1,-1794],
    [0,0,0,3,-1749],[0,1,-1,1,-1565],[1,0,0,1,-1491],[0,1,1,1,-1475],[0,1,1,-1,-1410],
    [0,1,0,-1,-1344],[1,0,0,-1,-1335],[0,0,3,1,1107],[4,0,0,-1,1021],[4,0,-1,1,833]
  ];
  function norm180(x) { x = x % 360; if (x > 180) x -= 360; if (x < -180) x += 360; return x; }

  // Geocentric ecliptic Moon + Sun for a Julian Ephemeris Day
  function moonSun(jde) {
    var T = (jde - 2451545.0) / 36525, T2 = T * T;
    var Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T2;
    var D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T2;
    var M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T2;
    var Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T2;
    var F = 93.2720950 + 483202.0175233 * T - 0.0036539 * T2;
    var Om = 125.0445479 - 1934.1362891 * T + 0.0020754 * T2;
    var A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.290 * T, A3 = 313.45 + 481266.484 * T;
    var E = 1 - 0.002516 * T - 0.0000074 * T2, E2 = E * E;
    var sl = 0, sr = 0, sb = 0, i, t, a, e;
    for (i = 0; i < LR.length; i++) {
      t = LR[i]; a = (t[0] * D + t[1] * M + t[2] * Mp + t[3] * F) * RAD;
      e = t[1] === 0 ? 1 : (Math.abs(t[1]) === 1 ? E : E2);
      sl += t[4] * e * Math.sin(a); sr += t[5] * e * Math.cos(a);
    }
    for (i = 0; i < B.length; i++) {
      t = B[i]; a = (t[0] * D + t[1] * M + t[2] * Mp + t[3] * F) * RAD;
      e = t[1] === 0 ? 1 : (Math.abs(t[1]) === 1 ? E : E2);
      sb += t[4] * e * Math.sin(a);
    }
    sl += 3958 * Math.sin(A1 * RAD) + 1962 * Math.sin((Lp - F) * RAD) + 318 * Math.sin(A2 * RAD);
    sb += -2235 * Math.sin(Lp * RAD) + 382 * Math.sin(A3 * RAD) + 175 * Math.sin((A1 - F) * RAD)
        + 175 * Math.sin((A1 + F) * RAD) + 127 * Math.sin((Lp - Mp) * RAD) - 115 * Math.sin((Lp + Mp) * RAD);
    var lam = Lp + sl / 1e6, bet = sb / 1e6, dist = 385000.56 + sr / 1000;
    // Sun
    var L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T2, Mr = M * RAD;
    var C = (1.914602 - 0.004817 * T - 0.000014 * T2) * Math.sin(Mr) + (0.019993 - 0.000101 * T) * Math.sin(2 * Mr) + 0.000289 * Math.sin(3 * Mr);
    var ecc = 0.016708634 - 0.000042037 * T;
    var Rau = 1.000001018 * (1 - ecc * ecc) / (1 + ecc * Math.cos(Mr + C * RAD));
    return { lam: lam, bet: bet, dist: dist, sunLam: L0 + C, sunR: Rau * AU, F: F, Om: Om };
  }
  function seleno(lam, bet, F, Om) {
    var W = (lam - Om) * RAD, b = bet * RAD;
    var A = Math.atan2(Math.sin(W) * Math.cos(b) * Math.cos(INCL) - Math.sin(b) * Math.sin(INCL), Math.cos(W) * Math.cos(b));
    return { lon: norm180(A * DEG - F), lat: Math.asin(-Math.sin(W) * Math.cos(b) * Math.sin(INCL) - Math.sin(b) * Math.cos(INCL)) * DEG };
  }
  // Sub-Earth and sub-solar points (selenographic deg) at a UTC Julian Day
  function subPoints(jdUtc) {
    var m = moonSun(jdUtc + 69.2 / 86400);
    var se = seleno(m.lam, m.bet, m.F, m.Om);
    var k = m.dist / m.sunR;
    var lamH = m.sunLam + 180 + k * 57.296 * Math.cos(m.bet * RAD) * Math.sin((m.sunLam - m.lam) * RAD);
    var ss = seleno(lamH, k * m.bet, m.F, m.Om);
    return { eLon: se.lon, eLat: se.lat, sLon: ss.lon, sLat: ss.lat, dist: m.dist, sunR: m.sunR };
  }
  // Elevation/azimuth (deg; azimuth clockwise from lunar north) of a body whose sub-point is (lon,lat) at range km
  function altAz(siteLat, siteLon, lon, lat, range) {
    var p = siteLat * RAD, L = siteLon * RAD, b = lat * RAD, l = lon * RAD;
    var ux = Math.cos(b) * Math.cos(l), uy = Math.cos(b) * Math.sin(l), uz = Math.sin(b);
    var sx = Math.cos(p) * Math.cos(L), sy = Math.cos(p) * Math.sin(L), sz = Math.sin(p);
    var dx = range * ux - R_MOON * sx, dy = range * uy - R_MOON * sy, dz = range * uz - R_MOON * sz;
    var n = Math.sqrt(dx * dx + dy * dy + dz * dz); dx /= n; dy /= n; dz /= n;
    var up = dx * sx + dy * sy + dz * sz;
    var east = -dx * Math.sin(L) + dy * Math.cos(L);
    var north = -dx * Math.sin(p) * Math.cos(L) - dy * Math.sin(p) * Math.sin(L) + dz * Math.cos(p);
    var az = Math.atan2(east, north) * DEG; if (az < 0) az += 360;
    return { el: Math.asin(Math.max(-1, Math.min(1, up))) * DEG, az: az };
  }
  function jdFromMs(ms) { return ms / 86400000 + 2440587.5; }
  function uv(lat, lon) { var a = lat * RAD, b = lon * RAD; return [Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function vnorm(a) { var l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function gmstDeg(jd) { var T = (jd - 2451545) / 36525, g = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T; return ((g % 360) + 360) % 360; }
  /* Geocentric Moon position (km), ecliptic of date */
  function moonVec(ms) { var m = moonSun(jdFromMs(ms) + 69.2 / 86400), l = m.lam * RAD, b = m.bet * RAD; return [m.dist * Math.cos(b) * Math.cos(l), m.dist * Math.cos(b) * Math.sin(l), m.dist * Math.sin(b)]; }
  /* Everything needed to draw the Earth-Moon-Sun system in one ecliptic frame centred on Earth:
     moon (km), sun (unit vector to the Sun), and rotation matrices (arrays of three column vectors) that take
     Earth-fixed and Moon-fixed axes into that frame. The Moon's frame is rebuilt from the sub-Earth and sub-solar points. */
  function vectors(jdUtc) {
    var m = moonSun(jdUtc + 69.2 / 86400), l = m.lam * RAD, b = m.bet * RAD, ls = m.sunLam * RAD, T = (jdUtc - 2451545) / 36525;
    var eps = (23.439291 - 0.0130042 * T) * RAD, g = gmstDeg(jdUtc) * RAD, sp = subPoints(jdUtc);
    var moon = [m.dist * Math.cos(b) * Math.cos(l), m.dist * Math.cos(b) * Math.sin(l), m.dist * Math.sin(b)], sun = [Math.cos(ls), Math.sin(ls), 0];
    function ef(x, y, z) { var X = x * Math.cos(g) - y * Math.sin(g), Y = x * Math.sin(g) + y * Math.cos(g); return [X, Y * Math.cos(eps) + z * Math.sin(eps), -Y * Math.sin(eps) + z * Math.cos(eps)]; }
    var bE = uv(sp.eLat, sp.eLon), bS = uv(sp.sLat, sp.sLon), iE = vnorm([-moon[0], -moon[1], -moon[2]]), iS = vnorm([sun[0] * m.sunR - moon[0], sun[1] * m.sunR - moon[1], sun[2] * m.sunR - moon[2]]);
    var c1 = cross(bE, bS), c2 = cross(iE, iS); if (c1[0] * c1[0] + c1[1] * c1[1] + c1[2] * c1[2] < 1e-8) { c1 = cross(bE, [0, 0, 1]); c2 = cross(iE, [0, 0, 1]); }
    var t2 = vnorm(c1), t3 = cross(bE, t2), r2 = vnorm(c2), r3 = cross(iE, r2), mr = [];
    for (var j = 0; j < 3; j++) mr.push([iE[0] * bE[j] + r2[0] * t2[j] + r3[0] * t3[j], iE[1] * bE[j] + r2[1] * t2[j] + r3[1] * t3[j], iE[2] * bE[j] + r2[2] * t2[j] + r3[2] * t3[j]]);
    return { moon: moon, sun: sun, sunR: m.sunR, earthRot: [ef(1, 0, 0), ef(0, 1, 0), ef(0, 0, 1)], moonRot: mr, sub: sp };
  }
  /* A two-body transfer ellipse from a 200 km Earth parking orbit to 500 km above the Moon's near side.
     It ignores the Moon's own gravity, so it shows the shape and timing of the trip, not a flyable trajectory. */
  var MU = 398600.4418;
  function transfer(t0) {
    var rp = 6371 + 200, tof = 4.9 * 86400, A, ra, a, k;
    for (k = 0; k < 5; k++) { A = moonVec(t0 + tof * 1000); ra = Math.sqrt(A[0] * A[0] + A[1] * A[1] + A[2] * A[2]) - 2237.4; a = (rp + ra) / 2; tof = Math.PI * Math.sqrt(a * a * a / MU); }
    var A2 = moonVec(t0 + tof * 1000 + 3600000), nrm = vnorm(cross(A, [A2[0] - A[0], A2[1] - A[1], A2[2] - A[2]])), pd = vnorm([-A[0], -A[1], -A[2]]);
    return { t0: t0, tof: tof, a: a, e: (ra - rp) / (ra + rp), rp: rp, ra: ra, p: pd, q: cross(nrm, pd) };
  }
  function transferAt(tr, ms) {
    var f = Math.max(0, Math.min(1, (ms - tr.t0) / (tr.tof * 1000))), M = Math.PI * f, e = tr.e, lo = 0, hi = Math.PI, E = M;
    for (var i = 0; i < 50; i++) { E = (lo + hi) / 2; if (E - e * Math.sin(E) < M) lo = E; else hi = E; }
    var nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)), r = tr.a * (1 - e * Math.cos(E)), c = Math.cos(nu), s = Math.sin(nu);
    return { pos: [r * (c * tr.p[0] + s * tr.q[0]), r * (c * tr.p[1] + s * tr.q[1]), r * (c * tr.p[2] + s * tr.q[2])], r: r, speed: Math.sqrt(MU * (2 / r - 1 / tr.a)), f: f };
  }
  return { moonSun: moonSun, seleno: seleno, subPoints: subPoints, altAz: altAz, jdFromMs: jdFromMs, R_MOON: R_MOON,
    uv: uv, gmstDeg: gmstDeg, moonVec: moonVec, vectors: vectors, transfer: transfer, transferAt: transferAt };
})();
if (typeof module !== 'undefined') module.exports = Ephem;
