import { readFileSync } from 'node:fs';
import packageInfo from '../package.json' with { type: 'json' };
let info;
try { info=JSON.parse(readFileSync(new URL('./build-info.json',import.meta.url),'utf8')); } catch {}
export const BUILD_INFO=Object.freeze({
  version:packageInfo.version,
  buildCommit:/^[a-f0-9]{40}$/.test(info?.buildCommit||'')?info.buildCommit:null,
  buildTime:info?.version===packageInfo.version && Number.isFinite(Date.parse(info?.buildTime))?info.buildTime:null,
});
