import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { publicationPlan, publishPreview } from '../scripts/publish-preview.mjs';

const commit = 'a'.repeat(40);
const base = 'https://github.com/Darius-Lea/Mother-AI/releases/download/mother-preview';
const version = '1.0.0-preview.1';
const payload = Buffer.alloc(1024 * 1024, 42);
const digest = createHash('sha256').update(payload).digest('hex');
const manifest = () => ({ version, artifacts: [
  ['win','windows','x64','exe'], ['win','windows','arm64','exe'],
  ['mac','mac','x64','pkg'], ['mac','mac','arm64','pkg'], ['linux','linux','x64','deb'],
].map(([name,platform,architecture,format]) => {
  // electron-builder's Debian target names x64 packages "amd64".
  const filename = `Mother-AI-${version}-${name}-${format === 'deb' && architecture === 'x64' ? 'amd64' : architecture}.${format}`;
  return { filename, version, platform, architecture, format, size: payload.length, sha256: digest, downloadUrl: `${base}/${filename}`, signing: 'unsigned', kind: 'installer', nativeInstallTested: false };
}) });

test('preview catalog uses immutable content-addressed installers and excludes private build paths', () => {
  const input = manifest();
  input.artifacts[0].relativePath = 'builds/private-path.exe';
  const result = publicationPlan(input,commit);
  assert.equal(result.manifest.channel,'preview');
  assert.equal(result.manifest.sourceCommit,commit);
  assert.equal(result.uploads[0].relativePath,'builds/private-path.exe');
  for (const item of result.manifest.artifacts) {
    assert.ok(item.filename.includes(`-${digest.slice(0,12)}.`));
    assert.equal(item.downloadUrl,`${base}/${item.filename}`);
    assert.equal(item.relativePath,undefined);
    assert.equal(item.nativeInstallTested,false);
  }
  const deb = result.manifest.artifacts.find(item=>item.format==='deb');
  assert.equal(deb.architecture,'x64');
  assert.equal(deb.filename,`Mother-AI-${version}-linux-amd64-${digest.slice(0,12)}.deb`);
});

test('publisher rejects missing targets, mismatched metadata and non-installer links', () => {
  assert.throws(()=>publicationPlan({...manifest(),artifacts:manifest().artifacts.slice(1)},commit),/All five/);
  assert.throws(()=>publicationPlan(manifest(),'main'),/exact source commit/);
  for (const mutate of [
    item=>{item.downloadUrl='https://evil.example/Mother.exe';},
    item=>{item.platform='mac';},
    item=>{item.architecture='arm64';},
    item=>{item.filename='../Mother.exe';},
    item=>{item.kind='portable';},
    item=>{item.nativeInstallTested=true;},
    item=>{item.signing='signed';},
    item=>{item.sha256='f00';},
  ]) {
    const input = manifest(); mutate(input.artifacts[0]);
    assert.throws(()=>publicationPlan(input,commit));
  }
});

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(),'mother-publish-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const input = manifest();
  for (const item of input.artifacts) await writeFile(path.join(directory,item.filename),payload);
  await writeFile(path.join(directory,'downloads.json'),JSON.stringify(input));
  return { directory, input };
}

