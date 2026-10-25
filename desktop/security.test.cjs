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
  assert.doesNotMatch(CSP, /unsafe-eval|https:\/\/\*/);
});
