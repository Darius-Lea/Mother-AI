'use strict';
const fs = require('node:fs');
const path = require('node:path');

const RETENTION_BYTES = 512 * 1024;
const NOTICE = 'Activity stays on this device until you clear it or it rotates. URL queries, fragments, credentials, headers, page contents and form bodies are omitted. Website paths can still contain private information. Activity is never sent to Mother’s model.';
const TYPES = new Set(['session-open','session-close','navigation','request','response','request-error','navigation-block','network-block','connection','download-block','permission-block','activity-truncated']);

function cleanUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:','wss:'].includes(url.protocol)) return undefined;
    return `${url.origin}${url.pathname}`.slice(0,1600);
  } catch { return undefined; }
}

function sanitizeRecord(value, now = () => new Date()) {
  const result = { timestamp: now().toISOString(), type: TYPES.has(value?.type) ? value.type : 'request-error' };
  const url = cleanUrl(value?.url);
  if (url) result.url = url;
  if (typeof value?.method === 'string' && /^[A-Z]{1,16}$/.test(value.method)) result.method = value.method;
  if (typeof value?.resourceType === 'string' && /^[A-Za-z]{1,32}$/.test(value.resourceType)) result.resourceType = value.resourceType;
  if (Number.isInteger(value?.status) && value.status >= 100 && value.status <= 599) result.status = value.status;
  if (Number.isInteger(value?.count) && value.count > 0) result.count = Math.min(value.count,1000000);
  // Reason codes are fixed categories supplied by browser policy, never error
  // messages or arbitrary website strings that could contain credentials.
  if (typeof value?.reason === 'string' && /^[a-z-]{1,40}$/.test(value.reason)) result.reason = value.reason;
  return result;
}

function createBrowserAudit({ userData, maxBytes = RETENTION_BYTES, maxQueue = 256, now } = {}) {
  if (typeof userData !== 'string' || !path.isAbsolute(userData)) throw Error('Browser activity requires the private application directory.');
  if (!Number.isInteger(maxBytes) || maxBytes < 2048 || maxBytes > 10 * 1024 * 1024) throw Error('Invalid activity retention limit.');
  const directory = path.join(userData,'audit');
  const current = path.join(directory,'browser-activity.jsonl');
  const previous = `${current}.previous`;
  let initialized = false, closed = false, flushing = null, failure = false;
  let queue = [], dropped = 0;

  async function initialize() {
    if (initialized) return;
    await fs.promises.mkdir(directory,{recursive:true,mode:0o700});
    const info = await fs.promises.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Invalid activity directory.');
    if (process.platform !== 'win32') await fs.promises.chmod(directory,0o700);
    initialized = true;
  }

  async function safeInfo(file) {
    try {
      const info = await fs.promises.lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) throw Error('Invalid activity file.');
      return info;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  async function append(text) {
    await initialize();
    const bytes = Buffer.byteLength(text);
    const existing = await safeInfo(current);
    if (existing && existing.size + bytes > maxBytes) {
      await fs.promises.rm(previous,{force:true});
      await fs.promises.rename(current,previous);
    }
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW || 0);
    const handle = await fs.promises.open(current,flags,0o600);
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw Error('Invalid activity file.');
      if (process.platform !== 'win32') await handle.chmod(0o600);
      await handle.writeFile(text);
    } finally { await handle.close(); }
  }

  function startFlush() {
    if (flushing) return;
    flushing = (async()=>{
      while (queue.length || dropped) {
        if (dropped) {
          queue.push(sanitizeRecord({type:'activity-truncated',count:dropped},now));
          dropped = 0;
        }
        let text = '';
        while (queue.length) {
          const line = `${JSON.stringify(queue[0])}\n`;
          if (text && Buffer.byteLength(text) + Buffer.byteLength(line) > maxBytes) break;
          queue.shift(); text += line;
          if (Buffer.byteLength(text) >= Math.min(32768,maxBytes)) break;
        }
        if (text) await append(text);
      }
      failure = false;
    })().catch(()=>{failure=true;queue=[];dropped=0;}).finally(()=>{
      flushing = null;
      if (queue.length || dropped) startFlush();
    });
  }

  async function flush() { while (flushing) await flushing; }

  async function readFile(file) {
    const info = await safeInfo(file);
    if (!info) return '';
    if (info.size > maxBytes) throw Error('Activity exceeds retention limit.');
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
    const handle = await fs.promises.open(file,flags);
    try { return await handle.readFile('utf8'); }
    finally { await handle.close(); }
  }

  return {
    record(value) {
      if (closed) return;
      if (queue.length >= maxQueue) dropped = Math.min(1000000,dropped+1);
      else queue.push(sanitizeRecord(value,now));
      startFlush();
    },
    available() { return !failure; },
    async read({limit=100}={}) {
      await flush();
      const retention = {maxBytes:maxBytes*2,files:2};
      try {
        const contents = `${await readFile(previous)}${await readFile(current)}`;
        const count = Number.isInteger(limit) ? Math.max(1,Math.min(limit,500)) : 100;
        const records = contents.split('\n').filter(Boolean).slice(-count).flatMap(line=>{
          try {
            const record=JSON.parse(line);
            const timestamp = typeof record.timestamp === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(record.timestamp) ? record.timestamp : new Date().toISOString();
            return [{...sanitizeRecord(record,()=>new Date(timestamp)),timestamp}];
          } catch { return []; }
        }).reverse();
        return {records,retention,notice:NOTICE,...(failure?{error:'Activity could not be saved on this device.'}:{})};
      } catch { return {records:[],retention,notice:NOTICE,error:'Activity could not be read on this device.'}; }
    },
    async clear() {
      queue=[];dropped=0;
      await flush();
      try {
        await fs.promises.rm(current,{force:true});
        await fs.promises.rm(previous,{force:true});
        failure=false;
        return {ok:true};
      } catch { failure=true;return {ok:false,error:'Activity could not be cleared on this device.'}; }
    },
    async close() { closed=true;await flush(); },
    flush,
  };
}
module.exports = {createBrowserAudit,sanitizeRecord,NOTICE};
