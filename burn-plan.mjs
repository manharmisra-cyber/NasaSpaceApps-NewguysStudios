// Burn planning: a timed table of the burns in the mission budget.
//
// Physics comes from mission-core budget() (Tsiolkovsky rocket equation, burn
// by burn, with the mass falling through each burn) and crew-limits.mjs (felt
// acceleration = thrust / mass). Directions come from the maneuver guidance, so
// this table, the guidance and the mission check always agree.
//
// Each burn is an impulsive event in the model. Its duration is the exact
// constant-thrust time to use its propellant (propellant / mass flow, which
// accounts for the changing mass), and the start/end times centre that duration
// on the impulsive event. Gravity and trajectory changes during the burn are
// not propagated, and descent ignition is not solved.
//
// Burn status (from budget()):
//   planned      enough usable propellant (above the locked reserve)
//   infeasible   propellant runs out part-way; achievedDv < dv; shortfallDv > 0
//   not-reached  an earlier burn already used all usable propellant

import {maneuverGuide} from './maneuvers.mjs';
import {burnAccelerations} from './crew-limits.mjs';

/** Physical sanity of the inputs a burn table depends on. */
export function burnInputIssues(p) {
  const issues = [];
  if (!(Number.isFinite(p.thrust) && p.thrust > 0)) issues.push('Thrust must be a positive number');
  if (!(Number.isFinite(p.isp) && p.isp > 0)) issues.push('Specific impulse must be a positive number');
  if (!(Number.isFinite(p.dry) && p.dry > 0)) issues.push('Dry mass must be a positive number');
  if (!(Number.isFinite(p.wet) && p.wet > p.dry)) issues.push('Wet mass must exceed dry mass');
  return issues;
}

export function burnPlan(p, c, b) {
  const inputIssues = burnInputIssues(p);
  const geometry = p.goal === 'orbit' || c.distance <= p.radius;
  let guide = null;
  try { guide = maneuverGuide(p, c, b); } catch { guide = null; }
  const directionOf = i => guide?.maneuvers?.find(m => m.burnIndex === i)?.direction;
  const accel = inputIssues.length ? [] : burnAccelerations(b.burns, p.thrust * 1000);
  const worst = b.crew?.applicable && !b.crewOK ? b.crew.worst : null;
  return b.burns.map((x, i, all) => {
    const status = x.status ?? (x.fuelValid === false ? 'infeasible' : 'planned');
    const achievedDv = x.achievedDv ?? (status === 'planned' ? x.dv : 0), shortfallDv = x.shortfallDv ?? (x.dv - achievedDv);
    const terminal = p.goal === 'land' && i === all.length - 1, noBurn = !(x.dv > 1e-6);
    const issues = [...inputIssues];
    if (!geometry) issues.push('Selected pin is not reached');
    if (status === 'infeasible') issues.push(`Infeasible: propellant reaches the locked reserve after ${achievedDv.toFixed(1)} of ${x.dv.toFixed(1)} m/s (short by ${shortfallDv.toFixed(1)} m/s)`);
    if (status === 'not-reached') issues.push('Not reached: usable propellant is already used up');
    if (status === 'planned' && b.fuelOK === false) issues.push('Mission budget fails once the loss allowance is included');
    if (terminal && b.thrustOK === false) issues.push('Thrust is below lunar weight at touchdown');
    if (worst && accel[i] && x.duration > 0 && accel[i].end >= worst.level) issues.push('Contributes to exceeding the crew acceleration limit');
    if (terminal) issues.push('Powered descent and ignition not solved');
    if (x.kind === 'conditional') issues.push('Earth encounter targeting not solved');
    const period = b.period ?? null;
    if (b.longBurn && (!period || x.duration > 0.05 * period)) issues.push('Long burn: impulse approximation weak');
    // A time-centred allocation is a planning estimate, never a propagated guidance solution.
    const start = noBurn || terminal || !geometry || status !== 'planned' || inputIssues.length ? null : x.time - x.duration / 2, end = start === null ? null : start + x.duration;
    if (start !== null && i > 0 && start < all[i - 1].time + all[i - 1].duration / 2) issues.push('Burn allocations overlap');
    if (start !== null && x.kind !== 'conditional' && start < p.epoch) issues.push('Allocation starts before the lunar orbit epoch');
    const direction = x.dv > 1e-6 ? (directionOf(i) || 'see maneuver guidance') : 'none (no burn needed)';
    return {...x, status, achievedDv, shortfallDv, direction, start, end, terminal, issues,
      remainingPropellant: x.after - p.dry, unreservedPropellant: x.after - p.dry - b.reserved,
      accelerationStart: accel[i]?.start ?? NaN, accelerationEnd: accel[i]?.end ?? NaN,
      approximation: 'Impulsive event; duration is constant-thrust with changing mass',
      statusLabel: noBurn && status === 'planned' ? 'No burn needed' : status === 'planned' ? 'Planning estimate; not flight guidance' : status === 'infeasible' ? 'Infeasible: not enough propellant' : 'Not reached'};
  });
}

export function burnCsv(rows) {
  const utc = x => x === null ? 'UNSOLVED' : new Date(x * 1000).toISOString(), quote = x => '"' + String(x).replaceAll('"', '""') + '"';
  return [['burn', 'status', 'direction', 'ideal_event_utc', 'estimated_start_utc', 'estimated_end_utc', 'duration_s', 'delta_v_m_s', 'achieved_delta_v_m_s', 'shortfall_m_s', 'propellant_kg', 'remaining_propellant_kg', 'unreserved_propellant_kg', 'initial_accel_m_s2', 'final_accel_m_s2', 'note', 'issues'],
    ...rows.map(x => [x.name, x.status, x.direction, utc(x.time), utc(x.start), utc(x.end), x.duration, x.dv, x.achievedDv, x.shortfallDv, x.propellant, x.remainingPropellant, x.unreservedPropellant, x.accelerationStart, x.accelerationEnd, x.statusLabel, x.issues.join('; ')])]
    .map(row => row.map(quote).join(',')).join('\n');
}
