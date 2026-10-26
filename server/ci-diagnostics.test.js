import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticAnnotation } from '../scripts/ci-diagnostics.mjs';

test('installer annotations contain a bounded final excerpt and escape workflow commands',()=>{
  const lines = Array.from({length:40},(_,index)=>`line ${index}`);
  lines.push('\u001b[31merror: 100% failed\u001b[0m','::warning::injected command');
  const result = diagnosticAnnotation('desktop-build.log',lines.join('\n'));
  assert.ok(result.startsWith('::error title=Installer failure (desktop-build.log)::'));
  assert.ok(!result.includes('line 0'));
  assert.ok(result.includes('100%25 failed%0A::warning::injected command'));
  assert.ok(!result.includes('\n'));
  assert.ok(!result.includes('\u001b'));
  assert.ok(diagnosticAnnotation('desktop-build.log','x'.repeat(100000)).length < 10000);
  assert.throws(()=>diagnosticAnnotation('untrusted,title=wrong','bad'));
});

test('installer annotations redact known secrets, bearer credentials and signed URLs',()=>{
  const result = diagnosticAnnotation('desktop-runtime.log','secret-long-value\nBearer private-token\nhttps://assets.example/file?signature=abcd\nghp_privateToken123',['secret-long-value']);
  for (const secret of ['secret-long-value','private-token','signature=abcd','ghp_privateToken123']) assert.ok(!result.includes(secret));
  assert.ok(result.includes('https://assets.example/file?[redacted]'));
});
