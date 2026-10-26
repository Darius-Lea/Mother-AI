import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { createVoiceAssetStore, createVoiceRouter, VOICE_MODEL } from './voice.js';

const bytes = Buffer.from('a small test stand-in for fixed, data-only neural model bytes');
const asset = { ...VOICE_MODEL, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
const response = value => new Response(value, { headers: { 'Content-Length': String(value.length) } });

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'mother-voice-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const fetchImpl = options.fetchImpl || (async (url, { redirect }) => {
    calls++;
    assert.equal(url, VOICE_MODEL.url);
    assert.equal(redirect, 'manual');
    return response(bytes);
  });
  const store = createVoiceAssetStore({ directory, asset, fetchImpl, ...options });
  t.after(() => store.shutdown());
  return { directory, store, calls: () => calls };
}

test('voice model downloads once, passes integrity checks, and is reused from a confined cache', async t => {
  const { directory, store, calls } = await fixture(t);
  assert.equal(store.status().state, 'idle');
  assert.equal(calls(), 0);
  const first = store.ensure();
  assert.equal(first, store.ensure());
  const file = await first;
  assert.equal(path.basename(file), VOICE_MODEL.filename);
  assert.deepEqual(await readFile(file), bytes);
  assert.equal(store.status().state, 'ready');
  assert.equal(store.status().progress, 100);
  assert.equal(store.status().completed, bytes.length);
  assert.equal(await store.ensure(), file);
  assert.equal(calls(), 1);
  assert.deepEqual(await readdir(directory), [VOICE_MODEL.filename]);
  assert.ok(!JSON.stringify(store.status()).includes(directory));
});

test('voice model redirects may use only the fixed HTTPS distribution hosts', async t => {
  const urls = [];
  const { store } = await fixture(t, { fetchImpl: async url => {
    urls.push(url);
    return urls.length === 1 ? new Response(null, { status: 302, headers: { Location: 'https://release-assets.githubusercontent.com/trusted/signed-model?signature=test' } }) : response(bytes);
  } });
  await store.ensure();
  assert.equal(urls.length, 2);
  for (const location of ['http://release-assets.githubusercontent.com/model', 'https://evil.example/model', 'https://user:pass@github.com/model', 'https://github.com:8443/model', 'file:///tmp/model']) {
    const { store: unsafe, directory } = await fixture(t, { fetchImpl: async () => new Response(null, { status: 302, headers: { Location: location } }) });
    await assert.rejects(unsafe.ensure(), /could not prepare/);
    assert.equal(unsafe.status().state, 'error');
    assert.deepEqual(await readdir(directory), []);
  }
});

test('wrong hashes, lengths and partial files are never served or left in the cache', async t => {
  for (const fetchImpl of [
    async () => response(Buffer.alloc(bytes.length, 0)),
    async () => response(Buffer.alloc(bytes.length + 1, 0)),
    async () => new Response(Buffer.alloc(bytes.length - 1, 0)),
    async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 4)); controller.error(Error('interrupted')); } })),
  ]) {
    const { store, directory } = await fixture(t, { fetchImpl });
    await assert.rejects(store.ensure(), /could not prepare/);
    assert.deepEqual(await readdir(directory), []);
    assert.equal(store.status().state, 'error');
    assert.notEqual(store.status().progress, 100);
  }
});

test('a cached symbolic link cannot redirect voice downloads to another file', async t => {
  if (process.platform === 'win32') return; // Ordinary Windows runners cannot create symlinks.
  const { store, directory, calls } = await fixture(t);
  const outside = path.join(directory, 'outside');
  await writeFile(outside, bytes);
  await symlink(outside, path.join(directory, VOICE_MODEL.filename));
  await assert.rejects(store.ensure(), /could not prepare/);
  assert.equal(calls(), 0);
  assert.deepEqual(await readFile(outside), bytes);
});

test('a changed regular cache file is repaired automatically before being served', async t => {
  const { store, calls } = await fixture(t);
  const file = await store.ensure();
  await writeFile(file, Buffer.alloc(bytes.length, 0));
  const repaired = await store.ensure();
  assert.equal(repaired, file);
  assert.deepEqual(await readFile(repaired), bytes);
  assert.equal(calls(), 2);
  assert.equal(store.status().state, 'ready');
});

test('timeouts and shutdown stop pending downloads without leaving partial files', async t => {
  for (const stopImmediately of [false, true]) {
    let calls = 0;
    const { store, directory } = await fixture(t, { timeoutMs: 10, fetchImpl: (_url, { signal }) => {
      calls++;
      return new Promise((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    } });
    const pending = store.ensure();
    if (stopImmediately) store.shutdown();
    await assert.rejects(pending, /could not prepare/);
    assert.deepEqual(await readdir(directory), []);
    assert.equal(calls, stopImmediately ? 0 : 1);
  }
});

test('the route exposes metadata and the single fixed asset, and never accepts arbitrary paths or text', async t => {
  const { directory } = await fixture(t);
  let calls = 0;
  const app = express();
  const router = createVoiceRouter({ directory, fetchImpl: async () => { calls++; throw Error('network unavailable'); } });
  app.use('/api/voice', router);
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => { router.shutdown(); server.close(); server.closeAllConnections(); });
  const origin = `http://127.0.0.1:${server.address().port}/api/voice`;
  const status = await fetch(`${origin}/status`).then(result => result.json());
  assert.equal(status.assetUrl, `/api/voice/files/${VOICE_MODEL.filename}`);
  assert.equal(status.downloadBytes, 114119327);
  assert.equal(calls, 0);
  for (const [route, options] of [['/files/https%3A%2F%2Fevil.example', {}], ['/files/tokenizer.json', {}], ['/files/model.js', {}], ['/speak', { method: 'POST', body: 'private text' }]]) {
    assert.equal((await fetch(`${origin}${route}`, options)).status, 404);
  }
  assert.equal(calls, 0);
  assert.equal((await fetch(`${origin}/files/${VOICE_MODEL.filename}`)).status, 503);
  assert.equal(calls, 1);
});

test('the verified voice asset is served from hidden application-data parent folders',async t=>{
  const {directory}=await fixture(t);
  const router=createVoiceRouter({directory:path.join(directory,'.private-app-data'),asset,fetchImpl:async()=>response(bytes)});
  const app=express();app.use('/api/voice',router);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{router.shutdown();server.close();server.closeAllConnections();});
  const result=await fetch(`http://127.0.0.1:${server.address().port}/api/voice/files/${VOICE_MODEL.filename}`);
  assert.equal(result.status,200);assert.deepEqual(Buffer.from(await result.arrayBuffer()),bytes);
});
