import test from 'node:test';
import assert from 'node:assert/strict';
import {search, budget, transfer, candidateAt} from '../mission-core.mjs';
import {burnPlan, burnCsv, burnInputIssues} from '../burn-plan.mjs';
import {maneuverGuide} from '../maneuvers.mjs';
import {missionCheck} from '../mission-check.mjs';

const epoch = Date.UTC(2026, 10, 14) / 1000;
const base = {origin: 'moon', goal: 'land', crew: 'robotic', wet: 15000, dry: 6500, thrust: 45, isp: 320, reserve: 10, allowance: 300,
  ap: 100, pe: 100, inc: 90, node: 0, arg: 0, phase: 0, earthAp: 200, earthPe: 200, targetAp: 200, targetPe: 200,
  lat: -89, lon: 0, radius: 50, epoch, from: epoch + 3600, to: epoch + 90000};
const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} != ${b}`);
function all(change) {
  const p = {...base, ...change}, r = search(p), c = r.windows[0] || r.best, b = budget(p, c, r.tr);
  return {p, r, c, b, plan: burnPlan(p, c, b), guide: maneuverGuide(p, c, b, r.tr), check: missionCheck(p, r, c, b)};
}

test('Tsiolkovsky per burn with changing mass; duration is the exact constant-thrust time', () => {
  const {p, plan} = all({});
  const ve = p.isp * 9.80665, mdot = p.thrust * 1000 / ve;
  let m = p.wet;
  for (const x of plan) {
    near(x.before, m, 1e-9); near(x.after, m * Math.exp(-x.dv / ve), 1e-9);
    near(x.duration, (x.before - x.after) / mdot, 1e-9);
    // Same duration from integrating a = F/m(t): dv = ve ln(m0/(m0 - mdot t)).
    near(ve * Math.log(x.before / (x.before - mdot * x.duration)), x.dv, 1e-6);
    near(x.accelerationStart, p.thrust * 1000 / x.before, 1e-12); near(x.accelerationEnd, p.thrust * 1000 / x.after, 1e-12);
    m = x.after;
  }
});

test('burn plan, guidance, budget and mission check agree', () => {
  for (const change of [{}, {goal: 'orbit', targetAp: 500, targetPe: 500, targetInc: 80}, {origin: 'earth', wet: 60000}, {crew: 'crewed'}]) {
    const {plan, guide, b, check} = all(change);
    near(plan.reduce((s, x) => s + x.dv, 0), b.needed, 1e-9, 'plan dv');
    near(guide.maneuvers.reduce((s, m) => s + m.dv, 0), b.needed, 1e-9, 'guide dv');
    for (const m of guide.maneuvers) { assert.equal(plan[m.burnIndex].direction, m.direction); near(plan[m.burnIndex].duration, m.duration, 1e-12); }
    const propItem = check.items.find(x => x.id === 'propellant');
    assert.equal(propItem.status === 'pass', plan.every(x => x.status === 'planned'), JSON.stringify(change));
  }
});

test('insufficient fuel: the burn stops at the reserve, is marked infeasible, and later burns are not reached', () => {
  const {plan, b, p} = all({dry: 12000});
  const floor = p.dry + (p.wet - p.dry) * p.reserve / 100;
  const bad = plan.findIndex(x => x.status === 'infeasible');
  assert.ok(bad >= 0);
  assert.ok(plan[bad].achievedDv < plan[bad].dv && plan[bad].shortfallDv > 0);
  near(plan[bad].after, floor, 1e-9);
  assert.ok(plan[bad].issues.some(s => /Infeasible/.test(s)));
  assert.equal(plan[bad].start, null, 'no timing for a burn that cannot happen');
  for (const x of plan.slice(bad + 1)) { assert.equal(x.status, 'not-reached'); assert.equal(x.propellant, 0); assert.equal(x.duration, 0); }
  assert.ok(plan.every(x => x.after >= floor - 1e-9), 'no mass below the reserve');
  assert.equal(b.fuelOK, false);
  assert.match(burnCsv(plan), /infeasible/);
});

test('crew limit violations are marked on the burns that cause them', () => {
  const {plan} = all({crew: 'crewed'});
  assert.ok(plan.some(x => x.issues.includes('Contributes to exceeding the crew acceleration limit')));
  const ok = all({crew: 'crewed', crewLimit: 'C'}).plan;
  assert.ok(!ok.some(x => x.issues.includes('Contributes to exceeding the crew acceleration limit')));
});

test('invalid thrust, Isp or masses are reported and suppress timing', () => {
  assert.deepEqual(burnInputIssues(base), []);
  for (const bad of [{thrust: 0}, {thrust: -1}, {isp: 0}, {isp: NaN}, {dry: 0}, {wet: 6000}]) assert.ok(burnInputIssues({...base, ...bad}).length, JSON.stringify(bad));
  const p = {...base}, tr = transfer(p), c = candidateAt(epoch + tr.time, p, tr), b = budget(p, c, tr);
  const plan = burnPlan({...p, thrust: 0}, c, b);
  assert.ok(plan.every(x => x.start === null && x.issues.includes('Thrust must be a positive number')));
});

test('orbit-transfer burns are timed; zero-delta-v burns say no burn is needed', () => {
  const {plan} = all({goal: 'orbit', targetAp: 300, targetPe: 100});
  assert.equal(plan[0].direction, 'none (no burn needed)');
  assert.equal(plan[0].statusLabel, 'No burn needed');
  assert.equal(plan[0].start, null);
  assert.equal(plan[1].direction, 'prograde');
  assert.ok(plan[1].start !== null);
});
