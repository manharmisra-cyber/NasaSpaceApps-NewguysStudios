import test from 'node:test';
import assert from 'node:assert/strict';
import {search, budget, transfer, candidateAt} from '../mission-core.mjs';
import {missionCheck} from '../mission-check.mjs';

const epoch = Date.UTC(2026, 10, 14) / 1000;
const base = {origin: 'moon', goal: 'land', crew: 'robotic', wet: 15000, dry: 6500, thrust: 45, isp: 320, reserve: 10, allowance: 300,
  ap: 100, pe: 100, inc: 90, node: 0, arg: 0, phase: 0, earthAp: 200, earthPe: 200, targetAp: 200, targetPe: 200,
  lat: -89, lon: 0, radius: 50, epoch, from: epoch + 3600, to: epoch + 90000};
function check(change) {
  const p = {...base, ...change}, r = search(p);
  const c = r.errors?.length ? null : (r.windows?.[0] || r.best);
  return {p, r, c, mc: missionCheck(p, r, c, c ? budget(p, c, r.tr) : null)};
}
const get = (mc, id) => mc.items.find(x => x.id === id);

test('feasible landing: checks pass, but descent and site hazards are reported as not checked', () => {
  const {mc} = check({});
  // The default 435 s braking burn exceeds 5 % of the orbital period, so the impulsive model is flagged.
  assert.equal(mc.overall, 'warning');
  assert.equal(get(mc, 'impulsive').status, 'warning');
  for (const id of ['inputs', 'start-orbit', 'delta-v', 'propellant', 'thrust', 'geometry']) assert.equal(get(mc, id).status, 'pass', id);
  assert.equal(check({thrust: 120}).mc.overall, 'pass', 'with short burns everything checked passes');
  assert.equal(get(mc, 'powered-descent').status, 'unavailable');
  assert.equal(get(mc, 'landing-site').status, 'unavailable');
  assert.equal(get(mc, 'crew').status, 'not-applicable');
  assert.equal(mc.unchecked, 2);
  assert.match(mc.summary, /2 not checked/);
  for (const x of mc.items.filter(i => i.status === 'pass' && ['delta-v', 'thrust', 'geometry'].includes(i.id))) assert.ok(x.value && x.constraint, x.id);
});

test('infeasible: not enough propellant fails with the shortfall and a correction', () => {
  const {mc} = check({dry: 13000});
  assert.equal(mc.overall, 'fail');
  const dv = get(mc, 'delta-v');
  assert.equal(dv.status, 'fail');
  assert.match(dv.explanation, /Short by/);
  assert.ok(dv.suggestion);
  assert.equal(get(mc, 'propellant').status, 'fail');
});

test('infeasible: thrust below lunar weight at touchdown fails; low braking T/W only warns', () => {
  assert.equal(get(check({thrust: 5}).mc, 'thrust').status, 'fail');
  const mid = check({thrust: 20}).mc;
  assert.equal(get(mid, 'thrust').status, 'pass');
  assert.equal(get(mid, 'thrust-braking').status, 'warning');
});

test('crew limit failure and pass are reported with value and limit', () => {
  const fail = get(check({crew: 'crewed'}).mc, 'crew');
  assert.equal(fail.status, 'fail');
  assert.match(fail.constraint, /Standing/);
  assert.equal(get(check({crew: 'crewed', crewLimit: 'C'}).mc, 'crew').status, 'pass');
});

test('geometry miss fails; orbit transfers mark pin and touchdown checks as not applicable', () => {
  assert.equal(get(check({inc: 0, lat: -89, radius: 5}).mc, 'geometry').status, 'fail');
  const orbit = check({goal: 'orbit'}).mc;
  assert.equal(get(orbit, 'geometry').status, 'not-applicable');
  assert.equal(get(orbit, 'thrust').status, 'not-applicable');
  assert.equal(get(orbit, 'powered-descent'), undefined);
});

test('invalid inputs produce one failing item and no other claims', () => {
  const {mc} = check({wet: 100});
  assert.equal(mc.overall, 'fail');
  assert.equal(mc.items.length, 1);
  assert.equal(mc.items[0].id, 'inputs');
});

test('conflicting or unsupported settings are flagged', () => {
  assert.equal(get(check({goal: 'orbit', targetAp: 100, targetPe: 100}).mc, 'conflict-same-orbit').status, 'warning');
  assert.equal(get(check({goal: 'orbit', targetAp: 200, targetPe: 10}).mc, 'target-orbit').status, 'fail');
  assert.equal(get(check({pe: 12, ap: 100}).mc, 'start-orbit').status, 'warning');
  assert.equal(get(check({origin: 'earth', wet: 60000}).mc, 'earth-leg').status, 'warning');
  assert.equal(get(check({ap: 200, pe: 100, radius: 300}).mc, 'eccentric-departure').status, 'warning');
});

test('no arrival in the interval: the budget is reported as not checked, never as passed', () => {
  const p = {...base, from: epoch, to: epoch + 10}, r = search(p);
  const mc = missionCheck(p, r, null, null);
  assert.equal(get(mc, 'opportunity').status, 'fail');
  assert.equal(get(mc, 'delta-v').status, 'unavailable');
});

test('long burns weaken the impulsive model and are flagged', () => {
  assert.equal(get(check({thrust: 6}).mc, 'impulsive').status, 'warning');
});

test('touchdown thrust uses the landing mass, not the lightest allowed mass', () => {
  const p = {...base}, tr = transfer(p), c = candidateAt(epoch + tr.time, p, tr), b = budget(p, c, tr);
  assert.ok(Math.abs(b.touchdownMass - b.burns.at(-1).after) < 1e-9);
  assert.ok(b.twrTouchdown < b.twrMinimumMass);
  // A thrust that holds up the minimum mass but not the actual landing mass now fails.
  const g = 4902.800118 / 1737.4 ** 2 * 1000, thrust = (b.touchdownMass + b.burns.at(-1).after) / 2 * g / 1000;
  const q = {...p, thrust: (b.touchdownMass * 0.98) * g / 1000};
  const bq = budget(q, c, tr);
  assert.ok(bq.twrMinimumMass > 1 && bq.twrTouchdown < 1);
  assert.equal(bq.thrustOK, false);
  assert.ok(thrust > 0);
});

test('page and export text match what the model now checks (no stale claims)', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../mission.html', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../mission.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /acceleration constraints are unassessed/);
  assert.doesNotMatch(html + ui, /Moon-stationary|stationary-orbit-rejected/);
  assert.doesNotMatch(ui, /'Crew safety unassessed'/);
  assert.doesNotMatch(ui + html, /first 14 days only|Long intervals use a moving window/);
});
