import express from 'express';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const OLLAMA = 'http://127.0.0.1:11434';
const GiB = 1024 ** 3;

// Estimated quantized download sizes, not promised disk usage or model quality.
export const MODEL_CATALOG = Object.freeze([
  { name: 'qwen2.5:1.5b', label: 'Lightweight', description: 'A small starter for modest hardware. Limited reasoning and coding quality.', downloadGiB: 1.0, minRamGiB: 4, category: 'general' },
  { name: 'qwen2.5-coder:7b', label: 'Coding specialist', description: 'A local code model for explanations, drafting, and debugging.', downloadGiB: 4.7, minRamGiB: 12, category: 'coding' },
  { name: 'qwen3:8b', label: 'Reasoning', description: 'A local reasoning model. CPU responses can take time.', downloadGiB: 5.2, minRamGiB: 12, category: 'reasoning' },
  { name: 'qwen3:14b', label: 'Advanced reasoning', description: 'A larger reasoning model for ample memory. A suitable GPU can improve response speed.', downloadGiB: 9.3, minRamGiB: 24, category: 'reasoning' },
  { name: 'qwen3-coder:30b', label: 'Workstation coding', description: 'A large code model. Needs at least 40 GB RAM with room for context and the operating system, substantial disk space, and patience on CPU-only devices.', downloadGiB: 19, minRamGiB: 40, category: 'coding' },
]);

export function hardwareSummary(source = os) {
  const total = source.totalmem();
  return {
    platform: source.platform(), arch: source.arch(),
    totalMemoryGiB: Math.round(total / GiB * 10) / 10,
    freeMemoryGiB: Math.round(source.freemem() / GiB * 10) / 10,
    cpuCount: source.cpus()?.length || 1,
    // GPU capability is intentionally not inferred from RAM or CPU count.
    gpuDetected: null,
  };
}

export function recommendationsFor(hardware) {
  const total = Number(hardware.totalMemoryGiB) || 0;
  const recommendedModel = total >= 24 ? 'qwen3:14b' : total >= 12 ? 'qwen3:8b' : total >= 4 ? 'qwen2.5:1.5b' : null;
  return {
    recommendedModel,
    recommendations: MODEL_CATALOG.map(model => ({ ...model, eligible: total >= model.minRamGiB, recommended: model.name === recommendedModel })),
  };
}

function cleanModels(data) {
  return Array.isArray(data?.models) ? data.models.filter(model => model && typeof model.name === 'string').map(({ name, size, details }) => ({ name, size, details })) : [];
}

function publicTask(task) {
  return {
    id: task.id, model: task.model, state: task.state, status: task.status,
    progress: task.progress, completed: task.completed, total: task.total,
    error: task.error || null, startedAt: task.startedAt, finishedAt: task.finishedAt || null,
    progressDetail: 'Byte counts are reported by Ollama. Additional model layers may appear before verification.',
  };
}

