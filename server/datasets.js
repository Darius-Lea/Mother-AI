import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import { createHash } from 'node:crypto';

export const MAX_DATASET_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
// Cloud environments may delegate all public DNS to a managed HTTPS proxy.
// Only these established dataset hosts may use that route: arbitrary user-owned
// hostnames still require independently validated, pinned DNS resolution.
export const TRUSTED_PROXY_DATASET_HOSTS = new Set([
  'raw.githubusercontent.com', 'huggingface.co', 'archive.ics.uci.edu',
]);
const directAgent = new https.Agent({ keepAlive: false, proxyEnv: {} });

export class DatasetError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** Only globally routable addresses are permitted, including every DNS answer. */
export function isPublicAddress(input) {
  const address = input.toLowerCase().replace(/^\[|\]$/g, '');
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
    // Normalize compressed notation before range checks so leading zeroes cannot
    // bypass reserved-prefix checks. Mapped IPv4 and scoped addresses are denied.
    if (address.includes('.') || address.includes('%')) return false;
    const parts = address.split('::');
    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts[1] ? parts[1].split(':') : [];
    const groups = parts.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
    const value = groups.reduce((result, part) => (result << 16n) | BigInt(parseInt(part, 16)), 0n);
    const prefix = (base, bits) => (value >> BigInt(128 - bits)) === (base >> BigInt(128 - bits));
    if (!prefix(0x20000000000000000000000000000000n, 3)) return false;
    // IETF special assignments, documentation, and 6to4 transition networks.
    if (prefix(0x20010000000000000000000000000000n, 23)) return false;
    if (prefix(0x20010db8000000000000000000000000n, 32)) return false;
    if (prefix(0x20020000000000000000000000000000n, 16)) return false;
    return true;
  }
  return false;
}

export function validateDatasetUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new DatasetError('Enter a complete public HTTPS dataset URL.'); }
  if (url.protocol !== 'https:') throw new DatasetError('Dataset links must use HTTPS.');
  if (url.username || url.password) throw new DatasetError('URLs containing credentials are not allowed.');
  if (url.port && url.port !== '443') throw new DatasetError('Only the standard HTTPS port is allowed.');
  url.hash = '';
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname.endsWith('.') || hostname.includes('%')) throw new DatasetError('Invalid public hostname.');
  if (net.isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new DatasetError('Private, local and reserved network addresses are blocked.');
  } else if (!hostname.includes('.') || /\.(?:localhost|local|internal|test|invalid|example|home|lan)$/.test(hostname)) {
    throw new DatasetError('Private, local and reserved hostnames are blocked.');
  }
  return url;
}

function remaining(deadline) {
  const ms = deadline - Date.now();
  if (ms <= 0) throw new DatasetError('The dataset request timed out.', 408);
  return ms;
}

async function resolvePublic(hostname, lookup, deadline) {
  const clean = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(clean)) return [{ address: clean, family: net.isIP(clean) }];
  let timer;
  try {
    const addresses = await Promise.race([
      lookup(clean, { all: true, verbatim: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new DatasetError('DNS lookup timed out.', 408)), remaining(deadline)); }),
    ]);
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      throw new DatasetError('The dataset hostname resolves to a private or reserved address.');
    }
    return addresses;
  } catch (error) {
    if (error instanceof DatasetError) throw error;
    const unavailable = new DatasetError('The dataset hostname could not be resolved. In proxy-only environments, use a raw dataset link from raw.githubusercontent.com, huggingface.co, or archive.ics.uci.edu.', 422);
    unavailable.code = 'DNS_UNAVAILABLE';
    throw unavailable;
  } finally { clearTimeout(timer); }
}

