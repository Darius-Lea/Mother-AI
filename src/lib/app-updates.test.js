import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebUpdateMonitor } from './app-updates.js';

const build = { version: '1.0.0-preview.2', buildCommit: 'oldcommit', buildTime: '2026-10-26T12:00:00Z' };
const latest = { version: '1.0.0-preview.2', buildCommit: 'newcommit', buildTime: '2026-10-27T12:00:00Z' };
const response = data => ({ ok: true, json: async () => data });

test('background update checks detect changed builds but never refresh', async () => {
  let reloads = 0, request;
  const monitor = createWebUpdateMonitor({ currentBuild: build, fetchImpl: async (url, options) => { request = {url, options}; return response(latest); }, reload: () => reloads++ });
  assert.equal((await monitor.check()).state, 'available');
  assert.equal(request.url, '/api/health'); assert.equal(request.options.cache, 'no-store');
  assert.equal(reloads, 0); monitor.dispose();
});

test('missing identities, identical commits and older deployments do not offer reload loops', async () => {
  for (const current of [{}, { ...latest, buildCommit: 'oldcommit' }, { ...latest, buildTime: '2026-10-25T00:00:00Z' }]) {
    const monitor = createWebUpdateMonitor({ currentBuild: build, fetchImpl: async () => response(current) });
    assert.equal((await monitor.check()).state, 'current'); monitor.dispose();
  }
});

test('explicit apply waits for service worker activation before one refresh', async () => {
  const events = new EventTarget(); let activation, reloads = 0, updates = 0;
  const registration = { waiting: { postMessage(message) { activation = message; } }, update: async () => { updates++; } };
  const serviceWorker = Object.assign(events, { getRegistration: async () => registration });
  const monitor = createWebUpdateMonitor({ currentBuild: build, fetchImpl: async () => response(latest), serviceWorker, reload: () => reloads++ });
  await monitor.check();
  const applying = monitor.apply();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(activation, { type: 'ACTIVATE_UPDATE' }); assert.equal(reloads, 0);
  events.dispatchEvent(new Event('controllerchange'));
  await applying; assert.equal(reloads, 1); assert.equal(updates, 1); monitor.dispose();
});

test('failed activation keeps the interface open and reports a retryable error', async () => {
  const events = new EventTarget(); let reloads = 0;
  const registration = { waiting: { postMessage() {} }, update: async () => {} };
  const monitor = createWebUpdateMonitor({ currentBuild: build, fetchImpl: async () => response(latest), serviceWorker: Object.assign(events, { getRegistration: async () => registration }), reload: () => reloads++, activationTimeout: 5 });
  await monitor.check(); await monitor.apply();
  assert.equal(monitor.getStatus().state, 'error'); assert.match(monitor.getStatus().error, /Keep working/); assert.equal(reloads, 0); monitor.dispose();
});

test('website without a service worker refreshes only after explicit apply', async () => {
  let reloads = 0;
  const monitor = createWebUpdateMonitor({ currentBuild: build, fetchImpl: async () => response(latest), serviceWorker: null, reload: () => reloads++ });
  await monitor.check(); assert.equal(reloads, 0); await monitor.apply(); assert.equal(reloads, 1); monitor.dispose();
});

test('disposing during activation removes its listener and prevents refresh', async () => {
  const events = new EventTarget(); let reloads = 0;
  const registration = { waiting: { postMessage() {} }, update: async () => {} };
  const monitor = createWebUpdateMonitor({ currentBuild: build, fetchImpl: async () => response(latest), serviceWorker: Object.assign(events, { getRegistration: async () => registration }), reload: () => reloads++ });
  await monitor.check(); const applying = monitor.apply(); await new Promise(resolve => setImmediate(resolve)); monitor.dispose();
  events.dispatchEvent(new Event('controllerchange')); await applying; assert.equal(reloads, 0);
});
