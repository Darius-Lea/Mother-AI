import { test, expect } from '@playwright/test';

const hardware = { platform: 'win32', arch: 'x64', totalMemoryGiB: 8, cpuCount: 4 };
const status = available => ({ hardware, runtime: { available }, models: [], recommendations: [], activeDownload: null });

test('desktop setup starts its included engine without opening another installer', async ({ page }) => {
  let ready = false;
  let starts = 0;
  await page.exposeFunction('startBundledEngine', () => { starts++; ready = true; return { state: 'ready', available: true, source: 'bundled' }; });
  await page.addInitScript(() => {
    window.motherDesktop = {
      isDesktop: true,
      getRuntimeStatus: async () => ({ state: 'idle', available: false }),
      startRuntime: () => window.startBundledEngine(),
    };
  });
  await page.route('**/api/models', route => route.fulfill({ json: { available: false, models: [] } }));
  await page.route('**/api/setup/status', route => route.fulfill({ json: status(ready) }));
  await page.goto('/');
  const wizard = page.getByRole('dialog');
  await wizard.getByRole('button', { name: 'Get started', exact: false }).click();
  await expect(wizard.getByRole('button', { name: 'Choose a model', exact: false })).toBeDisabled();
  await expect(wizard.locator('a[href*="ollama"]')).toHaveCount(0);
  await wizard.getByRole('button', { name: 'Start local engine', exact: true }).click();
  await expect(wizard.getByText('Local engine is ready', { exact: true })).toBeVisible();
  await expect(wizard.getByRole('button', { name: 'Choose a model', exact: false })).toBeEnabled();
  expect(starts).toBe(1);
});

test('a failed bundled engine stays unavailable and offers a retry', async ({ page }) => {
  await page.addInitScript(() => {
    window.motherDesktop = {
      isDesktop: true,
      getRuntimeStatus: async () => ({ state: 'error', available: false, error: 'The local engine could not start. Please reinstall Mother.' }),
      startRuntime: async () => ({ state: 'error', available: false, error: 'The local engine could not start. Please reinstall Mother.' }),
    };
  });
  await page.route('**/api/models', route => route.fulfill({ json: { available: false, models: [] } }));
  await page.route('**/api/setup/status', route => route.fulfill({ json: status(false) }));
  await page.goto('/');
  const wizard = page.getByRole('dialog');
  await wizard.getByRole('button', { name: 'Get started', exact: false }).click();
  await wizard.getByRole('button', { name: 'Start local engine', exact: true }).click();
  await expect(wizard.getByRole('alert')).toContainText('Please reinstall Mother');
  await expect(wizard.getByRole('button', { name: 'Choose a model', exact: false })).toBeDisabled();
  await expect(wizard.getByRole('button', { name: 'Start local engine', exact: true })).toBeEnabled();
});
