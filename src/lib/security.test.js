import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewSource, compareDigest} from './security.js';

test('source review reports risky operations with accurate lines and without leaking credentials', () => {
  const sample = 'const apiKey = "synthetic-example-not-a-real-key";\nresult.innerHTML = input;\nfetch(url);';
  const report = reviewSource(sample);
  assert.equal(report.lines, 3);
  assert.ok(report.findings.some(f => f.rule === 'embedded-secret' && f.line === 1));
  assert.ok(report.findings.some(f => f.rule === 'html-insertion' && f.line === 2));
  assert.equal(JSON.stringify(report).includes('synthetic-example-not-a-real-key'), false);
});

test('source review handles common unsafe patterns and leaves plain text rendering unflagged', () => {
  const report = reviewSource('subprocess.run(command, shell=True)\nrequests.get(url, verify=False)\npickle.loads(data)\nview.textContent = value;');
  assert.deepEqual(report.findings.map(f => f.rule), ['shell-command', 'tls-disabled', 'unsafe-deserialization']);
  assert.equal(reviewSource('const answer = 42;\nview.textContent = answer;').findings.length, 0);
});

test('review bounds untrusted inputs', () => {
  assert.throws(() => reviewSource(null), /text/);
  assert.throws(() => reviewSource('x'.repeat(200_001)), /200,000/);
});

test('digest comparison distinguishes malformed, different, and matching expected hashes', () => {
  const digest = 'a'.repeat(64);
  assert.equal(compareDigest(digest, ''), 'empty');
  assert.equal(compareDigest(digest, 'bad'), 'invalid');
  assert.equal(compareDigest(digest, 'b'.repeat(64)), 'mismatch');
  assert.equal(compareDigest(digest, ` ${digest.toUpperCase()} `), 'match');
});
