import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createNativeSpeech,nativeVoiceSupported,validateSpeech} from './voice-speech.js';
import {fetchOfficialAsset} from './https-assets.js';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// The official kokoro-onnx project distributes these Apache-2.0 model weights.
// This digest was measured from the actual versioned upstream release asset;
// keeping it pinned rejects replacement bytes or an unexpected HTML response.
export const VOICE_MODEL = Object.freeze({
  filename: 'kokoro-v1.0.int8.onnx',
  url: 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.int8.onnx',
  bytes: 114119327,
  sha256: 'ae315a79b623f244700e4afb9246c46a26066782e049ba174bf3ba433970ee9c',
  license: 'Apache-2.0',
});
const REDIRECT_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com']);

async function remoteAsset(fetchImpl, asset, signal) {
  let url = asset.url;
  for (let index = 0; index <= 3; index++) {
    const response = await fetchImpl(url, { signal, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || index === 3) throw Error('Voice asset redirect failed.');
      const target = new URL(location, url);
      if (target.protocol !== 'https:' || target.username || target.password || target.port || target.hash || !REDIRECT_HOSTS.has(target.hostname)) throw Error('Untrusted voice asset redirect.');
      url = target.href;
      continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw Error('Voice asset is unavailable.'); }
    const length = response.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) !== asset.bytes)) {
      await response.body.cancel();
      throw Error('Voice asset size does not match the pinned release.');
    }
    return response;
  }
  throw Error('Voice asset redirect failed.');
}

