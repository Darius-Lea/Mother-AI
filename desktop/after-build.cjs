'use strict';
// Build completion alone cannot establish a usable archive: concurrent source
// writes can change ASAR offsets while it is packed. Reject such output before
// creating the receipts used by the download catalog.
const { verifyArtifacts } = require('../scripts/desktop-verify-artifacts.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const asar = require('@electron/asar');
const { verifyBundle } = require('./runtime.cjs');

function validateArchive(archive, projectRoot) {
  const entries = asar.listPackage(archive).map(name => name.replaceAll('\\', '/'));
  let checked = 0;
  for (const name of entries.filter(entry => /^\/server\/.*\.js$/.test(entry) || /^\/desktop\/[^/]+\.cjs$/.test(entry))) {
    const relative = name.slice(1);
    // ASAR's lookup uses the host path separator internally. Keep listing
    // comparisons portable, but convert member names back to native paths.
    const packaged = asar.extractFile(archive, path.normalize(relative));
    const source = fs.readFileSync(path.join(projectRoot, relative));
    if (!packaged.equals(source)) throw new Error(`Packaged source changed during build: ${relative}. Rebuild from an unchanged source tree.`);
    const syntax = spawnSync(process.execPath, ['--check', `--input-type=${name.endsWith('.cjs') ? 'commonjs' : 'module'}`], { input: packaged, encoding: 'utf8' });
    if (syntax.status !== 0) throw new Error(`Packaged source does not parse: ${relative}\n${syntax.stderr}`);
    checked++;
  }
  for (const name of entries.filter(entry => entry.startsWith('/dist/'))) {
    const source = path.join(projectRoot, name.slice(1));
    if (!fs.statSync(source).isFile()) continue;
    if (!asar.extractFile(archive, path.normalize(name.slice(1))).equals(fs.readFileSync(source))) throw new Error(`Packaged interface changed during build: ${name}. Rebuild from an unchanged source tree.`);
  }
  const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  if (metadata.version !== require('../package.json').version) throw new Error('Packaged version does not match the completed build.');
  if (!checked || !entries.includes('/desktop/main.cjs') || !entries.includes('/server/index.js') || !entries.includes('/dist/index.html')) throw new Error('The application archive is missing its entry points.');
}

module.exports = async context => {
  const projectRoot = path.resolve(__dirname, '..');
  const output = path.resolve(projectRoot, 'releases', 'desktop');
  const platforms = new Set(context.artifactPaths.map(file => /\.exe$/.test(file) ? 'win' : /\.(AppImage|deb)$/.test(file) ? 'linux' : /\.(dmg|pkg)$/.test(file) ? 'mac' : null));
  const archives = [];
  if (platforms.has('linux')) archives.push(path.join(output, 'linux-unpacked', 'resources', 'app.asar'));
  if (platforms.has('win')) {
    for (const entry of fs.readdirSync(output, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^win(?:-[a-z0-9]+)?-unpacked$/.test(entry.name))) archives.push(path.join(output, entry.name, 'resources', 'app.asar'));
  }
  if (platforms.has('mac')) {
    for (const entry of fs.readdirSync(output, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^mac(?:-|$)/.test(entry.name))) {
      for (const app of fs.readdirSync(path.join(output, entry.name), { withFileTypes: true }).filter(item => item.isDirectory() && item.name.endsWith('.app'))) archives.push(path.join(output, entry.name, app.name, 'Contents', 'Resources', 'app.asar'));
    }
  }
  if (!archives.length) throw new Error('No packaged application archive was found for the completed installers.');
  for (const archive of archives) {
    validateArchive(archive, projectRoot);
    const target = path.relative(output, archive).split(path.sep)[0];
    await verifyBundle({
      resourcesPath: path.dirname(archive),
      platform: target.startsWith('win') ? 'win32' : target.startsWith('mac') ? 'darwin' : 'linux',
      arch: target.includes('arm64') ? 'arm64' : 'x64',
    });
  }
  await verifyArtifacts(context.artifactPaths, require('../package.json').version);
  return [];
};
module.exports.validateArchive = validateArchive;
