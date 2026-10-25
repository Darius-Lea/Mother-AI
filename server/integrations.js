import express from 'express';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { reviewSource } from './security.js';

export const INTEGRATION_SCOPES = Object.freeze(['chat', 'code:review']);
const MAX_INTEGRATIONS = 50;
const MAX_REGISTRY_BYTES = 256 * 1024;
const hashToken = token => createHash('sha256').update(token).digest();
const safeSummary = ({ id, name, scopes, createdAt, lastUsedAt }) => ({ id, name, scopes: [...scopes], createdAt, lastUsedAt });

export class IntegrationError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** Opaque app grants. Raw bearer credentials are returned once, never persisted. */
export function createIntegrationStore({ directory = process.env.MOTHER_DATA_DIR || path.join(os.homedir(), '.mother-ai') } = {}) {
  const filename = path.join(directory, 'integrations.json');
  let registry;
  let queue = Promise.resolve();
  async function readRegistry() {
    if (registry) return registry;
    try {
      const stat = await fs.stat(filename);
      if (!stat.isFile() || stat.size > MAX_REGISTRY_BYTES) throw new Error('Invalid registry size.');
      const parsed = JSON.parse(await fs.readFile(filename, 'utf8'));
      if (parsed.version !== 1 || !Array.isArray(parsed.connections) || parsed.connections.length > MAX_INTEGRATIONS) throw new Error('Unsupported registry.');
      registry = parsed.connections.map(record => {
        if (!record || !/^[a-f0-9]{24}$/.test(record.id) || typeof record.name !== 'string' || !record.name.trim() || record.name.length > 80 || !Array.isArray(record.scopes) || !record.scopes.length || record.scopes.some(scope => !INTEGRATION_SCOPES.includes(scope)) || !/^[a-f0-9]{64}$/.test(record.tokenHash)) throw new Error('Invalid registry record.');
        return { id: record.id, name: record.name, scopes: [...new Set(record.scopes)], tokenHash: record.tokenHash, createdAt: typeof record.createdAt === 'string' ? record.createdAt : '', lastUsedAt: typeof record.lastUsedAt === 'string' ? record.lastUsedAt : null };
      });
    } catch (error) {
      if (error.code === 'ENOENT') registry = [];
      else throw new IntegrationError('Mother could not safely read the app connection registry. Existing grants were preserved; repair or restore the local registry before adding connections.', 503);
    }
    return registry;
  }
  async function writeRegistry(records) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `.integrations-${randomBytes(8).toString('hex')}.tmp`);
    try {
      await fs.writeFile(temporary, JSON.stringify({ version: 1, connections: records }, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, filename);
      registry = records;
    } finally { await fs.unlink(temporary).catch(() => {}); }
  }
  function mutate(operation) {
    const pending = queue.then(async () => operation(await readRegistry()));
    queue = pending.catch(() => {});
    return pending;
  }
  return {
    async list() { await queue; return (await readRegistry()).map(safeSummary); },
    async grant({ name, scopes } = {}) {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new IntegrationError('Name your app using 1–80 readable characters.');
      if (!Array.isArray(scopes) || !scopes.length || scopes.some(scope => !INTEGRATION_SCOPES.includes(scope))) throw new IntegrationError('Choose chat, code:review, or both.');
      return mutate(async records => {
        if (records.length >= MAX_INTEGRATIONS) throw new IntegrationError('Mother supports 50 connected apps. Revoke one before adding another.', 409);
        const token = `mother_${randomBytes(32).toString('base64url')}`;
        const record = { id: randomBytes(12).toString('hex'), name: name.trim(), scopes: [...new Set(scopes)], tokenHash: hashToken(token).toString('hex'), createdAt: new Date().toISOString(), lastUsedAt: null };
        await writeRegistry([...records, record]);
        return { connection: safeSummary(record), token };
      });
    },
    async revoke(id) {
      if (!/^[a-f0-9]{24}$/.test(id || '')) throw new IntegrationError('Connection not found.', 404);
      return mutate(async records => {
        if (!records.some(record => record.id === id)) throw new IntegrationError('Connection not found.', 404);
        await writeRegistry(records.filter(record => record.id !== id));
      });
    },
    async authenticate(token, scope) {
      if (typeof token !== 'string' || !/^mother_[A-Za-z0-9_-]{43}$/.test(token)) throw new IntegrationError('A valid Mother app token is required.', 401);
      await queue;
      const digest = hashToken(token);
      const records = await readRegistry();
      // Evaluate all records rather than exposing the position of a matching token.
      let found;
      for (const record of records) if (timingSafeEqual(Buffer.from(record.tokenHash, 'hex'), digest)) found = record;
      if (!found) throw new IntegrationError('This app token is invalid or has been revoked.', 401);
      if (scope && !found.scopes.includes(scope)) throw new IntegrationError(`This app was not granted ${scope} access.`, 403);
      return safeSummary(found);
    },
    async recordUse(id) {
      return mutate(async records => {
        const index = records.findIndex(record => record.id === id);
        if (index < 0) return;
        const next = records.map(record => record.id === id ? { ...record, lastUsedAt: new Date().toISOString() } : record);
        await writeRegistry(next);
      });
    },
  };
}

