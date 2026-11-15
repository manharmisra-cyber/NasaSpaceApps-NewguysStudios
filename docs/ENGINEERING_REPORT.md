# Lunar Navigator functional audit: engineering report

Branch `fix/lunar-navigator-functional-audit`, based on `main` at `b30c730`. Nine checkpoints, each committed separately; the running log is in `CODEX_PROGRESS.md`. This is an educational mission planner, not certified flight software; the results below are correct within the model limits listed at the end.

## 1. Summary of completed changes

| # | Checkpoint | Result |
|---|---|---|
| 1 | Arrival Search for your pin | Searches the whole interval (silent 14-day cap and forced 10-minute slice removed), finds every pass including sub-second grazes, window edges to 0.0001 s, great-circle distance on the lunar sphere |
| 2 | Surface and Space UI | Larger, readable landing-site list and map; compact rover controls; narrower right column; three map rendering bugs fixed |
| 3 | Mission Designer | Every input traced; crew selection now applies NASA acceleration limits; hidden fields no longer block results |
| 4 | Lunar orbital maneuvers | Step-by-step guidance for TLI, lunar orbit insertion, deorbit, braking, Hohmann, circularization, apse changes and inclination changes |
| 5 | Remove Moon Stationary Orbit | Option, calculations, display, styles, docs and tests removed; old saved sessions fall back safely |
| 6 | Mission Check | Real validation with pass / warning / fail / not checked / not applicable, values, limits and corrections |
| 7 | Burn Planning | Budget stops at usable propellant; burns marked planned / infeasible / not reached; directions and statuses shown |
| 8 | Remaining functional bugs | Full button, input and link sweep; stale explanations fixed |
| 9 | Integration | 126 unit tests and 40 browser checks pass; README updated |

## 2. Files modified

New: `lunar-geometry.mjs`, `arrival-search.mjs`, `crew-limits.mjs`, `maneuvers.mjs`, `mission-check.mjs`, `docs/ENGINEERING_REPORT.md`, `CODEX_PROGRESS.md`, and tests `arrival-search-tests.mjs`, `mission-inputs-tests.mjs`, `maneuvers-tests.mjs`, `mission-check-tests.mjs`, `burn-consistency-tests.mjs`.

Changed: `mission-core.mjs`, `burn-plan.mjs`, `mission.mjs`, `mission.html`, `mission-time.mjs`, `mission-context.mjs`, `candidate-map.mjs`, `globe.mjs`, `shared-state.js`, `index.html`, `js/surface-workspace.js`, `css/merge.css`, `css/theme.css`, `mission.css`, `README.md`, `tests/mission-tests.mjs`, `tests/burn-plan-tests.mjs`.

## 3. Physics corrections

- **Propellant exhaustion:** the budget applied the rocket equation after the locked reserve was used up, producing masses below the dry mass and impossible durations and accelerations for later burns. Each burn now stops at the reserve, reports the delta-v it can deliver and its shortfall, and later burns are "not reached".
- **Touchdown thrust:** the landing T/W check used the lightest allowed mass (dry plus reserve), which is optimistic. It now uses the actual landing mass.
- **Crew acceleration:** previously unassessed. Felt (proper) acceleration is thrust divided by mass; lunar gravity is reported separately and is felt only on the surface or hovering; the resultant inertial acceleration is not compared with crew limits. Limits are the sustained +Gz curves of NASA/TM-20205008196, Table 1.
- **Inclination change:** new; delta-v = 2 v_h sin(|di|/2) at the node with the larger radius, normal or anti-normal by sign and node; included in the fuel budget.
- **Arrival distance:** one shared great-circle function on the IAU mean lunar radius (1,737.4 km), atan2 form, accurate at zero, antipodal and polar separations, with longitude wrap.
- Verified unchanged and tested against independent formulas: vis-viva speed and period (1.6335 km/s, 117.8 min at 100 km), Hohmann delta-v, Tsiolkovsky per burn, exact constant-thrust burn duration, kN and Isp conversions, Earth departure using Earth's gravity parameter.

## 4. Algorithms implemented

