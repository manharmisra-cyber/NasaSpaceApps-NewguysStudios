import test from 'node:test';
import assert from 'node:assert/strict';
import {transfer, candidateAt, budget, planeChange, validate, search} from '../mission-core.mjs';
import {maneuverGuide, HIGHEST_TERRAIN_KM} from '../maneuvers.mjs';

const epoch = Date.UTC(2026, 10, 14) / 1000;
const base = {origin: 'moon', goal: 'orbit', crew: 'robotic', wet: 15000, dry: 6500, thrust: 45, isp: 320, reserve: 10, allowance: 300,
  ap: 100, pe: 100, inc: 90, node: 0, arg: 0, phase: 0, earthAp: 200, earthPe: 200, targetAp: 200, targetPe: 200,
  lat: -89, lon: 0, radius: 50, epoch, from: epoch + 3600, to: epoch + 90000};
const mu = 4902.800118, R = 1737.4;
const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} != ${b} (tol ${tol})`);
const vis = (r, a) => Math.sqrt(mu * (2 / r - 1 / a)) * 1000;   // m/s
function guide(change) {
  const p = {...base, ...change}, tr = transfer(p), c = candidateAt(epoch + 3 * 3600, p, tr), b = budget(p, c, tr);
  return {p, tr, c, b, g: maneuverGuide(p, c, b, tr)};
}
const total = g => g.maneuvers.reduce((s, m) => s + m.dv, 0);

test('Hohmann raise 100 km to 500 km: two prograde burns with textbook delta-v', () => {
  const {g, b} = guide({targetAp: 500, targetPe: 500});
  const r1 = R + 100, r2 = R + 500, a = (r1 + r2) / 2;
  assert.match(g.title, /Hohmann transfer: raise/);
  assert.equal(g.maneuvers.length, 2);
  near(g.maneuvers[0].dv, vis(r1, a) - vis(r1, r1), 1e-6);
  near(g.maneuvers[1].dv, vis(r2, r2) - vis(r2, a), 1e-6);
  assert.deepEqual(g.maneuvers.map(m => m.direction), ['prograde', 'prograde']);
  near(total(g), b.needed, 1e-9, 'guidance and budget agree');
  for (const m of g.maneuvers) for (const k of ['objective', 'initial', 'target', 'location', 'direction', 'expected']) assert.ok(m[k], `${m.id} ${k}`);
  for (const m of g.maneuvers) { assert.ok(m.duration > 0 && m.propellant > 0 && m.steps.length >= 3); }
});

test('Hohmann lower 500 km to 100 km uses retrograde burns', () => {
  const {g} = guide({ap: 500, pe: 500, targetAp: 100, targetPe: 100});
  assert.match(g.title, /lower/);
  assert.deepEqual(g.maneuvers.map(m => m.direction), ['retrograde', 'retrograde']);
});

test('circularize at apoapsis: one prograde burn equal to circular minus apoapsis speed', () => {
  const {g} = guide({ap: 300, pe: 100, targetAp: 300, targetPe: 300});
  assert.equal(g.title, 'Circularize at apoapsis');
  assert.equal(g.maneuvers.length, 1);
  const ra = R + 300, a = (R + 300 + R + 100) / 2;
  near(g.maneuvers[0].dv, vis(ra, ra) - vis(ra, a), 1e-6);
  assert.equal(g.maneuvers[0].direction, 'prograde');
});

test('circularize at periapsis: one retrograde burn at the low point', () => {
  const {g} = guide({ap: 300, pe: 100, targetAp: 100, targetPe: 100});
  assert.equal(g.title, 'Circularize at periapsis');
  assert.equal(g.maneuvers.length, 1);
  const rp = R + 100, a = (R + 300 + R + 100) / 2;
  near(g.maneuvers[0].dv, vis(rp, a) - vis(rp, rp), 1e-6);
  assert.equal(g.maneuvers[0].direction, 'retrograde');
  assert.match(g.maneuvers[0].location, /100\.0 km/);
});

test('circular to elliptical: raise apoapsis and lower periapsis each take one burn', () => {
  const up = guide({targetAp: 300, targetPe: 100}).g;
  assert.equal(up.title, 'Circular to elliptical: raise apoapsis');
  assert.equal(up.maneuvers.length, 1); assert.equal(up.maneuvers[0].direction, 'prograde');
  const r = R + 100;
  near(up.maneuvers[0].dv, vis(r, (r + R + 300) / 2) - vis(r, r), 1e-6);
  const down = guide({targetAp: 100, targetPe: 50}).g;
  assert.equal(down.title, 'Circular to elliptical: lower periapsis');
  assert.equal(down.maneuvers.length, 1); assert.equal(down.maneuvers[0].direction, 'retrograde');
});

test('elliptical to circular and generic two-burn transfers are labelled as such, not Hohmann', () => {
  const e2c = guide({ap: 300, pe: 100, targetAp: 600, targetPe: 600}).g;
  assert.equal(e2c.title, 'Elliptical to circular: two-burn transfer');
  assert.ok(e2c.assumptions.some(a => /Hohmann transfer only when both orbits are circular/.test(a)));
  const ee = guide({ap: 300, pe: 100, targetAp: 900, targetPe: 400}).g;
  assert.match(ee.title, /coaxial/);
  assert.ok(ee.maneuvers[0].warnings.some(w => /apse line/.test(w)));
});

test('no change needed when the target equals the start orbit', () => {
  const {g, b} = guide({targetAp: 100, targetPe: 100});
  assert.equal(g.maneuvers.length, 0);
  assert.equal(g.title, 'No maneuver needed');
  near(b.needed, 0, 1e-9);
});

test('inclination change: 2 v sin(di/2) at the node, included in the fuel budget, correct direction', () => {
  const {g, b, p} = guide({targetAp: 200, targetPe: 200, targetInc: 80});
  const pc = planeChange(p), r = R + 200;
  near(pc.dv, 2 * Math.sqrt(mu / r) * 1000 * Math.sin(5 * Math.PI / 180), 1e-6);
  const m = g.maneuvers.find(x => x.type === 'plane-change');
  assert.ok(m);
  near(m.dv, pc.dv, 1e-9);
  assert.ok(b.burns.some(x => x.name === 'Plane change'));
  near(total(g), b.needed, 1e-9);
  assert.equal(pc.direction, 'anti-normal', 'lowering inclination at the ascending node');
  assert.equal(planeChange({...p, targetInc: 100}).direction, 'normal');
  assert.equal(planeChange({...p, targetInc: 90}), null);
  // Eccentric target: the slower (higher) node is chosen.
  const ecc = planeChange({...p, targetAp: 900, targetPe: 100, arg: 90, targetInc: 80});
  assert.ok(ecc.altitude > 400, `node at ${ecc.altitude} km`);
  assert.ok(validate({...p, targetInc: 200}).length);
  assert.deepEqual(validate({...p, targetInc: NaN}), []);
});

test('lunar orbit insertion and trans-lunar injection from Earth match the budget and are marked as estimates', () => {
  const {g, b} = guide({origin: 'earth', goal: 'land'});
  const ids = g.maneuvers.map(m => m.id);
  assert.deepEqual(ids, ['tli', 'loi', 'deorbit', 'braking']);
  near(g.maneuvers[0].dv, b.burns[0].dv, 1e-9);
  near(g.maneuvers[1].dv, b.burns[1].dv, 1e-9);
  assert.equal(g.maneuvers[1].direction, 'retrograde');
  assert.ok(g.maneuvers[0].estimate && g.maneuvers[1].estimate);
  assert.ok(g.maneuvers[1].warnings.some(w => /not solved/.test(w)));
  near(total(g), b.needed, 1e-9);
});

test('landing guidance: deorbit retrograde, braking against surface velocity, durations from the budget', () => {
  const {g, b, tr, c} = guide({goal: 'land'});
  const [d, s] = g.maneuvers;
  assert.equal(d.direction, 'retrograde'); near(d.dv, tr.first, 1e-9); near(d.duration, b.burns[0].duration, 1e-9);
  near(s.dv, c.last, 1e-9); near(s.duration, b.burns[1].duration, 1e-9);
  assert.ok(s.warnings.some(w => /gravity losses/.test(w)));
  assert.ok(s.checks.some(k => k.label === 'Touchdown thrust'));
});

test('unavailable when there is no state to plan from, and for unsupported goals', () => {
  assert.equal(maneuverGuide(null, null, null).available, false);
  const {p, c} = guide({});
  assert.equal(maneuverGuide(p, c, {burns: []}).available, false);
});

test('feasibility: terrain clearance, propellant, long burns and crew limits are reported', () => {
  const low = guide({targetAp: 200, targetPe: 10}).g;
  const k = low.maneuvers.flatMap(m => m.checks).find(x => /periapsis clearance/.test(x.label) && x.status === 'fail');
  assert.ok(k, `periapsis 10 km is below the ${HIGHEST_TERRAIN_KM} km terrain`);
  const empty = guide({goal: 'land', dry: 13000}).g;
  assert.ok(empty.maneuvers.some(m => m.checks.some(x => x.label === 'Propellant' && x.status === 'fail')));
  const slow = guide({goal: 'land', thrust: 5}).g;
  assert.ok(slow.maneuvers.some(m => m.warnings.some(w => /Long burn/.test(w))));
  const crew = guide({goal: 'land', crew: 'crewed'}).g;
  assert.ok(crew.maneuvers.some(m => m.checks.some(x => x.label === 'Crew acceleration')));
});

test('guidance agrees with the opportunity chosen by the arrival search', () => {
  const p = {...base, goal: 'land'}, r = search(p), c = r.windows[0], b = budget(p, c, r.tr), g = maneuverGuide(p, c, b, r.tr);
  near(total(g), b.needed, 1e-9);
  assert.match(g.maneuvers[0].location, new RegExp(new Date(c.burn * 1000).toISOString().slice(0, 16)));
});
