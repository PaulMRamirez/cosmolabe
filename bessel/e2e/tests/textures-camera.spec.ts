import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { frameStats } from './frame-stats.ts';
import { expandCamera } from './sample.ts';

// Cosmographia rendering/camera parity (Track B): three closing items, each
// surfaced in the UI and asserted deterministically, with the axe a11y scan.
//
//  1. Real planetary imagery loads at runtime through the auto-download + OPFS
//     cache manager (the Solar System Scope equirectangular set), with the
//     procedural fallback retained. The actual NASA/SSS hosts are unreachable in
//     the headless CI sandbox, so the network is MOCKED here: page.route fulfills
//     every texture request with a tiny valid PNG. This proves the manager +
//     swap path deterministically; the live fetch is exercised by the unit tests
//     for the manager (fetch/cache/decode/fallback) in @bessel/scene.
//  2. The camera can lock to an arbitrary SPICE reference frame (IAU_EARTH),
//     beyond orbit/sync/track.
//  3. Richer camera-motion verbs (dolly and crane) are available and move the
//     rendered frame.

// A small opaque 8x8 RGB PNG (a checker), base64-decoded at fulfill time. It
// stands in for the equirectangular base map; only the decode + material swap is
// under test here, not pixel fidelity.
const PNG_8X8_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAGUlEQVR4nGPQCFhwImABJsmAVRRIMgxKHQAg1VoBLRCNBAAAAABJRU5ErkJggg==';

test('real imagery loads (mocked), camera locks to a SPICE frame, and dolly/crane move the view', async ({
  page,
}) => {
  // Mock every Solar System Scope texture fetch with a tiny valid PNG so the
  // auto-download + decode + material-swap path runs offline and deterministically.
  await page.route(/solarsystemscope\.com\/textures\//, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      // The real CC-BY host serves cross-origin imagery with permissive CORS;
      // mirror that here so the cross-origin fetch is readable in the browser.
      headers: { 'access-control-allow-origin': '*' },
      body: Buffer.from(PNG_8X8_BASE64, 'base64'),
    });
  });

  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  const viewport = page.getByTestId('viewport');
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  // Imagery starts off: bodies are procedural.
  await expect(viewport).toHaveAttribute('data-real-imagery', 'false');

  // (1) Enable real imagery via the Layers toggle and assert the swap happened.
  await page.getByTestId('layers-popover').click();
  await page.getByTestId('setting-realImagery').check();
  await expect(viewport).toHaveAttribute('data-real-imagery', 'true', { timeout: 30_000 });
  // Close the layers popover so it does not overlap later interactions.
  await page.keyboard.press('Escape');

  // The textured scene still renders a non-empty WebGL frame.
  await page.waitForTimeout(300);
  const imageryFrame = await frameStats(viewport);
  expect(imageryFrame.nonBackground).toBeGreaterThan(200);

  // (2) Lock the camera to an arbitrary SPICE reference frame. The camera controls
  // live in the collapsible Camera panel; expand it, switch to Frame mode, then pick
  // IAU_EARTH; the viewport reflects the active mode.
  await expandCamera(page);
  await page.getByTestId('camera-mode-frame').click();
  await expect(viewport).toHaveAttribute('data-cam-mode', 'frame');
  await page.getByTestId('camera-frame-select').selectOption('IAU_EARTH');
  await expect(page.getByTestId('camera-frame-select')).toHaveValue('IAU_EARTH');
  // The locked-frame scene keeps rendering a non-empty frame.
  await page.waitForTimeout(300);
  expect((await frameStats(viewport)).nonBackground).toBeGreaterThan(200);

  // (3) Dolly and crane move the camera: each verb changes the rendered frame.
  // Return to Orbit so the moves read against a stable framing.
  await page.getByTestId('camera-mode-orbit').click();
  await page.waitForTimeout(300);
  const beforeMove = await frameStats(viewport);
  await page.getByTestId('camera-dolly-in').click();
  await page.waitForTimeout(400);
  const afterDolly = await frameStats(viewport);
  expect(afterDolly.signature).not.toBe(beforeMove.signature);

  await page.getByTestId('camera-crane-up').click();
  await page.waitForTimeout(400);
  const afterCrane = await frameStats(viewport);
  expect(afterCrane.signature).not.toBe(afterDolly.signature);

  // a11y: no serious or critical violations on the parity surface.
  const a11y = await new AxeBuilder({ page }).analyze();
  const seriousOrCritical = a11y.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(seriousOrCritical).toEqual([]);
});
