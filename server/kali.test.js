import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {EventEmitter,once} from 'node:events';
import {PassThrough} from 'node:stream';
import {createKaliRouter,NMAP_ARGUMENTS,runTool,validateTarget} from './kali.js';

function childProcess(){const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=signal=>{queueMicrotask(()=>child.emit('close',null,signal));return true;};return child;}
function fakeTools({missing=false,scan,records=[]}={}){
  return (command,args,options)=>{
    records.push({command,args:[...args],options});const child=childProcess();
    queueMicrotask(()=>{
      if(command!=='nmap'||missing){const error=Object.assign(new Error('not found'),{code:'ENOENT'});child.emit('error',error);return;}
      if(args.includes('--version')){child.stdout.write('Nmap version TEST\n');child.emit('close',0,null);return;}
      if(scan)scan(child,args);else {child.stdout.write('22/tcp open ssh\n');child.emit('close',0,null);}
    });return child;
  };
}
async function fixture(t,options){const app=express();app.use(express.json());const router=createKaliRouter(options);app.use(router);const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{router.shutdown();await new Promise(resolve=>server.close(resolve));});const base=`http://127.0.0.1:${server.address().port}`;return async(path,body)=>{const response=await fetch(base+path,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};}
const planBody={tool:'nmap',target:'owned.example',authorizationConfirmed:true};

for(const target of ['-iL','127.0.0.1;id','https://owned.example','10.0.0.0/8','10.0.0.1-5','10.0.0.*','host1,host2','host --script=all','$(whoami)','127.1','owned.example\n','a..example'])test(`rejects multi-target or command syntax ${JSON.stringify(target)}`,()=>assert.throws(()=>validateTarget(target)));
test('accepts single literal addresses or safe hostnames and normalizes DNS',()=>{assert.equal(validateTarget('Owned.Example.'),'owned.example');assert.equal(validateTarget('192.168.1.20'),'192.168.1.20');assert.equal(validateTarget('::1'),'::1');assert.equal(validateTarget('my-router'),'my-router');});

test('inventory reports missing tools honestly and cannot prepare an unavailable operation',async t=>{
  const records=[];const request=await fixture(t,{spawnImpl:fakeTools({missing:true,records})});
  const inventory=await request('/capabilities');assert.equal(inventory.status,200);assert.equal(inventory.data.environment.kaliBundled,false);assert.equal(inventory.data.capabilities.fullKaliSuite,false);assert.ok(inventory.data.tools.every(tool=>!tool.installed));
  const planned=await request('/plan',planBody);assert.equal(planned.status,503);assert.ok(records.every(record=>record.args.includes('--version')||record.args.includes('-Version')));
});
test('authorization, exact reviewed arguments, explicit execution approval, and single use are enforced',async t=>{
  const records=[];const request=await fixture(t,{spawnImpl:fakeTools({records})});
  assert.equal((await request('/plan',{...planBody,authorizationConfirmed:false})).status,403);assert.equal(records.length,0);
  const plan=await request('/plan',planBody);assert.equal(plan.status,201);assert.deepEqual(plan.data.args,[...NMAP_ARGUMENTS,'owned.example']);
  assert.equal((await request(`/plans/${plan.data.id}/run`,{approved:false})).status,403);
  const result=await request(`/plans/${plan.data.id}/run`,{approved:true});assert.equal(result.status,200);assert.equal(result.data.state,'completed');assert.equal(result.data.exitCode,0);assert.match(result.data.stdout,/22\/tcp/);
  const scan=records.find(record=>record.args.includes('-sT'));assert.equal(scan.command,'nmap');assert.equal(scan.options.shell,false);assert.equal(scan.options.stdio[0],'ignore');assert.deepEqual(scan.args,plan.data.args);
  assert.equal((await request(`/plans/${plan.data.id}/run`,{approved:true})).status,404);
});
test('plans expire before execution and unsupported tools have no execution endpoint',async t=>{
  let time=100000;const request=await fixture(t,{spawnImpl:fakeTools(),now:()=>time});
  assert.equal((await request('/plan',{...planBody,tool:'sqlmap'})).status,400);
  const plan=await request('/plan',planBody);time+=5*60*1000+1;
  assert.equal((await request(`/plans/${plan.data.id}/run`,{approved:true})).status,410);
});
test('concurrency is one check and accepted runs are limited per minute',async t=>{
  let release;let scans=0;
  const request=await fixture(t,{spawnImpl:fakeTools({scan:child=>{scans++;if(scans===1)release=()=>{child.stdout.write('done');child.emit('close',0,null);};else child.emit('close',0,null);}})});
  const first=await request('/plan',planBody),second=await request('/plan',planBody);
  const running=request(`/plans/${first.data.id}/run`,{approved:true});
  for(let i=0;i<20&&!release;i++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal((await request(`/plans/${second.data.id}/run`,{approved:true})).status,409);release();await running;
  assert.equal((await request(`/plans/${second.data.id}/run`,{approved:true})).status,200);
  for(let i=0;i<8;i++){const plan=await request('/plan',planBody);assert.equal((await request(`/plans/${plan.data.id}/run`,{approved:true})).status,200);}
  const excess=await request('/plan',planBody);assert.equal((await request(`/plans/${excess.data.id}/run`,{approved:true})).status,429);assert.equal(scans,10);
});
test('nonzero exits, bounded output, and timeout never become successful checks',async t=>{
  for(const scenario of ['exit','output','timeout']){
    const records=[];const request=await fixture(t,{spawnImpl:fakeTools({records,scan:child=>{
      if(scenario==='exit'){child.stderr.write('permission problem');child.emit('close',2,null);}
      else if(scenario==='output')child.stdout.write('x'.repeat(150));
      // timeout scenario intentionally waits for the runner to terminate it.
    }}),scanTimeout:20,maxOutputBytes:100});
    const plan=await request('/plan',planBody);const result=await request(`/plans/${plan.data.id}/run`,{approved:true});
    assert.equal(result.data.state,'failed');assert.ok(result.data.outputBytes<=100);
    if(scenario==='output')assert.equal(result.data.truncated,true);
    if(scenario==='timeout')assert.equal(result.data.timedOut,true);
    if(scenario==='exit')assert.equal(result.data.exitCode,2);
  }
});
test('process startup failures remain errors and do not leak exception contents',async()=>{
  const result=await runTool('nmap',['--version'],{spawnImpl:()=>{throw Object.assign(new Error('private internal path'),{code:'ENOENT'});}});
  assert.equal(result.missing,true);assert.equal(result.exitCode,null);assert.doesNotMatch(result.error,/private internal path/);
});
