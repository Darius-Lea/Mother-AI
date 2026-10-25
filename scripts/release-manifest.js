/**
 * Build the public catalog only from completed desktop builds.
 * After electron-builder exits successfully, scripts/desktop-verify-artifacts.cjs
 * writes <artifact>.build.json receipts. Run this script after that verification.
 * Missing receipts exclude an artifact; metadata/digest mismatches fail the scan.
 * Headers plus a build receipt do not establish OS launch testing, signing, or publication.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageInfo = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const releaseRoot = path.join(root, 'releases');
const artifacts = [];
const names = new Set();
const allowedName = /^Mother-AI-([0-9][0-9A-Za-z.+_-]*)-(win|windows|mac|darwin|linux)-(x64|x86_64|amd64|arm64|aarch64|ia32)\.(exe|AppImage|deb|dmg)$/;

async function checksum(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyPackage(file, format, size) {
  const descriptor = await open(file, 'r');
  try {
    const head = Buffer.alloc(12);
    await descriptor.read(head, 0, head.length, 0);
    if (format === 'exe' && head.subarray(0, 2).toString() !== 'MZ') throw new Error('Windows package is not an executable.');
    if (format === 'AppImage' && (head.subarray(0, 4).toString('hex') !== '7f454c46' || head[8] !== 0x41 || head[9] !== 0x49)) throw new Error('AppImage signature is missing.');
    if (format === 'deb' && head.subarray(0, 8).toString() !== '!<arch>\n') throw new Error('Debian package signature is missing.');
    if (format === 'dmg') {
      const tail = Buffer.alloc(4);
      await descriptor.read(tail, 0, 4, size - 512);
      if (tail.toString() !== 'koly') throw new Error('Disk image trailer is missing.');
    }
  } finally { await descriptor.close(); }
}

async function scan(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT' && directory === releaseRoot) return; throw error; }
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    // An unpacked application executable is not a downloadable installer.
    if (entry.isDirectory()) {
      if (!/(?:unpacked|\.app$|node_modules|builder-effective-config)/i.test(entry.name)) await scan(file);
      continue;
    }
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const match = entry.name.match(allowedName);
    if (!match || match[1] !== packageInfo.version) continue;
    let receiptStat;
    try { receiptStat = await lstat(`${file}.build.json`); }
    catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`Skipping package without a successful-build receipt: ${entry.name}`);
        continue;
      }
      throw error;
    }
    if (!receiptStat.isFile() || receiptStat.isSymbolicLink() || receiptStat.size > 16384) throw new Error(`Invalid build receipt: ${entry.name}`);
    let receipt;
    try { receipt = JSON.parse(await readFile(`${file}.build.json`, 'utf8')); }
    catch { throw new Error(`Unreadable build receipt: ${entry.name}`); }
    const platform = ['win', 'windows'].includes(match[2]) ? 'windows' : ['mac', 'darwin'].includes(match[2]) ? 'mac' : 'linux';
    if (receipt?.status !== 'build-completed' || receipt.version !== packageInfo.version || receipt.filename !== entry.name || receipt.platform !== platform || !/^[a-f0-9]{64}$/.test(receipt.sha256 || '')) {
      throw new Error(`Build receipt does not match this package: ${entry.name}`);
    }
    if (names.has(entry.name)) throw new Error(`Duplicate release filename: ${entry.name}`);
    const resolved = await realpath(file);
    if (!resolved.startsWith(`${await realpath(releaseRoot)}${path.sep}`)) throw new Error('Release escaped the release directory.');
    const stat = await lstat(resolved);
    if (!stat.size) throw new Error(`Empty release artifact: ${entry.name}`);
    const digest = await checksum(resolved);
    if (digest !== receipt.sha256) throw new Error(`Package checksum differs from its completed-build receipt: ${entry.name}`);
    await verifyPackage(resolved, match[4], stat.size);
    names.add(entry.name);
    artifacts.push({
      filename: entry.name,
      version: match[1],
      platform,
      architecture: ({x86_64:'x64',amd64:'x64',aarch64:'arm64'})[match[3]] || match[3],
      format: match[4].toLowerCase(),
      size: stat.size,
      sha256: digest,
      downloadUrl: `/downloads/${encodeURIComponent(entry.name)}`,
      signing: 'unsigned',
      relativePath: path.relative(releaseRoot, resolved).split(path.sep).join('/'),
    });
  }
}

await scan(releaseRoot);
artifacts.sort((a,b) => `${a.platform}-${a.architecture}-${a.format}`.localeCompare(`${b.platform}-${b.architecture}-${b.format}`));
const manifest = { version: packageInfo.version, generatedAt: new Date().toISOString(), artifacts };
await writeFile(path.join(root, 'public', 'downloads.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Release manifest: ${artifacts.length} real installer artifact(s) for ${packageInfo.version}.`);
