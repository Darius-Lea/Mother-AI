// English text normalization follows the Apache-2.0 Kokoro.js pipeline.
// https://github.com/hexgrad/kokoro — npm kokoro-js@1.2.1
import configuration from './kokoro-vocab.json' with { type: 'json' };

export function normalizeSpokenText(value) {
  return String(value).replace(/[‘’]/g, "'").replace(/[«»“”]/g, '"')
    .replace(/[、，]/g, ', ').replace(/。/g, '. ').replace(/！/g, '! ').replace(/？/g, '? ')
    .replace(/\bDr\.(?= [A-Z])/g, 'Doctor').replace(/\bMr\.(?= [A-Z])/g, 'Mister')
    .replace(/\bMs\.(?= [A-Z])/g, 'Miss').replace(/\bMrs\.(?= [A-Z])/g, 'Missus')
    .replace(/(?<=\d),(?=\d)/g, '').replace(/(?<=\d)-(?=\d)/g, ' to ')
    .replace(/\s+/g, ' ').trim();
}

export async function phonemeTokens(text, { voice = 'af_heart', phonemize }) {
  const normalized = normalizeSpokenText(text);
  const parts = normalized.split(/(\s*[;:,.!?¡¿—…"«»“”(){}[\]]+\s*)/g).filter(Boolean);
  const language = voice.startsWith('b') ? 'en' : 'en-us';
  let phonemes = '';
  // eSpeak is a shared WASM instance; serialize calls instead of running it
  // concurrently for every punctuation-delimited piece.
  for (const part of parts) {
    phonemes += /^[\s;:,.!?¡¿—…"«»“”(){}[\]]+$/.test(part) ? part : (await phonemize(part, language)).join(' ');
  }
  phonemes = phonemes.replace(/ʲ/g, 'j').replace(/r/g, 'ɹ').replace(/x/g, 'k').replace(/ɬ/g, 'l').trim();
  const ids = [...phonemes].map(character => configuration.vocab[character]).filter(Number.isInteger);
  if (ids.length < 1) throw new Error('Mother could not pronounce that passage. Try a short English sentence.');
  if (ids.length > 508) throw new Error('That voice passage is too long. Try a shorter sentence.');
  return { ids: BigInt64Array.from([0, ...ids, 0], value => BigInt(value)), length: ids.length };
}
