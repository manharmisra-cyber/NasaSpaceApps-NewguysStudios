// Arrival search for the mission designer's pin.
//
// What is searched
//   For every arrival time t in the arrival interval, mission-core's
//   candidateAt() gives the surface point reached by the modelled descent:
//   an impulsive burn half a transfer ellipse earlier, from the assumed lunar
//   orbit, landing on the mean sphere, with the Moon rotating underneath.
//   This module finds every time at which that arrival point lies within the
//   search radius of the pin, measured as a great-circle distance on the lunar
//   mean sphere (lunar-geometry.mjs). Distance to the pin is geometry only:
//   whether a window is affordable is decided separately by budget(), and the
//   result keeps the two apart (window.distance vs. budget fuelOK/thrustOK).
//
// Interval
//   The whole requested interval is searched. The earliest possible arrival is
//   the orbit epoch plus one transfer time, so the searched interval starts at
//   max(from, epoch + transfer time); coverage reports both. Intervals longer
//   than SEARCH.maxDays are rejected with an explicit error instead of being
//   shortened.
//
// Method (circular source orbit, landing)
//   1. Sample the arrival distance every orbital period / samplesPerRevolution.
//      Along one revolution the arrival point follows a nearly great-circle
//      track that drifts slowly as the Moon turns, so the distance to a fixed
//      pin has one minimum and one maximum per revolution. Every true minimum
//      therefore lies within one sample of a sampled local minimum.
//   2. Refine each sampled local minimum by golden-section search on its two
//      neighbouring sample intervals. A minimum is skipped only when a strict
//      lower bound shows it cannot reach the radius: by the triangle inequality,
//      no point between two samples can be closer to the pin than the sampled
//      distance minus the larger neighbouring sample spacing.
//   3. Find each window's entry and exit times by bisection on
//      distance(t) - radius between a sample outside and a time inside.
//   This finds short crossings (a track that grazes the radius between two
//   samples) and tangent passes, which a fixed sample grid alone would miss.
//
// Method (eccentric source orbit, or orbit transfer)
//   The model only departs from apoapsis, so arrivals are discrete: one per
//   revolution. Every one inside the interval is evaluated.
//
// Tolerances
//   Times are refined to SEARCH.timeToleranceS (0.0001 s, under 0.2 m of track
//   at lunar arrival speed of about 1.7 km/s). A point is inside the radius when its distance is at
//   most radius + SEARCH.distanceToleranceKm (1 mm), so a point exactly on the
//   boundary counts as inside.
//
// Display samples
//   samples[] is only for drawing the candidate map. It covers the optional
//   view interval (the playback window) at no more than SEARCH.maxDisplaySamples
//   points and always includes each window's closest approach in view. Windows,
//   best and coverage never depend on the view.

import {mod, validate, transfer, candidateAt, budget} from './mission-core.mjs';
import {MOON_MEAN_RADIUS_KM} from './lunar-geometry.mjs';

export const SEARCH = Object.freeze({
  maxDays: 731,
  samplesPerRevolution: 72,
  timeToleranceS: 1e-4,
  distanceToleranceKm: 1e-6,
  displayStepS: 30,
  maxDisplaySamples: 6000,
});

const DEG = Math.PI / 180;
const GOLDEN = (Math.sqrt(5) - 1) / 2;

function goldenMinimum(fn, a, b, tol) {
  let c = b - GOLDEN * (b - a), d = a + GOLDEN * (b - a), fc = fn(c), fd = fn(d);
  for (let i = 0; i < 200 && b - a > tol; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - GOLDEN * (b - a); fc = fn(c); }
    else { a = c; c = d; fc = fd; d = a + GOLDEN * (b - a); fd = fn(d); }
  }
  return (a + b) / 2;
}

// outside: a time with distance > radius; inside: a time with distance <= radius.
// Returns the crossing time, converged to tol, on the inside side of the boundary.
function crossing(fn, outside, inside, radius, tol) {
  for (let i = 0; i < 200 && Math.abs(inside - outside) > tol; i++) {
    const m = (outside + inside) / 2;
    if (fn(m) <= radius) inside = m; else outside = m;
  }
  return inside;
}