function sendFailure(res, error) {
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
  res.status(status).json({ error: error instanceof IntegrationError || status < 500 ? error.message : status === 503 ? error.message || 'The local model service is unavailable.' : 'The app connection could not complete its request.' });
}

export function validateIntegrationChat(body) {
  const { model, messages, context = '' } = body || {};
  if (typeof model !== 'string' || !/^[\w./:@-]{1,150}$/.test(model)) throw new IntegrationError('Select a valid installed local model.');
  if (!Array.isArray(messages) || !messages.length || messages.length > 100 || messages.some(message => !message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 16000)) throw new IntegrationError('Provide 1–100 user/assistant messages of at most 16,000 characters each.');
  if (typeof context !== 'string' || context.length > 40000) throw new IntegrationError('Reference context is limited to 40,000 characters.');
  return { model, messages: messages.map(({ role, content }) => ({ role, content })), context };
}

/** Admin routes deny access unless the embedding app supplies its own admin gate. */
export function createIntegrationRouters({ directory, store = createIntegrationStore({ directory }), requireAdmin = (_req, res) => res.status(403).json({ error: 'Open Mother to manage app connections.' }), chat, models } = {}) {
  const adminRouter = express.Router();
  const apiRouter = express.Router();
  adminRouter.use(requireAdmin);
  adminRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  adminRouter.get('/info', (req, res) => {
    res.json({ baseUrl: `http://127.0.0.1:${req.socket.localPort}`, restartChangesPort: true, transport: 'loopback-http', browserCrossOrigin: false });
  });
  adminRouter.get('/', async (_req, res) => {
    try { res.json({ connections: await store.list(), scopes: INTEGRATION_SCOPES }); } catch (error) { sendFailure(res, error); }
  });
  adminRouter.post('/', async (req, res) => {
    try { res.status(201).json(await store.grant(req.body)); } catch (error) { sendFailure(res, error); }
  });
  adminRouter.delete('/:id', async (req, res) => {
    try { await store.revoke(req.params.id); res.json({ revoked: true }); } catch (error) { sendFailure(res, error); }
  });
  function authorize(scope) {
    return async (req, res, next) => {
      try {
        const header = req.get('authorization');
        const credential = typeof header === 'string' ? /^Bearer[ \t]+([^ \t]+)$/i.exec(header) : null;
        if (!credential) throw new IntegrationError('Send your app token in the Authorization: Bearer header.', 401);
        req.motherIntegration = await store.authenticate(credential[1], scope);
        res.setHeader('Cache-Control', 'no-store');
        next();
      } catch (error) { sendFailure(res, error); }
    };
  }
  apiRouter.get('/status', authorize(), async (req, res) => {
    try {
      const runtime = models ? await models() : { available: false, models: [] };
      res.json({ name: 'Mother AI', connectedApp: req.motherIntegration.name, scopes: req.motherIntegration.scopes, features: { neuralChat: !!runtime.available && Array.isArray(runtime.models) && runtime.models.length > 0, codeReview: 'local-static-patterns' }, runtime });
    } catch (error) { sendFailure(res, error); }
  });
  apiRouter.post('/chat', authorize('chat'), async (req, res) => {
    try {
      const body = validateIntegrationChat(req.body);
      if (typeof chat !== 'function') throw new IntegrationError('Neural conversation is unavailable. Connect a local model in Mother first.', 503);
      const result = await chat(body);
      if (!result?.message?.content || result.neural !== true) throw new IntegrationError('The local model did not return a valid neural response.', 502);
      await store.recordUse(req.motherIntegration.id);
      res.json(result);
    } catch (error) { sendFailure(res, error); }
  });
  apiRouter.post('/review', authorize('code:review'), async (req, res) => {
    try {
      const report = reviewSource(req.body?.source);
      await store.recordUse(req.motherIntegration.id);
      res.json({ ...report, engine: 'local-static-patterns', neural: false, limitation: 'Pattern checks are not a complete security audit. Source is never executed.' });
    } catch (error) { sendFailure(res, error instanceof TypeError ? new IntegrationError(error.message) : error.message?.startsWith('Limit the review') ? new IntegrationError(error.message) : error); }
  });
  return { adminRouter, apiRouter, store };
}
