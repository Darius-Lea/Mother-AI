'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const { createRuntimeManager, verifyBundle, RUNTIME_VERSION } = require('./runtime.cjs');

async function bundle(t, { platform = 'linux', arch = 'x64' } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mother-engine-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'runtime');
  const executable = `bin/ollama${platform === 'win32' ? '.exe' : ''}`;
  const libraryDirectory = platform === 'darwin' ? 'bin' : 'lib/ollama';
  const files = [];
  for (const [name, data] of [[executable, 'test-runtime-bytes'], [`${libraryDirectory}/RUNTIME_LICENSE`, 'test-license-bytes']]) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), data);
    files.push({ path: name, size: Buffer.byteLength(data), sha256: createHash('sha256').update(data).digest('hex') });
  }
  const manifest = { schema: 1, platform, arch, version: RUNTIME_VERSION, executable, libraryDirectory, files };
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  return { resourcesPath: directory, userData: path.join(directory, 'data'), root, manifest };
}

const service = () => async url => Response.json(url.endsWith('/api/version') ? { version: RUNTIME_VERSION } : { models: [] });
const unavailable = async () => { throw new Error('No service'); };
function fakeChild() {
  const child = new EventEmitter();
  child.exitCode = null; child.signalCode = null; child.kills = [];
  child.kill = signal => {
    child.kills.push(signal); child.signalCode = signal;
    queueMicrotask(() => child.emit('exit', null, signal));
    return true;
  };
  return child;
}

test('bundled engine verification rejects changed bytes, wrong architecture and injected libraries', async t => {
  const options = await bundle(t);
  const result = await verifyBundle({ ...options, platform: 'linux', arch: 'x64' });
  assert.equal(result.executable, path.join(options.root, 'bin', 'ollama'));
  await assert.rejects(verifyBundle({ ...options, platform: 'linux', arch: 'arm64' }), /Unsupported/);
  await fs.writeFile(path.join(options.root, 'bin', 'unexpected.dll'), 'unexpected');
  await assert.rejects(verifyBundle({ ...options, platform: 'linux', arch: 'x64' }), /unexpected/);
  await fs.rm(path.join(options.root, 'bin', 'unexpected.dll'));
  await fs.writeFile(path.join(options.root, 'bin', 'ollama'), 'bad!-runtime-bytes');
  await assert.rejects(verifyBundle({ ...options, platform: 'linux', arch: 'x64' }), /integrity/);
});

test('bundled engine verification rejects manifest traversal and symlinks', async t => {
  const options = await bundle(t);
  options.manifest.files[0].path = '../outside';
  await fs.writeFile(path.join(options.root, 'manifest.json'), JSON.stringify(options.manifest));
  await assert.rejects(verifyBundle({ ...options, platform: 'linux', arch: 'x64' }), /record/);
  options.manifest.files[0].path = 'bin/ollama';
  await fs.writeFile(path.join(options.root, 'manifest.json'), JSON.stringify(options.manifest));
  // Symlink creation is not granted to ordinary Windows CI accounts.
  if (process.platform !== 'win32') {
    await fs.rm(path.join(options.root, 'bin', 'ollama'));
    await fs.symlink(path.join(options.root, 'lib', 'ollama', 'RUNTIME_LICENSE'), path.join(options.root, 'bin', 'ollama'));
    await assert.rejects(verifyBundle({ ...options, platform: 'linux', arch: 'x64' }), /symbolic/);
  }
});

test('a validated existing service is reused and never terminated by Mother', async t => {
  let spawned = 0;
  const options = await bundle(t);
  const manager = createRuntimeManager({ ...options, platform: 'linux', arch: 'x64', fetchImpl: service(), spawnImpl: () => { spawned++; } });
  const result = await manager.ensureStarted();
  assert.equal(result.available, true);
  assert.equal(result.source, 'existing');
  assert.equal(result.version, RUNTIME_VERSION);
  manager.stop();
  assert.equal(spawned, 0);
  assert.equal(manager.status().state, 'stopped');
});

test('automatic setup verifies the bundle, starts a fixed child and coalesces duplicate requests', async t => {
  const options = await bundle(t, { platform: 'win32', arch: 'arm64' });
  let launched = false;
  let count = 0;
  const owned = fakeChild();
  const manager = createRuntimeManager({ ...options, platform: 'win32', arch: 'arm64',
    fetchImpl: async (...args) => launched ? service()(...args) : unavailable(),
    spawnImpl: (file, args, spawnOptions) => {
      count++; launched = true;
      assert.equal(file, path.join(options.root, 'bin', 'ollama.exe'));
      assert.deepEqual(args, ['serve']);
      assert.equal(spawnOptions.shell, false);
      assert.equal(spawnOptions.windowsHide, true);
      assert.equal(spawnOptions.env.OLLAMA_HOST, '127.0.0.1:11434');
      assert.equal(spawnOptions.env.OLLAMA_NO_CLOUD, '1');
      assert.equal(spawnOptions.env.OLLAMA_MODELS, path.join(options.userData, 'models'));
      assert.equal(spawnOptions.env.HOME, process.env.HOME);
      assert.ok(!JSON.stringify(manager.status()).includes(options.resourcesPath));
      return owned;
    } });
  t.after(() => manager.stop());
  const first = manager.ensureStarted();
  assert.equal(first, manager.ensureStarted());
  const result = await first;
  assert.equal(result.source, 'bundled');
  assert.equal(result.available, true);
  assert.equal(count, 1);
  manager.stop();
  assert.deepEqual(owned.kills, ['SIGTERM']);
});

