import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import {timingSafeEqual} from 'node:crypto';
import {createLocalBrain} from './brain.js';
import {createModelRouter} from './models.js';
import {createIntegrationRouters} from './integrations.js';
import {createWorkspaceRouter} from './workspace.js';
import {createKaliRouter} from './kali.js';
import { DatasetError, inspectDataset } from './datasets.js';
import {deploymentConfig,publicCapabilities} from './deployment.js';
import {createDistributionCatalog} from './distribution.js';
import {createWebRouter} from './web.js';
import {createVoiceRouter} from './voice.js';
import {BUILD_INFO} from './build-info.js';
import {createRecognitionRouter} from './recognition.js';

/** The browser may not access the local brain through an attacker-owned DNS name. */
export function isAllowedHostHeader(header, allowedHosts = []) {
  if (typeof header !== 'string' || !header || /[\s,/@?#\\]/.test(header)) return false;
  let parsed;
  try { parsed = new URL(`http://${header}`); } catch { return false; }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return false;
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (hostname === 'localhost' || net.isIP(hostname)) return true;
  return allowedHosts.some((value) => {
    if (typeof value !== 'string') return false;
    const allowed = value.trim().toLowerCase().replace(/\.$/, '');
    // Exact DNS names only: no schemes, paths, ports, credentials, or wildcards.
    return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(allowed) && allowed === hostname;
  });
}

export function createApp({ fetchImpl = fetch, distributionFetchImpl, webOptions = {}, voiceOptions = {}, inspect = inspectDataset, desktopToken, dataDirectory = process.env.MOTHER_DATA_DIR || path.join(os.homedir(), '.mother-ai'), workspaceRoot, mode = deploymentConfig(process.env,desktopToken).mode, allowedHosts = deploymentConfig(process.env,desktopToken).allowedHosts } = {}) {
  const app = express();
  app.disable('x-powered-by');
  const hostedPreview=mode==='hosted-preview';
  const brain=createLocalBrain({fetchImpl});
  app.locals.mode=mode;
  const requireAdmin=(req,res,next)=>{
    if(!desktopToken)return next();
    const supplied=req.get('X-Mother-Desktop-Token');
    if(typeof supplied!=='string'||Buffer.byteLength(supplied)!==Buffer.byteLength(desktopToken)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(desktopToken)))return res.status(401).json({error:'Open Mother to use this private app session.'});
    next();
  };
  // The API intentionally has no permissive CORS. Access through Vite or the built same-origin app.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // All app assets, voice data and workers are same-origin. Isolation permits
    // the neural voice's WASM engine to share CPU work across bounded threads.
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    if(hostedPreview){
      res.setHeader('X-Frame-Options','DENY');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    }
    if (!isAllowedHostHeader(req.get('host'), allowedHosts)) {
      return res.status(403).json({ error: 'Untrusted Host header. Use localhost, a literal IP address, or an explicitly configured MOTHER_ALLOWED_HOSTS hostname.' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.get('origin');
      if (origin) {
        let parsed;
        try { parsed = new URL(origin); } catch { return res.status(403).json({ error: 'Invalid request origin.' }); }
        if (parsed.host !== req.get('host')) return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
      }
      if (!req.is('application/json')) return res.status(415).json({ error: 'Use application/json.' });
    }
    next();
  });
  app.use('/api',(req,res,next)=>{
    const voiceAsset=['GET','HEAD'].includes(req.method) && (req.path==='/voice/status'||req.path.startsWith('/voice/files/')||['/recognition/status','/recognition/model.tar.gz'].includes(req.path));
    if(hostedPreview&&!voiceAsset&&!['/health','/models','/distribution'].includes(req.path)){
      return res.status(403).json({error:'This web preview keeps computer controls private. Download Mother for local AI setup, projects, app permissions, and host security tools.',mode:'hosted-preview'});
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use('/api',(req,res,next)=>{if(req.path==='/health'||req.path==='/distribution'||req.path==='/connect'||req.path.startsWith('/connect/'))return next();return requireAdmin(req,res,next);});

  app.get('/api/health',(_req,res)=>{res.setHeader('Cache-Control','no-store');res.json({ok:true,name:'Mother AI',...BUILD_INFO,releaseStatus:'first-release-preview',storage:'browser-local',paidServices:false,mode,capabilities:publicCapabilities(mode)});});
  app.get('/api/models',async(_req,res)=>res.json(hostedPreview?{available:false,models:[],mode,error:'This hosted preview uses the offline guide. Local neural models run in the desktop app.'}:await brain.models()));
  app.post('/api/chat',async(req,res)=>{try{res.json(await brain.chat(req.body));}catch(error){res.status(error.status||500).json({error:error.message});}});
  app.post('/api/chat/stream',async(req,res)=>{
    const controller=new AbortController();
    const cancel=()=>{if(!res.writableEnded)controller.abort();};
    res.on('close',cancel);
    const emit=value=>{if(!res.destroyed && !controller.signal.aborted)res.write(JSON.stringify(value)+'\n');};
    res.setHeader('Content-Type','application/x-ndjson');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Accel-Buffering','no');
    try {
      const result=await brain.stream(req.body,{signal:controller.signal,onChunk:text=>emit({type:'delta',text})});
      emit({type:'done',result});
    }catch(error){
      if(!res.headersSent)res.status(error.status||500);
      emit({type:'error',error:error.message});
    }finally{res.off('close',cancel);res.end();}
  });
  const modelRouter=createModelRouter({fetchImpl});
  app.use('/api/setup',modelRouter);
  const integrations=createIntegrationRouters({directory:dataDirectory,requireAdmin,chat:brain.chat,models:brain.models});
  app.use('/api/integrations',integrations.adminRouter);
  app.use('/api/connect',integrations.apiRouter);
  app.use('/api/workspace',createWorkspaceRouter({rootDirectory:workspaceRoot}));
  const securityRouter=createKaliRouter();
  app.use('/api/security',securityRouter);
  const webRouter=createWebRouter({dataDirectory:path.join(dataDirectory,'web'),...webOptions});
  app.use('/api/web',webRouter);
  const voiceRouter=createVoiceRouter({directory:path.join(dataDirectory,'voice'),nativeSynthesis:!hostedPreview,...voiceOptions});
  app.use('/api/voice',voiceRouter);
  const recognitionRouter=createRecognitionRouter({directory:path.join(dataDirectory,'recognition')});
  app.use('/api/recognition',recognitionRouter);
  app.locals.shutdown=()=>{modelRouter.shutdown?.();securityRouter.shutdown?.();webRouter.shutdown?.();voiceRouter.shutdown?.();recognitionRouter.shutdown?.();};

  app.post('/api/datasets/inspect', async (req, res) => {
    if (typeof req.body?.url !== 'string' || req.body.url.length > 4096) return res.status(400).json({ error: 'Provide one public HTTPS dataset URL.' });
    try { res.json(await inspect(req.body.url)); }
    catch (error) { res.status(error instanceof DatasetError ? error.status : 422).json({ error: error instanceof DatasetError ? error.message : 'Could not inspect this dataset.' }); }
  });

  const distribution=createDistributionCatalog({fetchImpl:distributionFetchImpl});
  app.get('/api/distribution',async(_req,res)=>{res.setHeader('Cache-Control','no-store');res.json(await distribution.catalog());});
  app.get('/downloads/:filename',async(req,res)=>{
    const filename=req.params.filename;
    if(path.basename(filename)!==filename)return res.status(404).json({error:'This installer is not available.'});
    const candidate=await distribution.localFile(filename);
    if(!candidate)return res.status(404).json({error:'This installer is not available on this machine.'});
    res.download(candidate,filename);
  });
  const distPath = fileURLToPath(new URL('../dist', import.meta.url));
  app.use(express.static(distPath, { index: false }));
  app.get('/{*path}', (req, res, next) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Unknown API route.' });
    res.sendFile(path.join(distPath, 'index.html'), (error) => { if (error) next(); });
  });
  app.use((error, _req, res, _next) => {
    const status = error.status === 413 ? 413 : error instanceof SyntaxError ? 400 : 500;
    res.status(status).json({ error: status === 413 ? 'Request body is too large.' : status === 400 ? 'Invalid JSON request.' : 'An internal server error occurred.' });
  });
  return app;
}

export function startServer({env=process.env}={}) {
  const config=deploymentConfig(env);
  const app=createApp({mode:config.mode,allowedHosts:config.allowedHosts});
  const server=app.listen(config.port,config.host,()=>console.log(`Mother AI web server listening on ${config.host}:${server.address().port} (${config.mode}).`));
  let stopping=false;
  const shutdown=()=>{
    if(stopping)return;stopping=true;
    app.locals.shutdown?.();server.close();server.closeAllConnections?.();
  };
  server.once('close',()=>{process.off('SIGTERM',shutdown);process.off('SIGINT',shutdown);});
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
  return {app,server,shutdown};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))startServer();
