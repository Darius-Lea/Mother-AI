/** Catalog only completed consumer installers. No ZIPs, sources, portable apps,
 * or bare executables are offered as setup packages. A receipt, file header and
 * digest prove a completed build, not native installation testing or signing. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import packageInfo from '../package.json' with { type: 'json' };
import { INSTALLER_NAME, PREVIEW_DOWNLOAD_BASE } from '../server/downloads-validation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function checksum(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyPackage(file, format) {
  const descriptor = await open(file, 'r');
  try {
    const head = Buffer.alloc(8);
    await descriptor.read(head, 0, head.length, 0);
    if (format === 'exe' && head.subarray(0,2).toString() !== 'MZ') throw Error('Windows installer is not an executable.');
    if (format === 'deb' && head.toString() !== '!<arch>\n') throw Error('Debian package signature is missing.');
    if (format === 'pkg' && head.subarray(0,4).toString() !== 'xar!') throw Error('Mac installer package signature is missing.');
  } finally { await descriptor.close(); }
}

export async function buildReleaseManifest({ directory = path.join(root,'releases'), version = packageInfo.version, baseUrl = '' } = {}) {
  if (baseUrl && baseUrl !== PREVIEW_DOWNLOAD_BASE) throw Error('Use the approved Mother preview download location.');
  const artifacts = [];
  const names = new Set();
  let canonicalRoot;
  try { canonicalRoot = await realpath(directory); }
  catch (error) {
    if (error.code === 'ENOENT') return { version, generatedAt: new Date().toISOString(), artifacts };
    throw error;
  }

  async function scan(folder) {
    for (const entry of await readdir(folder,{withFileTypes:true})) {
      const file = path.join(folder,entry.name);
      if (entry.isDirectory()) {
        if (!/(?:unpacked|\.app$|node_modules|builder-effective-config)/i.test(entry.name)) await scan(file);
        continue;
      }
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const match = entry.name.match(INSTALLER_NAME);
      if (!match || match[1] !== version) continue;
      const platform = ['win','windows'].includes(match[2]) ? 'windows' : ['mac','darwin'].includes(match[2]) ? 'mac' : 'linux';
      const format = ({windows:'exe',mac:'pkg',linux:'deb'})[platform];
      if (match[4] !== format) throw Error(`Installer format does not match its platform: ${entry.name}`);
      let receiptInfo;
      try { receiptInfo = await lstat(`${file}.build.json`); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (!receiptInfo.isFile() || receiptInfo.isSymbolicLink() || receiptInfo.size > 16384) throw Error(`Invalid build receipt: ${entry.name}`);
      let receipt;
      try { receipt = JSON.parse(await readFile(`${file}.build.json`,'utf8')); }
      catch { throw Error(`Unreadable build receipt: ${entry.name}`); }
      if (receipt?.status !== 'build-completed' || receipt.version !== version || receipt.filename !== entry.name || receipt.platform !== platform || receipt.kind !== 'installer' || !/^[a-f0-9]{64}$/.test(receipt.sha256 || '')) throw Error(`Build receipt does not match this installer: ${entry.name}`);
      if (names.has(entry.name)) throw Error(`Duplicate installer filename: ${entry.name}`);
      const resolved = await realpath(file);
      if (!resolved.startsWith(canonicalRoot + path.sep)) throw Error('Installer escaped the release directory.');
      const info = await lstat(resolved);
      if (!info.isFile() || info.size < 1024 * 1024 || info.size !== receipt.bytes) throw Error(`Installer size differs from its completed-build receipt: ${entry.name}`);
      const digest = await checksum(resolved);
      if (digest !== receipt.sha256) throw Error(`Installer checksum differs from its completed-build receipt: ${entry.name}`);
      const suffix = entry.name.match(/-([a-f0-9]{12})\.(?:exe|pkg|deb)$/)?.[1];
      if (suffix && !digest.startsWith(suffix)) throw Error(`Installer filename does not match its checksum: ${entry.name}`);
      await verifyPackage(resolved,format);
      names.add(entry.name);
      const artifact = {
        filename: entry.name, version, platform, architecture: ({x86_64:'x64',amd64:'x64',aarch64:'arm64'})[match[3]] || match[3], format,
        size: info.size, sha256: digest,
        downloadUrl: baseUrl ? `${baseUrl}/${entry.name}` : `/downloads/${entry.name}`,
        // Signing and native install testing are not established by a build receipt.
        signing: 'unsigned', kind: 'installer', nativeInstallTested: false,
      };
      if (!baseUrl) artifact.relativePath = path.relative(canonicalRoot,resolved).split(path.sep).join('/');
      artifacts.push(artifact);
    }
  }
  await scan(canonicalRoot);
  artifacts.sort((a,b)=>`${a.platform}-${a.architecture}`.localeCompare(`${b.platform}-${b.architecture}`));
  return { version, generatedAt: new Date().toISOString(), artifacts };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  let output = path.join(root,'public','downloads.json');
  for (let index=2;index<process.argv.length;index+=2) {
    const flag=process.argv[index], value=process.argv[index+1];
    if (!value || !['--directory','--output','--base-url'].includes(flag)) throw Error('Use --directory DIR --output FILE --base-url URL.');
    if (flag === '--directory') options.directory = path.resolve(value);
    if (flag === '--output') output = path.resolve(value);
    if (flag === '--base-url') options.baseUrl = value;
  }
  const manifest = await buildReleaseManifest(options);
  await writeFile(output,`${JSON.stringify(manifest,null,2)}\n`);
  console.log(`Installer catalog: ${manifest.artifacts.length} completed installer(s) for ${manifest.version}.`);
}
