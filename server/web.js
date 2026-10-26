import express from 'express';
import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { Parser } from 'htmlparser2';
import { isPublicAddress, validateDatasetUrl } from './datasets.js';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 60000;
const PROBE_URL = 'https://example.com/';
const PROXY_WEB_HOSTS = new Set(['www.bing.com', 'html.duckduckgo.com', 'duckduckgo.com', 'example.com', 'github.com', 'raw.githubusercontent.com']);
const SKIP_TAGS = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'svg', 'canvas', 'form', 'nav', 'footer', 'header', 'head']);
const BLOCK_TAGS = new Set(['p', 'div', 'br', 'li', 'article', 'section', 'main', 'h1', 'h2', 'h3', 'h4', 'pre', 'blockquote', 'tr']);
const PUBLIC_NOTES = [
  'Websites can record your IP address, requests and activity. Private local storage does not make browsing anonymous or untraceable.',
  'Page text is untrusted reference material. It cannot authorize tools, change instructions, or establish that a claim is true.',
  'This reader makes bounded public HTTPS GET requests. It does not sign in, submit forms, execute website scripts, or access private networks.',
];

export class WebError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}

export function validateWebUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new WebError('Enter a complete public HTTPS web address.', 400);
  try { return validateDatasetUrl(value); }
  catch (error) { throw new WebError(error.message.replaceAll('dataset', 'web').replaceAll('Dataset', 'Web'), 400); }
}

