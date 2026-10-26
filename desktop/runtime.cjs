'use strict';
// Mother starts only the runtime distributed with her installer. The renderer
// never supplies executable paths, command arguments, environment or URLs.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

const RUNTIME_VERSION = '0.40.11';
const RUNTIME_ORIGIN = 'http://127.0.0.1:11434';
const SUPPORTED = new Set(['win32-x64', 'win32-arm64', 'darwin-x64', 'darwin-arm64', 'linux-x64']);

function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 && value.length < 512
    && !value.includes('\\') && !value.includes('\0') && !value.startsWith('/')
    && value.split('/').every(part => part && part !== '.' && part !== '..' && !part.includes(':'));
}

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyBundle({ resourcesPath, bundleDirectory, platform = process.platform, arch = process.arch }) {
  if (!SUPPORTED.has(`${platform}-${arch}`)) throw new Error('Unsupported bundled runtime platform.');
  const directory = path.resolve(bundleDirectory || path.join(resourcesPath, 'runtime'));
  const rootStat = await fs.promises.lstat(directory);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Invalid runtime bundle directory.');
  const manifestPath = path.join(directory, 'manifest.json');
  const manifestStat = await fs.promises.lstat(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 256 * 1024) throw new Error('Invalid runtime manifest.');
  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
  const expectedExecutable = `bin/ollama${platform === 'win32' ? '.exe' : ''}`;
  const expectedLibraryDirectory = platform === 'darwin' ? 'bin' : 'lib/ollama';
  if (manifest.schema !== 1 || manifest.version !== RUNTIME_VERSION || manifest.platform !== platform || manifest.arch !== arch
      || manifest.executable !== expectedExecutable || manifest.libraryDirectory !== expectedLibraryDirectory
      || !Array.isArray(manifest.files) || manifest.files.length < 2 || manifest.files.length > 500) {
    throw new Error('Runtime manifest does not match this installer.');
  }
  const expected = new Set();
  for (const entry of manifest.files) {
    if (!safeRelative(entry?.path) || entry.path === 'manifest.json' || expected.has(entry.path)
        || !/^[a-f0-9]{64}$/.test(entry.sha256 || '') || !Number.isSafeInteger(entry.size) || entry.size < 1) {
      throw new Error('Invalid runtime file record.');
    }
    expected.add(entry.path);
  }
  if (!expected.has(expectedExecutable)) throw new Error('The bundled runtime executable is missing.');

  // Reject added DLLs and symlinks as well as changed bytes. Build preparation
  // materializes only confined upstream symlinks as regular files.
  async function inspect(relative = '') {
    for (const entry of await fs.promises.readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error('Runtime bundle contains a symbolic link.');
      if (entry.isDirectory()) await inspect(name);
      else if (!entry.isFile() || (name !== 'manifest.json' && !expected.has(name))) throw new Error('Runtime bundle contains an unexpected file.');
    }
  }
  await inspect();
  for (const entry of manifest.files) {
    const file = path.join(directory, ...entry.path.split('/'));
    const stat = await fs.promises.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.size || await digest(file) !== entry.sha256) {
      throw new Error('Bundled runtime integrity check failed.');
    }
  }
  return {
    directory,
    executable: path.join(directory, ...expectedExecutable.split('/')),
    libraryDirectory: path.join(directory, ...expectedLibraryDirectory.split('/')),
    manifest,
  };
}

async function readJson(response) {
  if (!response.ok) throw new Error('Runtime did not respond.');
  if (Number(response.headers.get('content-length') || 0) > 2 * 1024 * 1024) throw new Error('Runtime response is too large.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Runtime response is empty.');
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new Error('Runtime response is too large.');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function probeRuntime(fetchImpl, timeoutMs = 1400) {
  const signal = AbortSignal.timeout(timeoutMs);
  const [version, tags] = await Promise.all([
    fetchImpl(`${RUNTIME_ORIGIN}/api/version`, { signal, redirect: 'error' }).then(readJson),
    fetchImpl(`${RUNTIME_ORIGIN}/api/tags`, { signal, redirect: 'error' }).then(readJson),
  ]);
  if (typeof version?.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version.version)
      || !Array.isArray(tags?.models) || tags.models.some(model => !model || typeof model.name !== 'string')) {
    throw new Error('No compatible local model service was found.');
  }
  return version.version;
}