test('an external service disappearing triggers a fresh bundled startup on retry', async t => {
  const options = await bundle(t);
  let external = true;
  let launched = false;
  let count = 0;
  const manager = createRuntimeManager({ ...options, platform: 'linux', arch: 'x64',
    fetchImpl: async (...args) => (external || launched) ? service()(...args) : unavailable(),
    spawnImpl: () => { count++; launched = true; return fakeChild(); } });
  t.after(() => manager.stop());
  assert.equal((await manager.ensureStarted()).source, 'existing');
  external = false;
  assert.equal((await manager.ensureStarted()).source, 'bundled');
  assert.equal(count, 1);
});

test('invalid local responses do not count as readiness; startup times out and stops only its own child', async t => {
  const options = await bundle(t);
  const owned = fakeChild();
  const manager = createRuntimeManager({ ...options, platform: 'linux', arch: 'x64',
    fetchImpl: async () => Response.json({ unrelated: true }), spawnImpl: () => owned,
    startupTimeoutMs: 30, pollIntervalMs: 5 });
  t.after(() => manager.stop());
  const result = await manager.ensureStarted();
  assert.equal(result.state, 'error');
  assert.equal(result.available, false);
  assert.deepEqual(owned.kills, ['SIGTERM']);
  assert.ok(!result.error.includes(options.resourcesPath));
});

test('stopping during bundle verification cannot launch an orphan child', async t => {
  const options = await bundle(t);
  let count = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const manager = createRuntimeManager({ ...options, platform: 'linux', arch: 'x64',
    fetchImpl: async () => { await gate; throw new Error('No runtime'); }, spawnImpl: () => { count++; return fakeChild(); } });
  const starting = manager.ensureStarted();
  manager.stop(); release();
  assert.equal((await starting).state, 'stopped');
  assert.equal(count, 0);
});

test('archive preparation excludes GPU binaries and rejects traversal and escaped links', () => {
  const program = String.raw`
import importlib.util, io, pathlib, sys, tarfile, tempfile, zipfile
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('prep', 'scripts/prepare-runtime.py')
p=importlib.util.module_from_spec(spec); spec.loader.exec_module(p)
assert p.selected_name('lib/ollama/cuda_v13/ggml-cuda.dll','win32') is None
assert p.selected_name('lib/ollama/cuda_v13/vcruntime140.dll','win32')=='lib/ollama/vcruntime140.dll'
assert p.selected_name('mlx_metal_v4/libmlx.dylib','darwin','arm64')=='bin/mlx_metal_v4/libmlx.dylib'
assert p.selected_name('mlx_metal_v4/libmlx.dylib','darwin','x64') is None
with tempfile.TemporaryDirectory() as temp:
 root=pathlib.Path(temp)
 for unsafe in ('../outside','/absolute','lib/../../outside','C:/outside','lib\\outside'):
  try: p.safe_name(unsafe)
  except ValueError: pass
  else: raise AssertionError('unsafe archive path accepted')
 data=io.BytesIO()
 with tarfile.open(fileobj=data,mode='w') as archive:
  m=tarfile.TarInfo('lib/ollama/libcpu.so.1');m.size=3;archive.addfile(m,io.BytesIO(b'cpu'))
  m=tarfile.TarInfo('lib/ollama/libcpu.so');m.type=tarfile.SYMTYPE;m.linkname='libcpu.so.1';archive.addfile(m)
 data.seek(0)
 extractor=p.Extractor(root/'safe','linux');p.extract_tar(data,extractor);extractor.materialize_links()
 assert (root/'safe/lib/ollama/libcpu.so').read_bytes()==b'cpu'
 assert not (root/'safe/lib/ollama/libcpu.so').is_symlink()
 extractor=p.Extractor(root/'unsafe','linux')
 try: extractor.add('lib/ollama/link',0,linkname='/etc/passwd')
 except ValueError: pass
 else: raise AssertionError('absolute link accepted')
 bad=root/'bad.zip'
 with zipfile.ZipFile(bad,'w') as archive: archive.writestr('../outside',b'bad')
 try: p.extract_archive(bad,root/'out','win32')
 except ValueError: pass
 else: raise AssertionError('unsafe ZIP accepted')
print('archive guards passed')
`;
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', program], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /archive guards passed/);
});