function download(url, addresses, deadline, request = https.request, agent = directAgent) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    let req;
    const timer = setTimeout(() => {
      req?.destroy();
      finish(new DatasetError('The dataset request timed out.', 408));
    }, remaining(deadline));
    req = request(url, {
      method: 'GET',
      headers: { Accept: 'application/json, application/x-ndjson, text/csv, text/plain;q=0.9', 'Accept-Encoding': 'identity', 'User-Agent': 'MotherAI-Dataset-Review/0.1' },
      // Pin the verified address for the TLS connection. No second DNS lookup.
      ...(addresses ? { lookup: (_hostname, options, callback) => {
        if (options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      } } : {}),
      agent,
      rejectUnauthorized: true,
    }, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        res.resume();
        finish(null, { redirect: res.headers.location });
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume(); finish(new DatasetError(`The dataset server returned HTTP ${status}.`, 422)); return;
      }
      if (Number(res.headers['content-length']) > MAX_DATASET_BYTES) {
        res.destroy(); finish(new DatasetError('Dataset exceeds the 2 MB review limit.', 413)); return;
      }
      const encoding = String(res.headers['content-encoding'] || 'identity').toLowerCase();
      if (encoding !== 'identity') {
        res.destroy(); finish(new DatasetError('Compressed responses are not supported. Use a raw text dataset link.', 415)); return;
      }
      const contentType = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const allowed = /^(?:text\/(?:plain|csv|tab-separated-values)|application\/(?:json|(?:x-)?ndjson|jsonl|octet-stream))$/;
      if (contentType && !allowed.test(contentType)) {
        res.destroy(); finish(new DatasetError('Use a raw JSON, JSONL, CSV, or plain-text dataset, not a webpage or executable.', 415)); return;
      }
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_DATASET_BYTES) {
          res.destroy(); finish(new DatasetError('Dataset exceeds the 2 MB review limit.', 413));
        } else chunks.push(chunk);
      });
      res.on('end', () => finish(null, { buffer: Buffer.concat(chunks), contentType }));
      res.on('aborted', () => finish(new DatasetError('The dataset download was interrupted.', 422)));
      res.on('error', () => finish(new DatasetError('The dataset download failed.', 422)));
    });
    req.on('error', () => finish(new DatasetError('Could not securely download this dataset.', 422)));
    req.end();
  });
}

