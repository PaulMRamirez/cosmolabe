// Dev screenshot helper: load the running app, wait for the scene to be Ready,
// optionally load the Cassini sample and select bodies, then capture a PNG.
// Usage: node scripts/shot.mjs <out.png> [--cassini] [--select=Saturn,Titan]
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? '/tmp/bessel-shot.png';
const cassini = process.argv.includes('--cassini');
const selectArg = process.argv.find((a) => a.startsWith('--select='));
const url = process.env.SHOT_URL ?? 'http://localhost:5191/';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(url, { waitUntil: 'load' });
await page.getByTestId('status').filter({ hasText: 'Ready' }).waitFor({ timeout: 60_000 });

if (cassini) {
  await page.getByTestId('mission-menu').click(); // catalog loader lives in the Mission menu
  await page
    .getByTestId('catalog-file-input')
    .setInputFiles('apps/web/public/samples/cassini-saturn.json');
  await page.keyboard.press('Escape');
  await page.getByTestId('select-Cassini').waitFor({ timeout: 30_000 });
  await page.getByTestId('status').filter({ hasText: 'Ready' }).waitFor({ timeout: 30_000 });
}

if (selectArg) {
  for (const id of selectArg.slice('--select='.length).split(',')) {
    await page.getByTestId(`select-${id}`).click();
  }
}

const clickArg = process.argv.find((a) => a.startsWith('--click='));
if (clickArg) {
  for (const id of clickArg.slice('--click='.length).split(',')) {
    await page.getByTestId(id).click();
  }
}

await page.waitForTimeout(1200); // let the scene settle
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out);
