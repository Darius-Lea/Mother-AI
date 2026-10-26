'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { once } = require('node:events');
const { createBrowserProxy, validateBrowserUrl } = require('./browser-network.cjs');

const PUBLIC = [{ address: '93.184.215.14', family: 4 }];
const basic = proxy => `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`;

async function fixture(t, options = {}) {
  const connections = [], events = [], echoSockets = new Set();
  const echo = net.createServer(socket => {
    echoSockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => echoSockets.delete(socket));
    socket.pipe(socket);
  });
  echo.listen(0, '127.0.0.1');
  await once(echo, 'listening');
  const proxy = await createBrowserProxy({
    lookup: async () => PUBLIC,
    connect: value => {
      connections.push(value);
      // Fixtures never contact an external address. Inspect the address that
      // production would use, then route to this local fake TCP destination.
      return net.connect({ host: '127.0.0.1', port: echo.address().port });
    },
    audit: event => events.push(event),
    ...options,
  });
  t.after(async () => {
    await proxy.close();
    for (const socket of echoSockets) socket.destroy();
    await new Promise(resolve => echo.close(resolve));
  });
  return { proxy, connections, events, echoSockets };
}

function request(proxy, target = 'public.domain:443', { authorization = basic(proxy), method = 'CONNECT', extraHeaders = '', head = '' } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port });
    const chunks = [];
    let bytes = 0;
    const timer = setTimeout(() => { socket.destroy(); reject(Error('Proxy fixture response timed out.')); }, 2000);
    const fail = error => { clearTimeout(timer); reject(error); };
    socket.on('error', fail);
    socket.once('connect', () => socket.write(`${method} ${target} HTTP/1.1\r\nHost: public.domain\r\n${authorization === null ? '' : `Proxy-Authorization: ${authorization}\r\n`}${extraHeaders}\r\n${head}`));
    const collect = chunk => {
      chunks.push(chunk); bytes += chunk.length;
      const buffer = Buffer.concat(chunks, bytes);
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      clearTimeout(timer);
      socket.removeListener('data', collect);
      socket.removeListener('error', fail);
      socket.on('error', () => {});
      resolve({ socket, headers: buffer.subarray(0, end).toString(), body: buffer.subarray(end + 4) });
    };
    socket.on('data', collect);
  });
}

async function echoed(socket, value) {
  const reply = once(socket, 'data');
  socket.write(value);
  return (await reply)[0].toString();
}

test('browser URLs allow public HTTPS, and WSS only for subrequests', () => {
  assert.equal(validateBrowserUrl('https://public.domain:443/a?secret=one#fragment').href, 'https://public.domain/a?secret=one#fragment');
  assert.equal(validateBrowserUrl('https://8.8.8.8/').hostname, '8.8.8.8');
  assert.equal(validateBrowserUrl('https://[2606:4700:4700::1111]/').hostname, '[2606:4700:4700::1111]');
  assert.throws(() => validateBrowserUrl('wss://public.domain/'));
  assert.equal(validateBrowserUrl('wss://public.domain/', { allowWebSocket: true }).protocol, 'wss:');
});

test('browser URL validation blocks local protocols, credentials, ports and local hostnames', () => {
  for (const value of [
    'http://public.domain/', 'ws://public.domain/', 'file:///etc/passwd', 'javascript:alert(1)', 'mother://app/api/chat',
    'https://name:password@public.domain/', 'https://@public.domain/', 'https:public.domain/', 'https:/public.domain/',
    'https://public.domain:8443/', 'wss://public.domain:444/',
    'https://localhost/', 'https://printer/', 'https://printer.local/', 'https://service.internal/',
    'https://router.home/', 'https://host.lan/', 'https://public.domain./', 'https://public.domain%00.evil/',
    'https://public..domain/', 'https://-bad.domain/', 'https://bad_.domain/', 'https://public.domain\\@127.0.0.1/',
    'https://public.domain/\r\nProxy-Authorization: password',
  ]) assert.throws(() => validateBrowserUrl(value, { allowWebSocket: true }), value);
});

test('browser URL validation normalizes IP literals before rejecting private and reserved ranges', () => {
  for (const value of [
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '127.1', '2130706433', '0x7f000001', '0177.0.0.1',
    '169.254.169.254', '172.31.0.1', '192.168.1.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255',
    '[::]', '[::1]', '[0000:0000:0000:0000:0000:0000:0000:0001]', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]',
    '[fe80::1]', '[fc00::1]', '[0200::1]', '[2001:db8::1]', '[2001:0000::1]', '[2002:0808:0808::1]', '[3fff::1]',
  ]) assert.throws(() => validateBrowserUrl(`https://${value}/`), value);
});

