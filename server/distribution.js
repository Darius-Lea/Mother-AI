import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import packageInfo from '../package.json' with { type: 'json' };
import { normalizeInstaller, PREVIEW_MANIFEST_URL } from './downloads-validation.js';
import {fetchOfficialAsset} from './https-assets.js';
import {randomBytes} from 'node:crypto';

const MAX_CATALOG_BYTES = 64 * 1024;
const allowedRedirectHosts = new Set(['github.com', 'release-assets.githubusercontent.com']);

function validCatalog(value, remoteOnly) {
  if (!value || value.version !== packageInfo.version || !Array.isArray(value.artifacts) || value.artifacts.length > 20) throw Error('Invalid installer catalog.');
  const names = new Set();
  const artifacts = value.artifacts.map(item => {
    const normalized = normalizeInstaller(item, { version: packageInfo.version, remoteOnly });
    if (!normalized || names.has(normalized.filename)) throw Error('Invalid installer entry.');
    names.add(normalized.filename);
    return normalized;
  });
  return { version: packageInfo.version, generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt.slice(0,64) : undefined, artifacts };
}

async function readRemote(fetchImpl, signal) {
  // The rolling catalog changes while installer filenames stay immutable.
  // Avoid a CDN's cached redirect to the previous catalog after publication.
  const fresh=new URL(PREVIEW_MANIFEST_URL);
  fresh.searchParams.set('mother_check',randomBytes(8).toString('hex'));
  let url = fresh.href;
  for (let redirect = 0; redirect <= 3; redirect++) {
    const response = await fetchImpl(url, { signal, redirect: 'manual', headers: { Accept: 'application/json' } });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirect === 3) throw Error('Installer catalog redirect failed.');
      const target = new URL(location, url);
      if (target.protocol !== 'https:' || target.username || target.password || target.port || target.hash || !allowedRedirectHosts.has(target.hostname)) throw Error('Untrusted installer catalog redirect.');
      url = target.href;
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw Error('Installer catalog is not published yet.'); }
    const length = response.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_CATALOG_BYTES)) { await response.body?.cancel(); throw Error('Installer catalog is too large.'); }
    if (!response.body) throw Error('Installer catalog is empty.');
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_CATALOG_BYTES) throw Error('Installer catalog is too large.');
        chunks.push(Buffer.from(value));
      }
    } catch (error) { await reader.cancel().catch(()=>{}); throw error; }
    finally { reader.releaseLock(); }
    return validCatalog(JSON.parse(Buffer.concat(chunks).toString('utf8')), true);
  }
}

/** The public catalog contains direct installer links, never CI artifacts or paths. */
export function createDistributionCatalog({
  fetchImpl = fetchOfficialAsset,
  manifestFile = fileURLToPath(new URL('../public/downloads.json', import.meta.url)),
  releaseRoot = fileURLToPath(new URL('../releases', import.meta.url)),
  now = Date.now,
  cacheMs = 60000,
  timeoutMs = 4000,
} = {}) {
  let cached, expiresAt = 0, pending;
  let localFiles = new Map();

  async function localCatalog() {
    try {
      const info = await stat(manifestFile);
      if (info.size > MAX_CATALOG_BYTES) return null;
      const raw = JSON.parse(await readFile(manifestFile, 'utf8'));
      const validated = validCatalog(raw, false);
      if (!validated.artifacts.length) return null;
      const root = await realpath(releaseRoot);
      const files = new Map();
      for (const artifact of validated.artifacts) {
        const original = raw.artifacts.find(item => item.filename === artifact.filename);
        if (artifact.downloadUrl.startsWith('https:')) return null;
        const relative = original.relativePath || artifact.filename;
        if (typeof relative !== 'string' || path.isAbsolute(relative)) return null;
        const candidate = await realpath(path.join(root, relative));
        const fileInfo = await stat(candidate);
        if (!candidate.startsWith(root + path.sep) || !fileInfo.isFile() || fileInfo.size !== artifact.size) return null;
        files.set(artifact.filename, candidate);
      }
      localFiles = files;
      return { ...validated, status: 'available', source: 'website' };
    } catch { return null; }
  }

  async function refresh() {
    const local = await localCatalog();
    if (local) return local;
    localFiles = new Map();
    try {
      const remote = await readRemote(fetchImpl, AbortSignal.timeout(timeoutMs));
      return { ...remote, status: remote.artifacts.length ? 'available' : 'pending', source: 'github-preview' };
    } catch {
      // Never invent links to unfinished or unverified packages.
      return { version: packageInfo.version, artifacts: [], status: 'pending', source: 'github-preview' };
    }
  }

  return {
    async catalog() {
      if (cached && now() < expiresAt) return cached;
      if (!pending) pending = refresh().then(result => {
        cached = result;
        expiresAt = now() + (result.status === 'available' ? cacheMs : Math.min(cacheMs,15000));
        return result;
      }).finally(() => { pending = null; });
      return pending;
    },
    async localFile(filename) {
      await this.catalog();
      const candidate = localFiles.get(filename);
      if (!candidate) return null;
      try {
        const resolved = await realpath(candidate);
        const root = await realpath(releaseRoot);
        if (resolved !== candidate || !resolved.startsWith(root + path.sep) || !(await stat(resolved)).isFile()) return null;
        return resolved;
      } catch { return null; }
    },
  };
}
