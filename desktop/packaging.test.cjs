'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');
const {validateArchive} = require('./after-build.cjs');

async function fixture(t, code = 'export const ready = true;\n') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mother-package-check-'));
  t.after(() => fs.rm(directory, {recursive:true,force:true}));
  const source = path.join(directory,'source');
  await fs.mkdir(path.join(source,'server'),{recursive:true});
  await fs.mkdir(path.join(source,'desktop'),{recursive:true});
  await fs.mkdir(path.join(source,'dist','assets'),{recursive:true});
  await fs.writeFile(path.join(source,'server','index.js'),code);
  await fs.writeFile(path.join(source,'desktop','main.cjs'),'module.exports = {};\n');
  await fs.writeFile(path.join(source,'dist','index.html'),'<html>Mother</html>');
  await fs.writeFile(path.join(source,'dist','assets','app.js'),'console.log("Mother");\r\n');
  await fs.writeFile(path.join(source,'package.json'),JSON.stringify({version:require('../package.json').version}));
  const archive=path.join(directory,'app.asar');
  await asar.createPackage(source,archive);
  return {source,archive};
}

test('completed archives contain parseable entry points matching source', async t=>{
  const {source,archive}=await fixture(t);
  assert.doesNotThrow(()=>validateArchive(archive,source));
});
test('packaging rejects stale or shifted archive bytes before issuing receipts', async t=>{
  const {source,archive}=await fixture(t);
  await fs.writeFile(path.join(source,'server','index.js'),'export const ready = false;\n');
  assert.throws(()=>validateArchive(archive,source),/changed during build/);
});
test('packaging rejects syntax errors even when source bytes match the archive', async t=>{
  const {source,archive}=await fixture(t,'const broken = (');
  assert.throws(()=>validateArchive(archive,source),/does not parse/);
});
test('archive validation normalizes Windows list separators', async t=>{
  const {source,archive}=await fixture(t);
  const original=asar.listPackage;
  asar.listPackage=(...args)=>original(...args).map(name=>name.replaceAll('/','\\'));
  try {assert.doesNotThrow(()=>validateArchive(archive,source));}
  finally {asar.listPackage=original;}
});
test('packaging rejects an interface changed while the archive was built', async t=>{
  const {source,archive}=await fixture(t);
  await fs.writeFile(path.join(source,'dist','index.html'),'<html>New build</html>');
  assert.throws(()=>validateArchive(archive,source),/interface changed during build/);
});


test('nested interface assets validate with Windows ASAR lookup semantics', async t=>{
  const {source,archive}=await fixture(t,'export const ready = true;\r\n');
  if(process.platform==='win32'){
    assert.doesNotThrow(()=>validateArchive(archive,source));
    return;
  }
  // Reproduce ASAR's Win32 dirname/basename/separator lookup on Linux CI too.
  // Keep absolute fixture paths native so this tests member lookup rather than
  // asking the Linux filesystem to open Windows paths. The ASAR header is cached
  // before the synchronous substitution, and all methods are restored afterward.
  asar.listPackage(archive);
  const original={dirname:path.dirname,basename:path.basename,normalize:path.normalize,sep:path.sep};
  const win={dirname:path.win32.dirname,basename:path.win32.basename,normalize:path.win32.normalize,sep:path.win32.sep};
  Object.assign(path,{...win,normalize:value=>value.startsWith('/')?original.normalize(value):win.normalize(value)});
  try{assert.doesNotThrow(()=>validateArchive(archive,source));}
  finally{Object.assign(path,original);}
});