async function fileDigest(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

/** Only data for the fixed, pinned neural voice model is cached or served. */
export function createVoiceAssetStore({ directory, fetchImpl = fetchOfficialAsset, timeoutMs = 180000, asset = VOICE_MODEL } = {}) {
  if (typeof directory !== 'string' || !directory) throw Error('Voice cache directory is required.');
  let state = { state: 'idle', completed: 0, total: asset.bytes, progress: 0, error: null };
  let pending, rootDirectory, verifiedStamp, controller, stopped = false;

  async function root() {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Voice cache is not a regular directory.');
    rootDirectory = await realpath(directory);
    return rootDirectory;
  }

  async function cached() {
    const cacheRoot = await root();
    const filename = path.join(cacheRoot, asset.filename);
    let info;
    try { info = await lstat(filename); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!info.isFile() || info.isSymbolicLink() || await realpath(filename) !== filename) throw Error('Voice cache integrity check failed.');
    const corrupt = () => { const error = Error('Voice cache integrity check failed.'); error.code = 'VOICE_CACHE_CORRUPT'; return error; };
    if (info.size !== asset.bytes) throw corrupt();
    const stamp = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    if (stamp !== verifiedStamp) {
      if (await fileDigest(filename) !== asset.sha256) throw corrupt();
      verifiedStamp = stamp;
    }
    return filename;
  }

  async function run() {
    let temporary;
    try {
      if (stopped) throw Error('Voice cache service is stopped.');
      let existing;
      try { existing = await cached(); }
      catch (error) {
        // Repair only our known regular model cache file. Unsafe links or
        // directories fail closed; users never need to browse model folders.
        if (error.code !== 'VOICE_CACHE_CORRUPT') throw error;
        await rm(path.join(rootDirectory, asset.filename));
        verifiedStamp = undefined;
      }
      if (stopped) throw Error('Voice cache service is stopped.');
      if (existing) {
        state = { state: 'ready', completed: asset.bytes, total: asset.bytes, progress: 100, error: null };
        return existing;
      }
      const cacheRoot = rootDirectory;
      temporary = path.join(cacheRoot, `${asset.filename}.${randomUUID()}.tmp`);
      controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
      state = { state: 'downloading', completed: 0, total: asset.bytes, progress: 0, error: null };
      const response = await remoteAsset(fetchImpl, asset, signal);
      const hash = createHash('sha256');
      let bytes = 0;
      const inspect = new Transform({
        transform(chunk, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > asset.bytes) return callback(Error('Voice asset exceeded its pinned size.'));
          hash.update(chunk);
          state = { ...state, completed: bytes, progress: Math.min(99, bytes / asset.bytes * 100) };
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body), inspect, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal });
      state = { ...state, state: 'verifying' };
      if (bytes !== asset.bytes || hash.digest('hex') !== asset.sha256) throw Error('Voice asset failed its pinned integrity check.');
      const filename = path.join(cacheRoot, asset.filename);
      // A raced-in file or link cannot replace the verified cache. Only Mother
      // writes this owner-private cache directory during normal operation.
      try { await lstat(filename); throw Error('Voice cache changed during download.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await rename(temporary, filename);
      temporary = undefined;
      verifiedStamp = undefined;
      await cached();
      state = { state: 'ready', completed: asset.bytes, total: asset.bytes, progress: 100, error: null };
      return filename;
    } catch {
      state = { ...state, state: 'error', error: 'Mother could not prepare her free neural voice. Check your internet connection and available storage, then try again.' };
      throw Error(state.error);
    } finally {
      controller = undefined;
      if (temporary) await rm(temporary, { force: true }).catch(() => {});
    }
  }

  return {
    status() {
      return { model: 'Kokoro 82M', version: '1.0', license: asset.license, downloadBytes: asset.bytes,
        sha256: asset.sha256, assetUrl: `/api/voice/files/${asset.filename}`, ...state };
    },
    ensure() {
      if (!pending) pending = run().finally(() => { pending = undefined; });
      return pending;
    },
    shutdown() { stopped = true; controller?.abort(); },
  };
}

export function createVoiceRouter({nativeSynthesis=false,voiceRoot=fileURLToPath(new URL('../dist/voices',import.meta.url)),...options}) {
  const store = createVoiceAssetStore(options);
  const native=nativeSynthesis&&nativeVoiceSupported()?createNativeSpeech({ensureModel:()=>store.ensure(),voiceRoot}):null;
  const router = express.Router();
  router.get('/status', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json({...store.status(),nativeSynthesis:!!native,nativeReady:native?.ready()||false}); });
  router.post('/prepare',async(_req,res)=>{
    if(!native)return res.status(403).json({error:'Use the browser-local voice engine on this host.'});
    try{await native.prepare();res.json({ready:true,engine:'kokoro-native-cpu'});}catch{res.status(503).json({error:'Mother could not load her local speech engine. Retry setup or use the browser voice on this device.'});}
  });
  router.post('/synthesize',async(req,res)=>{
    if(!native)return res.status(403).json({error:'Local speech processing is available only in an owner-controlled desktop session.'});
    try{validateSpeech(req.body);}catch(error){return res.status(400).json({error:error.message});}
    try{
      const {samples,sampleRate}=await native.synthesize(req.body);
      res.set('Cache-Control','no-store');res.set('Content-Type','application/octet-stream');res.set('X-Mother-Sample-Rate',String(sampleRate));
      res.send(Buffer.from(samples.buffer,samples.byteOffset,samples.byteLength));
    }catch(error){res.status(error.status||503).json({error:error.status===429?error.message:'Mother could not generate this spoken passage. Try a shorter sentence or restart voice setup.'});}
  });
  router.get(`/files/${VOICE_MODEL.filename}`, async (_req, res) => {
    try {
      const filename = await store.ensure();
      res.set('Content-Type', 'application/octet-stream');
      res.set('Cache-Control', 'private, max-age=86400');
      res.set('ETag', `"${VOICE_MODEL.sha256}"`);
      // Application-data roots commonly include .config or .mother-ai. The
      // confined store already verified the absolute root; apply dotfile rules
      // only to the fixed public asset basename, never to its private parents.
      res.sendFile(path.basename(filename), { root: path.dirname(filename), dotfiles: 'deny' });
    } catch (error) { res.status(503).json({ error: error.message }); }
  });
  router.all('/{*path}', (_req, res) => res.status(404).json({ error: 'This voice resource is not available.' }));
  router.shutdown = () => {store.shutdown();void native?.close().catch(()=>{});};
  return router;
}
