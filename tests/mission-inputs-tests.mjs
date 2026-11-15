import test from 'node:test';
import assert from 'node:assert/strict';
import {C, validate, transfer, candidateAt, budget, earthLeg, orbitalState, search} from '../mission-core.mjs';
import {CREW_LIMIT_CURVES, DEFAULT_CREW_LIMIT, limitAt, timeAtOrAbove, burnAccelerations, crewAccelerationCheck, G0} from '../crew-limits.mjs';

const epoch = Date.UTC(2026, 10, 14) / 1000;
const base = {origin: 'moon', goal: 'land', crew: 'robotic', wet: 15000, dry: 6500, thrust: 45, isp: 320, reserve: 10, allowance: 300,
  ap: 100, pe: 100, inc: 90, node: 0, arg: 0, phase: 0, earthAp: 200, earthPe: 200, targetAp: 200, targetPe: 200,
  lat: -89, lon: 0, radius: 50, epoch, from: epoch + 3600, to: epoch + 90000};
const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} != ${b} (tol ${tol})`);
const mu = 4902.800118, R = 1737.4;
// Budget for the arrival at the first possible time, so geometry is held fixed.
function run(p) { const tr = transfer(p), c = candidateAt(epoch + 3 * 3600, p, tr); return {tr, c, b: budget(p, c, tr)}; }

// ---------------------------------------------------------------- physics audit

test('orbital speed and period follow vis-viva and Kepler for the Moon', () => {
  const o = orbitalState(base), r = R + 100;
  near(Math.sqrt(mu / o.a), Math.sqrt(mu / r), 1e-12);
  near(Math.sqrt(mu / r), 1.6335, 1e-4, 'circular speed at 100 km, km/s');
  near(o.period, 2 * Math.PI * Math.sqrt(r ** 3 / mu), 1e-9);
  near(o.period / 60, 117.8, 0.1, 'period at 100 km, min');
  const e = orbitalState({...base, ap: 200, pe: 50});
  near(e.a, R + 125, 1e-9); near(e.e, 150 / (2 * R + 250), 1e-12);
});

test('Hohmann-type transfer between circular lunar orbits matches the textbook formula', () => {
  const p = {...base, goal: 'orbit', ap: 100, pe: 100, targetAp: 500, targetPe: 500};
  const r1 = R + 100, r2 = R + 500, a = (r1 + r2) / 2;
  const dv1 = (Math.sqrt(mu * (2 / r1 - 1 / a)) - Math.sqrt(mu / r1)) * 1000;
  const dv2 = (Math.sqrt(mu / r2) - Math.sqrt(mu * (2 / r2 - 1 / a))) * 1000;
  const {tr, b} = run(p);
  near(tr.first, dv1, 1e-9, 'first burn m/s');
  near(b.burns[1].dv, dv2, 1e-6, 'insertion burn m/s');
  near(tr.time, Math.PI * Math.sqrt(a ** 3 / mu), 1e-9, 'half-ellipse coast s');
});

test('rocket equation, burn durations with changing mass and unit conversions', () => {
  const {b} = run(base), ve = 320 * 9.80665;      // Isp s -> exhaust speed m/s
  near(b.flow, 45 * 1000 / ve, 1e-12, 'mass flow kg/s from kN');
  let m = 15000;
  for (const x of b.burns) {
    near(x.after, m * Math.exp(-x.dv / ve), 1e-9);
    // Constant thrust: duration is propellant / mass flow, exact for the changing mass.
    const tExact = (m / (45000 / ve)) * (1 - Math.exp(-x.dv / ve));
    near(x.duration, tExact, 1e-9);
    m = x.after;
  }
  near(b.available, ve * Math.log(15000 / (6500 + 0.1 * 8500)), 1e-9);
});

test('Earth departure and capture use Earth and Moon gravity parameters, not one for both', () => {
  const p = {...base, origin: 'earth'}, l = earthLeg(p);
  const r = 6378.137 + 200, a = (r + 384400) / 2, mE = 398600.435507;
  near(l.dv, (Math.sqrt(mE * (2 / r - 1 / a)) - Math.sqrt(mE / r)) * 1000, 1e-9);
  near(l.time / 86400, Math.PI * Math.sqrt(a ** 3 / mE) / 86400, 1e-12);
  assert.ok(l.capture > 0);
});

// ---------------------------------------------------------------- input audit

// For every input: change it and check what moves and what must not.
const delta = (a, b) => Math.abs(a - b) > 1e-9;
test('every Your mission input reaches the calculations it should, and only those', () => {
  const ref = run(base);
  const cases = [
    ['wet', {wet: 16000}, b => b.available > ref.b.available, ['required']],
    ['dry', {dry: 7000}, b => b.available < ref.b.available, ['required']],
    ['isp', {isp: 340}, b => b.available > ref.b.available && b.burns[1].duration !== ref.b.burns[1].duration, ['required']],
    ['thrust', {thrust: 60}, b => b.burns[1].duration < ref.b.burns[1].duration && b.twr > ref.b.twr, ['required', 'available']],
    ['reserve', {reserve: 20}, b => b.available < ref.b.available && b.reserved > ref.b.reserved, ['required']],
    ['allowance', {allowance: 400}, b => Math.abs(b.required - ref.b.required - 100) < 1e-9, ['available', 'needed']],
    ['ap/pe', {ap: 150, pe: 150}, b => delta(b.needed, ref.b.needed), ['available']],
    ['crew', {crew: 'crewed'}, b => b.crew.applicable && !ref.b.crew.applicable, ['required', 'available']],
    ['crewLimit', {crew: 'crewed', crewLimit: 'A'}, b => b.crew.curve === 'A', ['required', 'available']],
  ];
  for (const [name, change, effect, unchanged] of cases) {
    const {b} = run({...base, ...change});
    assert.ok(effect(b), `${name} should change its result`);
    for (const k of unchanged) assert.ok(!delta(b[k], ref.b[k]), `${name} must not change ${k}`);
  }
});

test('route-specific inputs act only on their route', () => {
  // Earth parking orbit only matters when starting from Earth.
  const moon = run({...base, earthPe: 400, earthAp: 400}).b, earth1 = run({...base, origin: 'earth'}).b, earth2 = run({...base, origin: 'earth', earthPe: 400, earthAp: 400}).b;
  assert.ok(!delta(moon.needed, run(base).b.needed));
  assert.ok(delta(earth1.burns[0].dv, earth2.burns[0].dv));
  // Target orbit only matters for an orbit transfer.
  assert.ok(!delta(run({...base, targetAp: 900, targetPe: 900}).b.needed, run(base).b.needed));
  const o1 = run({...base, goal: 'orbit'}).b, o2 = run({...base, goal: 'orbit', targetAp: 900, targetPe: 900}).b;
  assert.ok(delta(o1.needed, o2.needed));
});

test('orientation, phase and epoch move the arrival point, not the fuel budget for a circular orbit', () => {
  const ref = run(base);
  for (const change of [{inc: 60}, {node: 40}, {arg: 30}, {phase: 50}]) {
    const p = {...base, ...change}, tr = transfer(p), c = candidateAt(epoch + 3 * 3600, p, tr);
    assert.ok(delta(c.lat, ref.c.lat) || delta(c.lon, ref.c.lon), JSON.stringify(change));
    near(budget(p, c, tr).burns[0].dv, ref.b.burns[0].dv, 1e-9);
  }
});

test('pin and interval inputs change the arrival search', () => {
  const a = search(base), b = search({...base, lat: -60}), c = search({...base, radius: 10}), d = search({...base, to: epoch + 40000});
  assert.notEqual(a.windows.length, b.windows.length);
  const open = r => r.windows.reduce((s, w) => s + w.duration, 0);
  assert.ok(open(c) < open(a), 'a smaller radius shortens the windows');
  assert.ok(d.windows.length < a.windows.length);
});

test('hidden route fields cannot block a result', () => {
  assert.deepEqual(validate({...base, earthAp: NaN, earthPe: NaN, targetAp: NaN, targetPe: NaN}), []);
  assert.ok(validate({...base, origin: 'earth', earthAp: NaN}).length);
  assert.ok(validate({...base, goal: 'orbit', targetPe: NaN}).length);
  assert.ok(validate({...base, goal: 'orbit', targetAp: 100, targetPe: 200}).length);
});

// ---------------------------------------------------------------- crew acceleration

test('limit curves reproduce NASA/TM-20205008196 Table 1 at the tabulated durations', () => {
  const B = [[0.5, 9.81], [50, 7.10], [80, 5.27], [90, 4.89], [100, 4.57], [120, 4.07], [150, 3.54], [540, 1.57], [700, 1.57], [900, 1.57], [5000, 1.57]];
  for (const [t, v] of B) near(limitAt('B', t), v, 1e-12, `B at ${t} s`);
  near(limitAt('A', 899), 9.81, 1e-12); near(limitAt('A', 900), 4.91, 1e-12);
  near(limitAt('C', 10), 13.0, 1e-12); near(limitAt('E', 15), 12.3, 1e-12);
  near(limitAt('B', 345), 3.54 + (345 - 150) / 390 * (1.57 - 3.54), 1e-12, 'linear between 150 and 540 s');
  near(limitAt('B', 0.1), 9.81, 1e-12, 'transient range uses the 0.5 s value');
  assert.ok(Number.isNaN(limitAt('Z', 10)));
  assert.equal(DEFAULT_CREW_LIMIT, 'B');
  for (const c of Object.values(CREW_LIMIT_CURVES)) for (let i = 1; i < c.limits.length; i++) assert.ok(c.limits[i] <= c.limits[i - 1]);
});

test('felt acceleration is thrust over mass; exposure time matches the closed form', () => {
  const F = 45000, burn = {name: 'x', before: 12000, after: 9000, duration: 3000 / (45000 / (320 * G0))};
  const [a] = burnAccelerations([burn], F);
  near(a.start, 3.75, 1e-12); near(a.end, 5, 1e-12);
  near(timeAtOrAbove([a], 3), burn.duration, 1e-9, 'level below the start');
  near(timeAtOrAbove([a], 6), 0, 0, 'level above the peak');
  // a(t) = 4 when m = 11250, a quarter of the way through the propellant.
  near(timeAtOrAbove([a], 4), burn.duration * 0.75, 1e-9);
  near(timeAtOrAbove([a, a], 4), burn.duration * 1.5, 1e-9, 'exposures add across burns');
});

test('lunar gravity is reported separately and never added to the felt acceleration', () => {
  const {b} = run({...base, crew: 'crewed'});
  near(b.crew.peak, 45000 / b.burns.at(-1).after, 1e-9);
  near(b.crew.gravity.lunarSurface, mu / R ** 2 * 1000, 1e-9);
  near(b.crew.peakG, b.crew.peak / 9.80665, 1e-12);
});

test('default crewed lander: curve B fails, seated curves pass, and robotic missions are exempt', () => {
  const p = {...base, crew: 'crewed'};
  const b = run(p).b;
  assert.equal(b.crew.curve, 'B');
  assert.equal(b.crewOK, false);
  assert.ok(b.crew.worst.ratio > 1);
  near(b.crew.worst.limit, limitAt('B', b.crew.worst.duration), 1e-12);
  for (const c of ['A', 'C', 'D', 'E']) assert.equal(run({...p, crewLimit: c}).b.crewOK, true, c);
  const robotic = run(base).b;
  assert.equal(robotic.crew.applicable, false);
  near(robotic.crew.peak, b.crew.peak, 1e-12, 'engine acceleration is reported for robotic missions too');
  assert.equal(robotic.crewOK, true);
});

test('lower thrust lowers felt acceleration; very high thrust breaks even the seated limit', () => {
  const low = run({...base, crew: 'crewed', thrust: 25}).b, high = run({...base, crew: 'crewed', thrust: 45}).b;
  assert.ok(low.crew.peak < high.crew.peak);
  const brutal = run({...base, crew: 'crewed', crewLimit: 'A', thrust: 400}).b;   // ~4.7 g peak
  assert.equal(brutal.crewOK, false);
  assert.ok(brutal.crew.worst.level > 9.81);
});

test('crew limits never change delta-v, windows or fuel; they add a separate pass/fail', () => {
  const a = search(base), b = search({...base, crew: 'crewed'});
  near(a.budget.required, b.budget.required, 1e-9);
  assert.equal(a.windows.length, b.windows.length);
  assert.equal(b.budget.fuelOK, a.budget.fuelOK);
  assert.equal(typeof b.budget.crewOK, 'boolean');
});

test('crew limit input is validated', () => {
  assert.ok(validate({...base, crew: 'crewed', crewLimit: 'Z'}).length);
  assert.deepEqual(validate({...base, crew: 'crewed', crewLimit: 'C'}), []);
  assert.deepEqual(validate({...base, crew: 'crewed'}), []);   // optional: default curve
  assert.deepEqual(validate({...base, crewLimit: 'Z'}), []);   // ignored for robotic missions
  const r = crewAccelerationCheck({crew: 'crewed', crewLimit: 'Z', thrust: 45}, []);
  assert.equal(r.ok, false);
  assert.ok(r.error);
});
