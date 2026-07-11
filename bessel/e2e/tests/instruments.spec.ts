import { test, expect, type Locator, type Page } from '@playwright/test';
import { loadCassiniSample } from './sample.ts';

// Phase 1 acceptance (SPEC Section 9): FOV cone rendering and footprint rendering
// on the Cassini sample mission. The FOV cone (cyan) comes from getfov; the
// footprint (yellow) comes from sincpt onto Saturn.

interface ColorStats {
  cyan: number;
  magenta: number;
  total: number;
}

async function colorStats(viewport: Locator): Promise<ColorStats> {
  return viewport.evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const ctx = off.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0);
    const { data } = ctx.getImageData(0, 0, off.width, off.height);
    let cyan = 0;
    let magenta = 0;
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (r > 24 || g > 24 || b > 24) total += 1;
      // FOV cone: blue dominant and bright.
      if (b > 70 && b >= g && b > r + 15) cyan += 1;
      // Footprint highlight: red and blue high, green low (magenta), distinct from
      // Saturn's tan surface (blue below green) and the cyan cone (low red).
      if (r > 140 && b > 110 && b > g + 20) magenta += 1;
    }
    return { cyan, magenta, total };
  });
}

// Scrub the timeline to roughly Saturn orbit insertion, where the geometry is
// compact and both the FOV cone and footprint sit clearly on Saturn.
async function scrubToSoi(page: Page): Promise<void> {
  await page.getByTestId('scrub').evaluate((el) => {
    const input = el as HTMLInputElement;
    const min = Number(input.min);
    const max = Number(input.max);
    const soi = min + (max - min) * 0.15;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, String(soi));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test.describe('Cassini instruments', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
    await loadCassiniSample(page);
    await scrubToSoi(page);
    await page.waitForTimeout(300);
  });

  test('FOV cone renders when instruments are enabled', async ({ page }) => {
    const viewport = page.getByTestId('viewport');
    const before = await colorStats(viewport);
    await page.getByTestId('instrument-show-CASSINI_ISS_WAC').click();
    await page.waitForTimeout(800);
    const after = await colorStats(viewport);
    // The cyan FOV cone adds a visible translucent region over the blue baseline
    // (trajectory and axis triad). The cone contributes a few hundred cyan pixels.
    expect(after.cyan).toBeGreaterThan(before.cyan + 120);
  });

  test('footprint renders on Saturn from a surface intercept', async ({ page }) => {
    const viewport = page.getByTestId('viewport');
    await page.getByTestId('instrument-show-CASSINI_ISS_WAC').click();
    // The footprint is computed asynchronously via sincpt; wait for points.
    await expect
      .poll(async () => Number(await viewport.getAttribute('data-footprint-points')), {
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(3);
    await page.waitForTimeout(300);
    const stats = await colorStats(viewport);
    expect(stats.magenta).toBeGreaterThan(50);
  });

  test('co-located FOV and Footprint toggles appear with instruments and stay in sync', async ({
    page,
  }) => {
    // Hidden until instruments are shown.
    await expect(page.getByTestId('toggle-fov')).toHaveCount(0);
    await expect(page.getByTestId('toggle-footprint')).toHaveCount(0);

    await page.getByTestId('instrument-show-CASSINI_ISS_WAC').click();
    await expect(page.getByTestId('toggle-fov')).toBeVisible();
    await expect(page.getByTestId('toggle-footprint')).toBeVisible();
    await expect(page.getByTestId('toggle-fov')).toHaveAttribute('aria-pressed', 'true');

    // The co-located pill drives the same setting as the Layers checkbox (one source).
    await page.getByTestId('toggle-fov').click();
    await expect(page.getByTestId('toggle-fov')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('layers-popover').click();
    await expect(page.getByTestId('setting-fov')).not.toBeChecked();
  });
});

test.describe('instrument selector', () => {
  test('a multi-instrument mission switches the active sensor via per-row eyes', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

    // Load a mission declaring two ISS sensors (both defined in the bundled IK).
    await page.getByTestId('mission-menu').click();
    await page.getByTestId('catalog-file-input').setInputFiles('e2e/fixtures/two-instruments.json');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('select-Cassini')).toBeVisible({ timeout: 30_000 });

    // Each instrument is its own row; its eye shows that sensor's FOV. Showing WAC marks
    // its eye checked and leaves NAC unchecked (only one sensor is the active one).
    const wac = page.getByTestId('instrument-show-CASSINI_ISS_WAC');
    const nac = page.getByTestId('instrument-show-CASSINI_ISS_NAC');
    await wac.click();
    await expect(wac).toHaveAttribute('aria-checked', 'true');
    await expect(nac).toHaveAttribute('aria-checked', 'false');

    // Showing NAC switches the active sensor: NAC becomes checked and WAC clears.
    await nac.click();
    await expect(nac).toHaveAttribute('aria-checked', 'true');
    await expect(wac).toHaveAttribute('aria-checked', 'false');
  });
});