function angleBetween(a, b) {
  const cx = a[1] * b[2] - a[2] * b[1], cy = a[2] * b[0] - a[0] * b[2], cz = a[0] * b[1] - a[1] * b[0];
  return Math.atan2(Math.hypot(cx, cy, cz), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
}

/** Extra checks on top of mission-core validate(); returns a list of messages. */
export function validateArrivalSearch(p) {
  const issues = validate(p);
  if (!issues.length && (p.to - p.from) > SEARCH.maxDays * 86400) {
    issues.push(`Arrival interval: the search covers at most ${SEARCH.maxDays} days. Shorten the interval; it is not shortened automatically.`);
  }
  return issues;
}

function discreteSearch(p, tr, lo, hi, at) {
  const firstBurn = p.epoch + mod(Math.PI - p.phase * DEG, 2 * Math.PI) / tr.o.n;
  const k0 = Math.max(0, Math.ceil((lo - tr.time - firstBurn) / tr.o.period));
  const all = [], windows = [];
  for (let k = k0; ; k++) {
    const burn = firstBurn + k * tr.o.period, arrival = burn + tr.time;
    if (arrival > hi) break;
    if (arrival < lo) continue;
    const c = at(arrival);
    all.push(c);
    if (p.goal === 'orbit' || c.distance <= p.radius + SEARCH.distanceToleranceKm) {
      windows.push({...c, open: c.arrival, close: c.arrival, duration: 0, discrete: true});
    }
  }
  return {all, windows, evaluations: all.length, step: tr.o.period};
}

function continuousSearch(p, tr, lo, hi, at) {
  const R = p.radius + SEARCH.distanceToleranceKm, tol = SEARCH.timeToleranceS;
  const step = tr.o.period / SEARCH.samplesPerRevolution;
  const count = Math.max(1, Math.ceil((hi - lo) / step));
  const times = new Float64Array(count + 1), dist = new Float64Array(count + 1), bodies = new Array(count + 1);
  for (let k = 0; k <= count; k++) {
    const t = k === count ? hi : lo + k * step, c = at(t);
    times[k] = t; dist[k] = c.distance; bodies[k] = c.body;
  }
  let evaluations = count + 1;
  const fn = t => { evaluations++; return at(t).distance; };
  let sampledMin = Infinity;
  for (let k = 0; k <= count; k++) if (dist[k] < sampledMin) sampledMin = dist[k];

  const minima = [];
  for (let k = 0; k <= count; k++) {
    if (k > 0 && dist[k] > dist[k - 1]) continue;
    if (k < count && dist[k] > dist[k + 1]) continue;
    // skip the second sample of an exactly flat pair
    if (k > 0 && dist[k] === dist[k - 1] && minima.length && minima.at(-1).k === k - 1) continue;
    const before = k > 0 ? angleBetween(bodies[k - 1], bodies[k]) : 0;
    const after = k < count ? angleBetween(bodies[k], bodies[k + 1]) : 0;
    const lowerBound = dist[k] - Math.max(before, after) * MOON_MEAN_RADIUS_KM;
    if (lowerBound > Math.max(R, sampledMin)) continue;
    const a = times[Math.max(0, k - 1)], b = times[Math.min(count, k + 1)];
    let t = goldenMinimum(fn, a, b, tol), d = fn(t);
    if (dist[k] < d) { t = times[k]; d = dist[k]; }
    minima.push({k, t, d});
  }

  let closest = null;
  for (const m of minima) if (!closest || m.d < closest.d) closest = m;

  const raw = [];
  for (const m of minima) {
    if (m.d > R) continue;
    // Entry: the last sample before m.t that is outside the radius. The inside
    // part of a pass is contiguous, so every sample between it and m.t is inside.
    let s = Math.min(count, Math.floor((m.t - lo) / step));
    while (s >= 0 && (times[s] >= m.t || dist[s] <= R)) s--;
    let open, clippedStart = false;
    if (s < 0) { open = lo; clippedStart = true; }
    else open = crossing(fn, times[s], s + 1 <= count && times[s + 1] < m.t ? times[s + 1] : m.t, R, tol);
    // Exit: the first sample after m.t that is outside the radius.
    let e = Math.max(0, Math.min(count, Math.ceil((m.t - lo) / step)));
    while (e <= count && (times[e] <= m.t || dist[e] <= R)) e++;
    let close, clippedEnd = false;
    if (e > count) { close = hi; clippedEnd = true; }
    else close = crossing(fn, times[e], e - 1 >= 0 && times[e - 1] > m.t ? times[e - 1] : m.t, R, tol);
    raw.push({t: m.t, d: m.d, open, close, clippedStart, clippedEnd});
  }
  raw.sort((a, b) => a.open - b.open);
  const merged = [];
  for (const w of raw) {
    const last = merged.at(-1);
    if (last && w.open <= last.close + tol) {
      if (w.close > last.close) { last.close = w.close; last.clippedEnd = w.clippedEnd; }
      if (w.d < last.d) { last.t = w.t; last.d = w.d; }
    } else merged.push({...w});
  }
  const windows = merged.map(w => ({...at(w.t), open: w.open, close: w.close, duration: w.close - w.open,
    clippedStart: w.clippedStart, clippedEnd: w.clippedEnd, discrete: false}));
  return {windows, closest: closest ? at(closest.t) : null, evaluations, step};
}

function displaySamples(p, tr, from, to, at, windows, discreteAll) {
  if (!(to >= from)) return [];
  if (discreteAll) {
    const inView = discreteAll.filter(c => c.arrival >= from && c.arrival <= to);
    if (inView.length <= SEARCH.maxDisplaySamples) return inView;
    const every = Math.ceil(inView.length / SEARCH.maxDisplaySamples);
    return inView.filter((c, i) => i % every === 0);
  }
  const step = Math.max(SEARCH.displayStepS, (to - from) / SEARCH.maxDisplaySamples);
  const out = [];
  for (let t = from; t <= to; t += step) out.push(at(t));
  if (!out.length || out.at(-1).arrival !== to) out.push(at(to));
  for (const w of windows) if (w.arrival >= from && w.arrival <= to) out.push(w);
  return out.sort((a, b) => a.arrival - b.arrival);
}

let cache = {key: '', value: null};

function fullSearch(p) {
  const key = JSON.stringify(p);
  if (cache.key === key) return cache.value;
  let value;
  const errors = validateArrivalSearch(p);
  if (errors.length) value = {errors};
  else {
    const tr = transfer(p), lo = Math.max(p.from, p.epoch + tr.time), hi = p.to;
    const coverage = {from: lo, to: hi, requestedFrom: p.from, requestedTo: p.to, earliestArrival: p.epoch + tr.time, complete: true, partial: false};
    const at = t => candidateAt(t, p, tr);
    if (lo > hi) {
      value = {errors: [], tr, windows: [], best: null, coverage, method: {kind: 'none', evaluations: 0},
        empty: 'No arrival can occur in this interval: the earliest modelled arrival is one transfer time after the lunar orbit epoch.'};
    } else if (tr.o.e >= 1e-9 || p.goal === 'orbit') {
      const r = discreteSearch(p, tr, lo, hi, at);
      const pool = r.windows.length ? r.windows : r.all;
      const best = pool.reduce((b, c) => !b || c.distance < b.distance ? c : b, null);
      value = {errors: [], tr, windows: r.windows, best, coverage, all: r.all,
        method: {kind: 'discrete', step: r.step, evaluations: r.evaluations}};
    } else {
      const r = continuousSearch(p, tr, lo, hi, at);
      const best = r.windows.length ? r.windows.reduce((b, c) => c.distance < b.distance ? c : b) : r.closest;
      value = {errors: [], tr, windows: r.windows, best, coverage,
        method: {kind: 'continuous', step: r.step, evaluations: r.evaluations, timeToleranceS: SEARCH.timeToleranceS}};
    }
    if (value.best) value.budget = budget(p, value.best, tr);
  }
  cache = {key, value};
  return value;
}

/**
 * Search the whole arrival interval [p.from, p.to] for arrivals near the pin.
 * view (optional) = {from, to}: limits only the display samples, e.g. playback.
 * Returns {errors, tr, windows, best, budget, coverage, method, samples} or
 * {errors:[...]} for invalid input.
 */
export function search(p, view) {
  const full = fullSearch(p);
  if (full.errors.length) return {...full, samples: []};
  if (!full.tr || full.coverage.from > full.coverage.to) return {...full, samples: []};
  const at = t => candidateAt(t, p, full.tr);
  const from = Math.max(full.coverage.from, Number.isFinite(view?.from) ? view.from : -Infinity);
  const to = Math.min(full.coverage.to, Number.isFinite(view?.to) ? view.to : Infinity);
  const samples = displaySamples(p, full.tr, from, to, at, full.windows, full.all || null);
  const {all, ...rest} = full;
  return {...rest, samples, view: {from, to}};
}
