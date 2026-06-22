import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loadCassiniSample } from './sample.ts';

// Phase 2 acceptance (SPEC Section 9): an accessibility scan with zero serious or
// critical violations on the main view, and a second load that works offline
// against the OPFS kernel cache.

test('the main view has no serious or critical accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrCritical = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    seriousOrCritical,
    JSON.stringify(
      seriousOrCritical.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
      null,
      2,
    ),
  ).toEqual([]);
});

test('object browser, settings, readouts, and multi-select are wired', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  // The Cassini sample focuses Saturn and provides the spacecraft observer the
  // geometry readouts measure from.
  await loadCassiniSample(page);

  // Geometry readout: range to the focused body (Saturn) becomes a finite value.
  await expect
    .poll(async () => (await page.getByTestId('readout-range').textContent()) ?? '', {
      timeout: 10_000,
    })
    .toMatch(/\d/);

  // Multi-object selection via the object browser (distinct from the camera focus).
  await page.getByTestId('select-Earth').click();
  await page.getByTestId('select-Jupiter').click();
  const selection = await page.getByTestId('viewport').getAttribute('data-selection');
  expect(selection).toContain('Earth');
  expect(selection).toContain('Jupiter');

  // Settings toggle flips a checkbox (mapped to a scene layer seam). Visualization
  // toggles live in the canvas "Layers" popover.
  await page.getByTestId('layers-popover').click();
  const stars = page.getByTestId('setting-stars');
  await expect(stars).toBeChecked();
  await stars.click();
  await expect(stars).not.toBeChecked();
  await page.getByTestId('layers-popover').click(); // close the popover

  // Object browser visibility toggle hides a body.
  const saturnVisible = page.getByTestId('visible-Saturn');
  await expect(saturnVisible).toBeChecked();
  await saturnVisible.click();
  await expect(saturnVisible).not.toBeChecked();

  // The epoch defaults to UTC and the time-system selector round-trips through SPICE
  // (et2tdb in the worker), flipping the tag and re-deriving the displayed epoch.
  const viewport = page.getByTestId('viewport');
  await expect(viewport).toHaveAttribute('data-time-system', 'UTC');
  const utcEpoch = await viewport.getAttribute('data-epoch');
  await page.getByTestId('time-system').selectOption('TDB');
  await expect(viewport).toHaveAttribute('data-time-system', 'TDB');
  await expect
    .poll(async () => (await viewport.getAttribute('data-epoch')) ?? '', { timeout: 10_000 })
    .not.toBe(utcEpoch);
});

test('a second load works offline against the OPFS kernel cache', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  // Let the service worker activate (app shell plus wasm precache) and the kernels
  // settle into the OPFS cache.
  await page.evaluate(async () => {
    await navigator.serviceWorker?.ready;
  });
  await page.waitForTimeout(1500);

  await context.setOffline(true);
  await page.reload();

  // The shell and wasm come from the service worker precache; the kernels come
  // from the OPFS cache; no network is available.
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  const ready = await page.getByTestId('viewport').getAttribute('data-ready');
  expect(ready).toBe('true');
});
