import { test, expect } from '@playwright/test';
import { loadCassiniSample, openAnalyze, expandCard } from './sample.ts';

// The consolidated Analyze dock is pinnable: unlike the former popovers it stays
// mounted and keeps its results across tab switches, canvas clicks, and timeline
// scrubbing, and it does not auto-dismiss on Escape. This is the locked UX guarantee
// the auto-dismissing popovers could not give.

test('the Analyze dock keeps results across tab switches, canvas clicks, and scrubbing', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);

  // Compute an eclipse on the Lighting & Geometry tab (expand its TaskCard first).
  await openAnalyze(page, 'lighting-geometry');
  await expandCard(page, 'eclipse');
  await page.getByTestId('compute-eclipse').click();
  await expect(page.getByTestId('eclipse-result')).toBeVisible({ timeout: 20_000 });

  // Switch to another tab and back; the eclipse result is still in the store (it is not
  // recomputed). The card collapses on the round trip (panel state resets), so re-expand
  // it to confirm the result re-renders from state with no recompute.
  await page.getByTestId('tab-conjunction').click();
  await expect(page.getByTestId('eclipse-result')).toHaveCount(0);
  await page.getByTestId('tab-lighting-geometry').click();
  await expandCard(page, 'eclipse');
  await expect(page.getByTestId('eclipse-result')).toBeVisible();

  // Clicking the canvas and scrubbing the timeline do not dismiss the dock or its result.
  await page.getByTestId('viewport').click({ position: { x: 80, y: 80 } });
  await expect(page.getByTestId('analyze-workbench')).toBeVisible();
  await expect(page.getByTestId('eclipse-result')).toBeVisible();
  const scrub = page.getByTestId('scrub');
  await scrub.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('analyze-workbench')).toBeVisible();

  // Escape does not close the dock (no auto-dismiss); only the explicit close does.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('analyze-workbench')).toBeVisible();
  await page.getByTestId('analyze-close').click();
  await expect(page.getByTestId('analyze-workbench')).toHaveCount(0);
});

test('the workbench exposes the six intent-named domain tabs with keyboard arrow nav', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  // The dock opens on the default Orbit & Maneuver tab; all six domain tabs are present.
  await openAnalyze(page, 'orbit-maneuver');
  const tabs = [
    'orbit-maneuver',
    'lighting-geometry',
    'access-comms',
    'conjunction',
    'coverage',
    'report-compare',
  ];
  for (const id of tabs) {
    await expect(page.getByTestId(`tab-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId('tab-orbit-maneuver')).toHaveAttribute('aria-selected', 'true');

  // Roving-tabindex arrow nav: focus the active tab, ArrowRight moves selection forward,
  // ArrowLeft wraps back. role=tab/tablist/tabpanel machinery is preserved.
  await page.getByTestId('tab-orbit-maneuver').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('tab-lighting-geometry')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('tab-access-comms')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('tab-lighting-geometry')).toHaveAttribute('aria-selected', 'true');
});

test('the AnalysisLauncher search jumps to the owning tab and expands the card', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);

  // From any tab, searching an intent surfaces matching cards; selecting one switches to
  // the owning tab and expands that card so its tool is ready to run.
  await openAnalyze(page, 'orbit-maneuver');
  await page.getByTestId('analysis-launcher').fill('eclipse');
  await page.getByTestId('launcher-result-eclipse').click();
  await expect(page.getByTestId('tab-lighting-geometry')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('taskcard-eclipse-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('compute-eclipse')).toBeVisible();
});

test('a mission-profile preset switches to its persona home tab and pre-expands its cards', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);

  // The preset chips are an accelerator over the workflow IA. From the default tab, clicking
  // SSA switches to the Conjunction tab and pre-expands its primary cards (catalog screen +
  // closest approach). The presets hide nothing; the tabs stay reachable normally.
  await openAnalyze(page, 'orbit-maneuver');
  await expect(page.getByTestId('mission-presets')).toBeVisible();
  await page.getByTestId('mission-preset-SSA').click();
  await expect(page.getByTestId('tab-conjunction')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('mission-preset-SSA')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('taskcard-catalog-screen-toggle')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.getByTestId('taskcard-closest-approach-toggle')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});
