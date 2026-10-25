import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from './index.js';

test('desktop owner session isolates admin APIs while explicitly scoped app tokens work',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'mother-session-'));
  const desktopToken='a'.repeat(64);
  const app=createApp({desktopToken,dataDirectory:directory,fetchImpl:async()=>{throw Error('No model');}});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{app.locals.shutdown();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/api/health')).status,200);
  assert.equal((await (await fetch(base+'/api/health')).json()).version,'1.0.0-preview.1');
  for(const route of ['/api/models','/api/setup/status','/api/integrations','/api/workspace/status','/api/security/capabilities'])assert.equal((await fetch(base+route)).status,401);
  assert.equal((await fetch(base+'/api/models',{headers:{'X-Mother-Desktop-Token':'wrong'}})).status,401);
  const headers={'Content-Type':'application/json','X-Mother-Desktop-Token':desktopToken};
  const grantResponse=await fetch(base+'/api/integrations',{method:'POST',headers,body:JSON.stringify({name:'Test local app',scopes:['code:review']})});
  assert.equal(grantResponse.status,201);const grant=await grantResponse.json();
  const appHeaders={'Content-Type':'application/json',Authorization:`Bearer ${grant.token}`};
  const reviewed=await fetch(base+'/api/connect/review',{method:'POST',headers:appHeaders,body:JSON.stringify({source:'eval(userInput);'})});
  assert.equal(reviewed.status,200);assert.equal((await reviewed.json()).neural,false);
  assert.equal((await fetch(base+'/api/integrations',{headers:appHeaders})).status,401);
  assert.equal((await fetch(base+'/api/connect/chat',{method:'POST',headers:appHeaders,body:JSON.stringify({model:'qwen3:8b',messages:[{role:'user',content:'Hello'}]})})).status,403);
  assert.equal((await fetch(`${base}/api/integrations/${grant.connection.id}`,{method:'DELETE',headers,body:'{}'})).status,200);
  assert.equal((await fetch(base+'/api/connect/status',{headers:appHeaders})).status,401);
});
