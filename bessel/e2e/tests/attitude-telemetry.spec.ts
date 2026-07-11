import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { frameStats } from './frame-stats.ts';
import { openAnalyze, expandCard } from './sample.ts';

// Track D (Cosmographia parity): real data-driven spacecraft attitude, SPICE-derived
// timeline annotations, and an on-screen predicted-versus-actual telemetry overlay.
// The native-cassini fixture declares a UniformRotation orientation, so the bundled
// generic builder drives the spacecraft model with a real, visible attitude (no CK
// binary needed). Annotations come from the arc boundaries plus a SPICE-found
// closest approach; the overlay reads the live telemetry adapter series.

test('attitude is data-driven, annotations scrub, and the telemetry overlay renders', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  const viewport = page.getByTestId('viewport');
  await expect(viewport).toHaveAttribute('data-ready', 'true');

  // Load the native catalog with a spacecraft; the generic builder rebuilds the scene.
  await page.getByTestId('mission-menu').click();
  await page.getByTestId('catalog-file-input').setInputFiles('e2e/fixtures/native-cassini.json');
  await expect(page.getByTestId('select-Probe')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 30_000 });

  const after = await frameStats(viewport);
  expect(after.nonBackground).toBeGreaterThan(200);

  // D1: the spacecraft attitude is real and data-driven. The store publishes the
  // applied quaternion (so it is present, not absent), and playing the clock makes
  // the declared UniformRotation spin advance it (a genuine, visible orientation,
  // not a static placeholder).
  await expect
    .poll(async () => (await viewport.getAttribute('data-sc-quat')) ?? '', { timeout: 10_000 })
    .not.toBe('');
  const q1 = await viewport.getAttribute('data-sc-quat');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect
    .poll(async () => (await viewport.getAttribute('data-sc-quat')) ?? '', { timeout: 10_000 })
    .not.toBe(q1);

  // D2: a SPICE-derived timeline annotation marker is clickable and scrubs the clock.
  const startMarker = page.getByTestId('marker-arc-0-start');
  await expect(startMarker).toBeVisible();
  await page.getByRole('button', { name: 'Pause' }).click();
  const epochBefore = await viewport.getAttribute('data-epoch');
  await page.getByTestId('marker-periapsis').click();
  await expect
    .poll(async () => (await viewport.getAttribute('data-epoch')) ?? '', { timeout: 5_000 })
    .not.toBe(epochBefore);

  // B8: the timeline shows the next upcoming event, and the go-to-epoch field jumps
  // the clock to a typed epoch (parsed via SPICE).
  await expect(page.getByTestId('next-event')).toBeVisible();
  const epochAtMarker = await viewport.getAttribute('data-epoch');
  await page.getByTestId('goto-epoch').fill('2004-06-25T00:00:00');
  await page.getByTestId('goto-epoch').press('Enter');
  await expect
    .poll(async () => (await viewport.getAttribute('data-epoch')) ?? '', { timeout: 5_000 })
    .not.toBe(epochAtMarker);

  // D3: the predicted-versus-actual overlay renders with the series, residual,
  // threshold, and a now-line. SVG primitives are asserted by attachment (a flat
  // polyline has a zero-height bounding box, which Playwright reports as hidden).
  await page.getByRole('button', { name: 'Play' }).click();
  await openAnalyze(page, 'report-compare');
  await expandCard(page, 'compare');
  await expect(page.getByTestId('telemetry-overlay')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('telemetry-residual-line')).toBeAttached();
  await expect(page.getByTestId('telemetry-threshold-line')).toBeAttached();
  await expect(page.getByTestId('telemetry-now-line')).toBeAttached();
  // The overlay reads the live adapter series: a numeric residual readout appears.
  await expect(page.getByTestId('telemetry-severity')).toContainText('km', { timeout: 10_000 });

  // Accessibility: the new surfaces add no serious or critical violations.
  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrCritical = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    seriousOrCritical,
    JSON.stringify(seriousOrCritical.map((v) => ({ id: v.id, impact: v.impact })), null, 2),
  ).toEqual([]);

  // The overlay must stay AA-clean in the light theme too: the selene tile value
  // colors are theme-reactive tokens (not baked dark hex), so they remain legible on
  // the light surface. Scoped to the overlay so unrelated app chrome is out of scope.
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  // The Analyze dock does not auto-dismiss, so the Compare overlay is still mounted on
  // the Report & Compare tab; ensure it is selected and its card expanded for the scan.
  await openAnalyze(page, 'report-compare');
  await expandCard(page, 'compare');
  await expect(page.getByTestId('telemetry-overlay')).toBeVisible({ timeout: 10_000 });
  const lightResults = await new AxeBuilder({ page })
    .include('[data-testid="telemetry-overlay"]')
    .analyze();
  const lightSeriousOrCritical = lightResults.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    lightSeriousOrCritical,
    JSON.stringify(lightSeriousOrCritical.map((v) => ({ id: v.id, impact: v.impact })), null, 2),
  ).toEqual([]);
});