test('proxy requires its random per-instance credentials before accepting any request', async t => {
  const { proxy, connections, events } = await fixture(t);
  const other = await createBrowserProxy();
  t.after(() => other.close());
  assert.notEqual(proxy.username, other.username);
  assert.notEqual(proxy.password, other.password);
  for (const authorization of [null, 'Basic wrong', basic(other)]) {
    const result = await request(proxy, 'public.domain:443', { authorization });
    assert.match(result.headers, /^HTTP\/1\.1 407 /);
    assert.match(result.headers, /Proxy-Authenticate: Basic/);
    result.socket.destroy();
  }
  const duplicate = await request(proxy, 'public.domain:443', { extraHeaders: `Proxy-Authorization: ${basic(proxy)}\r\n` });
  assert.match(duplicate.headers, /^HTTP\/1\.1 407 /);
  duplicate.socket.destroy();
  const ordinary = await request(proxy, 'https://public.domain/', { method: 'GET' });
  assert.match(ordinary.headers, /^HTTP\/1\.1 405 /);
  ordinary.socket.destroy();
  assert.equal(connections.length, 0);
  assert.ok(events.every(event => event.type === 'network-block'));
  assert.ok(!JSON.stringify(events).includes(proxy.password));
});

test('authenticated proxy pins all-answers DNS result and forwards raw tunnel bytes', async t => {
  const lookups = [];
  const { proxy, connections, events } = await fixture(t, {
    lookup: async (hostname, options) => { lookups.push({ hostname, options }); return PUBLIC; },
  });
  const { socket, headers } = await request(proxy);
  assert.match(headers, /^HTTP\/1\.1 200 /);
  assert.equal(await echoed(socket, 'opaque TLS fixture bytes'), 'opaque TLS fixture bytes');
  assert.deepEqual(lookups, [{ hostname: 'public.domain', options: { all: true, verbatim: true } }]);
  assert.deepEqual(connections, [{ host: PUBLIC[0].address, family: 4, port: 443 }]);
  assert.deepEqual(events, [{ type: 'connection', url: 'https://public.domain/' }]);
  socket.destroy();
});

test('DNS is checked on each connection so a public-to-private rebinding is blocked', async t => {
  let lookups = 0;
  const { proxy, connections } = await fixture(t, {
    lookup: async () => ++lookups === 1 ? PUBLIC : [{ address: '127.0.0.1', family: 4 }],
  });
  const first = await request(proxy);
  assert.match(first.headers, /^HTTP\/1\.1 200 /);
  first.socket.destroy();
  const second = await request(proxy);
  assert.match(second.headers, /^HTTP\/1\.1 403 /);
  second.socket.destroy();
  assert.equal(lookups, 2);
  assert.equal(connections.length, 1);
});

test('a private or malformed address in any DNS answer rejects the whole connection', async t => {
  let answers;
  const { proxy, connections } = await fixture(t, { lookup: async () => answers });
  for (const bad of [
    { address: '10.0.0.5', family: 4 }, { address: '::ffff:7f00:1', family: 6 },
    { address: 'fe80::1', family: 6 }, { address: '2001:0db8::1', family: 6 },
    { address: '93.184.215.14', family: 6 }, { address: 'not-an-address', family: 4 },
  ]) {
    answers = [...PUBLIC, bad];
    const result = await request(proxy);
    assert.match(result.headers, /^HTTP\/1\.1 403 /, JSON.stringify(bad));
    result.socket.destroy();
  }
  answers = [];
  const result = await request(proxy);
  assert.match(result.headers, /^HTTP\/1\.1 403 /);
  result.socket.destroy();
  assert.equal(connections.length, 0);
});

test('CONNECT rejects ambiguous authorities, private literals and nonstandard ports without DNS', async t => {
  let lookups = 0;
  const { proxy, connections, events } = await fixture(t, { lookup: async () => { lookups++; return PUBLIC; } });
  for (const target of [
    '127.0.0.1:443', '[::1]:443', '[2001:db8::1]:443', 'localhost:443', 'printer.local:443',
    'public.domain:80', 'public.domain:8443', 'public.domain:0443', 'https://public.domain:443/',
    'name:password@public.domain:443', 'public.domain:443/path', 'public.domain:443?query',
    'public.domain.:443', '2606:4700:4700::1111:443', 'public.domain%00:443',
  ]) {
    const result = await request(proxy, target);
    assert.match(result.headers, /^HTTP\/1\.1 403 /, target);
    result.socket.destroy();
  }
  assert.equal(lookups, 0);
  assert.equal(connections.length, 0);
  assert.ok(!JSON.stringify(events).includes('name:password'));
});

