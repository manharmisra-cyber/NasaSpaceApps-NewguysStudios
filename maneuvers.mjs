// Step-by-step maneuver guidance for the mission designer.
//
// Every number shown here comes from the same calculation as the fuel budget
// (mission-core transfer(), earthLeg(), planeChange() and budget()), so the
// guidance cannot disagree with the burn plan. This module only adds the
// orbital description around those numbers: where each burn happens, which
// way to point, what the orbit becomes and what to watch for.
//
// Model limits stated in every plan
//   - Burns are impulses in a two-body Moon model; durations are constant-
//     thrust estimates with changing mass. Long burns (over 5 % of the orbital
//     period) make the impulsive picture inaccurate.
//   - Orbit transfers keep the plane (unless a plane change is asked for) and
//     the apse line (coaxial ellipses). The two-burn transfer is a Hohmann
//     transfer only when both orbits are circular.
//   - Lunar orbit insertion from Earth uses a patched-conic estimate of the
//     arrival speed; the incoming plane and timing are not solved.

import {C, D, TAU, orbitalState, transfer, earthLeg, planeChange} from './mission-core.mjs';

// Highest point on the Moon is about 10.7 km above the 1737.4 km mean radius
// (LOLA; assets/terrain/manifest.json maximumMetres = 10685.5).
export const HIGHEST_TERRAIN_KM = 10.6855;
export const TERRAIN_MARGIN_KM = 5;
const EPS = 1e-6; // m/s; smaller burns are reported as "no burn needed"

export const GLOSSARY = Object.freeze({
  prograde: 'Prograde: along the direction of travel. Adds speed and raises the far side of the orbit.',
  retrograde: 'Retrograde: against the direction of travel. Removes speed and lowers the far side of the orbit.',
  normal: 'Normal / anti-normal: perpendicular to the orbit plane, along or against the orbit’s angular momentum. Tilts the plane.',
  apoapsis: 'Apoapsis: the highest point of the orbit. Burns here change the periapsis on the opposite side most cheaply.',
  periapsis: 'Periapsis: the lowest point of the orbit. Burns here change the apoapsis on the opposite side most cheaply.',
  circularization: 'Circularization: a burn at one apse that brings the opposite apse to the same height, making the orbit circular.',
  node: 'Node: where the orbit crosses the reference (lunar equator) plane. Plane changes are done there.',
});

const km = x => `${x.toFixed(1)} km`;
const ms = x => `${x.toFixed(1)} m/s`;
const orbit = (apAlt, peAlt, inc) => {
  const s = orbitalState({ap: apAlt, pe: peAlt});
  return {apAlt, peAlt, inc, circular: Math.abs(apAlt - peAlt) < 1e-9, periodMin: s.period / 60,
    text: Math.abs(apAlt - peAlt) < 1e-9 ? `circular ${km(apAlt)} orbit, ${inc.toFixed(1)}° inclination` : `${km(peAlt)} × ${km(apAlt)} orbit, ${inc.toFixed(1)}° inclination`};
};

function burnFacts(b, burn, p, period) {
  const facts = {burnIndex: b.burns.indexOf(burn), dv: burn.dv, duration: burn.duration, propellant: burn.propellant, massBefore: burn.before, massAfter: burn.after,
    feltStart: p.thrust * 1000 / burn.before, feltEnd: p.thrust * 1000 / burn.after, fuelValid: burn.fuelValid !== false};
  const warnings = [], checks = [];
  checks.push({label: 'Propellant', status: facts.fuelValid ? 'pass' : 'fail',
    detail: facts.fuelValid ? `Uses ${burn.propellant.toFixed(0)} kg; locked reserve kept.` : 'This burn would dip into the locked reserve or run out of propellant.'});
  if (p.crew === 'crewed') {
    checks.push({label: 'Crew acceleration', status: b.crewOK ? 'pass' : 'fail',
      detail: `Felt ${facts.feltStart.toFixed(2)} to ${facts.feltEnd.toFixed(2)} m/s²; mission-wide limit check ${b.crewOK ? 'passes' : 'fails'}.`});
  }
  if (period && burn.duration > 0.05 * period) {
    warnings.push(`Long burn: ${burn.duration.toFixed(0)} s is ${(100 * burn.duration / period).toFixed(0)} % of the ${(period / 60).toFixed(0)}-minute orbit, so the single-impulse picture is only approximate. Centre the burn on the point given.`);
  }
  return {facts, warnings, checks};
}

