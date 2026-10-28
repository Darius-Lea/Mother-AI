import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import packageInfo from '../package.json' with { type: 'json' };
import { createDistributionCatalog } from './distribution.js';
import { normalizeInstaller, PREVIEW_DOWNLOAD_BASE, PREVIEW_MANIFEST_URL } from './downloads-validation.js';

const version = packageInfo.version;
const filename = `Mother-AI-${version}-win-x64.exe`;
const installer = { filename, version, platform:'windows', architecture:'x64', format:'exe', kind:'installer', size:1024*1024, sha256:'a'.repeat(64), downloadUrl:`${PREVIEW_DOWNLOAD_BASE}/${filename}`, signing:'unsigned', nativeInstallTested:false };
const manifest = { version, artifacts:[installer] };

async function fixture(t, options={}) {
  // macOS /var and Windows short temp paths can alias their canonical location.
  // The catalog intentionally returns real paths for confinement checks.
  const directory = await realpath(await mkdtemp(path.join(tmpdir(),'mother-downloads-')));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const manifestFile = path.join(directory,'downloads.json');
  const releaseRoot = path.join(directory,'releases');
  await mkdir(releaseRoot);
  await writeFile(manifestFile,JSON.stringify({version,artifacts:[]}));
  return { directory, manifestFile, releaseRoot, catalog:createDistributionCatalog({manifestFile,releaseRoot,...options}) };
}

test('installer validation accepts only matching setup packages and approved direct links',()=>{
  assert.equal(normalizeInstaller(installer).filename,filename);
  for (const change of [
    {downloadUrl:'https://evil.example/setup.exe'},
    {downloadUrl:`${PREVIEW_DOWNLOAD_BASE}/${filename}?redirect=evil`},
    {downloadUrl:`${PREVIEW_DOWNLOAD_BASE}/../source.zip`},
    {filename:`Mother-AI-${version}-win-x64-portable.exe`},
    {kind:'portable'}, {format:'dmg'}, {architecture:'arm64'}, {platform:'linux'},
    {size:1}, {sha256:'bad'}, {version:'0.2.0'},
    {filename:`Mother-AI-${version}-win-x64-bbbbbbbbbbbb.exe`,downloadUrl:`${PREVIEW_DOWNLOAD_BASE}/Mother-AI-${version}-win-x64-bbbbbbbbbbbb.exe`},
  ]) assert.equal(normalizeInstaller({...installer,...change}),null);
  assert.equal(normalizeInstaller({...installer,downloadUrl:`/downloads/${filename}`}).downloadUrl,`/downloads/${filename}`);
  assert.equal(normalizeInstaller({...installer,downloadUrl:`/downloads/${filename}`},{remoteOnly:true}),null);
  const debFilename=`Mother-AI-${version}-linux-amd64.deb`;
  const deb=normalizeInstaller({...installer,filename:debFilename,platform:'linux',format:'deb',downloadUrl:`${PREVIEW_DOWNLOAD_BASE}/${debFilename}`});
  assert.equal(deb.architecture,'x64');
});

