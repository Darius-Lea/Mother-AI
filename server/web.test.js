import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { mkdtemp, readFile, stat, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { createWebClient, createWebRouter, extractWebPage, validateWebUrl } from './web.js';

const publicDns = async () => [{ address: '1.1.1.1', family: 4 }];
const html = '<!doctype html><html><head><title>A useful page</title><script>hidden secret</script></head><body><main><h1>Hello reader</h1><p>Useful public reference text.</p></main></body></html>';

function requestFrom(handler) {
  return (url, options, callback) => {
    const req = new EventEmitter();
    req.end = () => queueMicrotask(() => {
      try {
        const result = handler(new URL(url), options);
        const response = Readable.from([Buffer.from(result.body ?? html)]);
        response.statusCode = result.status ?? 200;
        response.headers = { 'content-type': 'text/html', ...result.headers };
        callback(response);
      } catch (error) { req.emit('error', error); }
    });
    req.destroy = () => {};
    return req;
  };
}

test('public web addresses reject credential URLs, non-HTTPS and local networks', () => {
  assert.equal(validateWebUrl('https://www.wikipedia.org/wiki/AI#section').href, 'https://www.wikipedia.org/wiki/AI');
  for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com:8443/', 'https://localhost/', 'https://127.1/', 'https://169.254.169.254/', 'https://[::1]/', 'file:///etc/passwd', 'https://device.local']) assert.throws(() => validateWebUrl(url));
});

test('web extraction returns text references and safe links without executable page content', () => {
  const result = extractWebPage('<html><head><title>Human &amp; readable</title><script>secretScript()</script></head><body><nav>navigation</nav><p>Keep <b>these words</b>.</p><form>private form</form><div hidden>hidden text</div><a href="/article">Read article</a><a href="javascript:alert(1)">Unsafe</a><a href="https://127.0.0.1">Local</a></body></html>', 'https://example.com/');
  assert.equal(result.title, 'Human & readable');
  assert.match(result.text, /Keep these words/);
  assert.doesNotMatch(result.text, /secretScript|private form|hidden text|navigation/);
  assert.deepEqual(result.links, [{ title: 'Read article', url: 'https://example.com/article' }]);
  assert.equal(result.truncated, false);
});

test('web reader checks and pins every direct DNS address and sends no account headers', async t => {
  let requested = 0;
  const client = createWebClient({ lookupImpl: publicDns, proxyEnv: {}, requestImpl: requestFrom((url, options) => {
    requested++;
    assert.equal(url.href, 'https://public.example.org/article');
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers.Authorization, undefined);
    options.lookup('public.example.org', { all: true }, (error, records) => { assert.equal(error, null); assert.deepEqual(records, [{ address: '1.1.1.1', family: 4 }]); });
    return {};
  }) });
  t.after(() => client.close());
  const page = await client.read('https://public.example.org/article');
  assert.equal(page.title, 'A useful page');
  assert.match(page.text, /Useful public reference/);
  assert.equal(page.reviewed, false);
  assert.equal(page.transport, 'direct-pinned-dns');
  assert.match(page.sha256, /^[a-f0-9]{64}$/);
  assert.equal(requested, 1);
});

test('mixed private DNS and private redirects fail before another outbound request', async t => {
  let requests = 0;
  const mixed = createWebClient({ lookupImpl: async () => [...await publicDns(), { address: '127.0.0.1', family: 4 }], proxyEnv: {}, requestImpl: requestFrom(() => { requests++; return {}; }) });
  const redirect = createWebClient({ lookupImpl: publicDns, proxyEnv: {}, requestImpl: requestFrom(() => { requests++; return { status: 302, headers: { location: 'https://169.254.169.254/secret' } }; }) });
  t.after(() => { mixed.close(); redirect.close(); });
  await assert.rejects(mixed.read('https://public.example.org/'), /private or reserved/);
  assert.equal(requests, 0);
  await assert.rejects(redirect.read('https://public.example.org/'), /Private, local and reserved/);
  assert.equal(requests, 1);
});

test('proxy-only DNS fallback is confined to fixed search/probe hosts', async t => {
  let requested = 0;
  const client = createWebClient({ lookupImpl: async () => { throw Error('DNS blocked'); }, proxyEnv: { HTTPS_PROXY: 'http://127.0.0.1:3128' }, requestImpl: requestFrom((_url, options) => { requested++; assert.equal(options.lookup, undefined); return {}; }) });
  t.after(() => client.close());
  await assert.rejects(client.read('https://arbitrary.example.org/'), /Public DNS is unavailable/);
  assert.equal(requested, 0);
  assert.equal((await client.probe()).available, true);
  assert.equal(requested, 1);
});

