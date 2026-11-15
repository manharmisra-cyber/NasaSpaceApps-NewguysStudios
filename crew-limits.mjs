// Crew acceleration limits for crewed lunar missions.
//
// Which acceleration the crew feels
//   In free fall (coasting, or any burn in space) gravity accelerates the crew
//   and the vehicle equally, so it is not felt. What the crew feels is the
//   proper acceleration produced by non-gravitational forces, here the engine:
//       felt = thrust / mass                          (engine-generated, proper)
//   This holds during powered descent too. Lunar gravity (1.62 m/s^2 at the
//   mean radius) is felt only while the vehicle is supported on the surface or
//   hovering, where thrust balances it. The acceleration of the vehicle in an
//   inertial frame, thrust/mass plus the gravity vector, is the resultant
//   (coordinate) acceleration; it changes the trajectory, not what the crew
//   feels. Limits below apply to the felt acceleration only.
//
// Limit source
//   NASA/TM-20205008196, Pattarini, Somers and Charvat, "Artemis Sustained
//   Translational Acceleration Limits: Human Tolerance Evidence from Apollo to
//   International Space Station", Table 1 and Figure 4: sustained +Gz limits
//   (m/s^2) against exposure duration for five posture and garment cases.
//   The memo assumes a standing crew unless a curve says otherwise.
//   https://www.nasa.gov/wp-content/uploads/2023/03/tm-20205008196.pdf
//
// Modelling assumptions (documented, not hidden)
//   - Thrust acts along the crew's head-to-foot axis (+Gz), as for a lander
//     with an upright crew. The memo gives no +Gx/-Gz/Gy limits; for crew
//     seated facing the thrust (+Gx), NASA-STD-3001 limits are higher, so
//     applying the +Gz curves is conservative.
//   - Durations: the memo says exposure is "accumulated across the specific
//     phase of flight" but its example is ambiguous. This model uses the
//     conservative reading: for each acceleration level, the total time spent
//     at or above that level, summed over every burn in the mission.
//   - Between tabulated durations the limit is interpolated linearly; beyond
//     900 s the 900 s value applies. Exposures shorter than 0.5 s are
//     transient loads, which this model does not assess; the 0.5 s value is
//     used for them.
//   - The memo's "short duration" and "long duration" curves are offered as
//     named there; the memo does not define the terms.

export const CREW_LIMIT_SOURCE = 'NASA/TM-20205008196, Table 1 (sustained +Gz limits)';
export const G0 = 9.80665;

const DURATIONS = [0.5, 10, 15, 30, 50, 80, 90, 100, 120, 150, 540, 900];
// Table 1 values in m/s^2 at the durations above. The memo lists 540 < t < 900
// with the 540 s value and >= 900 s separately; both are represented here.
export const CREW_LIMIT_CURVES = Object.freeze({
  A: Object.freeze({label: 'Seated, or standing with a compression garment (short-duration curve)',
    limits: [9.81, 9.81, 9.81, 9.81, 9.81, 9.81, 9.81, 9.81, 9.81, 9.81, 9.81, 4.91]}),
  B: Object.freeze({label: 'Standing, no compression garment (short-duration curve)',
    limits: [9.81, 9.81, 9.81, 9.81, 7.10, 5.27, 4.89, 4.57, 4.07, 3.54, 1.57, 1.57]}),
  C: Object.freeze({label: 'Seated with a compression garment (short-duration curve)',
    limits: [19.6, 13.0, 12.7, 9.81, 9.81, 9.81, 9.81, 9.81, 9.81, 9.81, 9.81, 4.91]}),
  D: Object.freeze({label: 'Seated, or standing with a compression garment (long-duration curve)',
    limits: [9.81, 9.81, 9.81, 9.81, 7.85, 6.67, 6.24, 5.89, 4.91, 4.91, 4.91, 4.91]}),
  E: Object.freeze({label: 'Seated with a compression garment (long-duration curve)',
    limits: [19.6, 13.0, 12.3, 9.81, 7.85, 6.67, 6.24, 5.89, 4.91, 4.91, 4.91, 4.91]}),
});
// The memo's baseline is a standing crew; curve B is also the most restrictive.
export const DEFAULT_CREW_LIMIT = 'B';