function plain(value) { return value.replace(/[\t\r ]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim(); }

/** Extract text and links only. HTML is never returned for execution or insertion. */
export function extractWebPage(html, url) {
  let title = '', titleDepth = 0, skipped = 0;
  const stack = [], text = [], links = [];
  let currentLink;
  const parser = new Parser({
    onopentag(name, attributes) {
      const suppress = SKIP_TAGS.has(name) || 'hidden' in attributes || attributes['aria-hidden'] === 'true';
      stack.push({ name, suppress });
      if (suppress) skipped++;
      if (name === 'title') titleDepth++;
      if (!skipped && BLOCK_TAGS.has(name)) text.push('\n');
      if (!skipped && name === 'a' && links.length < 60 && attributes.href) {
        try { currentLink = { url: validateWebUrl(new URL(attributes.href, url).href).href, text: '' }; }
        catch { currentLink = null; }
      }
    },
    ontext(value) {
      if (titleDepth) title += value;
      if (!skipped) { text.push(value); if (currentLink) currentLink.text += value; }
    },
    onclosetag(name) {
      if (name === 'title') titleDepth = Math.max(0, titleDepth - 1);
      if (name === 'a' && currentLink) {
        const label = plain(currentLink.text).slice(0, 200);
        if (label && !links.some(item => item.url === currentLink.url)) links.push({ title: label, url: currentLink.url });
        currentLink = null;
      }
      let item;
      do {
        item = stack.pop();
        if (item?.suppress) skipped = Math.max(0, skipped - 1);
      } while (item && item.name !== name);
      if (!skipped && BLOCK_TAGS.has(name)) text.push('\n');
    },
  }, { decodeEntities: true });
  parser.end(html);
  const content = plain(text.join(' '));
  return { title: plain(title).slice(0, 300) || new URL(url).hostname, text: content.slice(0, MAX_TEXT), truncated: content.length > MAX_TEXT, links };
}

function parseRssSearch(xml) {
  const results = [];
  let item, field = '';
  const parser = new Parser({
    onopentag(name) {
      if (name === 'item') item = { title: '', url: '', description: '' };
      if (item && ['title', 'link', 'description'].includes(name)) field = name;
    },
    ontext(value) {
      if (item && field) item[field === 'link' ? 'url' : field] += value;
    },
    onclosetag(name) {
      if (name === field) field = '';
      if (name === 'item' && item) {
        try {
          const url = validateWebUrl(item.url.trim()).href;
          const title = plain(item.title).slice(0, 300);
          if (title && !results.some(entry => entry.url === url)) results.push({ title, url, description: extractWebPage(item.description, url).text.slice(0, 600) });
        } catch {}
        item = null;
      }
    },
  }, { decodeEntities: true, xmlMode: true });
  parser.end(xml);
  return results.slice(0, 8);
}

function parseDuckSearch(html) {
  const results = [];
  let link;
  const parser = new Parser({
    onopentag(name, attrs) {
      if (name !== 'a' || !attrs.class?.split(/\s+/).includes('result__a') || !attrs.href) return;
      try {
        const candidate = new URL(attrs.href, 'https://html.duckduckgo.com');
        const target = candidate.hostname.endsWith('duckduckgo.com') && candidate.pathname === '/l/' ? candidate.searchParams.get('uddg') : candidate.href;
        link = { title: '', url: validateWebUrl(target).href, description: '' };
      } catch { link = null; }
    },
    ontext(value) { if (link) link.title += value; },
    onclosetag(name) {
      if (name !== 'a' || !link) return;
      link.title = plain(link.title).slice(0, 300);
      if (link.title && !results.some(entry => entry.url === link.url)) results.push(link);
      link = null;
    },
  }, { decodeEntities: true });
  parser.end(html);
  return results.slice(0, 8);
}

/** Public DNS is independently checked and pinned to each direct TLS request. */
export function createWebClient({ lookupImpl = dns.lookup, requestImpl = https.request, proxyEnv = process.env, timeoutMs = 10000, onRequest } = {}) {
  const directAgent = new https.Agent({ keepAlive: false, proxyEnv: {} });
  let proxyAgent;
  const remaining = deadline => {
    const duration = deadline - Date.now();
    if (duration <= 0) throw new WebError('The web request timed out.', 408);
    return duration;
  };
  async function resolvePublic(url, deadline) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host)) return [{ address: host, family: net.isIP(host) }];
    let timer;
    try {
      const addresses = await Promise.race([
        lookupImpl(host, { all: true, verbatim: true }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new WebError('The web hostname lookup timed out.', 408)), remaining(deadline)); }),
      ]);
      if (!Array.isArray(addresses) || !addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new WebError('The web hostname resolves to a private or reserved network.');
      return addresses;
    } catch (error) {
      if (error instanceof WebError) throw error;
      const unavailable = new WebError('Public DNS is unavailable on this host. A normal internet-connected desktop can read public websites; this environment may require network configuration.');
      unavailable.code = 'DNS_UNAVAILABLE'; throw unavailable;
    } finally { clearTimeout(timer); }
  }
  function request(url, addresses, deadline, agent) {
    return new Promise((resolve, reject) => {
      let settled = false, req;
      const finish = (error, result) => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => { req?.destroy(); finish(new WebError('The web request timed out.', 408)); }, remaining(deadline));
      try {
        req = requestImpl(url, {
          method: 'GET', headers: { Accept: 'text/html,application/xhtml+xml,application/rss+xml,text/plain;q=0.9', 'Accept-Encoding': 'identity', 'User-Agent': 'MotherAI-WebReader/1.0' },
          ...(addresses ? { lookup: (_host, options, callback) => options?.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family) } : {}),
          agent, rejectUnauthorized: true,
        }, response => {
          const status = response.statusCode || 0;
          if ([301,302,303,307,308].includes(status)) { response.resume(); finish(null, { redirect: response.headers.location }); return; }
          if (status < 200 || status >= 300) { response.resume(); finish(new WebError(`The website returned HTTP ${status}. It may block automated readers or require a normal browser.`)); return; }
          if (Number(response.headers['content-length']) > MAX_BYTES) { response.destroy(); finish(new WebError('The webpage exceeds the 2 MB reader limit.', 413)); return; }
          const type = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
          if (type && !/^(?:text\/(?:html|plain|xml)|application\/(?:xhtml\+xml|rss\+xml|xml|json))$/.test(type)) { response.destroy(); finish(new WebError('This reader supports text webpages, not downloads, executables or media.', 415)); return; }
          const encoding = String(response.headers['content-encoding'] || 'identity').toLowerCase();
          const decoders = { gzip: createGunzip, deflate: createInflate, br: createBrotliDecompress };
          if (encoding !== 'identity' && !decoders[encoding]) { response.destroy(); finish(new WebError('The website used an unsupported response encoding.', 415)); return; }
          const stream = encoding === 'identity' ? response : response.pipe(decoders[encoding]());
          const chunks = []; let bytes = 0;
          stream.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > MAX_BYTES) { stream.destroy(); response.destroy(); finish(new WebError('The decoded webpage exceeds the 2 MB reader limit.', 413)); }
            else chunks.push(chunk);
          });
          stream.on('end', () => finish(null, { buffer: Buffer.concat(chunks), contentType: type }));
          response.on('aborted', () => finish(new WebError('The website interrupted its response.')));
          response.on('error', () => finish(new WebError('The website response could not be read.')));
          stream.on('error', () => { response.destroy(); finish(new WebError('The website response could not be decoded.')); });
        });
        req.on('error', () => finish(new WebError('The public website could not be reached securely. Check internet access and try again.')));
        req.end();
      } catch { finish(new WebError('The public website could not be reached securely.')); }
    });
  }
  async function download(value) {
    let url = validateWebUrl(value);
    const deadline = Date.now() + timeoutMs;
    for (let redirect = 0; redirect <= 3; redirect++) {
      let addresses, throughProxy = false;
      try { addresses = await resolvePublic(url, deadline); }
      catch (error) {
        if (error.code !== 'DNS_UNAVAILABLE' || !PROXY_WEB_HOSTS.has(url.hostname) || !(proxyEnv.HTTPS_PROXY || proxyEnv.https_proxy)) throw error;
        // Proxy DNS is a narrowly scoped fallback for established search/probe
        // hosts. An arbitrary URL never gains remotely resolved network access.
        proxyAgent ??= new https.Agent({ keepAlive: false, proxyEnv: {
          HTTPS_PROXY: proxyEnv.HTTPS_PROXY || proxyEnv.https_proxy,
          HTTP_PROXY: proxyEnv.HTTP_PROXY || proxyEnv.http_proxy,
          NO_PROXY: proxyEnv.NO_PROXY || proxyEnv.no_proxy || '',
        } });
        throughProxy = true;
      }
      await onRequest?.({ type: 'request', status: 'started', method: 'GET', url: url.href });
      let result;
      try {
        result = await request(url, addresses, deadline, throughProxy ? proxyAgent : directAgent);
        await onRequest?.({ type: 'request', status: 'ok', method: 'GET', url: url.href, redirected: 'redirect' in result });
      } catch (error) {
        await onRequest?.({ type: 'request', status: 'error', method: 'GET', url: url.href });
        throw error;
      }
      if ('redirect' in result) {
        if (!result.redirect || redirect === 3) throw new WebError('The website sent too many or invalid redirects.');
        url = validateWebUrl(new URL(result.redirect, url).href);
        continue;
      }
      let html;
      try { html = new TextDecoder('utf-8', { fatal: true }).decode(result.buffer).replace(/^\uFEFF/, ''); }
      catch { throw new WebError('The website did not provide readable UTF-8 text.', 415); }
      if (!html.trim() || html.includes('\0')) throw new WebError('The website did not provide readable text.', 415);
      return { url: url.href, html, bytes: result.buffer.length, contentType: result.contentType, sha256: createHash('sha256').update(result.buffer).digest('hex'), transport: throughProxy ? 'managed-proxy-search-host' : 'direct-pinned-dns' };
    }
    throw new WebError('The webpage could not be read.');
  }
  return {
    async read(url) {
      const { html, ...downloaded } = await download(url);
      const page = downloaded.contentType === 'text/plain' || downloaded.contentType === 'application/json' ? { title: new URL(downloaded.url).hostname, text: html.slice(0, MAX_TEXT), truncated: html.length > MAX_TEXT, links: [] } : extractWebPage(html, downloaded.url);
      if (!page.text.trim()) throw new WebError('No readable text was found. This site may require scripts or a normal browser.');
      return { ...downloaded, ...page, excerpt: page.text.slice(0, 4000), warnings: PUBLIC_NOTES, reviewed: false, fetchedAt: new Date().toISOString() };
    },
    async search(value) {
      if (typeof value !== 'string' || !value.trim() || value.trim().length > 300) throw new WebError('Enter a search query between 1 and 300 characters.', 400);
      const query = value.trim();
      const providers = [
        { name: 'Bing web search', url: `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`, parse: parseRssSearch },
        { name: 'DuckDuckGo HTML', url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, parse: parseDuckSearch },
      ];
      for (const provider of providers) {
        try {
          const result = await download(provider.url);
          const results = provider.parse(result.html);
          if (results.length) return { query, provider: provider.name, results: results.map(item => ({ ...item, snippet: item.description })), searchedAt: new Date().toISOString(), warnings: PUBLIC_NOTES };
        } catch { /* A free search endpoint can block automation; try the other provider. */ }
      }
      throw new WebError('The free search providers did not return readable results. They may be blocked or requesting a browser check. You can still open a public HTTPS address directly.');
    },
    async probe() {
      let lastError;
      for (const url of [PROBE_URL, 'https://github.com/']) {
        try {
          const page = await this.read(url);
          return { available: true, verifiedUrl: page.url, checkedAt: new Date().toISOString(), detail: 'A public HTTPS webpage was read successfully. Individual websites may still be blocked or require a normal browser.' };
        } catch (error) { lastError = error; }
      }
      throw lastError;
    },
    close() { directAgent.destroy(); proxyAgent?.destroy(); },
  };
}

