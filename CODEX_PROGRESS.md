# Lunar Navigator functional audit: progress

Repository: https://github.com/manharmisra-cyber/NasaSpaceApps-NewguysStudios
Branch: `fix/lunar-navigator-functional-audit`, created from `main` at `b30c730` ("Merge project with existing GitHub repository").
Work rule: one checkpoint per cycle; the next starts only after the instruction `CONTINUE`. On 15 Nov 2026 the user authorised running all remaining checkpoints (4 to 9) without stopping; each is still committed and recorded separately.

## Current state

- All nine checkpoints are complete. Nothing is in progress.
- Remaining work: push the branch and open a pull request to `main` from a machine with GitHub access (see Blockers). Final report: `docs/ENGINEERING_REPORT.md`.

## Checkpoints

| # | Checkpoint | Status | Commit |
|---|---|---|---|
| 1 | Arrival Search for your pin | Done | `ec00aa1` |
| 2 | Surface and Space UI | Done | `8b3f429` |
| 3 | Mission Designer inputs and crewed acceleration | Done | `a2f7989` |
| 4 | Lunar orbital maneuver guidance | Done | `786f486` |
| 5 | Remove Moon Stationary Orbit | Done | `d4f3093` |
| 6 | Mission Check | Done | `83fe2a6` |
| 7 | Burn Planning | Done | `bdbb02a` |
| 8 | Remaining functional bugs | Done | `e2337b3` |
| 9 | Final integration and verification | Done | `3a20fae`, plus the report commit |

## Recovery of earlier work

An earlier interrupted session reported changes to `arrival-search.mjs`, `lunar-geometry.mjs` and `tests/arrival-search-tests.mjs`. None of these existed on `origin/main` at `b30c730` (the only remote branch; history has three commits), so nothing was recovered. The files of the same names on this branch were written from scratch in Checkpoint 1.

Findings reported by that session, and their status:
- Long arrival searches silently switched to a shorter interval: confirmed and fixed in Checkpoint 1 (see below).
- Crew selection not affecting mission validation: confirmed and fixed in Checkpoint 3. The existing test `crew selection does not silently invent physics or safety margins` still holds (crew does not change delta-v or windows); crew now adds a separate acceleration check.
- Burn estimates continuing beyond usable propellant: confirmed and fixed in Checkpoint 7.

## Project facts a new session needs

- Static site, no build step, no dependencies except bundled three.js (`vendor/`). Serve over http (`python3 -m http.server`, or `node server.mjs`).
- Pages: `index.html` (surface and space explorer, code in `js/`), `mission.html` (mission designer: `mission.mjs` UI, `mission-core.mjs` physics, `arrival-search.mjs`, `lunar-geometry.mjs`, `burn-plan.mjs`, `mission-time.mjs` playback clock, `candidate-map.mjs`, `globe.mjs`, `terrain-*.mjs`), `sky.html` (reference sky).
- Units in mission code: km, s, kg, kN in the form (N inside budget), delta-v in m/s.
- Tests: `node tests/run.js` and `node --test tests/*.mjs` (`npm test` runs both).
- Many source files are minified onto long lines; edit with exact string replacement.
- Repository files must not name any AI assistant or tool, and commits carry no tool attribution.

## Checkpoint 1: Arrival Search for your pin (done)

Failure modes found in the original `search()` (mission-core.mjs):
1. Silent 14-day cap: `hi = min(to, lo + 14 days)`; only a footnote mentioned it.
2. The playback clock forced intervals over 14 days into a moving slice of plus or minus 5 minutes (default) around the cursor, and the opportunity list, verdict and best arrival were computed from that slice only.
3. Overlapping windows were dropped instead of merged.
4. Window edges and minima were refined only to about 0.1 s.
5. Short passes were found only if a 30-second sample grid bracketed a local minimum; no lower-bound reasoning, and a cost of 2,880 samples per day that made long intervals impractical.

