'use strict';

const APP_ORIGIN = 'mother://app';
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

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
      || (url.hostname === 'github.com' && /^\/Darius-Lea\/Mother-AI(?:\/.*)?$/.test(url.pathname));
  } catch { return false; }
}

module.exports = { APP_ORIGIN, CSP, isAppUrl, isAllowedExternalUrl, officialDownloadUrl };
