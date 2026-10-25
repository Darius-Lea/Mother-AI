import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { createModelRouter, hardwareSummary, recommendationsFor } from './models.js';

const hardware = { platform:'linux', arch:'x64', totalMemoryGiB:32, freeMemoryGiB:24, cpuCount:8, gpuDetected:null };
const json = (body, status=200) => new Response(JSON.stringify(body), {status, headers:{'content-type':'application/json'}});
const lines = (events) => new Response(events.map(event=>JSON.stringify(event)).join('\n')+'\n', {status:200});

async function fixture(t, options = {}) {
  const app=express();app.use(express.json());
  const router=createModelRouter({getHardware:()=>hardware,...options});app.use(router);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{router.shutdown();await new Promise(resolve=>server.close(resolve));});
  const url=`http://127.0.0.1:${server.address().port}`;
  return async(path,body)=>{
    const response=await fetch(url+path,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json()};
  };
}

async function terminal(request,id) {
  for(let i=0;i<100;i++){
    const result=await request(`/pull/${id}`);
    if(['completed','cancelled','error'].includes(result.data.state))return result.data;
    await pause(5);
  }
  throw new Error('Download did not reach a terminal state');
}

test('hardware summary reports actual hardware fields without pretending GPU detection',()=>{
  const result=hardwareSummary({totalmem:()=>16*1024**3,freemem:()=>4*1024**3,platform:()=> 'linux',arch:()=> 'x64',cpus:()=>[{},{}]});
  assert.deepEqual(result,{platform:'linux',arch:'x64',totalMemoryGiB:16,freeMemoryGiB:4,cpuCount:2,gpuDetected:null});
  assert.equal(recommendationsFor({totalMemoryGiB:3}).recommendedModel,null);
  assert.equal(recommendationsFor({totalMemoryGiB:8}).recommendedModel,'qwen2.5:1.5b');
  assert.equal(recommendationsFor({totalMemoryGiB:16}).recommendedModel,'qwen3:8b');
  assert.equal(recommendationsFor({totalMemoryGiB:32}).recommendedModel,'qwen3:14b');
  assert.equal(recommendationsFor({totalMemoryGiB:32}).recommendations.find(m=>m.name==='qwen3-coder:30b').eligible,false);
});

test('missing runtime is explicit and does not become neural-ready',async t=>{
  const request=await fixture(t,{fetchImpl:async()=>{throw new Error('ECONNREFUSED');}});
  const status=await request('/status');
  assert.equal(status.status,200);assert.equal(status.data.runtime.available,false);
  assert.deepEqual(status.data.models,[]);assert.equal(status.data.capabilities.neuralConversation,false);
  assert.equal(status.data.capabilities.paidApiRequired,false);
  const result=await request('/pull',{model:'qwen3:8b'});assert.equal(result.status,503);
});

test('installed model and actual runtime version are discovered without downloading',async t=>{
  const calls=[];
  const request=await fixture(t,{fetchImpl:async url=>{calls.push(url);return url.endsWith('/api/tags')?json({models:[{name:'qwen3:8b',size:123}]}):json({version:'0.12.0'});}});
  const result=await request('/status');assert.equal(result.data.runtime.available,true);
  assert.equal(result.data.runtime.version,'0.12.0');assert.equal(result.data.capabilities.neuralConversation,true);
  assert.equal(result.data.models[0].name,'qwen3:8b');
  const duplicate=await request('/pull',{model:'qwen3:8b'});assert.equal(duplicate.status,409);assert.equal(duplicate.data.installed,true);
  assert.ok(!calls.some(url=>url.endsWith('/api/pull')));
});

test('rejects unknown models and models that exceed hardware before invoking Ollama',async t=>{
  let count=0;const request=await fixture(t,{getHardware:()=>({...hardware,totalMemoryGiB:4}),fetchImpl:async()=>{count++;return json({models:[]});}});
  assert.equal((await request('/pull',{model:'not-an-approved-model'})).status,400);
  assert.equal((await request('/pull',{model:'qwen3:14b'})).status,422);
  assert.equal(count,0);
});

test('streams actual layer byte totals and verifies installed tags before completion',async t=>{
  let tagCalls=0,pullBody;
  const request=await fixture(t,{fetchImpl:async(url,options)=>{
    if(url.endsWith('/api/tags'))return json({models:++tagCalls>1?[{name:'qwen3:8b'}]:[]});
    if(url.endsWith('/api/pull')){pullBody=JSON.parse(options.body);return lines([{status:'pulling layer A',digest:'sha256:a',total:100,completed:50},{status:'pulling layer B',digest:'sha256:b',total:200,completed:200},{status:'pulling layer A',digest:'sha256:a',total:100,completed:100},{status:'verifying sha256 digest'},{status:'success'}]);}
    throw Error('Unexpected request');
  }});
  const start=await request('/pull',{model:'qwen3:8b'});assert.equal(start.status,202);
  const result=await terminal(request,start.data.id);
  assert.equal(result.state,'completed');assert.equal(result.progress,100);
  assert.equal(result.completed,300);assert.equal(result.total,300);
  assert.deepEqual(pullBody,{model:'qwen3:8b',stream:true});assert.equal(tagCalls,2);
});

test('success in download stream is insufficient if installed model cannot be verified',async t=>{
  const request=await fixture(t,{fetchImpl:async url=>url.endsWith('/api/tags')?json({models:[]}):lines([{status:'success'}])});
  const start=await request('/pull',{model:'qwen3:8b'});const result=await terminal(request,start.data.id);
  assert.equal(result.state,'error');assert.match(result.error,/not found in its installed list/);assert.notEqual(result.progress,100);
});

test('runtime stream errors and unfinished streams never produce successful readiness',async t=>{
  for(const events of [[{error:'registry access denied'}],[{status:'pulling manifest'}]]){
    const request=await fixture(t,{fetchImpl:async url=>url.endsWith('/api/tags')?json({models:[]}):lines(events)});
    const start=await request('/pull',{model:'qwen3:8b'});const result=await terminal(request,start.data.id);
    assert.equal(result.state,'error');assert.equal(result.progress,null);
  }
});

test('cancellation aborts only the active download and concurrency is bounded',async t=>{
  let aborted=false;
  const request=await fixture(t,{fetchImpl:async(url,options)=>{
    if(url.endsWith('/api/tags'))return json({models:[]});
    if(url.endsWith('/api/version'))return json({version:'test'});
    return new Promise((resolve,reject)=>{
      options.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Cancelled','AbortError'));},{once:true});
    });
  }});
  const start=await request('/pull',{model:'qwen3:8b'});assert.equal(start.status,202);
  const duplicate=await request('/pull',{model:'qwen2.5:1.5b'});assert.equal(duplicate.status,409);assert.equal(duplicate.data.activeDownload.id,start.data.id);
  const status=await request('/status');assert.equal(status.data.activeDownload.id,start.data.id);
  const cancelled=await request(`/pull/${start.data.id}/cancel`,{});assert.equal(cancelled.data.state,'cancelled');
  await pause(10);assert.equal(aborted,true);assert.equal((await request(`/pull/${start.data.id}`)).data.state,'cancelled');
  assert.equal((await request('/pull/unknown')).status,404);
});

test('timeout stops download with an explicit error instead of a fake completion',async t=>{
  const request=await fixture(t,{downloadTimeout:10,fetchImpl:async(url,options)=>{
    if(url.endsWith('/api/tags'))return json({models:[]});
    return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true}));
  }});
  const start=await request('/pull',{model:'qwen3:8b'});const result=await terminal(request,start.data.id);
  assert.equal(result.state,'error');assert.match(result.error,/timed out/);
});