What changed:
- `lunar-geometry.mjs` (new): `MOON_MEAN_RADIUS_KM = 1737.4`, `normalizeLongitude`, `isValidLatLon`, `unitVector`, `centralAngleVectors` (atan2 form, accurate near 0 and 180 degrees), `centralAngle`, `surfaceDistanceKm` (NaN for invalid input). `mission-core.mjs` now takes `C.R` and the arrival distance from here.
- `arrival-search.mjs` (new; `mission-core.mjs` re-exports `search`): searches the whole interval. Circular orbits: 72 samples per revolution, golden-section refinement of every sampled local minimum that a triangle-inequality lower bound cannot rule out, bisection for entry and exit times. Tolerances: time 0.0001 s, distance 1 mm (a point exactly on the radius is inside). Eccentric orbits and orbit transfers: every apoapsis departure in the interval. Interval limit 731 days, rejected with an explicit error. Results: `windows` (with `open`, `close`, `duration`, `clippedStart`, `clippedEnd`), `best`, `budget`, `coverage` (`from`, `to`, `requestedFrom`, `requestedTo`, `earliestArrival`, `complete`), `method` (`kind`, `step`, `evaluations`), and `samples` for the map only (optional `view` interval, at most 6,000 points plus window minima). A one-entry cache avoids recomputation during playback.
- `mission.mjs`: calls `search(fullParams, playbackView)`; the footnote states the searched interval, evaluation count and method; the empty-result note gives the closest predicted arrival; the slice-mode button now reads "Show the whole interval on the map".
- `mission-time.mjs`: no longer forces slice mode for long intervals; scope text says the list always covers the entire interval.
- `mission.html`: playback note updated. `README.md`: one line on search coverage and tolerances.

Tests:
- New `tests/arrival-search-tests.mjs`, 25 tests: lunar radius (not Earth), zero and 1 m distances, antimeridian and out-of-range longitudes, poles, invalid coordinates, core/geometry agreement, zero-distance pin, 1 km radius edges and chord duration, 300 km radius, tangent boundary included and 1 m smaller excluded, a 0.3 s crossing missed by a 30 s grid, unreachable pin, pins at +180 and -180, south-pole pin with arbitrary longitude, 60-day interval in under 5 s, over-limit rejection, earliest arrival, clipped windows at both interval edges, brute-force one-second scan of three pins over one day (no misses, no extras), sorted disjoint windows, 11 invalid inputs, determinism, playback view independence, full-interval eccentric search, re-export.
- Results at commit `ec00aa1`: `node tests/run.js` all checks passed; `node --test tests/*.mjs` 79 of 79 passed (54 existing, 25 new).
- Browser (headless Chrome, software WebGL) on `mission.html`: default 1-day interval 13 windows; 60-day interval searched completely (734 windows, list shows first 100 as before); playback changes only the map; 800-day interval shows the explicit error; 1-hour interval and invalid latitude handled; no console errors.

Known limitations (Checkpoint 1):
- The model only departs from apoapsis on eccentric orbits, and its orbit has no perturbations (no node drift, no mascons); windows are geometric arrivals of that model, not powered-descent ignition windows.
- The single-minimum-per-revolution property relies on the arrival track being close to a great circle over one revolution, which holds for this two-body model with the Moon's slow rotation; it is not proven for arbitrary future models.
- Surface distance is on a smooth sphere; terrain height and flattening are ignored (differences up to about 0.1 percent).
- The sync (Moon-stationary) branch was kept here and removed in Checkpoint 5.

Blockers:
- No push access from the working environment (GitHub account not linked to it). The branch exists locally and is delivered as a git bundle and a patch; see the final report of each checkpoint.

## Checkpoint 2: Surface and Space UI (done)

Interpretation: "Landing Site widget" covers the left "Landing sites" panel and the site map in the inspector's Map tab (where sites are picked and candidate arrivals are drawn). "Rover controller" is `#roverCard`; "right-side widgets" is the inspector column.

