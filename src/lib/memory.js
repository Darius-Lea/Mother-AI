export const MEMORY_VERSION = 1;
export const MEMORY_KEY = 'mother-ai-memory-v1';
export const MAX_DATASET_BYTES = 2 * 1024 * 1024;
export const MAX_MEMORY_BYTES = 8 * 1024 * 1024;
let memoryLoadIssue = '';

export function getMemoryLoadIssue() { return memoryLoadIssue; }

export function makeId() {
  return globalThis.crypto?.randomUUID?.() || `mother-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createMemory() {
  return {
    version: MEMORY_VERSION,
    profile: { name: '', notes: '' },
    conversations: [],
    knowledge: [],
    feedback: [],
    settings: { model: '', voice: true, reducedMotion: false, setupVisited: false },
  };
}

const byteLength = (text) => new TextEncoder().encode(text).length;
const cleanText = (value, limit, fallback = '') => typeof value === 'string' ? value.slice(0, limit) : fallback;
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

function validateNode(value, depth = 0) {
  if (depth > 20) throw new Error('This memory file is nested too deeply.');
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('This memory file contains unsafe properties.');
    validateNode(value[key], depth + 1);
  }
}

export function validateMemory(input) {
  if (!isObject(input) || input.version !== MEMORY_VERSION) throw new Error('Choose a Mother AI memory file (version 1).');
  validateNode(input);
  for (const key of ['conversations', 'knowledge', 'feedback']) {
    if (!Array.isArray(input[key])) throw new Error(`The memory file is missing its ${key} list.`);
  }
  if (input.conversations.length > 500 || input.knowledge.length > 100 || input.feedback.length > 1000) {
    throw new Error('This memory file exceeds the supported number of records.');
  }
  const next = createMemory();
  next.profile = {
    name: cleanText(input.profile?.name, 100),
    notes: cleanText(input.profile?.notes, 2000),
  };
  next.settings = {
    model: cleanText(input.settings?.model, 200),
    voice: typeof input.settings?.voice === 'boolean' ? input.settings.voice : true,
    reducedMotion: input.settings?.reducedMotion === true,
    setupVisited: input.settings?.setupVisited === true,
  };
  next.conversations = input.conversations.map((record) => {
    if (!isObject(record)) throw new Error('An invalid conversation record was found.');
    // Current sessions use flat messages. Thread-shaped records are retained too,
    // making portability independent of which conversation view is used.
    const result = {
      id: cleanText(record.id, 100) || makeId(),
      role: ['user', 'assistant', 'system'].includes(record.role) ? record.role : 'assistant',
      content: cleanText(record.content, 50000),
      timestamp: cleanText(record.timestamp, 100),
    };
    if (typeof record.createdAt === 'string') result.createdAt = cleanText(record.createdAt, 100);
    if (typeof record.engine === 'string') result.engine = cleanText(record.engine, 200);
    if (Array.isArray(record.messages)) {
      result.title = cleanText(record.title, 200);
      result.messages = record.messages.slice(0, 300).filter(isObject).map((message) => ({
        id: cleanText(message.id, 100) || makeId(),
        role: message.role === 'user' ? 'user' : 'assistant',
        content: cleanText(message.content, 50000),
        timestamp: cleanText(message.timestamp, 100),
      }));
    }
    return result;
  });
  next.knowledge = input.knowledge.map((record) => {
    if (!isObject(record) || typeof record.text !== 'string' || !record.text.trim()) throw new Error('A knowledge document is invalid.');
    if (byteLength(record.text) > MAX_DATASET_BYTES) throw new Error('A knowledge document is too large (2 MB maximum).');
    return {
      id: cleanText(record.id, 100) || makeId(),
      title: cleanText(record.title, 200, 'Untitled source'),
      source: cleanText(record.source, 2000),
      text: record.text,
      sha256: cleanText(record.sha256, 64),
      addedAt: cleanText(record.addedAt, 100),
      approved: record.approved === true,
      warnings: Array.isArray(record.warnings) ? record.warnings.slice(0, 10).map((item) => cleanText(item, 500)) : [],
    };
  });
  next.feedback = input.feedback.map((record) => {
    if (!isObject(record)) throw new Error('An invalid feedback record was found.');
    return {
      id: cleanText(record.id, 100) || makeId(),
      messageId: cleanText(record.messageId, 100),
      rating: ['helpful', 'unhelpful', 'positive', 'negative', 'up', 'down', 1, -1].includes(record.rating) ? record.rating : 'unhelpful',
      correction: cleanText(record.correction ?? record.note, 10000),
      prompt: cleanText(record.prompt, 12000),
      response: cleanText(record.response, 50000),
      engine: cleanText(record.engine, 200),
      timestamp: cleanText(record.timestamp, 100),
    };
  });
  return next;
}

export function importMemory(text) {
  if (typeof text !== 'string' || byteLength(text) > MAX_MEMORY_BYTES) throw new Error('Memory imports must be smaller than 8 MB.');
  let input;
  try { input = JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
  return validateMemory(input);
}

export function exportMemory(memory) {
  const text = JSON.stringify(validateMemory(memory), null, 2);
  if (byteLength(text) > MAX_MEMORY_BYTES) throw new Error('Memory is too large to export. Remove older documents first.');
  return text;
}

export function loadMemory() {
  memoryLoadIssue = '';
  try {
    if (!globalThis.localStorage) throw new Error('Browser storage is unavailable.');
    const text = globalThis.localStorage.getItem(MEMORY_KEY);
    return text ? importMemory(text) : createMemory();
  } catch (error) {
    memoryLoadIssue = error.message || 'Stored memory could not be read.';
    // A corrupt store must not prevent opening the application. The original
    // stored value is left untouched until the user makes a new change.
    return createMemory();
  }
}

export function saveMemory(memory) {
  try {
    if (!globalThis.localStorage) throw new Error('Browser storage is unavailable. Export your memory before closing this page.');
    globalThis.localStorage.setItem(MEMORY_KEY, exportMemory(memory));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || 'Browser storage is full. Export your memory to keep a copy.' };
  }
}

export function downloadMemory(memory) {
  const blob = new Blob([exportMemory(memory)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mother-memory-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportTrainingExamples(memory) {
  const examples = [];
  const seen = new Set();
  for (const entry of Array.isArray(memory?.feedback) ? memory.feedback : []) {
    if (!isObject(entry)) continue;
    const prompt = cleanText(entry.prompt, 12000).trim();
    const correction = cleanText(entry.correction, 10000).trim();
    const engine = cleanText(entry.engine, 200).trim();
    const helpful = ['helpful', 'positive', 'up', 1].includes(entry.rating);
    const realModel = !!engine && !/^(?:offline guide|introduction|guide|built[- ]?in guide)$/i.test(engine);
    // A supplied correction is an explicitly curated answer even when the
    // original was a guide response. An unchanged answer needs a helpful vote
    // and model provenance before it can become a training example.
    const answer = correction || (helpful && realModel ? cleanText(entry.response, 50000).trim() : '');
    if (!prompt || !answer) continue;
    const line = JSON.stringify({ messages: [
      { role: 'user', content: prompt },
      { role: 'assistant', content: answer },
    ] });
    if (!seen.has(line)) { examples.push(line); seen.add(line); }
  }
  return examples.join('\n');
}

export function downloadTrainingExamples(memory) {
  const text = exportTrainingExamples(memory);
  if (!text) throw new Error('Add a correction or mark a local-model response helpful before exporting teaching examples.');
  const blob = new Blob([`${text}\n`], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mother-teaching-examples-${new Date().toISOString().slice(0, 10)}.jsonl`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const tokenize = (text) => (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter((word) => !new Set(['the', 'and', 'for', 'that', 'this', 'what', 'with', 'from', 'have', 'are', 'you', 'your', 'can', 'how', 'about']).has(word));

export function retrieveContext(question, knowledge = []) {
  const terms = [...new Set(tokenize(question))].slice(0, 30);
  if (!terms.length) return '';
  const chunks = [];
  for (const document of knowledge) {
    if (document.approved !== true || typeof document.text !== 'string') continue;
    const text = document.text.slice(0, MAX_DATASET_BYTES);
    for (let offset = 0; offset < text.length; offset += 1000) {
      const excerpt = text.slice(offset, offset + 1400);
      const lower = excerpt.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
      if (score) chunks.push({ score, excerpt, title: cleanText(document.title, 200), source: cleanText(document.source, 500) });
    }
  }
  return chunks.sort((a, b) => b.score - a.score).slice(0, 3).map((chunk) => `Source: ${chunk.title}${chunk.source ? ` (${chunk.source})` : ''}\n${chunk.excerpt}`).join('\n\n').slice(0, 5000);
}

export async function inspectLocalDataset(file) {
  if (!file || file.size > MAX_DATASET_BYTES) throw new Error('Choose a text dataset smaller than 2 MB.');
  if (!/\.(txt|json|jsonl|csv|md)$/i.test(file.name)) throw new Error('Supported files: .txt, .json, .jsonl, .csv, or .md.');
  const text = await file.text();
  if (!text.trim() || text.includes('\u0000')) throw new Error('The dataset must contain readable text.');
  if (byteLength(text) > MAX_DATASET_BYTES) throw new Error('This dataset exceeds the 2 MB limit.');
  let sha256 = '';
  if (globalThis.crypto?.subtle) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    sha256 = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  if (/\.json$/i.test(file.name)) {
    try { JSON.parse(text); } catch { throw new Error('The JSON dataset contains invalid JSON.'); }
  }
  if (/\.jsonl$/i.test(file.name)) {
    try { text.split(/\r?\n/).filter((line) => line.trim()).forEach((line) => JSON.parse(line)); }
    catch { throw new Error('Each nonempty line of a JSONL dataset must be valid JSON.'); }
  }
  return {
    title: file.name,
    url: `Local file: ${file.name}`,
    text,
    preview: text.slice(0, 3000),
    bytes: byteLength(text),
    sha256,
    warnings: [
      'A readable file and a checksum do not establish factual accuracy. Verify the author, license, and claims before approval.',
      'Approved text is used as reference material, never executed. This does not train model weights.',
    ],
  };
}