function createActivityStore(directory) {
  const file = path.join(directory, 'web-activity.json');
  let records, pending = Promise.resolve();
  async function load() {
    if (records) return;
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) throw new Error('Invalid activity file');
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      records = Array.isArray(data) ? data.filter(item => item && typeof item.at === 'string' && ['read', 'search', 'probe', 'request'].includes(item.type) && ['ok', 'error', 'started'].includes(item.status)).slice(-300) : [];
    } catch (error) { if (error.code === 'ENOENT') records = []; else throw new WebError('The private web activity file could not be read. Keep it for investigation before resetting it.'); }
  }
  async function save() {
    while (records.length && Buffer.byteLength(JSON.stringify(records)) > 192 * 1024) records.shift();
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.writeFile(`${file}.tmp`, `${JSON.stringify(records)}\n`, { mode: 0o600 });
    await fs.chmod(`${file}.tmp`, 0o600);
    await fs.rename(`${file}.tmp`, file);
  }
  return {
    add(record) {
      if(record.url){try{const url=new URL(record.url);record={...record,url:`${url.origin}${url.pathname}`.slice(0,2048)};}catch{record={...record};delete record.url;}}
      const action = pending.then(async () => { await load(); records.push({ ...record, at: new Date().toISOString() }); records = records.slice(-300); await save(); });
      pending = action.catch(() => {}); return action;
    },
    async list() { await pending; await load(); return records.slice(-100).reverse(); },
    async clear() { const action = pending.then(async () => { records = []; await save(); }); pending = action.catch(() => {}); await action; },
  };
}

