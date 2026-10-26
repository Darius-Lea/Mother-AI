import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
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

test('native CI resolves exactly one target matching each bundled engine architecture',async()=>{
  const require = createRequire(import.meta.url);
  const yaml = require('js-yaml');
  const { normalizeOptions } = require('electron-builder/out/builder.js');
  const { Platform } = require('app-builder-lib');
  const { Arch } = require('builder-util');
  const { computeArchToTargetNamesMap } = require(path.join(path.dirname(require.resolve('app-builder-lib')),'targets','targetFactory.js'));
  const workflow = yaml.load(await readFile(new URL('../.github/workflows/desktop-installers.yml',import.meta.url),'utf8'));
  const configuration = yaml.load(await readFile(new URL('../electron-builder.yml',import.meta.url),'utf8'));
  const job = workflow.jobs.desktop;
  assert.ok(job.steps.find(step=>step.name==='Build native installers').run.includes('${{ matrix.platformFlag }} ${{ matrix.target }}'));
  assert.equal(job.strategy.matrix.include.length,5);
  for (const entry of job.strategy.matrix.include) {
    const flag = entry.platformFlag.slice(2);
    const platform = ({win:Platform.WINDOWS,mac:Platform.MAC,linux:Platform.LINUX})[flag];
    const options = normalizeOptions({[flag]:[entry.target]});
    const targets = computeArchToTargetNamesMap(options.targets.get(platform),{platformSpecificBuildOptions:configuration[flag]},platform);
    assert.deepEqual([...targets.entries()],[[Arch[entry.arch],[entry.target.split(':')[0]]]],`${entry.platform}/${entry.arch} must not include another architecture`);
  }
});
