import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The scripting console surfaces the Cosmographia cosmoscripting verb set in the
// app. A program typed into the console drives the live viewer: gotoObject moves
// the camera focus and setTimeRate changes the playback rate, and each executed
// verb is echoed to the output. It must pass the axe a11y scan.

test('the scripting console runs a cosmoscripting program against the viewer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await page.getByTestId('welcome-explore').click();

  // Open the Script popover from the right-side actions group.
  await page.getByTestId('script-menu').click();
  const input = page.getByTestId('script-input');
  await expect(input).toBeVisible();

  await input.fill('gotoObject Earth\nsetTimeRate 3600');
  await page.getByTestId('script-run').click();

  // The camera focus follows gotoObject, and the playback rate follows setTimeRate.
  await expect.poll(async () =>
    page.getByTestId('viewport').getAttribute('data-cam-target'),
  ).toBe('Earth');
  const rateSelect = page.getByLabel('Playback rate, seconds of mission time per second');
  await expect(rateSelect).toHaveValue('3600');

  // The output echoes both executed verbs.
  const output = await page.getByTestId('script-output').textContent();
  expect(output).toContain('gotoObject Earth');
  expect(output).toContain('setTimeRate 3600');
});

test('the scripting console saves, reloads, and runs a named script with Cmd+Enter', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await page.getByTestId('welcome-explore').click();

  await page.getByTestId('script-menu').click();
  const input = page.getByTestId('script-input');
  await input.fill('gotoObject Mars\nsetTimeRate 60');

  // Save the program under a name, then edit the editor away from it.
  await page.getByTestId('script-name').fill('mars-run');
  await page.getByTestId('script-save').click();
  await input.fill('pause');

  // Reloading the saved script from the menu restores its source.
  await page.getByTestId('script-load').selectOption('mars-run');
  await expect(input).toHaveValue('gotoObject Mars\nsetTimeRate 60');

  // Cmd/Ctrl+Enter in the editor runs without clicking the button.
  await input.focus();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(async () =>
    page.getByTestId('viewport').getAttribute('data-cam-target'),
  ).toBe('Mars');
  const output = await page.getByTestId('script-output').textContent();
  expect(output).toContain('gotoObject Mars');
});

test('the scripting console reports a bad line loudly without aborting prior verbs', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await page.getByTestId('welcome-explore').click();

  await page.getByTestId('script-menu').click();
  await page.getByTestId('script-input').fill('gotoObject Earth\nwarpDrive');
  await page.getByTestId('script-run').click();

  const output = await page.getByTestId('script-output').textContent();
  expect(output).toContain('gotoObject Earth');
  expect(output).toContain('error on line 2');
  expect(output).toContain('unknown verb "warpDrive"');
});

test('the scripting console has no serious or critical accessibility violations', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await page.getByTestId('welcome-explore').click();
  await page.getByTestId('script-menu').click();
  await expect(page.getByTestId('script-input')).toBeVisible();

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
