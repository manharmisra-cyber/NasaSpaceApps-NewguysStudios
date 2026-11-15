// Mission check: every validation the mission designer reports, in one place.
//
// Each item has a status:
//   pass            the calculation was done and the constraint is met
//   warning         done and met, but a stated assumption is weak or a margin is thin
//   fail            done and not met
//   unavailable     not calculated by this model; never counted as a pass
//   not-applicable  does not apply to this mission (for example crew limits on a robot)
// and, where meaningful: explanation, value (computed), constraint (what it is
// compared with) and suggestion (how to fix it).
//
// The overall result is fail if any item fails, otherwise warning if any item
// warns, otherwise pass. The number of unavailable items is always reported
// with it, so "pass" never hides an unchecked item.

import {C} from './mission-core.mjs';
import {HIGHEST_TERRAIN_KM, TERRAIN_MARGIN_KM} from './maneuvers.mjs';

const f = (x, d = 0) => Number.isFinite(x) ? x.toLocaleString('en-US', {minimumFractionDigits: d, maximumFractionDigits: d}) : '—';
const item = (id, label, status, explanation, extra = {}) => ({id, label, status, explanation, ...extra});

function periapsisItem(id, label, peAlt) {
  if (peAlt <= HIGHEST_TERRAIN_KM) return item(id, label, 'fail', `Periapsis ${f(peAlt, 1)} km is at or below the highest lunar terrain.`,
    {value: `${f(peAlt, 1)} km`, constraint: `> ${f(HIGHEST_TERRAIN_KM, 1)} km (highest point on the Moon)`, suggestion: `Raise the periapsis above about ${f(HIGHEST_TERRAIN_KM + TERRAIN_MARGIN_KM)} km.`});
  if (peAlt < HIGHEST_TERRAIN_KM + TERRAIN_MARGIN_KM) return item(id, label, 'warning', `Periapsis ${f(peAlt, 1)} km clears the highest terrain by less than ${f(TERRAIN_MARGIN_KM)} km; check the ground track.`,
    {value: `${f(peAlt, 1)} km`, constraint: `≥ ${f(HIGHEST_TERRAIN_KM + TERRAIN_MARGIN_KM, 1)} km recommended`, suggestion: 'Raise the periapsis, or confirm the ground track avoids high terrain.'});
  return item(id, label, 'pass', `Periapsis ${f(peAlt, 1)} km clears the highest lunar terrain.`, {value: `${f(peAlt, 1)} km`, constraint: `> ${f(HIGHEST_TERRAIN_KM, 1)} km`});
}

/**
 * p: inputs; result: search(p) output; chosen: selected window or best candidate
 * (may be null); b: budget(p, chosen, result.tr) (may be null).
 * Returns {overall, title, counts, items}.
 */
