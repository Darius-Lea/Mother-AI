'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,readFile,writeFile,readdir,rm}=require('node:fs/promises');
const {createHash}=require('node:crypto');
const path=require('node:path');
const os=require('node:os');
const {createUpdateManager,compareVersions}=require('./updater.cjs');
const BASE='https://github.com/Darius-Lea/Mother-AI/releases/download/mother-preview';
const COMMIT='b'.repeat(40);
function fixture({version='1.0.0-preview.2',platform='windows',architecture='x64',format='exe',signature='MZ'}={}) {
  const bytes=Buffer.alloc(1024*1024+19,0x31);bytes.write(signature);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const filename=`Mother-AI-${version}-${({windows:'win',mac:'mac',linux:'linux'})[platform]}-${architecture}-${sha256.slice(0,12)}.${format}`;
  const artifact={filename,version,platform,architecture,format,size:bytes.length,sha256,downloadUrl:`${BASE}/${filename}`,kind:'installer',signing:'unsigned',nativeInstallTested:false};
  return {bytes,artifact,catalog:{channel:'preview',version,sourceCommit:COMMIT,generatedAt:'2026-10-27T12:00:00Z',artifacts:[artifact]}};
}
async function setup(t,options={}) {
  const userData=await mkdtemp(path.join(os.tmpdir(),'mother-updater-'));
  t.after(()=>rm(userData,{recursive:true,force:true}));
  const file=fixture(options.fixture);const calls=[],states=[],opened=[];
  const fetchImpl=options.fetchImpl || (async value=>{calls.push(value);return value===`${BASE}/downloads.json`?Response.json(file.catalog):new Response(file.bytes,{headers:{'Content-Length':String(file.bytes.length)}});});
  const manager=createUpdateManager({userData,platform:'win32',arch:'x64',currentVersion:'1.0.0-preview.1',currentCommit:'a'.repeat(40),currentBuiltAt:'2026-10-26T12:00:00Z',fetchImpl,onStatus:state=>states.push(state),openInstaller:async(file,metadata)=>opened.push({file,metadata}),...options.manager});
  t.after(()=>manager.stop());
  return {userData,file,calls,states,opened,manager};
}
test('version ordering compares numeric preview components and blocks downgrades',()=>{
  assert.equal(compareVersions('1.0.0-preview.10','1.0.0-preview.2'),1);
  assert.equal(compareVersions('1.0.0','1.0.0-preview.10'),1);
  assert.equal(compareVersions('0.9.0','1.0.0-preview.1'),-1);
  assert.equal(compareVersions('1.0.0-preview.2+abcdef','1.0.0-preview.2'),0);
  assert.throws(()=>compareVersions('../../bad','1.0.0'));
});
test('checks, downloads with progress, verifies and only installs after explicit request',async t=>{
  const {manager,file,states,opened}=await setup(t);
  assert.equal((await manager.check()).state,'available');
  assert.equal((await manager.download()).state,'ready');
  assert.equal(opened.length,0);
  assert.ok(states.some(state=>state.state==='downloading'&&state.progress>0));
  assert.ok(states.some(state=>state.state==='verifying'));
  assert.equal(manager.status().signing,'unsigned');
  assert.equal(manager.status().nativeInstallTested,false);
  assert.equal((await manager.install()).state,'installing');
  assert.equal(opened.length,1);
  assert.equal(opened[0].metadata.platform,'win32');
  assert.deepEqual(await readFile(opened[0].file),file.bytes);
  assert.ok(!JSON.stringify(manager.status()).includes(opened[0].file));
});
test('supports a later build with the same preview version, but not the installed commit',async t=>{
  const a=await setup(t,{manager:{currentVersion:'1.0.0-preview.2'}});
  assert.equal((await a.manager.check()).state,'available');
  const b=await setup(t,{manager:{currentVersion:'1.0.0-preview.2',currentCommit:COMMIT}});
  assert.equal((await b.manager.check()).state,'current');
  const c=await setup(t,{manager:{currentVersion:'1.0.0-preview.3'}});
  assert.equal((await c.manager.check()).state,'current');
  const d=await setup(t,{manager:{currentBuiltAt:'2026-10-28T12:00:00Z'}});
  assert.equal((await d.manager.check()).state,'current');
});
test('rejects incorrect architecture, mutable filename, arbitrary URL and malformed catalog',async t=>{
  for(const mutation of [
    f=>{f.catalog.artifacts[0].architecture='arm64';},
    f=>{const a=f.catalog.artifacts[0];a.filename=a.filename.replace(/-[a-f0-9]{12}\.exe$/,'.exe');a.downloadUrl=`${BASE}/${a.filename}`;},
    f=>{f.catalog.artifacts[0].downloadUrl='https://evil.example/setup.exe';},
    f=>{f.catalog.sourceCommit='not-a-commit';},
    f=>{f.catalog.channel='production';},
  ]) {
    const {manager,file,opened}=await setup(t);mutation(file);
    assert.equal((await manager.check()).state,'error');
    await manager.download();await manager.install();assert.equal(opened.length,0);
  }
});
test('does not open installer after corrupt bytes, truncated bytes or wrong file magic',async t=>{
  for(const variant of ['corrupt','short','magic']) {
    const file=fixture({signature:variant==='magic'?'NO':'MZ'});
    const data=variant==='corrupt'?Buffer.from(file.bytes):variant==='short'?file.bytes.subarray(0,100):file.bytes;
    if(variant==='corrupt')data[data.length-1]^=1;
    const {manager,userData,opened}=await setup(t,{fetchImpl:async value=>value.endsWith('/downloads.json')?Response.json(file.catalog):new Response(data)});
    assert.equal((await manager.check()).state,'available');
    assert.equal((await manager.download()).state,'error');
    await manager.install();assert.equal(opened.length,0);
    assert.deepEqual(await readdir(path.join(userData,'updates')),[]);
  }
});
test('rechecks cached installer integrity immediately before OS handoff',async t=>{
  const {manager,userData,file,opened}=await setup(t);
  await manager.check();await manager.download();
  const changed=Buffer.from(file.bytes);changed[100]^=1;
  await writeFile(path.join(userData,'updates',file.artifact.filename),changed);
  assert.equal((await manager.install()).state,'error');
  assert.equal(opened.length,0);
});
test('cancellation removes partial download and never opens an installer',async t=>{
  const file=fixture();let streamController,requested;
  const started=new Promise(resolve=>requested=resolve);
  const {manager,userData,opened}=await setup(t,{fetchImpl:async(value,{signal})=>{
    if(value.endsWith('/downloads.json'))return Response.json(file.catalog);
    const body=new ReadableStream({start(controller){streamController=controller;controller.enqueue(file.bytes.subarray(0,8192));requested();signal.addEventListener('abort',()=>controller.error(Object.assign(new Error('Stopped'),{name:'AbortError'})),{once:true});}});
    return new Response(body);
  }});
  await manager.check();const download=manager.download();await started;manager.cancel();
  assert.equal((await download).state,'cancelled');
  assert.deepEqual(await readdir(path.join(userData,'updates')),[]);
  assert.equal(opened.length,0);assert.ok(streamController);
});
test('follows only approved HTTPS redirects, rejecting private hosts and insecure transport',async t=>{
  for(const location of ['http://github.com/x','https://127.0.0.1/private','https://evil.example/asset','https://user:password@github.com/file']) {
    let requests=0;
    const {manager}=await setup(t,{fetchImpl:async()=>{requests++;return new Response(null,{status:302,headers:{location}});}});
    assert.equal((await manager.check()).state,'error');assert.equal(requests,1);
  }
  const file=fixture();const requests=[];
  const {manager}=await setup(t,{fetchImpl:async value=>{
    requests.push(value);
    if(value.endsWith('/downloads.json'))return new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/official/catalog?token=temporary'}});
    return Response.json(file.catalog);
  }});
  assert.equal((await manager.check()).state,'available');assert.equal(requests.length,2);
  assert.ok(!JSON.stringify(manager.status()).includes('temporary'));
});

test('periodic checking leaves a verified ready installer available without another network request',async t=>{
  const {manager,calls,opened}=await setup(t);
  await manager.check();await manager.download();
  const before=calls.length;
  assert.equal((await manager.check()).state,'ready');
  assert.equal(calls.length,before);
  await manager.install();assert.equal(opened.length,1);
});
