/** Publish verified binaries to a rolling PREVIEW channel, never a stable release.
 * Installers have content-addressed names. Publish the catalog last and retain
 * old binaries so clients holding a cached catalog still receive matching bytes.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY = 'Darius-Lea/Mother-AI';
const TAG = 'mother-preview';
const API = `https://api.github.com/repos/${REPOSITORY}`;
const BASE_URL = `https://github.com/${REPOSITORY}/releases/download/${TAG}`;
const REQUIRED_TARGETS = new Set(['windows:x64:exe', 'windows:arm64:exe', 'mac:x64:pkg', 'mac:arm64:pkg', 'linux:x64:deb']);
const SAFE_NAME = /^Mother-AI-([0-9][0-9A-Za-z.+_-]*)-(win|windows|mac|darwin|linux)-(x64|amd64|x86_64|arm64|aarch64)\.(exe|pkg|deb)$/;

export function publicationPlan(input, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Publication requires the exact source commit.');
  if (!input || typeof input.version !== 'string' || !/^[0-9][0-9A-Za-z.+_-]*$/.test(input.version) || !Array.isArray(input.artifacts)) throw new Error('Invalid verified installer catalog.');
  const targets = new Set();
  const names = new Set();
  const uploads = [];
  const artifacts = input.artifacts.map(artifact => {
    const match = typeof artifact.filename === 'string' && artifact.filename.match(SAFE_NAME);
    const target = `${artifact.platform}:${artifact.architecture}:${artifact.format}`;
    const namedPlatform = match && ({ win: 'windows', windows: 'windows', mac: 'mac', darwin: 'mac', linux: 'linux' })[match[2]];
    const namedArchitecture = match && (({ amd64: 'x64', x86_64: 'x64', aarch64: 'arm64' })[match[3]] || match[3]);
    if (!match || match[1] !== input.version || artifact.version !== input.version || namedPlatform !== artifact.platform || namedArchitecture !== artifact.architecture || match[4] !== artifact.format || !REQUIRED_TARGETS.has(target) || targets.has(target) || names.has(artifact.filename) || artifact.kind !== 'installer' || !Number.isSafeInteger(artifact.size) || artifact.size < 1024 * 1024 || !/^[a-f0-9]{64}$/.test(artifact.sha256 || '') || artifact.signing !== 'unsigned' || artifact.nativeInstallTested !== false) throw new Error('The preview requires one verified, accurately labeled installer per supported target.');
    if (artifact.downloadUrl !== `${BASE_URL}/${artifact.filename}`) throw new Error('Installer catalog points outside the approved preview channel.');
    const extension = artifact.filename.slice(artifact.filename.lastIndexOf('.'));
    const name = `${artifact.filename.slice(0, -extension.length)}-${artifact.sha256.slice(0, 12)}${extension}`;
    uploads.push({ sourceName: artifact.filename, relativePath: artifact.relativePath || artifact.filename, filename: name, size: artifact.size, sha256: artifact.sha256 });
    targets.add(target); names.add(artifact.filename);
    const { relativePath: _relativePath, ...publicArtifact } = artifact;
    return { ...publicArtifact, filename: name, downloadUrl: `${BASE_URL}/${name}` };
  });
  if (targets.size !== REQUIRED_TARGETS.size) throw new Error('All five platform installers must finish before publication.');
  return { uploads, manifest: { version: input.version, generatedAt: new Date().toISOString(), sourceCommit: commit, channel: 'preview', artifacts } };
}

async function verifyFile(directory, upload) {
  const base = await realpath(directory);
  if (path.isAbsolute(upload.relativePath) || upload.relativePath.split(/[\\/]/).some(part => part === '..')) throw new Error('Installer path escaped the completed build directory.');
  const source = path.join(base, upload.relativePath);
  const entry = await lstat(source);
  const resolved = await realpath(source);
  if (!entry.isFile() || entry.isSymbolicLink() || !resolved.startsWith(`${base}${path.sep}`) || entry.size !== upload.size) throw new Error(`Installer file does not match the verified catalog: ${upload.sourceName}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(resolved)) hash.update(chunk);
  if (hash.digest('hex') !== upload.sha256) throw new Error(`Installer checksum changed after validation: ${upload.sourceName}`);
  return resolved;
}

export async function publishPreview({ directory, commit = process.env.GITHUB_SHA, repository = process.env.GITHUB_REPOSITORY, token = process.env.GITHUB_TOKEN, fetchImpl = fetch, report = console.log }) {
  if (repository !== REPOSITORY || !token) throw new Error('Publication requires this repository’s Actions token.');
  const input = JSON.parse(await readFile(path.join(directory, 'downloads.json'), 'utf8'));
  const plan = publicationPlan(input, commit);
  for (const upload of plan.uploads) upload.path = await verifyFile(directory, upload);
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  async function api(route, { method = 'GET', body, allowMissing = false } = {}) {
    const response = await fetchImpl(`${API}${route}`, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub preview ${method} failed (${response.status}).`);
    return response.status === 204 ? null : response.json();
  }
  async function isCurrent() {
    const branch = await api('/git/ref/heads/main');
    return branch?.object?.sha === commit;
  }
  if (!await isCurrent()) { report('A newer main update exists; keeping the current preview catalog.'); return { published: false, reason: 'stale-commit' }; }
  let release = await api(`/releases/tags/${TAG}`, { allowMissing: true });
  if (release && (release.tag_name !== TAG || release.prerelease !== true || release.draft !== false)) throw new Error('Refusing to modify a release that is not the approved public preview channel.');
  const body = `First-release preview downloads for Mother AI.\n\nThese are unsigned preview installers, not a market-ready production release. Your operating system may ask for installation approval. Model weights download separately inside Mother after you approve the download. Native installation has not yet been verified on every supported device.\n\nBuilt from commit ${commit}. Use the Download Mother button on the website for the appropriate installer. These files do not require ZIP extraction or a terminal.`;
  if (!release) release = await api('/releases', { method: 'POST', body: { tag_name: TAG, target_commitish: commit, name: 'Mother AI — first-release preview', body, draft: false, prerelease: true, make_latest: 'false' } });
  if (!Number.isSafeInteger(release.id) || release.id < 1) throw new Error('GitHub did not return a valid preview release.');
  const assets = [];
  for (let page = 1; page <= 100; page++) {
    const batch = await api(`/releases/${release.id}/assets?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('GitHub returned an invalid preview asset listing.');
    assets.push(...batch);
    if (batch.length < 100) break;
    if (page === 100) throw new Error('Preview asset listing is unexpectedly large.');
  }
  const uploadBase = `https://uploads.github.com/repos/${REPOSITORY}/releases/${release.id}/assets`;
  async function uploadAsset(name, data, size, contentType) {
    try {
      const response = await fetchImpl(`${uploadBase}?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { ...headers, 'Content-Type': contentType, 'Content-Length': String(size) }, body: data, duplex: 'half', redirect: 'error', signal: AbortSignal.timeout(600000) });
      if (!response.ok) throw new Error(`GitHub preview asset upload failed (${response.status}): ${name}`);
      const asset = await response.json();
      if (asset.name !== name || asset.size !== size || asset.state !== 'uploaded') throw new Error(`GitHub did not confirm the complete uploaded file: ${name}`);
      return asset;
    } finally { data?.destroy?.(); }
  }
  for (const upload of plan.uploads) {
    const existing = assets.find(asset => asset.name === upload.filename);
    if (existing) {
      if (existing.size !== upload.size || existing.state !== 'uploaded' || existing.digest !== `sha256:${upload.sha256}`) throw new Error(`Existing preview asset is not the expected immutable installer: ${upload.filename}`);
    } else {
      await uploadAsset(upload.filename, createReadStream(upload.path), upload.size, 'application/octet-stream');
    }
    report(`Preview installer ready: ${upload.filename}`);
  }
  if (!await isCurrent()) { report('Main advanced during upload; the preview catalog was not changed.'); return { published: false, reason: 'stale-commit' }; }
  const previousCatalog = assets.find(asset => asset.name === 'downloads.json');
  const catalog = Buffer.from(`${JSON.stringify(plan.manifest, null, 2)}\n`);
  // GitHub cannot atomically replace an asset. Delete only this small discovery
  // document immediately before upload. Cached catalogs keep valid old binaries.
  if (previousCatalog) await api(`/releases/assets/${previousCatalog.id}`, { method: 'DELETE' });
  await uploadAsset('downloads.json', catalog, catalog.length, 'application/json');
  await api(`/releases/${release.id}`, { method: 'PATCH', body: { name: 'Mother AI — first-release preview', body, draft: false, prerelease: true, make_latest: 'false' } });
  report(`Direct preview downloads published for ${commit.slice(0, 12)}.`);
  return { published: true, manifest: plan.manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directoryIndex = process.argv.indexOf('--directory');
  if (directoryIndex < 0 || !process.argv[directoryIndex + 1]) throw new Error('Pass --directory with the verified installer directory.');
  await publishPreview({ directory: path.resolve(process.argv[directoryIndex + 1]) }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
