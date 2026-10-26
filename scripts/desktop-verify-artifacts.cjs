'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

async function verifyArtifacts(artifacts, version) {
  const written = [];
  for (const filename of artifacts) {
    const name = path.basename(filename);
    const platform = name.endsWith('.exe') ? 'windows' : /\.(dmg|pkg)$/.test(name) ? 'mac' : /\.(AppImage|deb)$/.test(name) ? 'linux' : null;
    if (!platform) continue;
    if (!name.includes(version)) throw new Error(`Installer version does not match this completed build: ${name}`);
    const stat = await fs.promises.stat(filename);
    if (!stat.isFile() || stat.size < 1024 * 1024) throw new Error(`Installer is unexpectedly small or not a regular file: ${name}`);
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
    const receipt = { status: 'build-completed', version, filename: name, sha256: hash.digest('hex'), platform, kind: name.endsWith('-portable.exe') ? 'portable' : 'installer', bytes: stat.size, signed: false, nativeInstallTested: false };
    const target = `${filename}.build.json`;
    await fs.promises.writeFile(`${target}.tmp`, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    await fs.promises.rename(`${target}.tmp`, target);
    written.push(target);
  }
  return written;
}
module.exports = { verifyArtifacts };
if (require.main === module) {
  if (process.argv[2] !== '--after-successful-build') throw new Error('Run only after a completed builder command, with --after-successful-build and explicit artifact paths.');
  const version = require('../package.json').version;
  verifyArtifacts(process.argv.slice(3), version).then(files => console.log(`Wrote ${files.length} completed-build receipts.`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