Measured before (1280 x 800): left column 250 px, right column 355 px, 3D view 674 px wide; site details cut off with ellipses (5 elements clipped); rover block about 270 px tall; in the Map tab the globe started about 700 px down, mostly below the fold; inspector tab "Method" clipped once the column is narrowed.

What changed (all layout rules in `css/merge.css`, section "layout proportions (functional audit, checkpoint 2)"):
- Column widths: left `clamp(260px, 18vw, 312px)`, right `clamp(280px, 20vw, 304px)`; at 1200 px and below 232 / 272 px. Dock time controls use `var(--left)` so they stay aligned. 3D view width now: 1920 -> 1304 (was 1314), 1440 -> 892 (834), 1280 -> 740 (674), 1100 -> 596 (580).
- Landing sites: names and details wrap (details clamped to two lines); coordinate form on one row with a "Go" button (`aria-label` keeps the full name). On narrow screens site cards are 236 px wide in the horizontal list.
- Map tab (`index.html`): view selector and map moved above the candidate text; globe height `clamp(260px, 44vh, 440px)`; new "Show large map" button (`#mapLarge`, handler in `js/surface-workspace.js`) triggers the existing "Candidate map" layout and hides itself there.
- Rover: heading and position on one line, status chips in a row, smaller d-pad and buttons, shorter hint (full text kept in its `title`). About 200 px tall including padding.
- Inspector tabs flex to share the width.
- Pre-existing defects fixed: (1) the globe and the pole map were flex items that shrank below their drawn size when the panel was short; (2) a CSS `min-height: 180px` stretched the 2:1 flat map vertically, distorting it and shifting click latitudes (a click at 25 % height gave about 26 degrees N instead of 45); (3) the page links overflowed a 390 px phone by 1 px.

Tests:
- `node tests/run.js` passed; `node --test tests/*.mjs` 79 of 79 (no new unit tests: the changes are CSS and markup; behaviour covered by the browser checks below).
- Headless Chrome, software WebGL, at 1920x1080, 1440x900, 1280x800, 1100x760, 390x844: no horizontal page overflow, no clipped text elements (0, was 5-6), inspector and dock tabs fit, no console or page errors.
- Interaction check at 1280x800: keyboard and d-pad driving, Speed, LED, Return to lander, site selection, coordinate Go, all inspector and dock tabs, space view, Focus centre and Escape, Arrange panels (sites moved to the right zone), Reset layout, Plan a mission link, all three map views, Show large map (globe 464 px tall), flat-map click maps to the expected latitude and longitude within one pixel. All passed. Out-of-range latitude is stopped by the field's native range check ("Value must be less than or equal to 90"), as before.

Known limitations (Checkpoint 2):
- Only checked in headless Chrome with software rendering; not checked in Safari or Firefox, or on a real phone.
- When panels are rearranged so two panels share a column, each gets half the height; that is the existing arrangement behaviour.
- The dock keeps a fixed 293 px height; on short desktop windows (below about 700 px tall) the 3D view becomes small. Not changed.

## Checkpoint 3: Mission Designer (done)

Input audit ("Your mission" form, `mission.html`; read by `read()` in `mission.mjs`; validated by `validate()` and used in `mission-core.mjs`):

| Input | Meaning | Used by | Status before | Now |
|---|---|---|---|---|
| origin | Start in lunar orbit or Earth parking orbit | `earthLeg`, `budget` (adds TLI and capture burns) | Used | Used |
| goal | Land, other lunar orbit, Moon-stationary | `transfer`, `search`, `budget` | Used | Used (stationary removed in Checkpoint 5) |
| crew | Robotic or crewed | nothing except validation | **Not used** | Crew acceleration check (`crew-limits.mjs`), verdict, map colours |
| crewLimit (new, optional) | NASA limit curve A-E, default B | `crewAccelerationCheck` | n/a | Shown only for crewed |
| wet, dry | Masses, kg | rocket equation, T/W, durations | Used | Used |
| thrust | kN, constant | mass flow, durations, T/W | Used | Also felt acceleration |
| isp | s | exhaust speed g0*Isp | Used | Used |
| reserve | % of propellant locked | minimum mass floor, available delta-v | Used | Used |
| allowance | m/s user loss estimate | required delta-v | Used | Used |
| earthAp, earthPe | Earth parking orbit | `earthLeg` (origin earth) | Used; **validated even when hidden** | Validated only for origin earth |
| ap, pe, inc, node, arg, phase, epoch | Lunar orbit and its state | `orbitalState`, `candidateAt`, `budget` | Used | Used |
| targetAp, targetPe | Target lunar orbit | `transfer` (goal orbit) | Used; **validated even when hidden** | Validated only for goal orbit |
| lat, lon, radius, from, to | Pin and interval | `search` | Used | Used |