test('public IPv6 literals are normalized and pinned without another DNS lookup', async t => {
  let lookedUp = false;
  const { proxy, connections } = await fixture(t, { lookup: async () => { lookedUp = true; return PUBLIC; } });
  const result = await request(proxy, '[2606:4700:4700:0000:0000:0000:0000:1111]:443');
  assert.match(result.headers, /^HTTP\/1\.1 200 /);
  assert.equal(lookedUp, false);
  assert.deepEqual(connections, [{ host: '2606:4700:4700::1111', family: 6, port: 443 }]);
  result.socket.destroy();
});

test('DNS timeouts fail closed without connecting or exposing resolver errors', async t => {
  const { proxy, connections, events } = await fixture(t, { lookup: () => new Promise(() => {}), dnsTimeoutMs: 20 });
  const result = await request(proxy);
  assert.match(result.headers, /^HTTP\/1\.1 504 /);
  assert.equal(connections.length, 0);
  assert.equal(events[0].reason, 'dns-timeout');
  result.socket.destroy();
});

test('proxy close destroys active tunnel sockets and cancels pending DNS', async t => {
  let lookupStarted, finishLookup;
  const started = new Promise(resolve => { lookupStarted = resolve; });
  const { proxy, echoSockets, connections } = await fixture(t, {
    lookup: hostname => hostname === 'pending.domain' ? (lookupStarted(), new Promise(resolve => { finishLookup = resolve; })) : Promise.resolve(PUBLIC),
  });
  const active = await request(proxy);
  const activeClosed = once(active.socket, 'close');
  const pending = net.connect({ host: proxy.host, port: proxy.port });
  pending.on('error', () => {});
  await once(pending, 'connect');
  const pendingClosed = once(pending, 'close');
  pending.write(`CONNECT pending.domain:443 HTTP/1.1\r\nProxy-Authorization: ${basic(proxy)}\r\n\r\n`);
  await started;
  const close = proxy.close();
  assert.strictEqual(proxy.close(), close);
  await close;
  await Promise.all([activeClosed, pendingClosed]);
  assert.equal(active.socket.destroyed, true);
  assert.equal(pending.destroyed, true);
  finishLookup(PUBLIC);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(connections.length, 1);
  // Allow the local fixture peer to observe the FIN/reset from proxy teardown.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(echoSockets.size, 0);
});

test('total accepted connections bound pending DNS concurrency', async t => {
  let lookupStarted;
  const started = new Promise(resolve => { lookupStarted = resolve; });
  let lookups = 0;
  const { proxy } = await fixture(t, { maxConnections: 1, lookup: () => { lookups++; lookupStarted(); return new Promise(() => {}); } });
  const first = net.connect({ host: proxy.host, port: proxy.port });
  first.on('error', () => {});
  await once(first, 'connect');
  first.write(`CONNECT public.domain:443 HTTP/1.1\r\nProxy-Authorization: ${basic(proxy)}\r\n\r\n`);
  await started;
  const second = net.connect({ host: proxy.host, port: proxy.port });
  second.on('error', () => {});
  const secondClosed = once(second, 'close');
  await secondClosed;
  assert.equal(lookups, 1);
  first.destroy();
});

test('oversized HTTP headers are rejected before lookup and audit failures do not bypass policy', async t => {
  let lookups = 0;
  const { proxy, connections } = await fixture(t, {
    lookup: async () => { lookups++; return [{ address: '127.0.0.1', family: 4 }]; },
    audit: () => { throw Error('activity storage unavailable'); },
  });
  const oversized = await request(proxy, 'public.domain:443', { extraHeaders: `X-Large: ${'a'.repeat(9000)}\r\n` });
  assert.match(oversized.headers, /^HTTP\/1\.1 400 /);
  oversized.socket.destroy();
  assert.equal(lookups, 0);
  const blocked = await request(proxy);
  assert.match(blocked.headers, /^HTTP\/1\.1 403 /);
  blocked.socket.destroy();
  assert.equal(connections.length, 0);
});