- **Arrival search:** 72 samples per revolution; golden-section refinement of every sampled local minimum that a triangle-inequality lower bound cannot exclude; bisection for entry and exit times (tolerance 0.0001 s, distance 1 mm inclusive). One-entry cache; display samples capped and limited to the playback view. Up to 731 days per run, rejected explicitly beyond that.
- **Crew exposure:** for each acceleration level, the cumulative time at or above it across all burns (closed form for constant thrust), compared with the interpolated limit curve at that duration.
- **Maneuver classification:** two tangential impulses between coaxial orbits, labelled Hohmann only when both orbits are circular; single-burn cases recognised (circularize at either apse, raise or lower an apse).
- **Plane-change timing:** true-to-mean anomaly conversion (Kepler's equation) for the time from insertion to the node.

## 5. UI improvements

- Surface page: side columns scale with the window (left 260 to 312 px, right 280 to 304 px); the 3D view gains 58 to 66 px at common laptop widths. Site names and details wrap instead of being cut off; the coordinate form fits on one row. The Map tab shows the map first and sizes it to the window, with a "Show large map" button. Rover controls condensed from about 270 to about 200 px. Inspector tabs fit. Fixed: maps squeezed by flex layout, the stretched flat map (clicks landed up to about 19 degrees off), a 1 px phone overflow.
- Mission page: optional crew-limit and target-inclination fields (shown only when relevant); a mission check with statuses, values, limits and corrections; burn cards with status, direction and shortfall; a step-by-step guidance panel; failed crew limits coloured on the maps.

## 6. Removed functionality

The Moon-stationary orbit destination and all its calculations, rings, diagram, text, styles, export fields and tests. Ordinary lunar orbits, insertion, altitude changes, circularization and transfers are kept and tested.

## 7 to 10. Tests

Executed:
- `node tests/run.js` (original suite: Meeus examples, JPL Horizons comparison, terrain, line of sight, far horizon, transfer): passed.
- `node --test tests/*.mjs`: 126 tests, 126 passed, 0 failed (54 original, 72 added; 3 original tests were updated where the old assertion encoded removed or incorrect behaviour: the stationary-orbit test, the Earth-origin test that relied on masses below the reserve, and the burn-plan fixture missing wet mass and Isp).
- Browser (headless Chrome with software WebGL): 40 of 40 end-to-end checks (explorer driving, site selection, map, ranking, page hand-off; seven mission scenarios checking verdict, absence of NaN and undefined, and presence of checks, burns and guidance; option removal; reference sky; five screen sizes for two pages; no console errors). Earlier sweeps: every visible button on all three pages, every mission input at its limits for all four routes, explorer calculator inputs, every local link and anchor.

Failed: none.

Not executed:
- Real GPUs, Safari, Firefox and physical phones (only headless Chrome with software rendering was available).
- The hosted GitHub Pages copy (no push access from the working environment).

## 11. Remaining limitations

- Two-body Moon, impulsive burns, constant-thrust durations; no powered-descent simulation (reported as "not checked"), no terrain-safe landing, slope or hazard check.
- Earth departure and lunar capture are patched-conic estimates; phasing and the arrival plane are not solved.
- Orbit transfers assume a shared apse line; plane changes are separate burns, not combined or optimised.
- Crew limits use only the memo's +Gz curves and a conservative cumulative-exposure reading; transient loads, life support and abort are not assessed. The memo does not define its "short" and "long" duration curves.
- Eccentric orbits deorbit only from apoapsis in this model.
- During arrival playback the page stalls for about 1 s per step in the software-rendered test browser (already on `main`); profiling shows almost all time in WebGL rasterisation, not application code. Needs checking on a real GPU.

## 12 to 14. Commits, branch, pull request

Branch: `fix/lunar-navigator-functional-audit` (not merged into `main`).

| Commit | Content |
|---|---|
| `ec00aa1` | Checkpoint 1: arrival search |
| `65f4cf5` | Progress file |
| `8b3f429` | Checkpoint 2: surface layout |
| `a423dd0` | Progress file |
| `a2f7989` | Checkpoint 3: crew limits, input audit, validation |
| `0b499c0` | Progress file |
| `786f486` | Checkpoint 4: maneuver guidance and inclination changes |
| `d4f3093` | Checkpoint 5: stationary orbit removed |
| `83fe2a6` | Checkpoint 6: mission check |
| `bdbb02a` | Checkpoint 7: burn planning |
| `e2337b3` | Checkpoint 8: functional audit |
| `3a20fae` | Checkpoint 9: integration fixes and README |
| (this commit) | Engineering report and final progress file |

Pull request: not created. The working environment could read the public repository but had no GitHub credentials to push. The branch is delivered as a git bundle and a patch series; push it and open the pull request from a machine with access.
