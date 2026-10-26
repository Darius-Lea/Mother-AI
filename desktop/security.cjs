'use strict';

const APP_ORIGIN = 'mother://app';
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function isAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'mother:' && url.hostname === 'app' && !url.port && !url.username && !url.password;
  } catch { return false; }
}

function officialDownloadUrl(platform) {
  const pages = { win32: 'windows', darwin: 'mac', linux: 'linux' };
  return `https://ollama.com/download/${pages[platform] || 'linux'}`;
}

function isAllowedExternalUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
    return (url.hostname === 'ollama.com' && /^\/download(?:\/(?:windows|mac|linux))?\/?$/.test(url.pathname))
      || (url.hostname === 'github.com' && (/^\/Darius-Lea\/Mother-AI\/?$/.test(url.pathname)
        || /^\/Darius-Lea\/Mother-AI\/releases\/download\/mother-preview\/Mother-AI-[0-9A-Za-z.+_-]+\.(?:exe|pkg|deb)$/.test(url.pathname)) && !url.search && !url.hash);
  } catch { return false; }
}

module.exports = { APP_ORIGIN, CSP, isAppUrl, isAllowedExternalUrl, officialDownloadUrl };
