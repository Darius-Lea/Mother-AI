import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const {version} = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
let buildCommit = null;
try { buildCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:root, encoding:'utf8', stdio:['ignore','pipe','ignore']}).trim(); } catch {}
if (!/^[a-f0-9]{40}$/.test(buildCommit || '')) buildCommit = null;
await writeFile(new URL('server/build-info.json', root), JSON.stringify({version, buildCommit, buildTime:new Date().toISOString()})+'\n');