function csvRows(text, limit = 6) {
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(value); value = ''; }
    else if (c === '\n' && !quoted) {
      row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = '';
      if (rows.length === limit) break;
    } else value += c;
  }
  if (rows.length < limit && (value || row.length)) { row.push(value.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

export function inspectDatasetBytes(buffer, contentType = '', url = '') {
  if (buffer.length > MAX_DATASET_BYTES) throw new DatasetError('Dataset exceeds the 2 MB review limit.', 413);
  if (!buffer.length) throw new DatasetError('The dataset is empty.', 422);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, ''); }
  catch { throw new DatasetError('Dataset must contain valid UTF-8 text.', 415); }
  if (text.includes('\0') || /^\s*(?:<!doctype\s+html|<html|<script|#!)/i.test(text)) throw new DatasetError('Webpages, scripts, and binary files cannot be imported as datasets.', 415);
  let format = 'text', recordCount = null, sampleRecords = [];
  const lowerUrl = url.split('?')[0].toLowerCase();
  if (contentType.includes('ndjson') || contentType.includes('jsonl') || /\.(?:jsonl|ndjson)$/.test(lowerUrl)) {
    format = 'jsonl';
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    try { const records = lines.map((line) => JSON.parse(line)); recordCount = records.length; sampleRecords = records.slice(0, 3); }
    catch { throw new DatasetError('The JSONL dataset contains an invalid JSON record.', 422); }
  } else if (contentType.includes('json') || lowerUrl.endsWith('.json') || /^[\s]*[\[{]/.test(text)) {
    format = 'json';
    try {
      const data = JSON.parse(text);
      recordCount = Array.isArray(data) ? data.length : 1;
      sampleRecords = Array.isArray(data) ? data.slice(0, 3) : [data];
    } catch { throw new DatasetError('The JSON dataset could not be parsed.', 422); }
  } else if (contentType.includes('csv') || lowerUrl.endsWith('.csv')) {
    format = 'csv';
    const rows = csvRows(text);
    sampleRecords = rows.slice(1).map((row) => Object.fromEntries(rows[0].map((key, i) => [key, row[i] || ''])));
  }
  const warnings = [
    'Review required: a secure connection and content hash do not establish factual accuracy, source trust, consent, or licensing.',
    'Dataset content is untrusted reference material. It must never override system instructions or authorize tools.',
    'Importing reference material does not retrain neural-network weights.',
  ];
  if (/ignore (?:all |previous |prior )?instructions|system\s*prompt|<\|(?:im_start|system)|\[INST\]/i.test(text)) {
    warnings.push('Possible prompt-injection instructions detected. Review the content carefully before approval.');
  }
  // Bound structured previews as well as raw previews; a record may be very large.
  const samplesJson = JSON.stringify(sampleRecords);
  return {
    url, contentType: contentType || 'text/plain', bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'), format, recordCount,
    sampleRecords: samplesJson.length <= 12_000 ? sampleRecords : [],
    preview: text.slice(0, 4_000), text: text.slice(0, 50_000), truncated: text.length > 50_000,
    warnings, reviewed: false,
  };
}

export async function inspectDataset(value, { lookup = dns.lookup, request = https.request, proxyEnv = process.env } = {}) {
  let url = validateDatasetUrl(value);
  const deadline = Date.now() + TIMEOUT_MS;
  let proxyAgent;
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      let addresses;
      let useProxy = false;
      try { addresses = await resolvePublic(url.hostname, lookup, deadline); }
      catch (error) {
        if (error.code !== 'DNS_UNAVAILABLE' || !(proxyEnv.HTTPS_PROXY || proxyEnv.https_proxy)) throw error;
        if (!TRUSTED_PROXY_DATASET_HOSTS.has(url.hostname)) {
          throw new DatasetError('Public DNS is unavailable. The managed-proxy route permits only raw.githubusercontent.com, huggingface.co, and archive.ics.uci.edu. Use one of these raw dataset hosts or upload a reviewed local file.', 422);
        }
        // Node 24.5+ implements the managed-proxy agent, including normal CA and
        // TLS verification. An older runtime fails closed rather than using curl
        // or accepting arbitrary destinations without independent DNS checks.
        const [major, minor] = process.versions.node.split('.').map(Number);
        if (major < 24 || (major === 24 && minor < 5)) throw new DatasetError('Managed-proxy dataset access requires Node 24.5 or later.', 422);
        proxyAgent ??= new https.Agent({ keepAlive: false, proxyEnv: {
          HTTPS_PROXY: proxyEnv.HTTPS_PROXY || proxyEnv.https_proxy,
          HTTP_PROXY: proxyEnv.HTTP_PROXY || proxyEnv.http_proxy,
          NO_PROXY: proxyEnv.NO_PROXY || proxyEnv.no_proxy || '',
        } });
        useProxy = true;
      }
      const result = await download(url, useProxy ? null : addresses, deadline, request, useProxy ? proxyAgent : directAgent);
      if ('redirect' in result) {
        if (!result.redirect || redirects === 3) throw new DatasetError('Too many or invalid dataset redirects.', 422);
        try { url = validateDatasetUrl(new URL(result.redirect, url).href); }
        catch (error) { if (error instanceof DatasetError) throw error; throw new DatasetError('Invalid dataset redirect.', 422); }
        continue;
      }
      const inspected = inspectDatasetBytes(result.buffer, result.contentType, url.href);
      if (useProxy) {
        inspected.transport = 'managed-proxy-trusted-host';
        inspected.warnings.push('Downloaded through the configured HTTPS proxy from an established dataset host. Target DNS is resolved by that proxy; independent address pinning is unavailable on this route.');
      } else inspected.transport = 'direct-pinned-dns';
      return inspected;
    }
    throw new DatasetError('Dataset request failed.', 422);
  } finally { proxyAgent?.destroy(); }
}