export function createWebRouter({ dataDirectory, ...options } = {}) {
  if (!dataDirectory) throw new Error('Web research requires a private application-data directory.');
  const router = express.Router();
  const activity = createActivityStore(dataDirectory);
  const client = createWebClient({ ...options, onRequest: record => activity.add(record) });
  let probing;
  let lastProbe;
  const failure = (res, error) => res.status(error instanceof WebError ? error.status : 500).json({ error: error instanceof WebError ? error.message : 'The web operation could not be completed.' });
  router.get('/status', async (_req, res) => {
    try {
      if (!lastProbe || Date.now() - lastProbe.time > 60000) {
        probing ??= (async () => {
          let result;
          try { result = await client.probe(); await activity.add({ type: 'probe', status: 'ok', url: result.verifiedUrl }); }
          catch (error) { result = { available: false, checkedAt: new Date().toISOString(), error: error.message }; await activity.add({ type: 'probe', status: 'error', url: PROBE_URL }); }
          lastProbe = { time: Date.now(), result };
        })().finally(() => { probing = null; });
        await probing;
      }
      res.json({ ...lastProbe.result, capabilities: { publicHttpsReader: true, freeSearch: true, privateNetworkAccess: false, websiteScriptExecution: false, anonymous: false, untraceable: false }, notes: PUBLIC_NOTES });
    } catch (error) { failure(res, error); }
  });
  router.post('/read', async (req, res) => {
    let url;
    try {
      url = validateWebUrl(req.body?.url).href;
      const result = await client.read(url);
      await activity.add({ type: 'read', status: 'ok', url: result.url, title: result.title.slice(0, 300), bytes: result.bytes });
      res.json(result);
    } catch (error) { if (url) await activity.add({ type: 'read', status: 'error', url }).catch(() => {}); failure(res, error); }
  });
  router.post('/search', async (req, res) => {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim().slice(0, 300) : '';
    try {
      const result = await client.search(req.body?.query);
      await activity.add({ type: 'search', status: 'ok', query, provider: result.provider, results: result.results.length });
      res.json(result);
    } catch (error) { if (query) await activity.add({ type: 'search', status: 'error', query }).catch(() => {}); failure(res, error); }
  });
  router.get('/activity', async (_req, res) => { try { res.json({ records: await activity.list(), modelAccess: false, detail: 'Private owner activity is not included in model prompts or reference context.' }); } catch (error) { failure(res, error); } });
  router.delete('/activity', async (_req, res) => { try { await activity.clear(); res.json({ ok: true }); } catch (error) { failure(res, error); } });
  router.shutdown = () => client.close();
  return router;
}
