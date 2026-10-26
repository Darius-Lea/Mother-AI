import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {createApp} from './index.js';

async function serverFor(t){
  let invoked=false;
  const app=createApp({mode:'hosted-preview',allowedHosts:['mother-example.onrender.com'],distributionFetchImpl:async()=>new Response('',{status:404}),fetchImpl:async()=>{invoked=true;throw Error('Must not call the local model');}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{app.locals.shutdown();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});});
  return {base:`http://127.0.0.1:${server.address().port}`,invoked:()=>invoked};
}

test('public preview serves health, capability and download metadata without probing a private model',async t=>{
  const {base,invoked}=await serverFor(t);
  const health=await fetch(base+'/api/health').then(r=>r.json());assert.equal(health.mode,'hosted-preview');assert.equal(health.capabilities.projectAccess,false);
  const models=await fetch(base+'/api/models').then(r=>r.json());assert.equal(models.available,false);assert.deepEqual(models.models,[]);assert.equal(invoked(),false);
  const catalog=await fetch(base+'/api/distribution').then(r=>r.json());assert.equal(catalog.status,'pending');assert.deepEqual(catalog.artifacts,[]);assert.equal(catalog.desktopBuildsUrl,undefined);
  const headers=await fetch(base+'/api/health');assert.equal(headers.headers.get('x-frame-options'),'DENY');assert.match(headers.headers.get('content-security-policy'),/object-src 'none'/);
});

test('public preview rejects computer controls and app grants before invoking services',async t=>{
  const {base,invoked}=await serverFor(t);
  for(const endpoint of ['/api/workspace/status','/api/integrations','/api/connect/status','/api/security/capabilities','/api/setup/status']){
    const response=await fetch(base+endpoint);assert.equal(response.status,403);assert.match((await response.json()).error,/web preview/);
  }
  for(const endpoint of ['/api/workspace/open','/api/setup/pull','/api/chat','/api/datasets/inspect']){
    const response=await fetch(base+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,403);
  }
  assert.equal(invoked(),false);
});

test('Render legacy Node entry starts a web server without Electron and honors the provider port',async t=>{
  const cwd=fileURLToPath(new URL('..',import.meta.url));
  const child=spawn(process.execPath,['desktop/main.cjs'],{cwd,env:{...process.env,RENDER:'true',PORT:'0',HOST:'127.0.0.1',RENDER_EXTERNAL_HOSTNAME:'mother-example.onrender.com'},stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',chunk=>logs+=chunk.toString());child.stderr.on('data',chunk=>logs+=chunk.toString());
  t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}});
  let port;
  for(let index=0;index<120;index++){const match=logs.match(/listening on 127\.0\.0\.1:(\d+) \(hosted-preview\)/);if(match){port=match[1];break;}if(child.exitCode!==null)break;await pause(50);}
  assert.ok(port,`Web process did not start: ${logs}`);
  const response=await fetch(`http://127.0.0.1:${port}/api/health`);assert.equal(response.status,200);assert.equal((await response.json()).mode,'hosted-preview');
  assert.doesNotMatch(logs,/Downloading Electron|registerSchemesAsPrivileged|TypeError/);
});