There is no separate payload or mission-duration input: dry mass includes payload, and the model has no duration-dependent consumable. None was added (the brief says not to add unnecessary mandatory inputs).

Crew acceleration model (`crew-limits.mjs`):
- Felt (proper) acceleration = thrust / mass, rising through each constant-thrust burn as mass falls. Gravity is not felt in free fall, including during powered descent; lunar gravity (mu/R^2 = 1.624 m/s^2) is reported separately as felt only on the surface or hovering. The resultant (inertial) acceleration is not compared with the crew limit.
- Limits: NASA/TM-20205008196, Table 1, sustained +Gz limits in m/s^2 against exposure duration, curves A-E (posture and lower-body compression garment; "short" and "long" duration curves, terms undefined in the memo). Linear interpolation between tabulated durations; 540-900 s uses the 540 s value; at least 900 s uses the last value; under 0.5 s uses the 0.5 s value (transient loads not assessed).
- Exposure: for each level, the cumulative time at or above it across all burns (conservative reading of "accumulated across the phase of flight"). Pass if level / limit(time at or above level) <= 1 at every level; scanned at 160 even levels plus each burn's start and end and each tabulated limit.
- Thrust assumed along the crew's head-to-foot axis. The memo has no +Gx limits; NASA-STD-3001 seated +Gx limits are higher, so this is conservative for seated crews.
- Default case (15 t, 45 kN, 320 s, 100 km orbit, landing): felt 3.00 to 5.20 m/s^2 (0.53 g), 443 s in total. Curve B allows 2.06 m/s^2 for 443 s: fails at 145 %. Curves A, C, D and E pass.

Other changes: verdict "Exceeds crew acceleration limit" with level, duration, limit and suggested corrections; check rows for peak felt acceleration (also for robotic), crew limit used and percentage, and lunar gravity; crewOK added to the failed colour in `candidate-map.mjs`, `globe.mjs` and the explorer's `mission-context.mjs` ranking (new status `crew`); legend says "Failed fuel, thrust or crew limit".