function github({ advance = false, initiallyStale = false, stable = false, uploadFails = false, previousCatalog = true, completedInstallers = false } = {}) {
  const calls = [];
  let branchChecks = 0;
  const release = { id: 7, tag_name: 'mother-preview', prerelease: !stable, draft: false };
  const fetchImpl = async (url,options) => {
    const method = options.method || 'GET';
    calls.push({ url, method });
    if (url.endsWith('/git/ref/heads/main')) return Response.json({object:{sha:initiallyStale || ++branchChecks > 1 && advance ? 'b'.repeat(40) : commit}});
    if (url.endsWith('/releases/tags/mother-preview')) return Response.json(release);
    if (url.includes('/assets?per_page=')) return Response.json([
      ...(previousCatalog ? [{id:99,name:'downloads.json'}] : []),
      ...(completedInstallers ? publicationPlan(manifest(),commit).uploads.map(item=>({name:item.filename,size:item.size,state:'uploaded',digest:`sha256:${item.sha256}`})) : []),
    ]);
    if (url.includes('uploads.github.com')) {
      const name = new URL(url).searchParams.get('name');
      if (uploadFails && name !== 'downloads.json') return new Response(null,{status:503});
      if (name === 'downloads.json') calls.at(-1).catalog = JSON.parse(options.body.toString());
      else for await (const _chunk of options.body) { /* consume file stream like fetch */ }
      return Response.json({name,size:Number(options.headers['Content-Length']),state:'uploaded'});
    }
    if (method === 'DELETE') return new Response(null,{status:204});
    if (method === 'PATCH') return Response.json(release);
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  return { calls, fetchImpl };
}

test('publisher uploads all immutable installers before switching the preview catalog', async t => {
  const {directory} = await fixture(t);
  const {calls,fetchImpl} = github();
  const result = await publishPreview({directory,commit,repository:'Darius-Lea/Mother-AI',token:'test-token',fetchImpl,report:()=>{}});
  assert.equal(result.published,true);
  const uploads = calls.filter(call=>call.url.includes('uploads.github.com'));
  assert.equal(uploads.length,6);
  assert.equal(new URL(uploads.at(-1).url).searchParams.get('name'),'downloads.json');
  assert.ok(uploads.slice(0,5).every(call=>!call.url.includes('.zip')));
  assert.ok(calls.findIndex(call=>call.method==='DELETE') > calls.indexOf(uploads[4]));
  assert.equal(uploads.at(-1).catalog.sourceCommit,commit);
  assert.ok(calls.at(-1).url.endsWith('/releases/7'));
});

test('main advancing during uploads leaves the previous catalog and existing binaries intact', async t => {
  const {directory} = await fixture(t);
  const {calls,fetchImpl} = github({advance:true});
  const result = await publishPreview({directory,commit,repository:'Darius-Lea/Mother-AI',token:'test-token',fetchImpl,report:()=>{}});
  assert.equal(result.published,false);
  assert.equal(result.reason,'stale-commit');
  assert.ok(!calls.some(call=>call.method==='DELETE'));
  assert.equal(calls.filter(call=>call.url.includes('uploads.github.com')).length,5);
});

test('a stale completed build makes no release changes', async t => {
  const {directory} = await fixture(t);
  const {calls,fetchImpl} = github({initiallyStale:true});
  const result = await publishPreview({directory,commit,repository:'Darius-Lea/Mother-AI',token:'test-token',fetchImpl,report:()=>{}});
  assert.equal(result.published,false);
  assert.equal(calls.length,1);
  assert.equal(calls[0].method,'GET');
});

test('a rerun reuses only complete existing assets with matching full checksums', async t => {
  const {directory} = await fixture(t);
  const {calls,fetchImpl} = github({completedInstallers:true});
  const result = await publishPreview({directory,commit,repository:'Darius-Lea/Mother-AI',token:'test-token',fetchImpl,report:()=>{}});
  assert.equal(result.published,true);
  const uploads = calls.filter(call=>call.url.includes('uploads.github.com'));
  assert.equal(uploads.length,1);
  assert.equal(new URL(uploads[0].url).searchParams.get('name'),'downloads.json');
});

test('paths outside the verified build directory are rejected before contacting GitHub', async t => {
  const {directory,input} = await fixture(t);
  input.artifacts[0].relativePath = '../escaped.exe';
  await writeFile(path.join(directory,'downloads.json'),JSON.stringify(input));
  const {calls,fetchImpl} = github();
  await assert.rejects(publishPreview({directory,commit,repository:'Darius-Lea/Mother-AI',token:'test-token',fetchImpl,report:()=>{}}),/escaped the completed build directory/);
  assert.equal(calls.length,0);
});

test('failed installer upload never deletes or replaces the discovery catalog', async t => {
  const {directory} = await fixture(t);
  const {calls,fetchImpl} = github({uploadFails:true});
  await assert.rejects(publishPreview({directory,commit,repository:'Darius-Lea/Mother-AI',token:'test-token',fetchImpl,report:()=>{}}),/asset upload failed/);
  assert.ok(!calls.some(call=>call.method==='DELETE'));
});

test('publisher refuses stable releases and changed build bytes', async t => {
  const {directory,input} = await fixture(t);
  const {calls,fetchImpl} = github({stable:true});
  const options = {directory,commit,repository:'Darius-Lea/Mother-AI',token:'test-token',fetchImpl,report:()=>{}};
  await assert.rejects(publishPreview(options),/not the approved public preview/);
  assert.ok(!calls.some(call=>call.method==='POST'));
  await writeFile(path.join(directory,input.artifacts[0].filename),Buffer.alloc(payload.length,0));
  calls.length = 0;
  await assert.rejects(publishPreview(options),/checksum changed/);
  assert.equal(calls.length,0);
});
