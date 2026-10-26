export const VOICE_OPTIONS = Object.freeze([
  { id: 'af_heart', name: 'Mother · Heart', detail: 'Warm American English' },
  { id: 'af_bella', name: 'Bella', detail: 'Clear American English' },
  { id: 'bf_emma', name: 'Emma', detail: 'Gentle British English' },
]);
export const VOICE_DOWNLOAD_BYTES = 114119327;
const ALLOWED_VOICES = new Set(VOICE_OPTIONS.map(voice => voice.id));
const CONSENT_KEY='mother-neural-voice-consent-v1';
export function hasVoiceConsent(){try{return globalThis.localStorage?.getItem(CONSENT_KEY)==='approved';}catch{return false;}}

export function normalizeVoiceSettings(settings = {}) {
  return {
    voiceEngine: settings.voiceEngine === 'system' ? 'system' : 'kokoro',
    voiceName: ALLOWED_VOICES.has(settings.voiceName) ? settings.voiceName : 'af_heart',
    voiceSpeed: Math.min(1.2, Math.max(0.8, Number(settings.voiceSpeed) || 1)),
  };
}

export function speechText(value) {
  return String(value || '').replace(/```[\s\S]*?```/g, ' Code example omitted. ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, ' web link ').replace(/[*_`#]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
}

export function speechChunks(value, limit = 180) {
  const text = speechText(value);
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const word of words) {
    if (word.length > limit) {
      if (current) { chunks.push(current); current = ''; }
      for (let index = 0; index < word.length; index += limit) chunks.push(word.slice(index, index + limit));
    } else if (current && current.length + word.length + 1 > limit) {
      chunks.push(current); current = word;
    } else current += `${current ? ' ' : ''}${word}`;
    if (current.length > 45 && /[.!?]["')]*$/.test(current)) { chunks.push(current); current = ''; }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function preferredSystemVoice(voices = []) {
  const score = voice => (/^en[-_]/i.test(voice.lang || '') ? 50 : 0)
    + (/heart|samantha|jenny|aria|sonia|sara|emma|moira|karen|female|natural/i.test(voice.name || '') ? 40 : 0)
    + (voice.localService ? 5 : 0) + (voice.default ? 1 : 0);
  return [...voices].filter(voice => /^en(?:[-_]|$)/i.test(voice.lang || '')).sort((a, b) => score(b) - score(a))[0] || null;
}

function interrupted() { const error = new Error('Speech stopped.'); error.name = 'AbortError'; return error; }

/** Local neural voice; system speech is used only when explicitly selected. */
export function createMotherVoice({ onStatus = () => {}, onActivity = () => {},
  workerFactory = () => new Worker(new URL('./voice-worker.js', import.meta.url), { type: 'module' }),
  audioContextFactory = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
  speechSynthesis = globalThis.speechSynthesis, utteranceFactory = text => new SpeechSynthesisUtterance(text),
  fetchImpl=globalThis.fetch,
} = {}) {
  let status = { state: 'idle', engine: 'kokoro', progress: null, downloaded: 0, total: VOICE_DOWNLOAD_BYTES, error: null, message: 'Download Mother’s human voice once to enable local neural speech.' };
  let worker;
  let audioContext;
  let source;
  let finishPlayback;
  let preparation;
  let prepared = false;
  let disposed = false;
  let counter = 0;
  let generation = 0;
  let finishSystem;
  let native=false,nativeRequest;
  const waiting = new Map();
  const getStatus = () => ({ ...status });
  const update = next => { status = { ...status, ...next }; if (!disposed) onStatus(getStatus()); };

  function ensureAudio() {
    if (!audioContext) audioContext = audioContextFactory();
    if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});
    return audioContext;
  }
  function failRequests(error) {
    for (const task of waiting.values()) { clearTimeout(task.timer); task.reject(error); }
    waiting.clear();
  }
  function ensureWorker() {
    if (worker) return worker;
    worker = workerFactory();
    worker.addEventListener('message', event => {
      const message = event.data || {};
      if (message.type === 'status') { update(message.status); return; }
      const task = waiting.get(message.id);
      if (!task) return;
      clearTimeout(task.timer); waiting.delete(message.id);
      if (message.error) task.reject(new Error(message.error)); else task.resolve(message.result);
    });
    worker.addEventListener('error', () => {
      prepared = false;
      update({ state: 'error', error: 'Mother’s voice engine stopped. Download or load the voice again to retry.', message: null });
      failRequests(new Error(status.error));
      worker?.terminate(); worker = null;
    });
    return worker;
  }
  function request(type, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = ++counter;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(type === 'prepare' ? 'The voice download or loading took too long. Check your connection and try again.' : 'This voice passage took too long. Try a shorter message or a faster device.'));
      }, type === 'prepare' ? 300000 : 120000);
      waiting.set(id, { resolve, reject, timer, type });
      try { ensureWorker().postMessage({ id, type, payload }); }
      catch (error) { clearTimeout(timer); waiting.delete(id); reject(error); }
    });
  }
  function stop() {
    generation++;
    nativeRequest?.abort();nativeRequest=null;
    if (source) { try { source.stop(); } catch {} source = null; }
    finishPlayback?.(); finishPlayback = null;
    speechSynthesis?.cancel(); finishSystem?.(); finishSystem = null;
    for (const [id, task] of waiting) if (task.type === 'generate') {
      clearTimeout(task.timer); task.reject(interrupted()); waiting.delete(id);
    }
    onActivity('idle');
    if (prepared && !disposed) update({ state: 'ready', error: null, message: 'Mother’s neural voice is ready on this device.' });
  }
  async function play(samples, sampleRate, token) {
    if (token !== generation || disposed) throw interrupted();
    const context = ensureAudio();
    await context.resume();
    if (context.state !== 'running') throw new Error('Your browser paused audio. Click the voice preview button to enable playback.');
    const audio = context.createBuffer(1, samples.length, sampleRate);
    audio.copyToChannel(samples, 0);
    const next = context.createBufferSource(); next.buffer = audio; next.connect(context.destination); source = next;
    update({ state: 'speaking', message: 'Mother is speaking.', error: null }); onActivity('speaking');
    await new Promise(resolve => {
      const done = () => { if (source === next) source = null; if (finishPlayback === done) finishPlayback = null; resolve(); };
      finishPlayback = done; next.onended = done; next.start();
    });
  }
  async function speakSystem(text, speed) {
    if (!speechSynthesis) throw new Error('System speech is unavailable on this device. Choose Mother’s neural voice.');
    const utterance = utteranceFactory(speechText(text));
    const preferred = preferredSystemVoice(speechSynthesis.getVoices());
    if (preferred) utterance.voice = preferred;
    utterance.rate = speed; utterance.pitch = 1; utterance.volume = 1;
    return new Promise((resolve, reject) => {
      const finish = () => { finishSystem = null; onActivity('idle'); resolve({ engine: 'system' }); };
      finishSystem = finish;
      utterance.onstart = () => onActivity('speaking');
      utterance.onend = finish;
      utterance.onerror = () => { finishSystem = null; onActivity('idle'); reject(new Error('The selected system voice could not play. Choose Mother’s neural voice or try another device voice.')); };
      speechSynthesis.speak(utterance);
    });
  }
  return {
    getStatus,
    async prepare({ consent = false } = {}) {
      if (disposed) throw new Error('This voice session is closed.');
      if (!consent) throw new Error('Approve the free voice download in Voice settings first.');
      try { globalThis.localStorage?.setItem(CONSENT_KEY,'approved'); } catch {}
      // Activate Web Audio inside the button gesture, before a long download.
      try { ensureAudio(); } catch {}
      if (prepared) return getStatus();
      if (!preparation) preparation = (async () => {
        update({ state: 'loading', error: null, message: 'Preparing Mother’s neural voice…' });
        try {
          let capability;
          try{const response=await fetchImpl('/api/voice/status',{signal:AbortSignal.timeout(6000)});if(response.ok)capability=await response.json();}catch{}
          native=capability?.nativeSynthesis===true;
          if(native){
            const polling=setInterval(async()=>{try{const response=await fetchImpl('/api/voice/status',{signal:AbortSignal.timeout(3000)});const state=await response.json();if(['downloading','verifying'].includes(state.state))update({state:'downloading',progress:state.progress/100,downloaded:state.completed,total:state.total,message:'Downloading and checking Mother’s free neural voice…'});}catch{}},800);
            try{const response=await fetchImpl('/api/voice/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(240000)});const result=await response.json();if(!response.ok||result.ready!==true)throw Error(result.error||'The local voice engine could not start.');}finally{clearInterval(polling);}
          }else await request('prepare');
          prepared = true;
          update({ state: 'ready', progress: 1, error: null, message: 'Mother’s human voice is ready. Speech is generated on this device.' });
          return getStatus();
        } catch (error) { update({ state: 'error', error: error.message, message: null }); throw error; }
        finally { preparation = null; }
      })();
      return preparation;
    },
    async speak(text, { voice = 'af_heart', speed = 1, engine = 'kokoro' } = {}) {
      if (disposed) throw new Error('This voice session is closed.');
      stop();
      const token = generation;
      const settings = normalizeVoiceSettings({ voiceName: voice, voiceSpeed: speed, voiceEngine: engine });
      const chunks = speechChunks(text);
      if (!chunks.length) return { duration: 0, engine: settings.voiceEngine };
      if (settings.voiceEngine === 'system') return speakSystem(chunks.join(' '), settings.voiceSpeed);
      if (!prepared) throw new Error('Open Voice settings and download Mother’s human voice first.');
      let duration = 0;
      try {
        for (const chunk of chunks) {
          if (token !== generation || disposed) throw interrupted();
          update({ state: 'generating', error: null, message: 'Mother is forming her words…' });
          let result;
          if(native){
            const operation=new AbortController();nativeRequest=operation;
            try{
              const response=await fetchImpl('/api/voice/synthesize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:chunk,voice:settings.voiceName,speed:settings.voiceSpeed}),signal:AbortSignal.any([operation.signal,AbortSignal.timeout(120000)])});
              if(!response.ok){const body=await response.json();throw Error(body.error||'The local voice engine could not speak.');}
              const bytes=await response.arrayBuffer();
              if(!bytes.byteLength||bytes.byteLength>24000*90*4||bytes.byteLength%4)throw Error('The voice engine returned invalid audio.');
              result={samples:new Float32Array(bytes),sampleRate:24000};
              if(result.samples.some(value=>!Number.isFinite(value)))throw Error('The voice engine returned invalid audio.');
            }finally{if(nativeRequest===operation)nativeRequest=null;}
          }else result=await request('generate', { text: chunk, voice: settings.voiceName, speed: settings.voiceSpeed });
          if (token !== generation || disposed) throw interrupted();
          const samples = result.samples instanceof Float32Array ? result.samples : new Float32Array(result.samples);
          duration += samples.length / result.sampleRate;
          await play(samples, result.sampleRate, token);
        }
        return { duration, engine: 'kokoro', voice: settings.voiceName };
      } catch (error) {
        if (error.name !== 'AbortError') update({ state: 'error', error: error.message, message: null });
        throw error;
      } finally {
        if (token === generation) {
          onActivity('idle');
          if (status.state !== 'error') update({ state: 'ready', message: 'Mother’s neural voice is ready on this device.' });
        }
      }
    },
    stop,
    dispose() { stop(); disposed = true; worker?.terminate(); worker = null; failRequests(interrupted()); void audioContext?.close().catch(() => {}); },
  };
}
