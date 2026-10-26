import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemory, exportMemory, importMemory, exportTrainingExamples, inspectLocalDataset, retrieveContext, loadMemory, saveMemory, getMemoryLoadIssue, MAX_MEMORY_BYTES } from './memory.js';

test('memory export and import preserve approved documents and feedback', () => {
  const memory = createMemory();
  memory.profile.name = 'Darius';
  memory.conversations.push({ id: 'message-1', role: 'user', content: 'Remember my project.', timestamp: '2026-01-01T00:00:00Z' });
  memory.knowledge.push({ id: 'source-1', title: 'Project', source: 'local', text: 'Mother uses blue and gold particles.', approved: true, sha256: 'abc', addedAt: '2026-01-01T00:00:00Z', warnings: [] });
  memory.feedback.push({ id: 'feedback-1', messageId: 'message-1', rating: 'helpful', correction: 'That is correct.', prompt: 'What is the project?', response: 'A particle companion.', engine: 'qwen2.5:0.5b', timestamp: '2026-01-01T00:00:00Z' });
  assert.deepEqual(importMemory(exportMemory(memory)), memory);
});

test('portable messages retain engine provenance and timestamps', () => {
  const memory = createMemory();
  memory.conversations.push({ id: 'provenance', role: 'assistant', content: 'This is an offline guide answer.', engine: 'Offline guide', timestamp: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' });
  assert.deepEqual(importMemory(exportMemory(memory)).conversations, memory.conversations);
});

test('portable voice and web preferences survive transfer with bounded voice controls', () => {
  const memory=createMemory();
  memory.settings={...memory.settings,voiceEngine:'kokoro',voiceName:'bf_emma',voiceSpeed:1.1,webResearch:true};
  assert.deepEqual(importMemory(exportMemory(memory)).settings,memory.settings);
  memory.settings={...memory.settings,voiceEngine:'unknown-provider',voiceName:'../../arbitrary-model',voiceSpeed:900};
  const restored=importMemory(exportMemory(memory));
  assert.equal(restored.settings.voiceEngine,'kokoro');
  assert.equal(restored.settings.voiceName,'af_heart');
  assert.equal(restored.settings.voiceSpeed,1.2);
});

test('storage failure is visible and a corrupt store is not overwritten by loading', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let writes = 0;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => '{corrupt memory',
    setItem: () => { writes += 1; throw new Error('Quota exceeded'); },
  } });
  try {
    const recovered = loadMemory();
    assert.deepEqual(recovered, createMemory());
    assert.match(getMemoryLoadIssue(), /valid JSON/);
    assert.equal(writes, 0);
    const saved = saveMemory(recovered);
    assert.equal(saved.ok, false);
    assert.match(saved.error, /Quota exceeded/);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('invalid and prototype-polluting imports are rejected', () => {
  assert.throws(() => importMemory('{'), /valid JSON/);
  assert.throws(() => importMemory('{"version":2}'), /version 1/);
  assert.throws(() => importMemory('{"version":1,"conversations":[],"knowledge":[],"feedback":[],"__proto__":{"polluted":true}}'), /unsafe properties/);
  assert.equal({}.polluted, undefined);
  assert.throws(() => importMemory(' '.repeat(MAX_MEMORY_BYTES + 1)), /8 MB/);
});

test('retrieval uses relevant approved sources and excludes unreviewed text', () => {
  const context = retrieveContext('How does Mother remember particles?', [
    { title: 'Unreviewed', text: 'Mother particles SECRET', approved: false },
    { title: 'Particle design', source: 'local', text: 'Mother uses blue particles to form her body.', approved: true },
    { title: 'Other', text: 'A recipe for green tea.', approved: true },
  ]);
  assert.match(context, /Particle design/);
  assert.doesNotMatch(context, /SECRET|green tea/);
  assert.equal(retrieveContext('the and for', []), '');
});

test('local dataset parser hashes data and rejects malformed records and binary files', async () => {
  const file = new File(['{"fact":"blue particles"}'], 'design.json', { type: 'application/json' });
  const inspected = await inspectLocalDataset(file);
  assert.match(inspected.sha256, /^[a-f0-9]{64}$/);
  assert.equal(inspected.text, '{"fact":"blue particles"}');
  assert.ok(inspected.warnings.length >= 1);
  await assert.rejects(() => inspectLocalDataset(new File(['{"bad":}'], 'bad.json')), /invalid JSON/);
  await assert.rejects(() => inspectLocalDataset(new File(['{"ok":true}\nnot-json'], 'bad.jsonl')), /valid JSON/);
  await assert.rejects(() => inspectLocalDataset(new File(['hello\u0000binary'], 'binary.txt')), /readable text/);
  await assert.rejects(() => inspectLocalDataset(new File(['alert(1)'], 'script.js')), /Supported files/);
});

test('teaching JSONL exports only curated examples and prefers corrections', () => {
  const memory = createMemory();
  memory.conversations = [{ role: 'user', content: 'Unreviewed conversation' }];
  memory.feedback = [
    { prompt: 'Correct this', response: 'Wrong answer', correction: 'Reviewed answer\nwith a second line.', rating: 'unhelpful', engine: 'qwen2.5:0.5b' },
    { prompt: 'Keep this', response: 'Useful model answer', rating: 'helpful', engine: 'qwen2.5:0.5b' },
    { prompt: 'Guide correction', response: 'Guide original', correction: 'User-curated replacement', rating: 'unhelpful', engine: 'Offline guide' },
    { prompt: 'Guide answer', response: 'Not a training target', rating: 'helpful', engine: 'Offline guide' },
    { prompt: 'Introduction', response: 'Not a training target', rating: 'helpful', engine: 'Introduction' },
    { prompt: 'Unknown model', response: 'No provenance', rating: 'helpful' },
    { prompt: 'Bad answer', response: 'Rejected answer', rating: 'unhelpful', engine: 'qwen2.5:0.5b' },
    { prompt: '', correction: 'Missing prompt', rating: 'unhelpful' },
    { response: 'Only response', rating: 'helpful', engine: 'qwen2.5:0.5b' },
    { prompt: 'No review', response: 'Unrated answer', engine: 'qwen2.5:0.5b' },
  ];
  const lines = exportTrainingExamples(memory).split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[0], { messages: [
    { role: 'user', content: 'Correct this' },
    { role: 'assistant', content: 'Reviewed answer\nwith a second line.' },
  ] });
  assert.equal(lines[1].messages[1].content, 'Useful model answer');
  assert.equal(lines[2].messages[1].content, 'User-curated replacement');
  assert.ok(lines.every((line) => line.messages.length === 2 && line.messages.every((message) => ['user', 'assistant'].includes(message.role))));
  assert.equal(exportTrainingExamples(createMemory()), '');
});

test('teaching export retains model provenance after portable-memory roundtrip', () => {
  const memory = createMemory();
  memory.feedback.push({ id: 'f', messageId: 'm', prompt: 'My question', response: 'My reviewed answer', correction: '', rating: 'helpful', engine: 'qwen2.5:0.5b', timestamp: '2026-01-01T00:00:00Z' });
  const restored = importMemory(exportMemory(memory));
  assert.equal(restored.feedback[0].engine, 'qwen2.5:0.5b');
  assert.equal(exportTrainingExamples(restored), exportTrainingExamples(memory));
});
