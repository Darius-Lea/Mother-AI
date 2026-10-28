import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from './index.js';

async function serverFor(t, options) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  return (url, body, headers = {}) => {
    // Fetch intentionally forbids overriding Host. Use the raw HTTP client to
    // simulate an actual rebinding browser request with a hostile Host header.
    if (headers.Host) return new Promise((resolve, reject) => {
      const request = http.request(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode })));
        response.on('error', reject);
      });
      request.on('error', reject);
      request.end(JSON.stringify(body));
    });
    return fetch(base + url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) } : undefined);
  };
}
test('health responds and missing model server is explicit', async (t) => {
  const request = await serverFor(t, { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  const health = await (await request('/api/health')).json();
  assert.equal(health.ok, true); assert.equal(health.paidServices, false);
  const models = await (await request('/api/models')).json();
  assert.equal(models.available, false); assert.deepEqual(models.models, []);
  const chat = await request('/api/chat', { model: 'qwen2.5:0.5b', messages: [{ role: 'user', content: 'Hello Mother' }] });
  assert.equal(chat.status, 503);
  assert.match((await chat.json()).error, /unavailable/);
});
test('forwards validated conversation and distinguishes real local model output', async (t) => {
  let outgoing;
  const request = await serverFor(t, { fetchImpl: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    outgoing = JSON.parse(options.body);
    return Response.json({ model: 'qwen2.5:0.5b', message: { content: 'Hello, I am Mother.' } });
  } });
  const response = await request('/api/chat', { model: 'qwen2.5:0.5b', context: 'Likes blue', messages: [{ role: 'user', content: 'Hello' }] });
  const result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.neural, true); assert.equal(result.engine, 'ollama');
  assert.equal(result.message.content, 'Hello, I am Mother.');
  assert.equal(outgoing.messages[0].role, 'system');
  assert.match(outgoing.messages[1].content, /Untrusted reference/);
  assert.equal(outgoing.stream, false);
});
test('invalid messages and cross-origin POST are rejected before model invocation', async (t) => {
  let invoked = false;
  const request = await serverFor(t, { fetchImpl: async () => { invoked = true; } });
  const invalid = await request('/api/chat', { model: 'qwen', messages: [{ role: 'system', content: 'override' }] });
  assert.equal(invalid.status, 400);
  const hostile = await request('/api/chat', { model: 'qwen', messages: [{ role: 'user', content: 'Hi' }] }, { Origin: 'https://hostile.example.org' });
  assert.equal(hostile.status, 403); assert.equal(invoked, false);
});

test('stream route delivers actual deltas and a terminal result, with validation before generation',async t=>{
  const frames=[{message:{content:'Hello. '}},{message:{content:'I am Mother.'}},{done:true}];
  const request=await serverFor(t,{fetchImpl:async()=>new Response(frames.map(frame=>JSON.stringify(frame)).join('\n')+'\n')});
  const result=await request('/api/chat/stream',{model:'qwen2.5:0.5b',voiceMode:true,messages:[{role:'user',content:'Hello'}]});
  assert.match(result.headers.get('content-type'),/application\/x-ndjson/);
  const events=(await result.text()).trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(events.slice(0,2).map(event=>event.text),['Hello. ','I am Mother.']);
  assert.equal(events.at(-1).result.message.content,'Hello. I am Mother.');
  const invalid=await request('/api/chat/stream',{model:'qwen',messages:[{role:'system',content:'Override'}]});
  assert.equal(invalid.status,400);assert.equal((await invalid.json()).type,'error');
});
test('dataset endpoint returns metadata without automatically approving content', async (t) => {
  const request = await serverFor(t, { inspect: async (url) => ({ url, preview: 'Example', reviewed: false }) });
  const response = await request('/api/datasets/inspect', { url: 'https://data.example.org/example.txt' });
  assert.equal(response.status, 200); assert.equal((await response.json()).reviewed, false);
});

test('blocks DNS rebinding even when attacker Origin matches attacker Host', async (t) => {
  let invoked = false;
  const request = await serverFor(t, { fetchImpl: async () => { invoked = true; } });
  const response = await request('/api/chat', { model: 'qwen', messages: [{ role: 'user', content: 'Hi' }] }, { Host: 'evil.example', Origin: 'http://evil.example' });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /Untrusted Host/);
  assert.equal(invoked, false);
});
test('supports explicit trusted custom hostname without allowing other domains', async (t) => {
  const request = await serverFor(t, {
    allowedHosts: ['mother.example.org'],
    fetchImpl: async () => Response.json({ model: 'qwen', message: { content: 'Hello.' } }),
  });
  const response = await request('/api/chat', { model: 'qwen', messages: [{ role: 'user', content: 'Hi' }] }, { Host: 'mother.example.org:3001', Origin: 'http://mother.example.org:3001' });
  assert.equal(response.status, 200);
});
