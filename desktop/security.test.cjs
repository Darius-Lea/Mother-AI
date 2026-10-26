'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isAppUrl, isAllowedExternalUrl, officialDownloadUrl, CSP } = require('./security.cjs');

test('desktop URL handling accepts only its application origin', () => {
  assert.equal(isAppUrl('mother://app/'), true);
  assert.equal(isAppUrl('mother://app/api/chat'), true);
  for (const value of ['https://app/', 'mother://evil/', 'mother://app.evil/', 'mother://user@app/', 'mother://app:42/', 'file:///etc/passwd', 'javascript:alert(1)']) {
    assert.equal(isAppUrl(value), false, value);
  }
});
test('external downloads are fixed official HTTPS pages, not arbitrary executables or sites', () => {
  assert.equal(isAllowedExternalUrl('https://ollama.com/download/windows'), true);
  assert.equal(isAllowedExternalUrl('https://github.com/Darius-Lea/Mother-AI'), true);
  for (const value of ['https://ollama.com.evil/download/windows', 'https://evil.com', 'http://ollama.com/download', 'https://user:password@ollama.com/download', 'https://ollama.com/download.exe', 'file:///tmp/a.sh', 'https://github.com/evil/repo']) {
    assert.equal(isAllowedExternalUrl(value), false, value);
  }
  assert.equal(officialDownloadUrl('darwin'), 'https://ollama.com/download/mac');
});
test('CSP rejects remote code, frames, and generic network access', () => {
  assert.match(CSP, /script-src 'self'/);
  assert.match(CSP, /connect-src 'self'/);
  assert.match(CSP, /frame-ancestors 'none'/);
  assert.match(CSP, /'wasm-unsafe-eval'/);
  assert.doesNotMatch(CSP, /(?:^|\s)'unsafe-eval'|https:\/\/\*/);
});

test('desktop download navigation allows only direct preview installers from the approved repository', () => {
  const prefix = 'https://github.com/Darius-Lea/Mother-AI';
  for (const extension of ['exe', 'pkg', 'deb']) assert.equal(isAllowedExternalUrl(`${prefix}/releases/download/mother-preview/Mother-AI-1.0.0-preview.1-win-x64.${extension}`), true);
  for (const suffix of ['/actions', '/tree/main', '/releases/download/production/app.exe', '/releases/download/mother-preview/source.zip', '/releases/download/mother-preview/Mother-AI-1.0.0-win-x64.exe?redirect=evil']) assert.equal(isAllowedExternalUrl(`${prefix}${suffix}`), false);
});
