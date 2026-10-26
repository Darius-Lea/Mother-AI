'use strict';
const http = require('node:http');
const net = require('node:net');
const dns = require('node:dns/promises');
const { randomBytes, timingSafeEqual } = require('node:crypto');

const MAX_HEADER_BYTES = 8192;
const IDLE_TIMEOUT_MS = 60_000;

class BrowserNetworkError extends Error {
  constructor(message, reason = 'invalid-url', status = 403) {
    super(message);
    this.reason = reason;
    this.status = status;
  }
}

// Keep the desktop policy at least as restrictive as server/datasets.js.
// This synchronous CJS copy also rejects the newer 3fff::/20 documentation range.
function isPublicAddress(input) {
  if (typeof input !== 'string') return false;
  const address = input.toLowerCase();
  const version = net.isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (version === 6) {
    if (address.includes('.') || address.includes('%')) return false;
    const parts = address.split('::');
    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts[1] ? parts[1].split(':') : [];
    const groups = parts.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
    const value = groups.reduce((result, part) => (result << 16n) | BigInt(parseInt(part, 16)), 0n);
    const prefix = (base, bits) => (value >> BigInt(128 - bits)) === (base >> BigInt(128 - bits));
    if (!prefix(0x20000000000000000000000000000000n, 3)) return false;
    if (prefix(0x20010000000000000000000000000000n, 23)) return false;
    if (prefix(0x20010db8000000000000000000000000n, 32)) return false;
    if (prefix(0x20020000000000000000000000000000n, 16)) return false;
    if (prefix(0x3fff0000000000000000000000000000n, 20)) return false;
    return true;
  }
  return false;
}