function terrainCheck(peAlt, label) {
  if (peAlt <= HIGHEST_TERRAIN_KM) return {label, status: 'fail', detail: `Periapsis ${km(peAlt)} is at or below the highest lunar terrain (${km(HIGHEST_TERRAIN_KM)} above the mean radius).`};
  if (peAlt < HIGHEST_TERRAIN_KM + TERRAIN_MARGIN_KM) return {label, status: 'warning', detail: `Periapsis ${km(peAlt)} clears the highest terrain by less than ${km(TERRAIN_MARGIN_KM)}; check the ground track.`};
  return {label, status: 'pass', detail: `Periapsis ${km(peAlt)} clears the highest lunar terrain (${km(HIGHEST_TERRAIN_KM)}).`};
}

function classifyTransfer(p, first, second) {
  const sc = p.ap === p.pe, tc = p.targetAp === p.targetPe, b1 = first > EPS, b2 = second > EPS;
  if (!b1 && !b2) return {type: 'none', title: 'No in-plane change needed'};
  if (sc && tc) return {type: 'hohmann', title: p.targetPe > p.pe ? 'Hohmann transfer: raise circular altitude' : 'Hohmann transfer: lower circular altitude', hohmann: true};
  if (b1 && !b2) {
    if (tc) return {type: 'circularize-apoapsis', title: 'Circularize at apoapsis'};
    if (sc) return {type: 'lower-periapsis', title: 'Circular to elliptical: lower periapsis'};
    return {type: p.targetPe > p.pe ? 'raise-periapsis' : 'lower-periapsis', title: p.targetPe > p.pe ? 'Raise periapsis' : 'Lower periapsis'};
  }
  if (!b1 && b2) {
    if (tc) return {type: 'circularize-periapsis', title: 'Circularize at periapsis'};
    if (sc) return {type: 'raise-apoapsis', title: 'Circular to elliptical: raise apoapsis'};
    return {type: p.targetAp > p.ap ? 'raise-apoapsis' : 'lower-apoapsis', title: p.targetAp > p.ap ? 'Raise apoapsis' : 'Lower apoapsis'};
  }
  if (!sc && tc) return {type: 'elliptical-to-circular', title: 'Elliptical to circular: two-burn transfer'};
  if (sc && !tc) return {type: 'circular-to-elliptical', title: 'Circular to elliptical: two-burn transfer'};
  return {type: 'two-burn', title: 'Two-burn transfer between coaxial elliptical orbits'};
}

/**
 * Build guidance for the selected opportunity.
 * p: mission inputs; c: chosen candidate from search(); b: budget(p, c, tr).
 * Returns {available, reason?, title, maneuvers: [...], assumptions, glossary}.
 */
