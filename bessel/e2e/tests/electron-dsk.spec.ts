import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { frameStats } from './frame-stats.ts';

// Phase 3 acceptance (SPEC Section 9): a Playwright Electron test that loads a
// meta-kernel and renders a DSK body. The desktop app resolves the fixture
// meta-kernel through the typed IPC bridge, reads its DSK shape model, and renders
// it; this asserts a non-empty WebGL frame and that real plates were read.

const mainJs = fileURLToPath(new URL('../../apps/desktop/out/main/main.js', import.meta.url));
const kernelRoot = fileURLToPath(new URL('../../kernels/fixtures', import.meta.url));

test.describe('desktop DSK rendering', () => {
  let app: ElectronApplication;

  test.beforeAll(async () => {
    if (!existsSync(mainJs)) {
      throw new Error(`Electron build missing at ${mainJs}; run pnpm build:desktop first.`);
    }
    app = await electron.launch({
      args: [mainJs],
      env: { ...process.env, BESSEL_KERNEL_ROOT: kernelRoot },
    });
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test('loads a meta-kernel and renders a DSK body', async () => {
    const page = await app.firstWindow();
    await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

    const viewport = page.getByTestId('viewport');
    // The DSK was read and meshed: real plates, a non-empty render.
    const plates = Number(await viewport.getAttribute('data-dsk-plates'));
    expect(plates).toBeGreaterThan(100);

    const stats = await frameStats(viewport);
    expect(stats.nonBackground).toBeGreaterThan(200);
  });
});
