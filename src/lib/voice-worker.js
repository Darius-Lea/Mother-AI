import * as ort from 'onnxruntime-web/wasm';
import { phonemize } from 'phonemizer';
import { phonemeTokens } from './voice-phonemes.js';
import wasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
import wasmModuleUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';

const MODEL_PATH = '/api/voice/files/kokoro-v1.0.int8.onnx';
const MODEL_BYTES = 114119327;
const MODEL_SHA256 = 'ae315a79b623f244700e4afb9246c46a26066782e049ba174bf3ba433970ee9c';
const VOICES = {
  af_heart: 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b',
  af_bella: 'f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b',
  bf_emma: '669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73',
};
let session;
let loading;
let queue = Promise.resolve();
const voices = new Map();
const localUrl = value => new URL(value, self.location.href).href;
const report = status => self.postMessage({ type: 'status', status });
const checksum = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');

async function readModel(response, reportProgress = true) {
  if (!response.ok) {
    let message;
    try { message = (await response.json()).error; } catch {}
    throw new Error(message || 'The free voice pack could not be downloaded. Check your connection and try again.');
  }
  const reader = response.body.getReader();
  const bytes = new Uint8Array(MODEL_BYTES);
  let completed = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (completed + value.byteLength > MODEL_BYTES) throw new Error('The voice pack size does not match its verified model.');
      bytes.set(value, completed); completed += value.byteLength;
      if (reportProgress) report({ state: 'downloading', downloaded: completed, total: MODEL_BYTES, progress: completed / MODEL_BYTES, message: 'Loading the verified voice pack on this device…' });
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (completed !== MODEL_BYTES || await checksum(bytes) !== MODEL_SHA256) throw new Error('The voice pack failed its integrity check. Please retry the download.');
  return bytes;
}

async function modelBytes() {
  const url = localUrl(MODEL_PATH);
  let cache;
  try {
    cache = await caches.open(`mother-kokoro-${MODEL_SHA256.slice(0, 12)}`);
    const found = await cache.match(url);
    if (found) {
      report({ state: 'loading', message: 'Checking the saved neural voice…', progress: null });
      try { return await readModel(found, false); } catch { await cache.delete(url); }
    }
  } catch { /* Storage restrictions do not disable the voice engine. */ }
  report({ state: 'downloading', downloaded: 0, total: MODEL_BYTES, progress: 0, message: 'Downloading Mother’s free neural voice…' });
  let polling = false;
  const timer = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const response = await fetch(localUrl('/api/voice/status'), { signal: AbortSignal.timeout(3000) });
      const state = await response.json();
      if (state.state === 'downloading' || state.state === 'verifying') report({ state: 'downloading', downloaded: state.completed, total: MODEL_BYTES, progress: Math.min(1,Math.max(0,state.progress/100)), message: state.state === 'verifying' ? 'Verifying the downloaded voice pack…' : 'Downloading Mother’s free neural voice…' });
    } catch {} finally { polling = false; }
  }, 700);
  let response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(240000) }); }
  finally { clearInterval(timer); }
  const bytes = await readModel(response);
  if (cache) { try { await cache.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } })); } catch {} }
  return bytes;
}

async function prepare() {
  if (session) return;
  if (!loading) loading = (async () => {
    const bytes = await modelBytes();
    report({ state: 'loading', progress: null, message: 'Starting Mother’s neural voice on this device…' });
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1,Math.min(4,self.navigator.hardwareConcurrency || 1)) : 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmModuleUrl };
    session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    report({ state: 'ready', progress: 1, error: null, message: 'Mother’s neural voice is ready.' });
  })().finally(() => { loading = null; });
  return loading;
}

async function voiceEmbedding(voice) {
  if (!Object.hasOwn(VOICES, voice)) throw new Error('Choose one of Mother’s included voices.');
  if (voices.has(voice)) return voices.get(voice);
  const response = await fetch(localUrl(`/voices/${voice}.bin`));
  if (!response.ok) throw new Error('This voice is missing from the app. Reopen Mother or reinstall the current version.');
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== 522240 || await checksum(buffer) !== VOICES[voice]) throw new Error('The selected voice failed its integrity check.');
  const embedding = new Float32Array(buffer); voices.set(voice, embedding); return embedding;
}

async function generate({ text, voice, speed }) {
  if (!session) throw new Error('Download and load Mother’s neural voice first.');
  if (typeof text !== 'string' || text.length > 500 || !Number.isFinite(speed) || speed < 0.8 || speed > 1.2) throw new Error('Invalid speech passage or speed.');
  report({state:'generating',message:'Preparing pronunciation…'});
  const { ids, length } = await phonemeTokens(text, { voice, phonemize });
  const embedding = await voiceEmbedding(voice);
  const offset = 256 * Math.min(length, 509);
  const style = embedding.slice(offset, offset + 256);
  report({state:'generating',message:'Generating natural speech on this device…'});
  const output = await session.run({
    input_ids: new ort.Tensor('int64', ids, [1, ids.length]),
    style: new ort.Tensor('float32', style, [1, 256]),
    speed: new ort.Tensor('float32', Float32Array.of(speed), [1]),
  });
  const samples = Float32Array.from(output.waveform.data);
  if (!samples.length || samples.length > 24000 * 90 || samples.some(sample => !Number.isFinite(sample))) {
    console.error('Neural audio validation failed',JSON.stringify({samples:samples.length,invalid:samples.filter(sample=>!Number.isFinite(sample)).length,voice,length}));
    throw new Error('The voice engine returned invalid audio. Try a shorter sentence.');
  }
  return { samples, sampleRate: 24000 };
}

self.addEventListener('message', event => {
  const { id, type, payload } = event.data || {};
  queue = queue.catch(() => {}).then(async () => {
    try {
      let result;
      if (type === 'prepare') { await prepare(); result = { ready: true }; }
      else if (type === 'generate') result = await generate(payload);
      else throw new Error('Unsupported voice operation.');
      self.postMessage({ id, result }, result?.samples ? [result.samples.buffer] : []);
    } catch (error) {
      self.postMessage({ id, error: String(error.message || 'Mother’s voice could not complete this step.').slice(0, 500) });
    }
  });
});