Tests: new `tests/mission-inputs-tests.mjs`, 16 tests (physics against independent formulas: vis-viva speed 1.6335 km/s and period 117.8 min at 100 km, Hohmann 100 to 500 km, rocket equation and exact constant-thrust duration, kN and Isp conversions, Earth departure with Earth's mu; input audit varying every field; route-specific fields; hidden fields; Table 1 values; closed-form exposure; gravity kept separate; default pass/fail per curve; thrust sensitivity; crew does not change delta-v; crewLimit validation). Results at `a2f7989`: `node tests/run.js` passed; `node --test tests/*.mjs` 95 of 95. Browser: robotic, crewed B (fails), A and C (pass), 400 kN with C (fails at 326 %), hidden field emptied (no error), Earth origin with empty Earth field (error shown), explorer candidates, ranking and legend; no console errors. A crewed redraw of 6,000 map points costs about 0.16 s in Node.

Found for later checkpoints (not changed here):
- `budget()` keeps applying the rocket equation after propellant runs out, so an infeasible Earth-origin case reports burns below dry mass and a felt peak of 1.87 g from impossible masses. Checkpoint 7.
- `thrustOK` for landing uses T/W at the lightest allowed mass; braking-start T/W below 1 is shown but does not fail (an existing test asserts this). Review in Checkpoint 6.
- Orbit transfers are same-plane only; inclination changes are not modelled. Checkpoint 4.

## Checkpoint 4: Lunar orbital maneuver guidance (done)

- New `maneuvers.mjs` (`maneuverGuide(p, c, b, tr)`): for each burn in the budget it returns objective, initial orbit, target orbit, burn location, direction, delta-v, duration, propellant, masses, felt acceleration, expected change, numbered steps, warnings and pass/warning/fail checks (propellant, crew acceleration, periapsis clearance above the highest lunar terrain 10.69 km, touchdown thrust). Numbers are read from `budget()` burns, so guidance and fuel budget agree (tested: sum of guidance delta-v equals `budget.needed`).
- Covered: trans-lunar injection and lunar orbit insertion (marked as estimates: patched-conic arrival speed, plane and timing not solved), deorbit (descent preparation), terminal braking, Hohmann raise and lower, circularize at apoapsis or periapsis, raise or lower apoapsis or periapsis, circular to elliptical, elliptical to circular, general coaxial two-burn transfers, and inclination change. The title names the maneuver type; "Hohmann" is used only when both orbits are circular and coplanar.
- Inclination change: new optional "Target inclination" field (orbit transfers only; empty = same plane). `planeChange()` in `mission-core.mjs`: dv = 2 v_h sin(|di|/2) at the node with the larger radius of the target orbit (same node line and apse line), direction normal or anti-normal from the sign of di and the node; timing from Kepler's equation. Added to `budget()` as a "Plane change" burn so fuel accounting includes it.
- Unavailable states: no valid budget or no selected opportunity gives "Guidance unavailable" with the reason.
- UI: new panel "5. Step-by-step guidance" on `mission.html`; each maneuver is a collapsible card; assumptions and glossary (prograde, retrograde, normal, apoapsis, periapsis, circularization, node) at the end. Styles in `css/theme.css`.
- Tests: new `tests/maneuvers-tests.mjs`, 13 tests (Hohmann raise and lower against textbook formulas, each single-burn type, two-burn labels, no-change case, plane change formula, node choice, direction and validation, Earth TLI and LOI, landing, unavailable states, terrain, propellant, long-burn and crew checks, agreement with the search's chosen window). All suites: 108 of 108 passed; `node tests/run.js` passed. Browser: landing, Hohmann 100 to 500 km, plus inclination 90 to 80 degrees (258 m/s), Earth to surface; no console errors.
- Limits: plane change kept separate (no combined plane change and transfer optimisation); target orbit assumed coaxial with the start orbit; LOI geometry not solved.

## Checkpoint 5: Remove Moon Stationary Orbit (done)

Removed: the "Moon-stationary orbit" destination option and its method paragraph (`mission.html`); `syncInfo()` and `'sync'` as a valid goal (`mission-core.mjs`); the sync branch and `blocked` result (`arrival-search.mjs`); the stationary verdict, checks, rings explanation, diagram and export status `stationary-orbit-rejected` and `synchronous` export field (`mission.mjs`); the synchronous and Hill-radius rings (`globe.mjs`); the `blocked` check (`candidate-map.mjs`); the sync early return (`mission-time.mjs`); `.sync-diagram` styles (`mission.css`); the README mention. The old test `synchronous radius exceeds Hill radius...` is replaced by one asserting the goal is rejected and nothing stationary is exported. `C.rotation` and `C.moonDistance` stay (used by arrival geometry and the Earth leg).

Preserved: ordinary lunar orbit selection, lunar orbit insertion, altitude changes, circularization, transfers and the new plane change (tested in `tests/maneuvers-tests.mjs`).

Related fixes:
- `shared-state.js` restore: a saved select value that no longer exists (an old session with goal "sync") now falls back to the field's default instead of leaving the select empty and the form invalid.
- `mission-context.mjs` (explorer's copy of the mission): reads `crewLimit` and `targetInc`, and replaces any retired or unknown choice with the default. Before this, the explorer ignored a non-default crew limit chosen in the mission designer.

Tests: 109 of 109 (new: retired-goal fallback and carry-over of the new fields). Browser: goal options are land and orbit only; no "stationary" text on the page; an old saved session with goal sync restores as landing with a valid result; orbit goal and explorer work; no console errors. During the edit a removal pattern briefly left a syntax fragment in `mission-core.mjs`; caught by the test run and fixed before commit.

## Checkpoint 6: Mission Check (done)

Before: the verdict was a chain of fuel / thrust / crew / pin conditions and the check list was label-value rows; items the model does not compute (finite-burn solution) sat beside passes with a plain value, and there was no explanation, limit or suggested correction.

Now `mission-check.mjs` (`missionCheck(p, result, chosen, budget)`) traces input -> search -> budget -> checks and returns items with status pass, warning, fail, unavailable ("Not checked") or not-applicable, plus explanation, value, constraint and suggestion:
- inputs; starting (or post-capture) orbit periapsis vs highest terrain 10.69 km (warning within 5 km); target orbit periapsis; same start and target orbit (warning: nothing to do);
- arrival opportunity (fail when none; then delta-v is "not checked", never passed);
- delta-v budget (available vs ideal + allowance); propellant per burn (reserve kept);
- thrust at touchdown, T/W > 1 at the landing mass (changed from the lightest allowed mass, which was optimistic); low T/W at the start of braking is a warning;
- crew acceleration (not applicable for robotic; fail with level, duration and limit);
- arrival at the pin (landing) or not applicable (orbit);
- powered descent profile and landing-site hazards: always "not checked";
- impulsive-burn approximation (warning when a burn exceeds 5 % of the period); Earth departure and capture (warning: estimate, phasing unsolved); eccentric-orbit deorbit only from apoapsis (warning).
Overall: fail if any fail, otherwise warning if any warning, otherwise pass; the summary always states how many items were not checked. The verdict title and detail come from the first failing item (with its suggestion) or from the summary. The JSON export includes the full check.

Note: the default landing now shows "Preliminary checks pass, with warnings" because its 435 s braking burn is longer than 5 % of the orbit (the old page showed the same fact as a separate "Long burn flag" row).

Tests: new `tests/mission-check-tests.mjs`, 10 tests (feasible with not-checked items, fuel shortfall, thrust fail and braking warning, crew pass and fail, pin miss and orbit not-applicable items, invalid inputs, conflicting and unsupported settings, no opportunity, long burns, touchdown-mass T/W). All suites 119 of 119; `node tests/run.js` passed. Browser: default, dry 13,000 kg (insufficient delta-v with correction), thrust 5 kN (thrust too low), thrust 120 kN (all checked items pass, 2 not checked); no console errors.

## Checkpoint 7: Burn Planning (done)

Audit of `budget()` and `burn-plan.mjs`:
- Delta-v per burn, rocket equation, mass changes: correct (Tsiolkovsky burn by burn; masses chain). Duration = propellant / mass flow, which is the exact constant-thrust time with the falling mass (tested against integrating F/m(t)).
- **Defect:** after usable propellant ran out the budget kept applying the rocket equation, so later burns had masses below the reserve and even below the dry mass; durations, propellant and felt acceleration for those burns were impossible numbers (an Earth-origin default reported 1.87 g from such masses). Fixed in `budget()`: each burn gets `status` planned / infeasible / not-reached, `achievedDv` and `shortfallDv`; an infeasible burn stops at the reserve floor; later burns use no propellant and no time. Masses never go below the floor.
- Burn timing: unchanged method (impulsive event, centred constant-thrust duration); no timing for infeasible, not-reached or terminal burns, or when inputs are invalid.
- Directions were missing from the burn table; now taken from the maneuver guidance (`burnIndex` link), so table and guidance cannot disagree. Zero-delta-v burns say "none (no burn needed)".
- Acceleration now comes from the shared `burnAccelerations()` in `crew-limits.mjs` (no duplicate formula); burns that contribute to a crew-limit failure are flagged.
- `burnInputIssues()` rejects zero, negative or non-numeric thrust and Isp, and nonphysical masses (also validated upstream).
- Budget result now carries `period`, so the long-burn flag is per burn.
- UI: each burn card shows status, direction, achieved and short delta-v when infeasible, "No thrust applied" for not-reached burns, and the approximation stated in sentence case. CSV adds status, direction, achieved delta-v and shortfall columns.

Tests: new `tests/burn-consistency-tests.mjs`, 6 tests (rocket equation and exact duration, plan/guidance/budget/check agreement for four mission types, infeasible stop at reserve and not-reached burns, crew flags, invalid inputs, zero-delta-v orbit burn). Updated: the Earth-origin test (now asserts infeasible TLI and not-reached later burns, all masses above the reserve) and the burn-plan fixture (added wet mass and Isp so the new input guard sees a physical vehicle). All suites 125 of 125; `node tests/run.js` passed. Browser: default plan, dry mass 12,000 kg (terminal burn infeasible), CSV download; no console errors.

## Checkpoint 8: Remaining functional bugs (done)

Audit method (headless Chrome, software WebGL, 1440 x 900):
- Clicked every visible button on `index.html` (55), `mission.html` and `sky.html` (17), scanning visible text for NaN, Infinity, undefined and [object Object] after each click: none; no console or page errors.
- Set every numeric mission input to its minimum, its maximum and empty, for all four origin/goal combinations: no NaN, Infinity or undefined in the verdict, checks, opportunity list or guidance.
- Explorer resource-calculator inputs at min, max, empty, 0, -5 and 1e9: none.
- Every local link and in-page anchor on the three pages resolves (no broken links).
- Mission Reset restores all fields including the new crew limit and target inclination and hides the crew-limit field; JSON export contains the mission check (10 items).
- `node server.mjs` serves the new modules with a JavaScript MIME type.

Fixed:
- Stale method text on `mission.html` said acceleration constraints are unassessed and that thrust/weight is tested at dry mass plus reserve; now describes the crew acceleration check and the landing-mass T/W.
- JSON export limitations said "Crew safety unassessed"; now states what the crew check covers and that burns are impulsive.
- Regression test added (`tests/mission-check-tests.mjs`): no stale claims about acceleration, the stationary orbit, the 14-day cut-off or the moving window.

Investigated, not changed:
- During arrival playback on the mission page the main thread stalls for about 1 s per step in this test browser, enough that clicks (including Pause) time out. The same happens on `main` (960 ms vs 1,390 ms on the branch). A CPU profile shows 96 % native time (software WebGL rasterisation of the globe and the embedded surface view) and only tens of milliseconds of application JavaScript. Likely an artefact of software rendering; it needs checking on a real GPU before changing anything (see Known limitations).

Tests: 126 of 126; `node tests/run.js` passed.

## Checkpoint 9: Final integration and verification (done)

- Full suite: `node tests/run.js` passed; `node --test tests/*.mjs` 126 of 126.
- Browser regression (headless Chrome, software WebGL): 40 of 40 checks across the explorer, seven mission scenarios (robotic landing; crewed standing fails; crewed seated with garment passes; fuel shortfall; Hohmann plus inclination change; no-change orbit; Earth origin), stationary option absent, reference sky, and five screen sizes for two pages; no console or page errors.
- Integration fix: zero-delta-v burns in the burn table are labelled "No burn needed" with no timing (they were shown as planning estimates).
- README updated with the new mission-designer behaviour and limits.
- Final engineering report: `docs/ENGINEERING_REPORT.md`.

## Next actions

1. On a machine with GitHub access: fetch the delivered bundle into a clone, push `fix/lunar-navigator-functional-audit`, open a pull request to `main` (do not merge automatically).
2. Check the arrival-playback stall on a real GPU (Checkpoint 8 note) and the layout in Safari, Firefox and on a phone.