function validateBrowserUrl(value, { allowWebSocket = false } = {}) {
  const text = value instanceof URL ? value.href : value;
  if (typeof text !== 'string' || text.length > 8192 || /[\x00-\x20\x7f\\]/.test(text)) {
    throw new BrowserNetworkError('Enter a complete public HTTPS URL.');
  }
  let url;
  try { url = new URL(text); }
  catch { throw new BrowserNetworkError('Enter a complete public HTTPS URL.'); }
  if (url.protocol !== 'https:' && !(allowWebSocket && url.protocol === 'wss:')) {
    throw new BrowserNetworkError('Private browsing allows public HTTPS websites only.', 'blocked-protocol');
  }
  if (!/^(?:https|wss):\/\//i.test(text)) throw new BrowserNetworkError('Enter a complete public HTTPS URL.');
  const authority = text.slice(text.indexOf('://') + 3).split(/[/?#]/, 1)[0];
  if (url.username || url.password || authority.includes('@')) throw new BrowserNetworkError('URLs containing credentials are not allowed.', 'url-credentials');
  if (url.port && url.port !== '443') throw new BrowserNetworkError('Only the standard HTTPS port is allowed.', 'blocked-port');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname.endsWith('.') || hostname.includes('%')) throw new BrowserNetworkError('Invalid public hostname.');
  if (net.isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new BrowserNetworkError('Private, local and reserved addresses are blocked.', 'private-address');
  } else {
    if (hostname.length > 253 || !hostname.includes('.') || /\.(?:localhost|local|internal|test|invalid|example|home|lan|onion|arpa|alt|corp)$/.test(hostname)) {
      throw new BrowserNetworkError('Private, local and reserved hostnames are blocked.', 'local-hostname');
    }
    if (!hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
      throw new BrowserNetworkError('Invalid public hostname.');
    }
  }
  return url;
}

function connectUrl(authority) {
  // CONNECT is an authority, never an absolute URL, path, userinfo, or an
  // unbracketed IPv6 literal. Requiring literal 443 avoids parser differences.
  if (typeof authority !== 'string' || !/^(?:\[[a-fA-F0-9:]+\]|[a-zA-Z0-9.-]+):443$/.test(authority)) {
    throw new BrowserNetworkError('Only public HTTPS connections on port 443 are allowed.', 'invalid-authority');
  }
  return validateBrowserUrl(`https://${authority}/`);
}

function auditUrl(value, authority = false) {
  try {
    const url = new URL(authority ? `https://${value}/` : value);
    if (!['https:', 'wss:'].includes(url.protocol)) return undefined;
    // Origins exclude credentials, paths, queries, fragments and request data.
    return `${url.origin}/`;
  } catch { return undefined; }
}

function resolvePublic(hostname, { lookup, dnsTimeoutMs, signal }) {
  if (net.isIP(hostname)) return Promise.resolve([{ address: hostname, family: net.isIP(hostname) }]);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(new BrowserNetworkError('The browser connection closed.', 'connection-closed', 503));
    const timer = setTimeout(() => finish(new BrowserNetworkError('DNS lookup timed out.', 'dns-timeout', 504)), dnsTimeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    Promise.resolve().then(() => lookup(hostname, { all: true, verbatim: true })).then(addresses => {
      if (!Array.isArray(addresses) || !addresses.length || addresses.some(answer => !answer || !isPublicAddress(answer.address) || net.isIP(answer.address) !== answer.family)) {
        finish(new BrowserNetworkError('DNS returned a private, reserved or invalid address.', 'private-dns'));
        return;
      }
      finish(null, addresses);
    }, () => finish(new BrowserNetworkError('The public hostname could not be resolved.', 'dns-failed', 502)));
  });
}

async function createBrowserProxy({ lookup = dns.lookup, connect = net.connect, audit = () => {}, dnsTimeoutMs = 5000, maxConnections = 32 } = {}) {
  if (typeof lookup !== 'function' || typeof connect !== 'function' || typeof audit !== 'function') throw new TypeError('Invalid browser proxy dependencies.');
  if (!Number.isInteger(dnsTimeoutMs) || dnsTimeoutMs < 1 || dnsTimeoutMs > 60_000) throw new RangeError('Invalid DNS timeout.');
  if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 256) throw new RangeError('Invalid connection limit.');
  const username = randomBytes(24).toString('hex');
  const password = randomBytes(32).toString('base64url');
  const authorization = Buffer.from(`Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`);
  const clients = new Set();
  const sockets = new Set();
  const pending = new Set();
  let closed = false, closePromise;

  function record(type, value, reason, authority = false) {
    const url = auditUrl(value, authority);
    try {
      const result = audit({ type, ...(url ? { url } : {}), ...(reason ? { reason } : {}) });
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch { /* Activity storage must never weaken the network policy. */ }
  }

  function authenticated(request) {
    let count = 0;
    for (let i = 0; i < request.rawHeaders.length; i += 2) {
      if (request.rawHeaders[i].toLowerCase() === 'proxy-authorization') count++;
    }
    if (count !== 1 || typeof request.headers['proxy-authorization'] !== 'string') return false;
    const supplied = Buffer.from(request.headers['proxy-authorization']);
    return supplied.length === authorization.length && timingSafeEqual(supplied, authorization);
  }

  function rejectSocket(socket, status) {
    if (socket.destroyed) return;
    const message = http.STATUS_CODES[status] || 'Forbidden';
    socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n${status === 407 ? 'Proxy-Authenticate: Basic realm="Mother private browser"\r\n' : ''}\r\n`, () => socket.destroy());
  }

  function track(socket) {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.setTimeout(IDLE_TIMEOUT_MS, () => socket.destroy());
    socket.once('close', () => sockets.delete(socket));
    return socket;
  }

  const server = http.createServer({ maxHeaderSize: MAX_HEADER_BYTES, requestTimeout: 10_000, headersTimeout: 10_000, keepAliveTimeout: 1000, connectionsCheckingInterval: 1000 }, (request, response) => {
    const status = authenticated(request) ? 405 : 407;
    record('network-block', request.url, status === 407 ? 'proxy-auth' : 'blocked-method');
    response.writeHead(status, { Connection: 'close', 'Content-Length': '0', ...(status === 407 ? { 'Proxy-Authenticate': 'Basic realm="Mother private browser"' } : {}) });
    response.end();
  });
  server.maxConnections = maxConnections;
  server.maxRequestsPerSocket = 1;
  server.on('connection', socket => {
    if (closed || clients.size >= maxConnections) { socket.destroy(); return; }
    clients.add(socket);
    track(socket);
    socket.once('close', () => clients.delete(socket));
  });
  server.on('clientError', (_error, socket) => rejectSocket(socket, 400));
  server.on('error', () => {});
  server.on('connect', (request, client, head) => {
    void (async () => {
      if (!authenticated(request)) {
        record('network-block', request.url, 'proxy-auth', true);
        rejectSocket(client, 407);
        return;
      }
      let url;
      try { url = connectUrl(request.url); }
      catch (error) {
        record('network-block', request.url, error.reason || 'invalid-authority', true);
        rejectSocket(client, 403);
        return;
      }
      if (head.length > 65_536) {
        record('network-block', url.href, 'oversized-header');
        rejectSocket(client, 413);
        return;
      }
      const controller = new AbortController();
      pending.add(controller);
      const abort = () => controller.abort();
      client.once('close', abort);
      let addresses;
      try {
        addresses = await resolvePublic(url.hostname.replace(/^\[|\]$/g, ''), { lookup, dnsTimeoutMs, signal: controller.signal });
      } catch (error) {
        if (!client.destroyed && !closed) {
          record('network-block', url.href, error.reason || 'dns-failed');
          rejectSocket(client, error.status || 502);
        }
        return;
      } finally {
        pending.delete(controller);
        client.removeListener('close', abort);
      }
      if (closed || client.destroyed) return;
      let upstream;
      try {
        // Numeric host and family pin this connection to the independently
        // checked answer. net.connect performs no second hostname lookup.
        upstream = track(connect({ host: addresses[0].address, family: addresses[0].family, port: 443 }));
      } catch {
        record('network-block', url.href, 'connection-failed');
        rejectSocket(client, 502);
        return;
      }
      let established = false;
      upstream.once('error', () => {
        if (!established) {
          record('network-block', url.href, 'connection-failed');
          rejectSocket(client, 502);
        } else client.destroy();
      });
      client.once('close', () => upstream.destroy());
      upstream.once('close', () => client.destroy());
      upstream.once('connect', () => {
        if (closed || client.destroyed) { upstream.destroy(); return; }
        established = true;
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        record('connection', url.href);
        // The tunnel is raw TLS. Chromium retains certificate and hostname
        // verification; the proxy never decrypts or inspects website traffic.
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
    })().catch(() => {
      record('network-block', request.url, 'connection-failed', true);
      rejectSocket(client, 502);
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return {
    host: '127.0.0.1',
    port: server.address().port,
    username,
    password,
    close() {
      if (closePromise) return closePromise;
      closed = true;
      for (const controller of pending) controller.abort();
      for (const socket of sockets) socket.destroy();
      closePromise = new Promise(resolve => server.close(() => resolve()));
      return closePromise;
    },
  };
}

module.exports = { createBrowserProxy, validateBrowserUrl };
