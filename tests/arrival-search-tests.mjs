import test from 'node:test';
import assert from 'node:assert/strict';
import {MOON_MEAN_RADIUS_KM, normalizeLongitude, isValidLatLon, centralAngle, surfaceDistanceKm} from '../lunar-geometry.mjs';
import {search, SEARCH, validateArrivalSearch} from '../arrival-search.mjs';
import {C, transfer, candidateAt, search as coreSearch} from '../mission-core.mjs';

const epoch = Date.UTC(2026, 10, 14) / 1000;
const base = {origin: 'moon', goal: 'land', crew: 'robotic', wet: 15000, dry: 6500, thrust: 45, isp: 320, reserve: 10, allowance: 300,
  ap: 100, pe: 100, inc: 90, node: 0, arg: 0, phase: 0, earthAp: 200, earthPe: 200, targetAp: 200, targetPe: 200,
  lat: -89, lon: 0, radius: 50, epoch, from: epoch + 3600, to: epoch + 90000};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} != ${b} (tol ${tol})`);
const R = MOON_MEAN_RADIUS_KM;
const tr = transfer(base);
const at = (p, t) => candidateAt(t, p, transfer(p));
// An arrival point on the track and the local ground speed there (km/s).
function trackPoint(t) {
  const c = candidateAt(t, base, tr), d = candidateAt(t + 1, base, tr);
  return {c, speed: surfaceDistanceKm(c.lat, c.lon, d.lat, d.lon)};
}
// A pin offset east of the arrival point at time t by dLon degrees.
const pinBeside = (t, dLon) => { const {c} = trackPoint(t); return {lat: c.lat, lon: normalizeLongitude(c.lon + dLon)}; };

// ---------------------------------------------------------------- geometry

test('geometry uses the lunar mean radius, not Earth radius', () => {
  assert.equal(R, 1737.4);
  assert.equal(C.R, R);
  near(surfaceDistanceKm(0, 0, 0, 1), R * Math.PI / 180, 1e-9);   // 30.32 km per degree
  near(surfaceDistanceKm(0, 0, 0, 90), R * Math.PI / 2, 1e-9);
  near(surfaceDistanceKm(0, 0, 0, 180), R * Math.PI, 1e-9);        // antipode
  near(surfaceDistanceKm(90, 0, -90, 0), R * Math.PI, 1e-9);
});

test('zero distance and very small distances are exact', () => {
  assert.equal(surfaceDistanceKm(-89.45, -137.3, -89.45, -137.3), 0);
  const oneMetre = 0.001 / R * 180 / Math.PI;            // one metre of latitude, in degrees
  near(surfaceDistanceKm(10, 20, 10 + oneMetre, 20), 0.001, 1e-12);
});

test('longitude wraparound: the antimeridian and out-of-range longitudes', () => {
  near(surfaceDistanceKm(0, 180, 0, -180), 0, 1e-9);
  near(surfaceDistanceKm(0, 179.9, 0, -179.9), 0.2 * Math.PI / 180 * R, 1e-9);
  near(surfaceDistanceKm(5, 540, 5, 180), 0, 1e-9);
  near(surfaceDistanceKm(5, -190, 5, 170), 0, 1e-9);
  assert.equal(normalizeLongitude(180), -180);
  assert.equal(normalizeLongitude(-180), -180);
  assert.equal(normalizeLongitude(370), 10);
  assert.equal(normalizeLongitude(-0), 0);
  assert.ok(Number.isNaN(normalizeLongitude(NaN)));
});

test('poles: longitude is irrelevant at the pole and arcs cross it correctly', () => {
  near(surfaceDistanceKm(-90, 0, -90, 123), 0, 1e-9);
  near(surfaceDistanceKm(89.9, 0, 89.9, 180), 0.2 * Math.PI / 180 * R, 1e-9);
  near(surfaceDistanceKm(-89, 0, -89, 90), centralAngle(-89, 0, -89, 90) * R, 0);
  near(surfaceDistanceKm(-89, 0, -89, 90), 2 * Math.asin(Math.SQRT1_2 * Math.sin(Math.PI / 180)) * R, 1e-9);
});

test('invalid coordinates give NaN instead of a distance', () => {
  for (const args of [[NaN, 0, 0, 0], [0, NaN, 0, 0], [91, 0, 0, 0], [0, 0, -90.1, 0], [0, Infinity, 0, 0], [undefined, 0, 0, 0]]) {
    assert.ok(Number.isNaN(surfaceDistanceKm(...args)), String(args));
  }
  assert.equal(isValidLatLon(90, 400), true);
  assert.equal(isValidLatLon(null, 0), false);
});

test('arrival distances in the mission core match the shared geometry', () => {
  const p = {...base, lat: -20, lon: 150};
  for (const dt of [4000, 9000, 30000, 70000]) {
    const c = at(p, epoch + dt);
    near(c.distance, surfaceDistanceKm(c.lat, c.lon, p.lat, p.lon), 1e-6);
  }
});

// ---------------------------------------------------------------- search

test('zero distance: a pin exactly on the track is found at the right time', () => {
  const t = epoch + 20000.123, pin = pinBeside(t, 0);
  const r = search({...base, ...pin, radius: 1});
  const w = r.windows.find(x => Math.abs(x.arrival - t) < 5);
  assert.ok(w, 'window at the known time');
  assert.ok(w.distance < 1e-3, `closest approach ${w.distance} km`);
  near(w.arrival, t, 1e-3);
});

test('small radius: window edges sit on the radius and duration matches the chord', () => {
  const t = epoch + 30000, {speed} = trackPoint(t), pin = pinBeside(t, 0);
  const p = {...base, ...pin, radius: 1};
  const r = search(p), w = r.windows.find(x => Math.abs(x.arrival - t) < 5);
  assert.ok(w);
  near(at(p, w.open).distance, 1, 1e-3, 'open edge');
  near(at(p, w.close).distance, 1, 1e-3, 'close edge');
  assert.ok(at(p, w.open - 0.05).distance > 1 && at(p, w.close + 0.05).distance > 1);
  near(w.duration, 2 / speed, 0.05, 'duration ~ 2r / ground speed');
});

test('large radius: 300 km windows are found and bounded on the radius', () => {
  const p = {...base, lat: -60, lon: 10, radius: 300};
  const r = search(p);
  assert.ok(r.windows.length > 0);
  for (const w of r.windows) {
    assert.ok(w.distance <= 300);
    if (!w.clippedStart) near(at(p, w.open).distance, 300, 1e-3);
    if (!w.clippedEnd) near(at(p, w.close).distance, 300, 1e-3);
  }
});

test('exact boundary: a pass tangent to the radius is included, a hair less is excluded', () => {
  const t = epoch + 40000, pin = pinBeside(t, 0.3);
  const narrow = {...base, ...pin, from: t - 3000, to: t + 3000};
  const probe = search({...narrow, radius: 50});
  const dmin = probe.best.distance;
  assert.ok(dmin > 1 && dmin < 50, `closest approach ${dmin}`);
  const tangent = search({...narrow, radius: dmin});
  assert.equal(tangent.windows.length, 1);
  assert.ok(tangent.windows[0].duration < 1, 'tangent window is a touch, not a pass');
  assert.equal(search({...narrow, radius: dmin - 0.001}).windows.length, 0);
});

test('short-duration crossing far shorter than the sample spacing is detected', () => {
  const t = epoch + 50000, pin = pinBeside(t, 0.17);
  const narrow = {...base, ...pin, from: t - 2987.3, to: t + 3000};
  const dmin = search({...narrow, radius: 50}).best.distance;
  assert.ok(dmin > 1, `closest approach ${dmin}`);
  const p = {...narrow, radius: dmin + 0.005};
  const r = search(p);
  assert.equal(r.windows.length, 1);
  const w = r.windows[0], step = r.method.step;
  assert.ok(w.duration > 0 && w.duration < 1, `window lasts ${w.duration} s`);
  assert.ok(step > 30 * w.duration, `sample spacing ${step} s is much longer than the window`);
  // A plain 30-second grid would have missed it.
  let grid = false;
  for (let s = p.from; s <= p.to; s += 30) if (at(p, s).distance <= p.radius) grid = true;
  assert.equal(grid, false);
});

test('outside range: a pin the orbit never reaches yields no windows and an honest closest distance', () => {
  const r = search({...base, inc: 0, lat: -89, radius: 5});
  assert.equal(r.windows.length, 0);
  assert.ok(r.best.distance > 2600);
  assert.ok(r.samples.length > 0);
});

test('longitude wraparound: pins at +180 and -180 give the same windows', () => {
  const p = {...base, lat: -30, radius: 20, from: epoch + 3600, to: epoch + 3 * 86400};
  const a = search({...p, lon: 180}), b = search({...p, lon: -180});
  assert.ok(a.windows.length > 0, 'the polar track crosses the antimeridian');
  assert.deepEqual(a.windows.map(w => [w.open, w.close]), b.windows.map(w => [w.open, w.close]));
  for (const w of a.windows) assert.ok(Math.abs(Math.abs(w.lon) - 180) < 1, `arrival lon ${w.lon}`);
});

test('poles: a polar orbit passes over the south pole and pin longitude does not matter', () => {
  const p = {...base, lat: -90, radius: 5, from: epoch + 3600, to: epoch + 86400};
  const a = search({...p, lon: 0}), b = search({...p, lon: 123.4});
  assert.ok(a.windows.length >= 10, `${a.windows.length} passes in a day`);
  assert.ok(a.windows.every(w => w.distance < 0.5));
  assert.deepEqual(a.windows.map(w => [w.open, w.close]), b.windows.map(w => [w.open, w.close]));
});

test('full interval: no 14-day cut-off, coverage ends at the requested end', () => {
  const p = {...base, lat: -89.45, lon: -137.3, radius: 20, from: epoch + 3600, to: epoch + 60 * 86400};
  const t0 = performance.now(), r = search(p), ms = performance.now() - t0;
  assert.equal(r.coverage.to, p.to);
  assert.equal(r.coverage.complete, true);
  assert.equal(r.coverage.partial, false);
  assert.ok(r.windows.at(-1).arrival > p.from + 50 * 86400, 'windows found late in the interval');
  assert.ok(ms < 5000, `60-day search took ${ms.toFixed(0)} ms`);
  assert.ok(r.windows.every(w => w.arrival >= p.from && w.arrival <= p.to));
});

test('intervals longer than the limit are rejected explicitly, not shortened', () => {
  const p = {...base, to: base.from + (SEARCH.maxDays + 1) * 86400};
  const r = search(p);
  assert.ok(r.errors.length === 1 && /at most/.test(r.errors[0]));
  assert.equal(r.windows, undefined);
  assert.deepEqual(validateArrivalSearch({...base, to: base.from + SEARCH.maxDays * 86400}), []);
});

test('earliest arrival: an interval starting at the epoch begins one transfer time later', () => {
  const p = {...base, from: epoch, to: epoch + 20000};
  const r = search(p);
  assert.equal(r.coverage.from, epoch + tr.time);
  assert.equal(r.coverage.requestedFrom, epoch);
  assert.ok(r.samples.every(s => s.arrival >= epoch + tr.time));
  const empty = search({...base, from: epoch, to: epoch + 10});
  assert.equal(empty.windows.length, 0);
  assert.ok(empty.empty);
});

test('interval edges clip a pass that is already under way, and the window says so', () => {
  const t = epoch + 30000, pin = pinBeside(t, 0);
  const p = {...base, ...pin, radius: 50, from: t, to: t + 4000};
  const r = search(p);
  assert.equal(r.windows[0].open, p.from);
  assert.equal(r.windows[0].clippedStart, true);
  const q = {...p, from: t - 4000, to: t};
  const s = search(q);
  assert.equal(s.windows.at(-1).close, q.to);
  assert.equal(s.windows.at(-1).clippedEnd, true);
});

test('agreement with a brute-force one-second scan: nothing missed, nothing extra', () => {
  for (const pin of [{lat: -89.45, lon: -137.3, radius: 15}, {lat: 12, lon: 179.5, radius: 40}, {lat: -45, lon: -60, radius: 3}]) {
    const p = {...base, ...pin, from: epoch + 3600, to: epoch + 86400};
    const r = search(p);
    for (let s = p.from; s <= p.to; s += 1) {
      const inside = at(p, s).distance <= p.radius;
      const covered = r.windows.some(w => s >= w.open - 0.02 && s <= w.close + 0.02);
      assert.equal(covered, inside, `pin ${pin.lat},${pin.lon} at +${s - p.from}s`);
    }
  }
});

test('windows are sorted, disjoint, and each one contains its own closest approach', () => {
  const p = {...base, lat: -88, lon: 45, radius: 120, to: epoch + 5 * 86400};
  const r = search(p);
  assert.ok(r.windows.length > 1);
  for (let i = 0; i < r.windows.length; i++) {
    const w = r.windows[i];
    assert.ok(w.open <= w.arrival && w.arrival <= w.close);
    if (i) assert.ok(w.open > r.windows[i - 1].close);
  }
});

test('invalid or missing inputs are reported and produce no windows', () => {
  for (const bad of [{lat: NaN}, {lat: 91}, {lat: -90.5}, {lon: NaN}, {lon: 181}, {lon: undefined},
    {radius: 0}, {radius: 301}, {radius: NaN}, {to: base.from - 1}, {from: NaN}]) {
    const r = search({...base, ...bad});
    assert.ok(r.errors.length > 0, JSON.stringify(bad));
    assert.ok(!r.windows || r.windows.length === 0);
    assert.deepEqual(r.samples, []);
  }
});

test('identical inputs give identical results', () => {
  const p = {...base, lat: -70, lon: 33, radius: 25, to: epoch + 4 * 86400};
  const a = JSON.stringify(search(p).windows);
  search({...p, lat: 10});            // replace the internal cache
  const b = JSON.stringify(search({...p}).windows);
  assert.equal(a, b);
});

test('the playback view limits only the map samples, never the windows', () => {
  const p = {...base, lat: -89, lon: 0, radius: 30, to: epoch + 3 * 86400};
  const full = search(p), view = search(p, {from: epoch + 86400, to: epoch + 86400 + 1200});
  assert.deepEqual(view.windows.map(w => w.open), full.windows.map(w => w.open));
  assert.ok(view.samples.every(s => s.arrival >= epoch + 86400 && s.arrival <= epoch + 86400 + 1200));
  assert.ok(full.samples.length <= SEARCH.maxDisplaySamples + full.windows.length + 2);
});

test('eccentric orbit: every apoapsis departure across the whole interval is checked', () => {
  const p = {...base, ap: 200, pe: 50, radius: 300, lat: -60, lon: 0, to: epoch + 30 * 86400};
  const r = search(p);
  assert.equal(r.method.kind, 'discrete');
  const expected = Math.floor((p.to - r.coverage.from) / r.tr.o.period);
  assert.ok(Math.abs(r.method.evaluations - expected) <= 1, `${r.method.evaluations} vs ${expected}`);
  assert.ok(r.windows.every(w => w.distance <= p.radius && w.discrete));
});

test('mission-core still exposes the same search for existing callers', () => {
  assert.equal(coreSearch, search);
});
