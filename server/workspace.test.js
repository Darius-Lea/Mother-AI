import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import express from 'express';
import {createWorkspaceRouter,MAX_CODE_BYTES} from './workspace.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t,{opened=true}={}) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mother-workspace-'));
  const root=path.join(directory,'project');await fs.mkdir(path.join(root,'src'),{recursive:true});
  await fs.writeFile(path.join(root,'src','hello.js'),'export const hello = "original";\n',{mode:0o640});
  if(process.platform!=='win32')await fs.chmod(path.join(root,'src','hello.js'),0o640);
  const app=express();app.use(express.json({limit:'1mb'}));app.use('/api/workspace',createWorkspaceRouter(opened?{rootDirectory:root}:{}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const request=async(route,body)=>{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/workspace${route}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  if(opened)assert.equal((await request('/status')).body.open,true);
  const read=()=>request('/file?path=src%2Fhello.js');
  const propose=async(content='export const hello = "improved";\n')=>{const current=await read();return request('/proposals',{path:'src/hello.js',content,expectedSha256:current.body.sha256});};
  return {directory,root,request,read,propose};
}

test('workspace requires explicit folder selection and disconnect invalidates old proposals',async t=>{
  const f=await fixture(t,{opened:false});
  assert.equal((await f.request('/status')).body.open,false);
  assert.equal((await f.request('/tree')).status,409);
  assert.equal((await f.request('/open',{path:'relative/path'})).status,400);
  assert.equal((await f.request('/open',{path:f.root})).body.open,true);
  const proposal=await f.propose();assert.equal(proposal.status,201);
  assert.equal((await f.request('/close',{})).body.open,false);
  assert.equal((await f.request(`/proposals/${proposal.body.id}/apply`,{})).status,404);
});

test('approved proposal writes only after review, preserves mode, and restores original contents',async t=>{
  const f=await fixture(t);const before=await f.read();
  assert.equal(before.status,200);assert.equal(before.body.sha256,hash(before.body.content));
  const proposal=await f.propose();assert.equal(proposal.status,201);assert.match(proposal.body.diff.text,/-export const hello/);
  assert.equal(await fs.readFile(path.join(f.root,'src/hello.js'),'utf8'),before.body.content);
  const applied=await f.request(`/proposals/${proposal.body.id}/apply`,{});assert.equal(applied.status,200);assert.equal(applied.body.status,'applied');
  assert.equal(await fs.readFile(path.join(f.root,'src/hello.js'),'utf8'),'export const hello = "improved";\n');
  if(process.platform!=='win32')assert.equal((await fs.stat(path.join(f.root,'src/hello.js'))).mode&0o777,0o640);
  assert.equal((await f.request(`/proposals/${proposal.body.id}/apply`,{})).status,409);
  const restored=await f.request(`/proposals/${proposal.body.id}/rollback`,{});assert.equal(restored.status,200);assert.equal(restored.body.status,'restored');
  assert.equal(await fs.readFile(path.join(f.root,'src/hello.js'),'utf8'),before.body.content);
});

test('UTF-8 BOM and CRLF survive a complete edit and restore',async t=>{
  const f=await fixture(t);const original=Buffer.from('\ufeffconst value = 1;\r\n');
  await fs.writeFile(path.join(f.root,'src/hello.js'),original);
  const loaded=await f.read();assert.equal(loaded.body.content.charCodeAt(0),0xfeff);
  const proposed=await f.propose('\ufeffconst value = 2;\r\n');
  assert.equal((await f.request(`/proposals/${proposed.body.id}/apply`,{})).status,200);
  assert.equal((await f.request(`/proposals/${proposed.body.id}/rollback`,{})).status,200);
  assert.deepEqual(await fs.readFile(path.join(f.root,'src/hello.js')),original);
});

test('external edits prevent stale proposals, stale application, and unsafe restore',async t=>{
  const f=await fixture(t);const old=await f.read();
  await fs.writeFile(path.join(f.root,'src/hello.js'),'new external version\n');
  assert.equal((await f.request('/proposals',{path:'src/hello.js',content:'proposed\n',expectedSha256:old.body.sha256})).status,409);
  const proposal=await f.propose();
  await fs.writeFile(path.join(f.root,'src/hello.js'),'a later external version\n');
  assert.equal((await f.request(`/proposals/${proposal.body.id}/apply`,{})).status,409);
  const fresh=await f.propose();assert.equal((await f.request(`/proposals/${fresh.body.id}/apply`,{})).status,200);
  await fs.writeFile(path.join(f.root,'src/hello.js'),'keep my independent edit\n');
  assert.equal((await f.request(`/proposals/${fresh.body.id}/rollback`,{})).status,409);
  assert.equal(await fs.readFile(path.join(f.root,'src/hello.js'),'utf8'),'keep my independent edit\n');
});

for(const forbidden of ['../outside.js','/etc/passwd','src/../hello.js','src\\hello.js','C:/Windows/file.js','.env','.env.example','secrets.json','credentials.txt','.ssh/config','src//hello.js','src/./hello.js']) {
  test(`rejects forbidden project path ${forbidden}`,async t=>{
    const f=await fixture(t);const result=await f.request(`/file?path=${encodeURIComponent(forbidden)}`);assert.ok([400,403].includes(result.status));
  });
}

test('source listing and reads exclude links and sensitive folders',async t=>{
  const f=await fixture(t);
  await fs.mkdir(path.join(f.root,'node_modules'),{recursive:true});await fs.writeFile(path.join(f.root,'node_modules','module.js'),'no');
  await fs.writeFile(path.join(f.root,'.env'),'TOKEN=private');await fs.writeFile(path.join(f.root,'secrets.json'),'{}');
  await fs.writeFile(path.join(f.directory,'outside.js'),'outside must stay private');
  await fs.symlink(path.join(f.directory,'outside.js'),path.join(f.root,'linked.js'));
  await fs.symlink(f.directory,path.join(f.root,'linked-dir'));
  await fs.link(path.join(f.directory,'outside.js'),path.join(f.root,'hardlinked.js'));
  const tree=await f.request('/tree');assert.deepEqual(tree.body.files.map(file=>file.path),['src/hello.js']);
  for(const relative of ['linked.js','linked-dir/outside.js','hardlinked.js'])assert.equal((await f.request(`/file?path=${encodeURIComponent(relative)}`)).status,403);
});

test('a source replaced with a symlink cannot be overwritten by applying a pending proposal',async t=>{
  const f=await fixture(t);const proposed=await f.propose();
  const outside=path.join(f.directory,'outside.js');await fs.writeFile(outside,'outside untouched');
  await fs.unlink(path.join(f.root,'src/hello.js'));await fs.symlink(outside,path.join(f.root,'src/hello.js'));
  assert.equal((await f.request(`/proposals/${proposed.body.id}/apply`,{})).status,403);
  assert.equal(await fs.readFile(outside,'utf8'),'outside untouched');
});

test('root replacement is rejected before reading or writing',async t=>{
  const f=await fixture(t);await fs.rename(f.root,`${f.root}-moved`);await fs.mkdir(f.root);await fs.mkdir(path.join(f.root,'src'));await fs.writeFile(path.join(f.root,'src/hello.js'),'different root');
  assert.equal((await f.read()).status,409);
});

test('file bounds, binary data, invalid UTF-8 and unsupported types are rejected',async t=>{
  const f=await fixture(t);
  await fs.writeFile(path.join(f.root,'oversized.txt'),Buffer.alloc(MAX_CODE_BYTES+1,65));
  await fs.writeFile(path.join(f.root,'binary.txt'),Buffer.from([65,0,66]));
  await fs.writeFile(path.join(f.root,'invalid.txt'),Buffer.from([0xff,0xff]));
  await fs.writeFile(path.join(f.root,'program.exe'),'not supported');
  assert.equal((await f.request('/file?path=oversized.txt')).status,413);
  assert.equal((await f.request('/file?path=binary.txt')).status,415);
  assert.equal((await f.request('/file?path=invalid.txt')).status,415);
  assert.equal((await f.request('/file?path=program.exe')).status,415);
  const current=await f.read();
  assert.equal((await f.request('/proposals',{path:'src/hello.js',content:'x'.repeat(MAX_CODE_BYTES+1),expectedSha256:current.body.sha256})).status,413);
  assert.equal((await f.request('/proposals',{path:'src/hello.js',content:current.body.content,expectedSha256:current.body.sha256})).status,400);
});

test('concurrent approvals cannot overwrite an intervening approved change',async t=>{
  const f=await fixture(t);const a=await f.propose('first\n'),b=await f.propose('second\n');
  const results=await Promise.all([f.request(`/proposals/${a.body.id}/apply`,{}),f.request(`/proposals/${b.body.id}/apply`,{})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
});

test('tree traversal respects the documented file count bound',async t=>{
  const f=await fixture(t);await Promise.all(Array.from({length:505},(_,i)=>fs.writeFile(path.join(f.root,`file-${String(i).padStart(3,'0')}.js`),'// file')));
  const tree=await f.request('/tree');assert.equal(tree.status,200);assert.equal(tree.body.files.length,500);assert.equal(tree.body.truncated,true);
});
