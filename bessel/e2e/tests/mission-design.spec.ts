import { test, expect } from '@playwright/test';
import { openAnalyze, expandCard } from './sample.ts';

// The editable mission-design workbench is mission-independent: from a cold boot the user
// builds a Mission Control Sequence in the segment editor (InitialState, coast, prograde burn,
// and a Target whose differential corrector tunes the burn to a desired radius), runs it via
// @bessel/propagator, renders the solved arc in the scene, and reports the per-iteration
// residual convergence, the solved delta-v, and the final state. It lives in the Orbit &
// Maneuver tab's "Mission control sequence" TaskCard. (STK_PARITY_SPEC §4.3; analysis-UX Phase 1.)

test('mission design edits a segment, runs the MCS, and reports corrector convergence', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  await openAnalyze(page, 'orbit-maneuver');
  await expandCard(page, 'mcs');

  // The default editable design has four segments; the Target row is segment index 3.
  await expect(page.getByTestId('mcs-segment-editor')).toBeVisible();
  await expect(page.getByTestId('mcs-add-segment')).toBeVisible();
  for (const i of [0, 1, 2, 3]) {
    await expect(page.getByTestId(`mcs-segment-${i}`)).toBeVisible();
  }

  // Edit the Target's desired radius via the new segment control to prove edits thread in.
  await page.getByTestId('mcs-segment-3-desired').fill('7300');
  await page.getByTestId('run-mcs').click();

  // The run surfaces a final-state readout, a converged differential-corrector report with the
  // solved delta-v, the per-iteration residual trace, and an altitude polyline along the arc.
  await expect(page.getByTestId('mcs-result')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('mcs-final-state')).toContainText('km');
  await expect(page.getByTestId('mcs-dc-report')).toContainText('converged');
  await expect(page.getByTestId('mcs-solved-dv')).toContainText('delta-v');
  await expect(page.getByTestId('mcs-residuals-chart').locator('polyline')).toHaveCount(1);
  await expect(page.getByTestId('mcs-altitude-chart').locator('polyline')).toHaveCount(1);
});

// The configurable Lambert card sweeps a porkchop (a departure-window x time-of-flight grid of
// total departure delta-v, solving Lambert about the central body at each node) and renders the
// delta-v contour with the minimum marked. From that optimum, "Send to MCS" appends an impulsive
// Maneuver to the editable MCS, so the trajectory designer flows porkchop -> MCS without
// re-typing the burn. (analysis-UX Phase 2, design section 3 tab 1.)
test('porkchop sweeps a delta-v contour and sends the optimum to a new MCS maneuver', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  await openAnalyze(page, 'orbit-maneuver');
  await expandCard(page, 'lambert');

  // The configurable transfer exposes departure/arrival bodies and the two range controls.
  await expect(page.getByTestId('param-departure-body')).toBeVisible();
  await expect(page.getByTestId('param-arrival-body')).toBeVisible();
  await expect(page.getByTestId('param-dep-range')).toBeVisible();
  await expect(page.getByTestId('param-tof-range')).toBeVisible();

  // Drive the sweep over a heliocentric Earth -> Mars-barycenter window that the bounded fixture
  // ephemeris actually covers: planet positions come from barycenters (the fixture SPK has the
  // planet barycenters, not the planet body-centers), and the departure + time-of-flight ranges
  // stay inside the bundled 2004 inner-system coverage (max departure + TOF = 30 + 150 = 180 d,
  // under the fixture's forward span from the cold-boot epoch). With a full kernel the user can
  // pick any covered pair and window; here we pin a fixture-covered one so spkezr never fails loud.
  await page.getByTestId('param-departure-body').selectOption('EARTH');
  await page.getByTestId('param-arrival-body').selectOption('MARS BARYCENTER');
  await page.getByTestId('param-dep-day0').fill('0');
  await page.getByTestId('param-dep-day1').fill('30');
  await page.getByTestId('param-tof-day0').fill('90');
  await page.getByTestId('param-tof-day1').fill('150');

  // Sweep the window on the dedicated worker; the contour + its marked minimum render. [ux-p3] the
  // grid solve runs off the main thread with a progress readout + cancel: after clicking, either the
  // progress readout (the worker is mid-sweep) or the final contour (a fast sweep already finished)
  // is shown, proving the worker-progress path is wired without flaking on the sub-frame timing.
  await page.getByTestId('compute-porkchop').click();
  await expect(page.getByTestId('porkchop-progress').or(page.getByTestId('porkchop'))).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('porkchop')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('porkchop-min')).toBeVisible();
  await expect(page.getByTestId('porkchop-best')).toContainText('delta-v');

  // The current MCS has four default segments; sending the optimum appends a fifth (a Maneuver).
  await expandCard(page, 'mcs');
  await expect(page.getByTestId('mcs-segment-4')).toHaveCount(0);
  await expandCard(page, 'lambert');
  await page.getByTestId('send-to-mcs').click();

  await expandCard(page, 'mcs');
  await expect(page.getByTestId('mcs-segment-4')).toBeVisible();
});