export function missionCheck(p, result, chosen, b) {
  const items = [];
  if (!result || result.errors?.length) {
    items.push(item('inputs', 'Inputs', 'fail', (result?.errors || ['No result.']).join(' '), {suggestion: 'Correct the highlighted inputs.'}));
    return summarize(items);
  }
  items.push(item('inputs', 'Inputs', 'pass', 'All inputs used by this route are present and within range.'));

  // Orbit validity
  items.push(periapsisItem('start-orbit', p.origin === 'earth' ? 'Assumed lunar orbit after capture' : 'Starting lunar orbit', p.pe));
  if (p.goal === 'orbit') {
    items.push(periapsisItem('target-orbit', 'Target lunar orbit', p.targetPe));
    const same = p.targetAp === p.ap && p.targetPe === p.pe && (!Number.isFinite(p.targetInc) || p.targetInc === p.inc);
    if (same) items.push(item('conflict-same-orbit', 'Mission settings', 'warning', 'The target orbit is the same as the starting orbit, so there is nothing to do.',
      {suggestion: 'Change the target apoapsis, periapsis or inclination.'}));
  }

  if (!chosen || !b) {
    items.push(item('opportunity', 'Arrival opportunity', 'fail', result.empty || 'No arrival in the interval, so nothing could be budgeted.',
      {suggestion: 'Lengthen or move the arrival interval.'}));
    items.push(item('delta-v', 'Delta-v budget', 'unavailable', 'Not calculated without an arrival opportunity.'));
    return summarize(items);
  }

  // Delta-v and propellant
  items.push(item('delta-v', 'Delta-v budget', b.fuelOK ? 'pass' : 'fail',
    b.fuelOK ? 'Available delta-v covers the ideal burns plus your loss allowance, with the reserve locked.' : `Short by ${f(-b.margin)} m/s.`,
    {value: `${f(b.available)} m/s available`, constraint: `≥ ${f(b.required)} m/s required (${f(b.needed)} ideal + ${f(p.allowance)} allowance)`,
      suggestion: b.fuelOK ? undefined : 'Add propellant (raise wet mass), lower dry mass, use a higher specific impulse, or choose a cheaper orbit.'}));
  const firstShort = b.burns.find(x => x.fuelValid === false);
  items.push(item('propellant', 'Propellant for each burn', firstShort ? 'fail' : 'pass',
    firstShort ? `${firstShort.name} would need propellant below the locked reserve.` : 'Every burn finishes above the locked reserve.',
    {value: `${f(b.remaining)} kg left after the last burn`, constraint: `≥ ${f(b.reserved)} kg reserve`,
      suggestion: firstShort ? 'Same as for the delta-v budget, or lower the reserve percentage if your mission rules allow it.' : undefined}));

  // Propulsion
  if (p.goal === 'land') {
    items.push(item('thrust', 'Thrust at touchdown', b.thrustOK ? 'pass' : 'fail',
      b.thrustOK ? 'Thrust exceeds lunar weight at the landing mass, so the vehicle can hover and set down.' : 'Thrust is below lunar weight at the landing mass; the vehicle cannot hover.',
      {value: `T/W ${f(b.twrTouchdown, 2)} at ${f(b.touchdownMass)} kg`, constraint: 'T/W > 1 in lunar gravity (1.62 m/s²)',
        suggestion: b.thrustOK ? undefined : 'Raise thrust or lower the landing mass.'}));
    if (b.twr < 1) items.push(item('thrust-braking', 'Thrust at start of braking', 'warning',
      'At the start of braking thrust is below lunar weight; braking will take longer and gravity losses will exceed the impulsive estimate.',
      {value: `T/W ${f(b.twr, 2)}`, constraint: 'T/W ≥ 1 preferred', suggestion: 'Raise the loss allowance or the thrust.'}));
  } else items.push(item('thrust', 'Thrust at touchdown', 'not-applicable', 'No landing in this mission.'));

  // Crew
  const cr = b.crew;
  if (!cr || !cr.applicable) items.push(item('crew', 'Crew acceleration', 'not-applicable', 'Robotic mission: no crew limits apply.', {value: cr ? `peak ${f(cr.peak, 2)} m/s²` : undefined}));
  else if (cr.error) items.push(item('crew', 'Crew acceleration', 'unavailable', cr.error, {suggestion: 'Choose a crew acceleration limit.'}));
  else items.push(item('crew', 'Crew acceleration', cr.ok ? 'pass' : 'fail',
    cr.worst ? `Felt engine acceleration (thrust ÷ mass) peaks at ${f(cr.peak, 2)} m/s² (${f(cr.peakG, 2)} g). The tightest point: ${f(cr.worst.duration)} s at or above ${f(cr.worst.level, 2)} m/s².` : 'No powered exposure.',
    {value: cr.worst ? `${f(cr.worst.level, 2)} m/s² for ${f(cr.worst.duration)} s` : '0', constraint: cr.worst ? `≤ ${f(cr.worst.limit, 2)} m/s² for that duration (${cr.label})` : cr.label,
      suggestion: cr.ok ? undefined : 'Lower the thrust, shorten high-acceleration burns, or use a seated or compression-garment limit if the vehicle provides one.'}));

  // Geometry and landing
  if (p.goal === 'land') {
    const inside = chosen.distance <= p.radius;
    items.push(item('geometry', 'Arrival at the pin', inside ? 'pass' : 'fail',
      inside ? 'The modelled arrival falls inside the search radius.' : 'The closest modelled arrival is outside the search radius.',
      {value: `${f(chosen.distance, 1)} km from the pin`, constraint: `≤ ${f(p.radius)} km`,
        suggestion: inside ? undefined : 'Change the orbit inclination or node, widen the radius, or lengthen the interval.'}));
    items.push(item('powered-descent', 'Powered descent profile', 'unavailable',
      'Descent ignition, the braking profile and gravity losses are not simulated; the terminal burn is an impulsive lower bound.',
      {suggestion: 'Keep a loss allowance for powered descent (Apollo-class descents needed several hundred m/s more than the impulsive value).'}));
    items.push(item('landing-site', 'Landing site hazards', 'unavailable', 'Slope, rocks, lighting and communications at touchdown are not part of this check.',
      {suggestion: 'Use the surface explorer to review terrain, sunlight and Earth visibility at the pin.'}));
  } else items.push(item('geometry', 'Arrival at the pin', 'not-applicable', 'The pin does not constrain an orbit transfer.'));

  // Model validity
  items.push(item('impulsive', 'Impulsive-burn approximation', b.longBurn ? 'warning' : 'pass',
    b.longBurn ? 'At least one burn lasts more than 5 % of the orbital period, so treating it as an instant impulse is inaccurate.' : 'All burns are short compared with the orbit, so the impulsive model is reasonable.',
    {value: `longest burn ${f(Math.max(...b.burns.map(x => x.duration)))} s`, constraint: `< ${f(0.05 * result.tr.o.period)} s (5 % of the period)`,
      suggestion: b.longBurn ? 'Raise thrust, or treat the timing and delta-v as rough.' : undefined}));
  if (p.origin === 'earth') items.push(item('earth-leg', 'Earth departure and capture', 'warning',
    'Delta-v is a patched-conic estimate; Earth–Moon phasing, the arrival plane and timing are not solved, so the capture is conditional.',
    {value: `${f(b.burns[0].dv)} + ${f(b.burns[1].dv)} m/s`, suggestion: 'Treat as an estimate; keep extra allowance for plane alignment.'}));
  if (p.goal === 'land' && p.ap !== p.pe) items.push(item('eccentric-departure', 'Deorbit point', 'warning',
    'With an eccentric orbit this model deorbits only from apoapsis, so other departure points (possibly cheaper or better placed) are not considered.'));

  return summarize(items);
}

function summarize(items) {
  const counts = {pass: 0, warning: 0, fail: 0, unavailable: 0, 'not-applicable': 0};
  for (const x of items) counts[x.status]++;
  const overall = counts.fail ? 'fail' : counts.warning ? 'warning' : 'pass';
  const firstFail = items.find(x => x.status === 'fail');
  const title = overall === 'fail' ? firstFail.label + ': fails' : overall === 'warning' ? 'Checks pass with warnings' : 'Checks pass';
  return {overall, title, counts, items, unchecked: counts.unavailable,
    summary: `${counts.pass} passed, ${counts.warning} ${counts.warning === 1 ? 'warning' : 'warnings'}, ${counts.fail} failed, ${counts.unavailable} not checked by this model.`};
}

export const LUNAR_SURFACE_GRAVITY = C.mu / C.R ** 2 * 1000;
