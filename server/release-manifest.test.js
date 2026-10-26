import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import packageInfo from '../package.json' with { type: 'json' };
import { buildReleaseManifest } from '../scripts/release-manifest.js';
import { PREVIEW_DOWNLOAD_BASE } from './downloads-validation.js';

const version=packageInfo.version;
async function fixture(t) {
  const directory=await mkdtemp(path.join(tmpdir(),'mother-release-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  async function artifact({platform='windows',arch='x64',format='exe',header='MZ',receiptChanges={},receipt=true,name}={}) {
    const filename=name || `Mother-AI-${version}-${platform==='windows'?'win':platform}-${arch}.${format}`;
    const file=path.join(directory,filename);
    const bytes=Buffer.alloc(1024*1024);bytes.write(header);
    await writeFile(file,bytes);
    const metadata={status:'build-completed',version,filename,platform,kind:'installer',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),signed:false,nativeInstallTested:false,...receiptChanges};
    if(receipt)await writeFile(`${file}.build.json`,JSON.stringify(metadata));
    return {file,metadata};
  }
  return {directory,artifact};
}

test('catalog emits only completed consumer installers and never an archive or portable build',async t=>{
  const {directory,artifact}=await fixture(t);
  await artifact();
  await artifact({platform:'mac',arch:'arm64',format:'pkg',header:'xar!'});
  await artifact({platform:'linux',arch:'amd64',format:'deb',header:'!<arch>\n'});
  await artifact({name:`Mother-AI-${version}-win-arm64.exe`,receipt:false});
  await artifact({name:`Mother-AI-${version}-win-x64-portable.exe`});
  await artifact({platform:'mac',format:'dmg'});
  await artifact({platform:'linux',format:'AppImage'});
  await artifact({name:`Mother-AI-${version}-win-x64.zip`});
  const unpacked=path.join(directory,'win-unpacked');await mkdir(unpacked);
  await writeFile(path.join(unpacked,`Mother-AI-${version}-win-x64.exe`),'MZ');
  const catalog=await buildReleaseManifest({directory,baseUrl:PREVIEW_DOWNLOAD_BASE});
  assert.equal(catalog.artifacts.length,3);
  assert.deepEqual(new Set(catalog.artifacts.map(item=>item.format)),new Set(['exe','pkg','deb']));
  assert.equal(catalog.artifacts.find(item=>item.platform==='linux').architecture,'x64');
  for(const item of catalog.artifacts){assert.equal(item.downloadUrl,`${PREVIEW_DOWNLOAD_BASE}/${item.filename}`);assert.equal(item.relativePath,undefined);assert.equal(item.signing,'unsigned');assert.equal(item.nativeInstallTested,false);}
});

test('build receipt metadata, digest, size and package signature must all match',async t=>{
  for(const options of [
    {receiptChanges:{status:'started'}}, {receiptChanges:{sha256:'a'.repeat(64)}},
    {receiptChanges:{bytes:42}}, {receiptChanges:{platform:'linux'}},
    {receiptChanges:{kind:'portable'}}, {header:'not an exe'},
  ]) {
    const {directory,artifact}=await fixture(t);await artifact(options);
    await assert.rejects(buildReleaseManifest({directory}));
  }
});

test('a content-addressed installer name must match the actual bytes',async t=>{
  const {directory,artifact}=await fixture(t);
  const first=await artifact();
  const digest=first.metadata.sha256;
  await rm(first.file);await rm(`${first.file}.build.json`);
  await artifact({name:`Mother-AI-${version}-win-x64-${digest.slice(0,12)}.exe`});
  assert.equal((await buildReleaseManifest({directory})).artifacts.length,1);
  await artifact({name:`Mother-AI-${version}-win-arm64-aaaaaaaaaaaa.exe`});
  await assert.rejects(buildReleaseManifest({directory}),/filename does not match/);
  await assert.rejects(buildReleaseManifest({directory,baseUrl:'https://evil.example'}),/approved/);
});