test('remote catalog follows only approved asset redirects and shares a bounded cache',async t=>{
  let calls=0;
  const {catalog}=await fixture(t,{fetchImpl:async(url,options)=>{
    calls++;assert.equal(options.redirect,'manual');assert.ok(options.signal);
    if(new URL(url).origin+new URL(url).pathname===PREVIEW_MANIFEST_URL)return new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/github-production-release-asset/manifest?token=example'}});
    assert.match(url,/^https:\/\/release-assets\.githubusercontent\.com\//);
    return Response.json({...manifest,secretPath:'/private/data',artifacts:[{...installer,relativePath:'../private'}]});
  }});
  const [one,two]=await Promise.all([catalog.catalog(),catalog.catalog()]);
  assert.equal(calls,2);assert.equal(one,two);assert.equal(one.status,'available');
  assert.equal(one.artifacts[0].downloadUrl,installer.downloadUrl);
  assert.equal(one.artifacts[0].relativePath,undefined);assert.equal(one.secretPath,undefined);
  await catalog.catalog();assert.equal(calls,2);
  assert.equal(await catalog.localFile(filename),null);
});
test('each catalog refresh bypasses cached rolling-release redirects without changing the trusted path',async t=>{
  const requests=[];
  const {catalog}=await fixture(t,{cacheMs:0,fetchImpl:async value=>{
    const url=new URL(value);requests.push(url);
    assert.equal(url.origin+url.pathname,PREVIEW_MANIFEST_URL);
    assert.match(url.searchParams.get('mother_check'),/^[a-f0-9]{16}$/);
    return Response.json(manifest);
  }});
  assert.equal((await catalog.catalog()).status,'available');
  assert.equal((await catalog.catalog()).status,'available');
  assert.equal(requests.length,2);assert.notEqual(requests[0].search,requests[1].search);
});

test('unsafe redirects, oversized catalogs and malformed installers never become download links',async t=>{
  const cases=[
    ()=>new Response(null,{status:302,headers:{location:'https://evil.example/manifest'}}),
    ()=>new Response(null,{status:302,headers:{location:'http://github.com/catalog'}}),
    ()=>new Response(null,{status:302,headers:{location:'https://user@github.com/catalog'}}),
    ()=>new Response('x',{headers:{'content-length':'999999'}}),
    ()=>new Response('x'.repeat(65537)),
    ()=>Response.json({...manifest,artifacts:[{...installer,downloadUrl:'https://example.com/mother.exe'}]}),
    ()=>Response.json({...manifest,version:'old'}),
    ()=>Response.json({...manifest,artifacts:[installer,installer]}),
  ];
  for (const fetchImpl of cases) {
    const {catalog}=await fixture(t,{fetchImpl});
    const value=await catalog.catalog();
    assert.equal(value.status,'pending');assert.deepEqual(value.artifacts,[]);
  }
});

test('a timed-out catalog fails closed and pending downloads can refresh without restarting',async t=>{
  let currentTime=0,ready=false;
  const {catalog}=await fixture(t,{now:()=>currentTime,cacheMs:1000,fetchImpl:async()=>ready?Response.json(manifest):new Response('',{status:404})});
  assert.equal((await catalog.catalog()).status,'pending');
  ready=true;assert.equal((await catalog.catalog()).status,'pending');
  currentTime=1001;assert.equal((await catalog.catalog()).status,'available');
  const second=await fixture(t,{timeoutMs:5,fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  })});
  // Keep one timer referenced while the deliberately stalled fetch waits for abort.
  const guard=setTimeout(()=>{},100);
  try { assert.equal((await second.catalog.catalog()).status,'pending'); }
  finally { clearTimeout(guard); }
});

test('website installers are available only while the named local package stays confined',async t=>{
  let calls=0;
  const {catalog,manifestFile,releaseRoot,directory}=await fixture(t,{cacheMs:0,fetchImpl:async()=>{calls++;return new Response('',{status:404});}});
  await writeFile(path.join(releaseRoot,filename),Buffer.alloc(installer.size));
  await writeFile(manifestFile,JSON.stringify({version,artifacts:[{...installer,downloadUrl:`/downloads/${filename}`,relativePath:filename}]}));
  const value=await catalog.catalog();assert.equal(value.source,'website');assert.equal(calls,0);
  assert.equal(value.artifacts[0].relativePath,undefined);
  assert.equal(await catalog.localFile(filename),path.join(releaseRoot,filename));
  await writeFile(path.join(directory,'outside.exe'),Buffer.alloc(installer.size));
  await writeFile(manifestFile,JSON.stringify({version,artifacts:[{...installer,downloadUrl:`/downloads/${filename}`,relativePath:'../outside.exe'}]}));
  assert.equal((await catalog.catalog()).status,'pending');assert.equal(await catalog.localFile(filename),null);
});