export function createModelRouter({ fetchImpl = fetch, getHardware = () => hardwareSummary(), requestTimeout = 3000, downloadTimeout = 60 * 60 * 1000, idFactory = randomUUID } = {}) {
  const router = express.Router();
  const tasks = new Map();
  let activeTask = null;

  async function getInstalled(signal) {
    const response = await fetchImpl(`${OLLAMA}/api/tags`, { signal: signal || AbortSignal.timeout(requestTimeout) });
    if (!response.ok) throw new Error('Ollama did not return its installed models.');
    return cleanModels(await response.json());
  }

  async function status() {
    const hardware = getHardware();
    let models = [], version;
    let runtime = { available: false, error: 'Mother could not find the local AI runtime. Install Ollama, then check again.' };
    try {
      models = await getInstalled();
      runtime = { available: true };
      try {
        const response = await fetchImpl(`${OLLAMA}/api/version`, { signal: AbortSignal.timeout(requestTimeout) });
        if (response.ok) { const value = await response.json(); if (typeof value.version === 'string') version = value.version.slice(0, 60); }
      } catch { /* Installed-model discovery already established runtime availability. */ }
      if (version) runtime.version = version;
    } catch { /* No neural runtime is represented as unavailable, never a simulated success. */ }
    return {
      hardware, runtime, models, ...recommendationsFor(hardware),
      activeDownload: activeTask && ['queued', 'downloading', 'verifying'].includes(activeTask.state) ? publicTask(activeTask) : null,
      capabilities: { neuralConversation: runtime.available && models.length > 0, automaticWeightTraining: false, paidApiRequired: false, gpuChecked: false },
      notes: [
        'Model downloads need internet access and several gigabytes of disk space. Sizes shown are estimates.',
        'Inference uses your device memory, processor, and electricity. No paid API key is needed.',
        'RAM recommendations leave some room for the operating system, but do not guarantee speed or compatibility.',
        'These open-weight models do not establish parity with ChatGPT, Codex, Claude, or any other frontier service.',
      ],
    };
  }

  function processLine(task, line) {
    if (!line.trim()) return;
    let event;
    try { event = JSON.parse(line); } catch { throw new Error('The local runtime sent unreadable download progress.'); }
    if (typeof event.error === 'string') throw new Error(event.error.slice(0, 500));
    if (typeof event.status === 'string') task.status = event.status.slice(0, 200);
    if (typeof event.digest === 'string' && Number.isFinite(event.total) && event.total > 0) {
      const previous = task.layers.get(event.digest);
      task.layers.set(event.digest, {
        total: Math.max(0, event.total),
        completed: Math.min(event.total, Math.max(0, Number.isFinite(event.completed) ? event.completed : previous?.completed || 0)),
      });
      const layers = [...task.layers.values()];
      task.total = layers.reduce((sum, layer) => sum + layer.total, 0);
      task.completed = layers.reduce((sum, layer) => sum + layer.completed, 0);
      task.progress = task.total ? Math.min(99, Math.floor(task.completed / task.total * 100)) : null;
    }
    if (event.status === 'success') task.receivedSuccess = true;
    if (typeof event.status === 'string' && /verifying|writing manifest|removing unused/i.test(event.status)) task.state = 'verifying';
  }

  async function runDownload(task) {
    const timer = setTimeout(() => task.controller.abort(new Error('Download exceeded the one-hour limit.')), downloadTimeout);
    timer.unref?.();
    try {
      task.state = 'downloading';
      const response = await fetchImpl(`${OLLAMA}/api/pull`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: task.model, stream: true }), signal: task.controller.signal,
      });
      if (!response.ok) throw new Error(response.status === 404 ? 'This model is unavailable from the local runtime.' : 'The local runtime could not start this model download.');
      if (!response.body) throw new Error('The local runtime did not send download progress.');
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of response.body) {
        if (task.controller.signal.aborted) throw new Error('Download cancelled.');
        buffer += decoder.decode(chunk, { stream: true });
        if (buffer.length > 256 * 1024) throw new Error('The local runtime sent an oversized progress message.');
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          processLine(task, line);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) processLine(task, buffer);
      if (task.controller.signal.aborted) throw new Error('Download cancelled.');
      if (!task.receivedSuccess) throw new Error('The model download ended before the local runtime confirmed success.');
      task.state = 'verifying'; task.status = 'Checking that the model is installed';
      const models = await getInstalled(task.controller.signal);
      if (!models.some(model => model.name === task.model)) throw new Error('The runtime finished downloading, but the model was not found in its installed list. Check Ollama and try again.');
      if (task.controller.signal.aborted) throw new Error('Download cancelled.');
      task.state = 'completed'; task.status = 'Installed and verified'; task.progress = 100;
    } catch (error) {
      if (task.state === 'cancelled') { /* Keep the explicit cancellation result. */ }
      else if (task.controller.signal.aborted) { task.state = 'error'; task.error = 'The download timed out. You can retry when the runtime and network are ready.'; task.status = 'Download stopped'; }
      else { task.state = 'error'; task.error = error.message?.slice(0, 500) || 'Model download failed. Check the runtime and network.'; task.status = 'Download failed'; }
    } finally {
      clearTimeout(timer); task.finishedAt = new Date().toISOString();
    }
  }

  router.get('/status', async (_req, res) => res.json(await status()));
  router.post('/pull', async (req, res) => {
    const model = req.body?.model;
    if (typeof model !== 'string' || !MODEL_CATALOG.some(item => item.name === model)) return res.status(400).json({ error: 'Choose a supported model from the setup list.' });
    if (activeTask && ['queued', 'downloading', 'verifying'].includes(activeTask.state)) return res.status(409).json({ error: 'A model download is already in progress.', activeDownload: publicTask(activeTask) });
    const recommendation = MODEL_CATALOG.find(item => item.name === model);
    if ((Number(getHardware().totalMemoryGiB) || 0) < recommendation.minRamGiB) return res.status(422).json({ error: `This starter requires at least ${recommendation.minRamGiB} GB of system memory. Choose a smaller model.` });
    let installed;
    try { installed = await getInstalled(); }
    catch { return res.status(503).json({ error: 'The local AI runtime is unavailable. Install or start Ollama, then check again.' }); }
    if (activeTask && ['queued', 'downloading', 'verifying'].includes(activeTask.state)) return res.status(409).json({ error: 'A model download is already in progress.', activeDownload: publicTask(activeTask) });
    if (installed.some(item => item.name === model)) return res.status(409).json({ error: 'This model is already installed. Select it instead of downloading it again.', installed: true, model });
    const task = {
      id: idFactory(), model, state: 'queued', status: 'Preparing download',
      progress: null, completed: 0, total: 0, error: null, layers: new Map(),
      receivedSuccess: false, startedAt: new Date().toISOString(), controller: new AbortController(),
    };
    tasks.set(task.id, task); activeTask = task;
    // Retain only a bounded recent history. Tasks never write model files themselves.
    if (tasks.size > 20) for (const [id, old] of tasks) { if (old !== task && !['queued', 'downloading', 'verifying'].includes(old.state)) { tasks.delete(id); if (tasks.size <= 20) break; } }
    res.status(202).json(publicTask(task));
    void runDownload(task);
  });
  router.get('/pull/:id', (req, res) => {
    const task = tasks.get(req.params.id);
    if (!task) return res.status(404).json({ error: 'This download is not known to this session. Check installed models before retrying.' });
    res.json(publicTask(task));
  });
  router.post('/pull/:id/cancel', (req, res) => {
    const task = tasks.get(req.params.id);
    if (!task) return res.status(404).json({ error: 'This download is not known to this session.' });
    if (['queued', 'downloading', 'verifying'].includes(task.state)) {
      task.state = 'cancelled'; task.status = 'Download cancelled'; task.finishedAt = new Date().toISOString();
      task.controller.abort();
    }
    res.json(publicTask(task));
  });
  // Root/desktop owns server lifecycle. This hook cancels only downloads created here.
  router.shutdown = () => { for (const task of tasks.values()) if (['queued', 'downloading', 'verifying'].includes(task.state)) { task.state = 'cancelled'; task.status = 'Application closed'; task.controller.abort(); } };
  return router;
}
