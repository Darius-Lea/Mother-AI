import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const temporary = await mkdtemp(path.join(tmpdir(), 'mother-desktop-smoke-'));
const executablePath = process.env.MOTHER_DESKTOP_EXECUTABLE || path.resolve('node_modules/electron/dist/electron');
const appArgument = process.env.MOTHER_DESKTOP_EXECUTABLE ? [] : [path.resolve('.')];
const launch = () => electron.launch({
  executablePath,
  args: [...appArgument, '--no-sandbox', '--enable-unsafe-swiftshader', ...(process.env.DISPLAY ? [] : ['--ozone-platform=headless'])],
  env: { ...process.env, MOTHER_DESKTOP_TEST: '1', MOTHER_DESKTOP_USER_DATA: temporary, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || path.join(temporary, 'cache') },
  timeout: 60_000,
});
let running;
try {
  running = await launch();
  let window = await running.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  assert.equal(new URL(window.url()).origin, 'null'); // URL's standard parser does not assign an HTTP origin to mother:.
  assert.equal(window.url().startsWith('mother://app/'), true);
  const checks = await window.evaluate(async () => {
    const health = await fetch('/api/health').then(response => response.json());
    const models = await fetch('/api/models');
    const info = await window.motherDesktop.getSystemInfo();
    const headers = await fetch('/').then(response => response.headers.get('content-security-policy'));
    localStorage.setItem('mother-desktop-smoke', 'persists');
    return { health, modelsStatus: models.status, info, csp: headers, nodeAccess: typeof require, processAccess: typeof process, bridgeKeys: Object.keys(window.motherDesktop) };
  });
  assert.equal(checks.health.ok, true);
  assert.equal(checks.modelsStatus, 200);
  assert.equal(checks.info.desktop, true);
  assert.equal(checks.nodeAccess, 'undefined');
  assert.equal(checks.processAccess, 'undefined');
  assert.ok(!checks.bridgeKeys.some(key => /token|exec|shell|readFile/.test(key)));
  assert.match(checks.csp, /connect-src 'self'/);
  const connection = await window.evaluate(async () => fetch('/api/integrations/info').then(response => response.json()));
  assert.ok(connection.baseUrl?.startsWith('http://127.0.0.1:'));
  const denied = await fetch(`${connection.baseUrl}/api/models`);
  assert.equal(denied.status, 401);
  const unavailable = await window.evaluate(async () => fetch('/api/setup/status').then(response => response.json()));
  assert.equal(typeof unavailable.runtime.available, 'boolean');
  if (process.env.MOTHER_DESKTOP_SCREENSHOT) await window.screenshot({ path: process.env.MOTHER_DESKTOP_SCREENSHOT });
  await running.close(); running = undefined;
  running = await launch();
  window = await running.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  assert.equal(await window.evaluate(() => localStorage.getItem('mother-desktop-smoke')), 'persists');
  console.log('Desktop smoke passed: stable origin and persisted memory, actual API, restricted bridge, isolated renderer, session-token gate, and setup status.');
} finally {
  await running?.close();
  await rm(temporary, { recursive: true, force: true });
}