export function maneuverGuide(p, c, b, tr = null) {
  if (!p || !c || !b || !b.burns?.length) return {available: false, reason: 'No valid mission and selected opportunity yet: guidance needs a computed burn budget.', maneuvers: []};
  if (p.goal !== 'land' && p.goal !== 'orbit') return {available: false, reason: 'Guidance is available for landing and lunar orbit transfers.', maneuvers: []};
  tr = tr || transfer(p);
  const lunar = orbit(p.ap, p.pe, p.inc), period = tr.o.period;
  const assumptions = ['Two-body Moon (mu = 4902.8 km³/s², mean radius 1737.4 km); no mascons or Earth/Sun perturbations.',
    'Burns are modelled as impulses; durations are constant-thrust estimates that include the falling mass.'];
  const out = [];
  let idx = 0;
  const next = () => b.burns[idx++];

  if (p.origin === 'earth') {
    const leg = earthLeg(p), tli = next(), loi = next();
    const ft = burnFacts(b, tli, p, null), fl = burnFacts(b, loi, p, period);
    out.push({id: 'tli', name: 'Trans-lunar injection', type: 'tli', estimate: true,
      objective: 'Leave the Earth parking orbit on a transfer ellipse that reaches the Moon’s distance.',
      initial: `Earth parking orbit, ${km(p.earthPe)} × ${km(p.earthAp)} above Earth`,
      target: `Earth-centred transfer ellipse, perigee ${km(p.earthPe)}, apogee at the Moon’s mean distance (384,400 km); about ${(leg.time / 86400).toFixed(1)} days to arrive`,
      location: 'Perigee of the parking orbit, timed so the Moon is near apogee on arrival', direction: 'prograde', ...ft.facts,
      expected: 'Apogee rises from the parking orbit to the Moon’s distance.',
      steps: ['Hold the parking orbit and wait for the departure opportunity that puts the Moon at apogee on arrival (phasing is not solved by this model).',
        'Orient prograde.', `Burn ${ms(tli.dv)} centred on perigee.`, 'Coast; plan small correction burns from your allowance.'],
      warnings: ['Earth–Moon phasing, departure date and the arrival plane are not solved here; this is a delta-v estimate.', ...ft.warnings],
      checks: ft.checks});
    const capOrbit = orbit(p.ap, p.pe, p.inc);
    out.push({id: 'loi', name: 'Lunar orbit insertion', type: 'loi', estimate: true,
      objective: 'Brake on the incoming hyperbola so the Moon captures the spacecraft into the assumed lunar orbit.',
      initial: `Hyperbolic approach, arrival speed far from the Moon about ${leg.vInf.toFixed(3)} km/s (patched-conic estimate)`,
      target: capOrbit.text, location: `Periapsis of the approach, ${km(p.pe)} above the mean surface`, direction: 'retrograde', ...fl.facts,
      expected: `Energy drops from hyperbolic (escape) to a closed ${capOrbit.text}; apoapsis forms at ${km(p.ap)}.`,
      steps: ['Before arrival, trim the approach so its periapsis is at the planned altitude and in the planned plane.',
        'Orient retrograde (against the direction of travel) a few minutes before periapsis.',
        `Burn ${ms(loi.dv)} centred on periapsis.`, 'Confirm the resulting apoapsis and periapsis before any further burn.'],
      warnings: ['The incoming trajectory’s plane, timing and periapsis are assumed, not solved; a real approach may need more delta-v, especially for a polar orbit.', ...fl.warnings],
      checks: [terrainCheck(p.pe, 'Capture periapsis clearance'), ...fl.checks]});
  }

  if (p.goal === 'land') {
    const deorbit = next(), stop = next(), fd = burnFacts(b, deorbit, p, period), fs = burnFacts(b, stop, p, period);
    const descent = orbit(Math.max(p.ap, 0), 0, p.inc);
    out.push({id: 'deorbit', name: 'Descent preparation: deorbit burn', type: 'deorbit',
      objective: 'Lower the far side of the orbit to the surface so the spacecraft arrives at the landing area half an orbit later.',
      initial: lunar.text, target: `Descent ellipse from ${km(p.ap)} down to the mean surface (0 km), ${(tr.time / 60).toFixed(1)} minutes to arrival`,
      location: lunar.circular ? `Half an orbit before the landing point (ideal event ${new Date(deorbit.time * 1000).toISOString().slice(0, 19)} UTC)` : 'Apoapsis of the lunar orbit (the model departs only from apoapsis)',
      direction: 'retrograde', ...fd.facts,
      expected: `Periapsis drops from ${km(p.pe)} to 0 km (the mean surface); the apoapsis stays at ${km(p.ap)}.`,
      steps: ['Confirm the current orbit and that the landing area lies under the far side of the coming half orbit.',
        'Orient retrograde.', `Burn ${ms(deorbit.dv)} centred on the planned point.`,
        `Coast ${(tr.time / 60).toFixed(1)} minutes toward the landing area; do not let the trajectory reach terrain before braking.`],
      warnings: ['The modelled periapsis is the mean surface; real missions keep periapsis above terrain (Apollo used about 15 km) and start powered descent there.', ...fd.warnings],
      checks: fd.checks});
    out.push({id: 'braking', name: 'Terminal braking to touchdown', type: 'braking',
      objective: 'Cancel the velocity relative to the rotating surface so the spacecraft can touch down.',
      initial: `Descent ellipse near periapsis, about ${(tr.arrivalSpeed * 1000).toFixed(0)} m/s inertial`, target: 'At rest on the surface at the selected arrival point',
      location: 'Near periapsis, over the landing area', direction: 'against the surface-relative velocity (retrograde), turning toward vertical as speed falls', ...fs.facts,
      expected: 'Horizontal speed relative to the ground falls to zero; the vehicle hovers and descends.',
      steps: ['Start braking before periapsis, while still above terrain; this model does not solve the ignition point.',
        'Point the thrust against the velocity relative to the surface.', `Remove about ${ms(stop.dv)} (impulsive lower bound).`,
        'Pitch toward vertical as horizontal speed falls; hover, choose a site, and descend.'],
      warnings: ['Impulsive lower bound: a real powered descent also fights gravity for several minutes (gravity losses). Cover them with the loss allowance.',
        'Powered descent ignition and the descent profile are not solved.', ...fs.warnings],
      checks: [...fs.checks, {label: 'Touchdown thrust', status: b.thrustOK ? 'pass' : 'fail',
        detail: b.thrustOK ? 'Thrust exceeds lunar weight at the minimum allowed mass, so the vehicle can hover.' : 'Thrust cannot hold the vehicle up against lunar gravity at landing mass.'}]});
  }

  if (p.goal === 'orbit') {
    const first = next(), second = next(), f1 = burnFacts(b, first, p, period);
    const target = orbit(p.targetAp, p.targetPe, p.inc), kind = classifyTransfer(p, first.dv, second.dv);
    const r2Alt = p.targetPe, raAlt = p.ap, peOpp = p.pe;
    const transferOrbit = orbit(Math.max(raAlt, r2Alt), Math.min(raAlt, r2Alt), p.inc);
    const f2 = burnFacts(b, second, p, orbitalState({ap: p.targetAp, pe: p.targetPe}).period);
    const dir1 = r2Alt > (lunar.circular ? raAlt : peOpp) ? 'prograde' : 'retrograde';
    const dir2 = tr.targetSpeed > tr.arrivalSpeed ? 'prograde' : 'retrograde';
    if (first.dv > EPS) out.push({id: 'transfer-1', name: kind.hohmann ? 'Hohmann transfer: first burn' : 'Transfer burn', type: kind.type,
      objective: `Move the opposite side of the orbit to ${km(r2Alt)}, where the target orbit’s periapsis will be.`,
      initial: lunar.text, target: `Transfer orbit ${transferOrbit.text}`,
      location: lunar.circular ? 'Anywhere on the circular orbit (timed to the selected departure)' : 'Apoapsis of the current orbit', direction: dir1, ...f1.facts,
      expected: `The point half an orbit ahead moves from ${km(lunar.circular ? raAlt : peOpp)} to ${km(r2Alt)}.`,
      steps: [`Orient ${dir1}.`, `Burn ${ms(first.dv)} centred on the burn point.`, `Coast half the transfer orbit (${(tr.time / 60).toFixed(1)} minutes) to the opposite apse.`],
      warnings: [...(kind.hohmann ? [] : ['Assumes the target orbit shares the current apse line; if it does not, the real transfer costs more.']), ...f1.warnings],
      checks: [terrainCheck(transferOrbit.peAlt, 'Transfer periapsis clearance'), ...f1.checks]});
    if (second.dv > EPS) out.push({id: 'transfer-2', name: kind.hohmann ? 'Hohmann transfer: second burn (circularize)' : (kind.type.startsWith('circularize') ? kind.title : 'Target-orbit insertion'), type: kind.type,
      objective: `Set the far side of the orbit so it becomes the ${target.text}.`,
      initial: first.dv > EPS ? `Transfer orbit ${transferOrbit.text}` : lunar.text, target: target.text,
      location: `The apse at ${km(r2Alt)}${first.dv > EPS ? ', half a transfer orbit after the first burn' : ''}`, direction: dir2, ...f2.facts,
      expected: `The opposite apse moves to ${km(p.targetAp === r2Alt ? p.targetPe : p.targetAp)}; the orbit becomes ${target.text}.`,
      steps: [`Arrive at the ${km(r2Alt)} apse.`, `Orient ${dir2}.`, `Burn ${ms(second.dv)} centred on that apse.`, 'Confirm the new apoapsis and periapsis.'],
      warnings: f2.warnings, checks: [terrainCheck(target.peAlt, 'Target periapsis clearance'), ...f2.checks]});
    const pc = planeChange(p);
    if (pc) {
      const burn = next(), fp = burnFacts(b, burn, p, pc.period);
      out.push({id: 'plane', name: `Inclination change: ${p.inc.toFixed(1)}° to ${p.targetInc.toFixed(1)}°`, type: 'plane-change',
        objective: `Tilt the orbit plane by ${Math.abs(pc.di).toFixed(2)}° about its line of nodes.`,
        initial: target.text, target: orbit(p.targetAp, p.targetPe, p.targetInc).text,
        location: `The ${pc.node} node of the target orbit, ${km(pc.altitude)} up (the slower node is cheaper)`, direction: pc.direction, ...fp.facts,
        expected: 'Inclination changes; size, shape and node longitude stay the same.',
        steps: [`Coast to the ${pc.node} node (about ${(pc.afterInsertion / 60).toFixed(1)} minutes after insertion).`, `Orient ${pc.direction} (perpendicular to the orbit plane).`,
          `Burn ${ms(burn.dv)} centred on the node.`, 'Confirm the new inclination.'],
        warnings: ['Plane changes are expensive at orbital speed: 1° costs about 2 % of the orbital speed. Doing it at a higher apoapsis, or combining it with another burn, can be cheaper; this plan keeps it separate.', ...fp.warnings],
        checks: fp.checks});
    }
    if (!out.length) return {available: true, title: 'No maneuver needed', maneuvers: [], assumptions, glossary: GLOSSARY,
      note: 'The target orbit is the same as the starting orbit.'};
    assumptions.push(kind.hohmann ? 'Hohmann transfer: both orbits circular and in the same plane, two tangential impulses.' :
      'Two tangential impulses between coaxial orbits in the same plane; a Hohmann transfer only when both orbits are circular.');
    return {available: true, title: kind.title + (pc ? ' with inclination change' : ''), maneuvers: out, assumptions, glossary: GLOSSARY};
  }
  return {available: true, title: p.origin === 'earth' ? 'Earth to lunar surface' : 'Lunar orbit to surface', maneuvers: out, assumptions, glossary: GLOSSARY};
}
