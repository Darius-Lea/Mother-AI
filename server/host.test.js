import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedHostHeader } from './index.js';

for (const host of ['localhost', 'localhost:5173', 'LOCALHOST:3001', '127.0.0.1:3001', '[::1]:3001', '192.168.1.10:3001', '10.0.0.2', '8.8.8.8:80']) {
  test(`accepts local/literal Host ${host}`, () => assert.equal(isAllowedHostHeader(host), true));
}
for (const host of ['evil.example', 'evil.example:3001', 'localhost.evil.example:3001', 'evil.localhost', 'evil@127.0.0.1', '127.0.0.1/evil', '127.0.0.1#evil', '127.0.0.1?evil', 'localhost,evil.example', undefined, '']) {
  test(`rejects untrusted/malformed Host ${host}`, () => assert.equal(isAllowedHostHeader(host), false));
}
test('custom hostnames are exact and require explicit valid configuration', () => {
  assert.equal(isAllowedHostHeader('mother.example.org:3001', ['mother.example.org']), true);
  assert.equal(isAllowedHostHeader('mother.example.org', ['MOTHER.EXAMPLE.ORG']), true);
  assert.equal(isAllowedHostHeader('sub.mother.example.org', ['mother.example.org']), false);
  assert.equal(isAllowedHostHeader('mother.example.org', ['https://mother.example.org', '*.example.org', 'mother.example.org:3001']), false);
});