test('web reader bounds encoded and decoded responses and rejects binary downloads', async t => {
  const replies = [
    { body: 'too big', headers: { 'content-length': String(3 * 1024 * 1024) } },
    { body: gzipSync('a'.repeat(3 * 1024 * 1024)), headers: { 'content-encoding': 'gzip' } },
    { body: 'download', headers: { 'content-type': 'application/octet-stream' } },
    { body: Buffer.from([0, 1, 2]), headers: { 'content-type': 'text/plain' } },
  ];
  const client = createWebClient({ lookupImpl: publicDns, proxyEnv: {}, requestImpl: requestFrom(() => replies.shift()) });
  t.after(() => client.close());
  await assert.rejects(client.read('https://public.example.org/'), /2 MB/);
  await assert.rejects(client.read('https://public.example.org/'), /decoded webpage/);
  await assert.rejects(client.read('https://public.example.org/'), /not downloads/);
  await assert.rejects(client.read('https://public.example.org/'), /readable text/);
});

test('free search produces bounded real source links and ignores private search results', async t => {
  const client = createWebClient({ lookupImpl: publicDns, proxyEnv: {}, requestImpl: requestFrom(url => {
    assert.equal(url.hostname, 'www.bing.com');
    assert.equal(url.searchParams.get('q'), 'free learning');
    return { headers: { 'content-type': 'application/rss+xml' }, body: '<rss><channel><item><title>Source &amp; context</title><link>https://example.org/article</link><description>Useful excerpt</description></item><item><title>Local admin</title><link>https://127.0.0.1/admin</link></item></channel></rss>' };
  }) });
  t.after(() => client.close());
  const result = await client.search('free learning');
  assert.equal(result.provider, 'Bing web search');
  assert.deepEqual(result.results, [{ title: 'Source & context', url: 'https://example.org/article', description: 'Useful excerpt', snippet: 'Useful excerpt' }]);
  await assert.rejects(client.search('x'.repeat(301)), /300 characters/);
});

test('free search falls back to readable DuckDuckGo results without inventing answers', async t => {
  const client = createWebClient({ lookupImpl: publicDns, proxyEnv: {}, requestImpl: requestFrom(url => url.hostname === 'www.bing.com' ? { status: 403 } : { body: '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Farticle">A source</a>' }) });
  t.after(() => client.close());
  const result = await client.search('topic');
  assert.equal(result.provider, 'DuckDuckGo HTML');
  assert.equal(result.results[0].url, 'https://example.org/article');
  const blocked = createWebClient({ lookupImpl: publicDns, proxyEnv: {}, requestImpl: requestFrom(() => ({ status: 403 })) });
  t.after(() => blocked.close());
  await assert.rejects(blocked.search('topic'), /did not return readable results/);
});

async function serverFor(t, options = {}) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'mother-web-test-')));
  const router = createWebRouter({ dataDirectory: directory, lookupImpl: publicDns, proxyEnv: {}, requestImpl: requestFrom(() => ({})), ...options });
  const app = express(); app.use(express.json({ limit: '16kb' })); app.use('/api/web', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { router.shutdown(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await rm(directory, { recursive: true, force: true }); });
  return { directory, base: `http://127.0.0.1:${server.address().port}`, router };
}

test('internet status requires an actual successful public response and caches probe calls', async t => {
  let requests = 0;
  const { base } = await serverFor(t, { requestImpl: requestFrom(() => { requests++; return {}; }) });
  const [first, second] = await Promise.all([fetch(`${base}/api/web/status`).then(r => r.json()), fetch(`${base}/api/web/status`).then(r => r.json())]);
  assert.equal(first.available, true);
  assert.equal(second.available, true);
  assert.equal(requests, 1);
  assert.equal(first.verifiedUrl, 'https://example.com/');
  assert.equal(first.capabilities.untraceable, false);
  const failed = await serverFor(t, { requestImpl: requestFrom(() => ({ status: 403 })) });
  const status = await fetch(`${failed.base}/api/web/status`).then(r => r.json());
  assert.equal(status.available, false);
  assert.match(status.error, /HTTP 403/);
});

test('owner audit persists request metadata without page text or model access and can be cleared', async t => {
  const { base, directory } = await serverFor(t);
  const read = await fetch(`${base}/api/web/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://public.example.org/article' }) });
  assert.equal(read.status, 200);
  const log = await fetch(`${base}/api/web/activity`).then(r => r.json());
  assert.equal(log.modelAccess, false);
  assert.equal(log.records[0].type, 'read');
  assert.equal(log.records[0].url, 'https://public.example.org/article');
  const persisted = await readFile(path.join(directory, 'web-activity.json'), 'utf8');
  assert.doesNotMatch(persisted, /Useful public reference text|hidden secret/);
  if (process.platform !== 'win32') assert.equal((await stat(path.join(directory, 'web-activity.json'))).mode & 0o777, 0o600);
  const cleared = await fetch(`${base}/api/web/activity`, { method: 'DELETE' }); assert.equal(cleared.status, 200);
  assert.deepEqual((await fetch(`${base}/api/web/activity`).then(r => r.json())).records, []);
});
