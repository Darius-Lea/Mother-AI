// The download page accepts installer assets from Mother's preview channel only.
// Never turn a catalog entry into an arbitrary navigation or source-code download.
export const PREVIEW_DOWNLOAD_BASE = 'https://github.com/Darius-Lea/Mother-AI/releases/download/mother-preview';
export const PREVIEW_MANIFEST_URL = `${PREVIEW_DOWNLOAD_BASE}/downloads.json`;
export const INSTALLER_NAME = /^Mother-AI-([0-9][0-9A-Za-z.+_-]*)-(win|windows|mac|darwin|linux)-(x64|x86_64|amd64|arm64|aarch64)(?:-[a-f0-9]{12})?\.(exe|pkg|deb)$/;

export function normalizeInstaller(item, { version, remoteOnly = false } = {}) {
  if (!item || typeof item !== 'object') return null;
  const match = typeof item.filename === 'string' && item.filename.match(INSTALLER_NAME);
  if (!match || match[1] !== item.version || (version && item.version !== version)) return null;
  const platform = ['win', 'windows'].includes(match[2]) ? 'windows' : ['mac', 'darwin'].includes(match[2]) ? 'mac' : 'linux';
  const architecture = ({x86_64:'x64',amd64:'x64',aarch64:'arm64'})[match[3]] || match[3];
  const format = ({ windows: 'exe', mac: 'pkg', linux: 'deb' })[platform];
  if (match[4] !== format || item.platform !== platform || item.format !== format || item.architecture !== architecture || item.kind !== 'installer') return null;
  if (!Number.isSafeInteger(item.size) || item.size < 1024 * 1024 || !/^[a-f0-9]{64}$/.test(item.sha256 || '')) return null;
  const suffix = item.filename.match(/-([a-f0-9]{12})\.(?:exe|pkg|deb)$/)?.[1];
  if (suffix && !item.sha256.startsWith(suffix)) return null;
  const directUrl = `${PREVIEW_DOWNLOAD_BASE}/${item.filename}`;
  const localUrl = `/downloads/${item.filename}`;
  if (item.downloadUrl !== directUrl && (remoteOnly || item.downloadUrl !== localUrl)) return null;
  return {
    filename: item.filename, version: item.version, platform, architecture, format,
    size: item.size, sha256: item.sha256, downloadUrl: item.downloadUrl,
    signing: item.signing === 'signed' ? 'signed' : 'unsigned', kind: 'installer',
    nativeInstallTested: item.nativeInstallTested === true,
  };
}

export function installerArchitectures(platform) {
  return platform === 'linux' ? ['x64'] : ['x64', 'arm64'];
}
