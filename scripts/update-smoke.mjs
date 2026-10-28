import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Real application bridge + fixed public catalog. Never launch an installer or
// replace transport/URLs through a production test IPC endpoint.
const temporary = await mkdtemp(path.join(os.tmpdir(), 'mother-update-smoke-'));
let running;
try {
  const executablePath = process.env.MOTHER_DESKTOP_EXECUTABLE || path.resolve('node_modules/electron/dist/electron');
  running = await electron.launch({
    executablePath,
    args: [...(process.env.MOTHER_DESKTOP_EXECUTABLE ? [] : [path.resolve('.')]), '--no-sandbox', '--enable-unsafe-swiftshader', ...(process.env.DISPLAY ? [] : ['--ozone-platform=headless'])],
    env: { ...process.env, MOTHER_DESKTOP_TEST: '1', MOTHER_DESKTOP_USER_DATA: temporary, XDG_CACHE_HOME: path.join(temporary, 'cache') },
    timeout: 60000,
  });
  const window = await running.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  const result = await window.evaluate(async () => {
    const states = [];
    const unsubscribe = window.motherDesktop.onUpdateStatus(status => states.push(status.state));
    try {
      const before = await window.motherDesktop.getUpdateStatus();
      const checked = await window.motherDesktop.checkForUpdates();
      const after = await window.motherDesktop.getUpdateStatus();
      const info = await window.motherDesktop.getSystemInfo();
      return { before, checked, after, states, appVersion: info.appVersion };
    } finally { unsubscribe(); }
  });
  assert.equal(result.before.source, 'desktop');
  assert.equal(result.checked.installedVersion, result.appVersion);
  assert.ok(['current', 'available'].includes(result.checked.state), result.checked.error || `Unexpected updater state: ${result.checked.state}`);
  assert.equal(result.after.state, result.checked.state);
  assert.equal(result.checked.error, null);
  assert.ok(!Object.keys(result.checked).some(key => /path|url|token/i.test(key)), 'Update status exposed private transport details.');
  if (result.checked.state === 'available') {
    assert.match(result.checked.availableCommit, /^[a-f0-9]{40}$/);
    assert.ok(result.checked.total > 1024 * 1024);
    assert.equal(result.checked.progress, 0);
  }
  console.log(`Actual desktop updater smoke passed: authenticated narrow bridge checked the fixed public catalog with normal TLS; ${result.appVersion} is ${result.checked.state}. No installer downloaded or opened.`);
} finally {
  await running?.close();
  await rm(temporary, { recursive: true, force: true });
}
