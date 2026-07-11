import { test, expect } from '@playwright/test';
import { loadCassiniSample } from './sample.ts';

// Timeline UX: the transport cluster navigates the loaded window without dragging
// the slider. Jump-to-start/end land on the bounds (and disable there); a step moves
// off the bound and re-enables the opposite end.

test('the transport jumps to the window start and end and steps within it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);

  const toStart = page.getByTestId('timeline-to-start');
  const toEnd = page.getByTestId('timeline-to-end');
  const epoch = page.getByTestId('epoch');
  const initial = await epoch.textContent();

  // Jump to the end of the window: the end controls disable, and the epoch advances
  // (the label is pushed on the next frame tick, so poll for it).
  await toEnd.click();
  await expect(toEnd).toBeDisabled();
  await expect(toStart).toBeEnabled();
  await expect.poll(async () => epoch.textContent()).not.toBe(initial);
  const endEpoch = await epoch.textContent();

  // Jump to the start: the start controls disable and the epoch returns to the start.
  await toStart.click();
  await expect(toStart).toBeDisabled();
  await expect(toEnd).toBeEnabled();
  await expect.poll(async () => epoch.textContent()).not.toBe(endEpoch);

  // A single forward step moves off the start, re-enabling the start controls.
  await page.getByTestId('timeline-step-forward').click();
  await expect(toStart).toBeEnabled();
});

test('the scrub track labels the loaded window start and end', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);

  // The Cassini sample window spans late June to late August 2004 (the labels track
  // the SPK coverage, which sits just inside the nominal arc), and both ends show.
  const bounds = page.getByTestId('scrub-bounds');
  await expect(bounds).toContainText('2004-06', { timeout: 10_000 });
  await expect(bounds).toContainText('2004-08');
});
