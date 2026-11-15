/* Run with: node tests/run.js */
const assert = require('assert');
const Ephem = require('../js/ephem.js');
const Terrain = require('../js/terrain.js');
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} +/- ${tol}`);
const mod = (x) => ((x % 360) + 360) % 360;

// Meeus, Astronomical Algorithms, example 47.a (1992 April 12, 0h TD)
const m = Ephem.moonSun(2448724.5);
near(mod(m.lam), 133.162655, 0.003, 'Moon longitude');
near(m.bet, -3.229126, 0.003, 'Moon latitude');
near(m.dist, 368409.7, 30, 'Moon distance (km)');
// Meeus example 53.a: optical libration and the selenographic position of the Sun
const lib = Ephem.seleno(m.lam, m.bet, m.F, m.Om);
near(lib.lon, -1.206, 0.01, 'libration in longitude');
near(lib.lat, 4.194, 0.01, 'libration in latitude');
const sp = Ephem.subPoints(2448724.5 - 69.2 / 86400);
near(sp.sLon, 67.89, 0.05, 'sub-solar longitude');
near(sp.sLat, 1.46, 0.05, 'sub-solar latitude');
// Apollo 11 touchdown, 1969-07-20 20:17 UTC: Sun about 10.8 deg up in the east, Earth high in the west
const p = Ephem.subPoints(Ephem.jdFromMs(Date.UTC(1969, 6, 20, 20, 17)));
const sun = Ephem.altAz(0.6741, 23.473, p.sLon, p.sLat, p.sunR);
near(sun.el, 10.8, 0.5, 'Apollo 11 Sun elevation'); near(sun.az, 90, 5, 'Apollo 11 Sun azimuth');
// A body straight overhead is at 90 deg; at a point 90 deg away it sits on the horizon (minus parallax for Earth)
near(Ephem.altAz(10, 20, 20, 10, 1.5e8).el, 90, 1e-3, 'zenith');
near(Ephem.altAz(0, 90, 0, 0, 384400).el, -0.259, 0.01, 'Earth parallax at the limb');

// Terrain: flat ground gives the 2 m eye-height dip; a wall gives atan(h/d)
const flat = Terrain.flat();
near(Terrain.horizon(flat, 123, 0), -0.087, 0.01, 'flat horizon');
const h = new Float32Array(128 * 128);
for (let i = 0; i < 128; i++) { h[(64 - 25) * 128 + i] = 100; h[(64 - 26) * 128 + i] = 100; }
const wall = Terrain.finish({ N: 128, cell: 40, h, rot: 0 });
near(wall.prof[0], Math.atan(98 / 1000) * 180 / Math.PI, 0.3, 'wall to the north');
near(wall.prof[180], -0.087, 0.02, 'open to the south');
// Shadow map: Sun low in the north is blocked behind the wall, clear in front of it
const lit = Terrain.shadow(wall, 0, 3, 0.27, 0);
assert(lit[70 * 128 + 64] === 0, 'cell south of the wall is in shadow');
assert(lit[20 * 128 + 64] === 1, 'cell north of the wall is lit');
assert(Terrain.shadow(wall, 0, 20, 0.27, 0)[70 * 128 + 64] === 1, 'high Sun clears the wall');
// From any point: the wall hides the Sun-side horizon and the far side of the wall from a rover standing south of it
near(Terrain.horizonFrom(wall, 0, 0, 0, 2), wall.prof[0], 1e-4, 'horizonFrom matches the site profile');
assert(Terrain.horizonFrom(wall, 0, 900, 0, 2) > 30, 'wall looms when close');
assert(Terrain.los(wall, 0, -500, 2, 0, 0, 3) === true, 'clear line of sight on open ground');
assert(Terrain.los(wall, 0, 1500, 2, 0, 0, 3) === false, 'wall blocks the line of sight');
// Rotated grid: with rot = 90 the same wall lies to the local west (azimuth 270)
const rotd = Terrain.finish({ N: 128, cell: 40, h, rot: 90 });
near(rotd.prof[270], wall.prof[0], 0.01, 'grid rotation');
// Synthetic terrain is deterministic
assert.deepStrictEqual(Array.from(Terrain.synthetic(-85, 30).h.slice(0, 50)), Array.from(Terrain.synthetic(-85, 30).h.slice(0, 50)));
// ASCII grid loader
const asc = 'ncols 4\nnrows 4\nxllcorner 0\nyllcorner 0\ncellsize 100\nNODATA_value -9999\n1 2 3 4\n1 2 3 4\n1 2 3 4\n1 2 3 4\n';
// a tile with a missing cell is rejected, not filled in
assert.throws(() => Terrain.fromAsc(asc.replace('1 2 3 4\n1 2 3 4\n1 2 3 4\n', '1 2 3 4\n1 2 -9999 4\n1 2 3 4\n'), 'north', 0, 't'));
const dem = Terrain.fromAsc(asc, 'north', 0, 't');
near(dem.cell, 400 / 128, 1e-6, 'resampled cell'); assert(dem.min >= 1 && dem.max <= 4);
assert.throws(() => Terrain.fromAsc('hello', 'north', 0));
// Earth-Moon-Sun frame: the rebuilt lunar axes must reproduce the sub-Earth and sub-solar directions
const v = Ephem.vectors(Ephem.jdFromMs(Date.UTC(2026, 10, 14, 5, 30)));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], unit = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };
const toBody = (R, x) => [dot(R[0], x), dot(R[1], x), dot(R[2], x)];
const eB = toBody(v.moonRot, unit(v.moon.map((x) => -x))), eS = Ephem.uv(v.sub.eLat, v.sub.eLon);
near(dot(eB, eS), 1, 1e-9, 'Earth direction in the lunar frame');
near(dot(toBody(v.moonRot, v.sun), Ephem.uv(v.sub.sLat, v.sub.sLon)), 1, 1e-5, 'Sun direction in the lunar frame');
near(Math.asin(v.moonRot[2][2]) * 180 / Math.PI, 90 - 1.5424, 0.02, 'tilt of the lunar pole to the ecliptic');
// Earth orientation: in mid-November the Sun is overhead near 18 S, and at 05:30 UTC near 94 E
const sE = toBody(v.earthRot, v.sun);
near(Math.asin(sE[2]) * 180 / Math.PI, -18.2, 0.3, 'solar declination'); near(Math.atan2(sE[1], sE[0]) * 180 / Math.PI, 93.6, 0.5, 'sub-solar longitude on Earth');
// Transfer ellipse: leaves from 200 km above a 6,371 km Earth at about 10.9 km/s and ends 500 km above the Moon
const t0 = Date.UTC(2026, 10, 14, 5, 30), tr = Ephem.transfer(t0), a0 = Ephem.transferAt(tr, t0), a1 = Ephem.transferAt(tr, t0 + tr.tof * 1000), mv = Ephem.moonVec(t0 + tr.tof * 1000);
near(a0.r, 6571, 1, 'departure radius'); near(a0.speed, 10.92, 0.05, 'departure speed (km/s)');
near(Math.hypot(a1.pos[0] - mv[0], a1.pos[1] - mv[1], a1.pos[2] - mv[2]), 2237.4, 5, 'arrival distance from the Moon centre');
assert(tr.tof / 86400 > 4.3 && tr.tof / 86400 < 5.3, 'time of flight between 4.3 and 5.3 days');
// JPL Horizons (DE441), retrieved 14 Nov 2026: apparent azimuth and elevation of the Sun and Earth from three lunar sites,
// 00:00 UTC on 14, 17, 20, 23 and 26 Nov 2026. Rows are [sunAz, sunEl, earthAz, earthEl].
const HORIZONS = [
  { lat: -69.373, lon: 32.319, rows: [[94.571036, -0.055703, 325.602342, 12.521085], [59.928392, 12.312306, 320.783913, 15.282258], [22.816456, 20.694072, 317.722423, 18.848841], [343.708587, 21.403274, 319.122516, 22.069747], [306.186905, 14.104065, 324.968303, 22.719295]] },
  { lat: -89.45, lon: -137.3, rows: [[263.902879, 1.498257, 136.041926, -5.044143], [227.367562, 1.180823, 132.078486, -1.335009], [190.894563, 1.004609, 130.085418, 2.817613], [154.478946, 1.034620, 132.142536, 5.621336], [118.091409, 1.250192, 137.572145, 5.041511]] },
  { lat: 0.6741, lon: 23.473, rows: [[91.441740, -13.158069, 279.017549, 64.944427], [91.984328, 23.364411, 270.262386, 61.193982], [94.233762, 59.796907, 262.189068, 58.897038], [250.697352, 83.326091, 255.956764, 60.416404], [267.044989, 47.254236, 254.282491, 65.819017]] }];
let worst = 0;
const wrap = (x) => ((x + 540) % 360) - 180;
HORIZONS.forEach((s) => s.rows.forEach((r, i) => {
  const q = Ephem.subPoints(Ephem.jdFromMs(Date.UTC(2026, 10, 14 + 3 * i))), su = Ephem.altAz(s.lat, s.lon, q.sLon, q.sLat, q.sunR), ea = Ephem.altAz(s.lat, s.lon, q.eLon, q.eLat, q.dist);
  worst = Math.max(worst, Math.abs(su.el - r[1]), Math.abs(wrap(su.az - r[0])) * Math.cos(su.el * Math.PI / 180), Math.abs(ea.el - r[3]), Math.abs(wrap(ea.az - r[2])) * Math.cos(ea.el * Math.PI / 180));
}));
assert(worst < 0.05, 'agreement with JPL Horizons within 0.05 deg, got ' + worst);
console.log('Largest difference from JPL Horizons: ' + worst.toFixed(3) + ' deg');
// Far horizon: terrain beyond the grid raises the horizon and darkens the shadow map
const farT = Terrain.fromHeights(new Float32Array(128 * 128), 500, 'flat with a far ridge', new Array(360).fill(3));
near(Terrain.horizon(farT, 40, 0), 3, 1e-6, 'far horizon is used');
assert(Terrain.shadow(farT, 40, 2, 0.27, 0)[64 * 128 + 64] === 0 && Terrain.shadow(farT, 40, 5, 0.27, 0)[64 * 128 + 64] === 1, 'far horizon blocks a low Sun');
console.log('All checks passed.');