/** Allowed sustained acceleration (m/s^2) for an exposure of `duration` seconds. */
export function limitAt(curve, duration) {
  const c = CREW_LIMIT_CURVES[curve];
  if (!c) return NaN;
  const L = c.limits;
  if (!(duration > DURATIONS[0])) return L[0];
  if (duration >= DURATIONS.at(-1)) return L.at(-1);
  // The memo gives 540 < t < 900 the 540 s value and a step at 900 s.
  if (duration >= 540) return L[DURATIONS.indexOf(540)];
  for (let i = 1; i < DURATIONS.length; i++) {
    if (duration <= DURATIONS[i]) {
      const f = (duration - DURATIONS[i - 1]) / (DURATIONS[i] - DURATIONS[i - 1]);
      return L[i - 1] + f * (L[i] - L[i - 1]);
    }
  }
  return L.at(-1);
}

/**
 * Felt (engine) acceleration during each burn, for constant thrust:
 * a(t) = F / (m0 - mdot t), rising from F/m_before to F/m_after.
 * burns: [{name, before, after, duration}] (kg, s); thrustN in newtons.
 */
export function burnAccelerations(burns, thrustN) {
  return burns.map(b => ({name: b.name, start: thrustN / b.before, end: thrustN / b.after,
    duration: b.duration, before: b.before, after: b.after}));
}

/** Total time (s) at or above acceleration `level` (m/s^2), summed over burns. */
export function timeAtOrAbove(profile, level) {
  let total = 0;
  for (const b of profile) {
    if (!(b.duration > 0) || level > b.end) continue;
    if (level <= b.start) { total += b.duration; continue; }
    // a(t) = level when m(t) = F/level; mass falls linearly in time.
    const massAtLevel = b.start * b.before / level;          // F / level
    const fraction = (b.before - massAtLevel) / (b.before - b.after);
    total += b.duration * (1 - fraction);
  }
  return total;
}

/**
 * Check felt acceleration against a limit curve.
 * Returns {applicable, curve, label, source, peak, peakG, peakBurn, ok,
 *   worst: {level, duration, limit, ratio}, gravity, note}.
 * applicable is false for robotic missions (no crew limit applies).
 */
export function crewAccelerationCheck(p, burns, options = {}) {
  const gravity = {lunarSurface: options.lunarSurfaceGravity ?? 1.62, felt: 'only while supported on the surface or hovering'};
  // The engine acceleration is physics and is reported for every vehicle;
  // only the comparison with a crew limit depends on the crew setting.
  const thrustN = p.thrust * 1000;
  const profile = burnAccelerations(burns.filter(b => b.duration > 0), thrustN);
  let peak = 0, peakBurn = null;
  for (const b of profile) if (b.end > peak) { peak = b.end; peakBurn = b.name; }
  const felt = {peak, peakG: peak / G0, peakBurn, profile, gravity};
  if (p.crew !== 'crewed') return {applicable: false, ok: true, ...felt, note: 'Robotic mission: crew acceleration limits do not apply.'};
  const curve = p.crewLimit || DEFAULT_CREW_LIMIT;
  if (!CREW_LIMIT_CURVES[curve]) return {applicable: true, ok: false, curve, error: 'Unknown crew limit curve.', ...felt};
  if (!profile.length) return {applicable: true, ok: true, curve, label: CREW_LIMIT_CURVES[curve].label, source: CREW_LIMIT_SOURCE, ...felt, worst: null};
  // Scan levels from just above zero to the peak, plus every burn's start and
  // end level and every tabulated limit, which are where the margin can turn.
  // 160 evenly spaced levels resolve the margin to 0.6 % of the peak; the
  // listed extra levels make the check exact at the curve's own values.
  const levels = [];
  const STEPS = 160;
  for (let i = 1; i <= STEPS; i++) levels.push(peak * i / STEPS);
  for (const b of profile) levels.push(b.start, b.end);
  for (const v of CREW_LIMIT_CURVES[curve].limits) if (v <= peak) levels.push(v, v * (1 + 1e-9));
  let worst = null;
  for (const level of levels) {
    if (!(level > 0)) continue;
    const duration = timeAtOrAbove(profile, level);
    if (!(duration > 0)) continue;
    const limit = limitAt(curve, duration), ratio = level / limit;
    if (!worst || ratio > worst.ratio) worst = {level, duration, limit, ratio};
  }
  return {applicable: true, curve, label: CREW_LIMIT_CURVES[curve].label, source: CREW_LIMIT_SOURCE,
    ...felt, worst, ok: !worst || worst.ratio <= 1};
}