function createRuntimeManager({ resourcesPath, bundleDirectory, userData, platform = process.platform, arch = process.arch,
  fetchImpl = globalThis.fetch, spawnImpl = spawn, startupTimeoutMs = 30000, pollIntervalMs = 250 }) {
  let current = { state: 'idle', available: false, source: null, version: null, error: null };
  let pending;
  let child;
  let stopped = false;
  const status = () => ({ ...current });
  function change(next) { current = { ...current, ...next }; return status(); }
  function terminate() {
    const owned = child;
    child = null;
    if (!owned) return;
    try { owned.kill('SIGTERM'); } catch {}
    const fallback = setTimeout(() => {
      if (owned.exitCode == null && owned.signalCode == null) { try { owned.kill('SIGKILL'); } catch {} }
    }, 2500);
    fallback.unref?.();
    owned.once('exit', () => clearTimeout(fallback));
  }

  async function start() {
    if (stopped) return status();
    change({ state: 'checking', available: false, source: null, version: null, error: null });
    try {
      const version = await probeRuntime(fetchImpl);
      if (stopped) return status();
      return change({ state: 'ready', available: true, source: child ? 'bundled' : 'existing', version });
    } catch {}
    if (stopped) return status();
    // A previously ready service can disappear between wizard visits. Restart
    // our own failed child; never kill a separate Ollama installation.
    terminate();
    change({ state: 'starting', source: 'bundled' });
    let bundle;
    try { bundle = await verifyBundle({ resourcesPath, bundleDirectory, platform, arch }); }
    catch {
      return stopped ? status() : change({ state: 'error', available: false, error: 'Mother could not verify her included AI engine. Download and reinstall the current Mother installer, then try again. Your saved memory is kept separately.' });
    }
    if (stopped) return status();
    let failed = false;
    try {
      const modelDirectory = path.join(userData, 'models');
      await fs.promises.mkdir(modelDirectory, { recursive: true });
      if (stopped) return status();
      const env = { ...process.env, OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_MODELS: modelDirectory,
        OLLAMA_NO_CLOUD: '1', OLLAMA_NUM_PARALLEL: '1', OLLAMA_CONTEXT_LENGTH: '8192',
        OLLAMA_LIBRARY_PATH: bundle.libraryDirectory };
      // Keep the native libraries beside the CPU engine discoverable to its
      // child runner, including on Windows installations without developer tools.
      if (platform === 'win32') {
        for (const key of Object.keys(env)) if (key.toUpperCase() === 'PATH') delete env[key];
        env.PATH = `${bundle.libraryDirectory};${process.env.PATH || ''}`;
      }
      child = spawnImpl(bundle.executable, ['serve'], { cwd: bundle.directory, env, shell: false, windowsHide: true, stdio: 'ignore' });
      const owned = child;
      owned.once('error', () => { failed = true; });
      owned.once('exit', () => {
        failed = true;
        if (child === owned) {
          child = null;
          if (!stopped) change({ state: 'error', available: false, error: 'Mother’s AI engine stopped. Choose Try again to restart it. If this continues, restart Mother and check available memory.' });
        }
      });
      const deadline = Date.now() + startupTimeoutMs;
      while (!stopped && !failed && Date.now() < deadline) {
        try {
          const version = await probeRuntime(fetchImpl, Math.min(1400, Math.max(1, deadline - Date.now())));
          if (!stopped && !failed) return change({ state: 'ready', available: true, source: 'bundled', version, error: null });
        } catch {}
        if (!stopped && !failed) await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      }
    } catch {}
    terminate();
    return stopped ? status() : change({ state: 'error', available: false, error: 'Mother could not start her AI engine. Choose Try again, or restart Mother. Check that this device has enough free memory and that another app is not using the local AI service.' });
  }

  return {
    status,
    ensureStarted() {
      if (stopped) return Promise.resolve(status());
      if (!pending) pending = start().finally(() => { pending = undefined; });
      return pending;
    },
    stop() { stopped = true; change({ state: 'stopped', available: false, error: null }); terminate(); },
  };
}

module.exports = { createRuntimeManager, verifyBundle, RUNTIME_VERSION };
