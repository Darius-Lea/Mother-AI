import express from 'express';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export const MAX_CODE_BYTES = 128 * 1024;
const MAX_TREE_FILES = 500;
const EXTENSIONS = new Set(['.js','.mjs','.cjs','.jsx','.ts','.tsx','.py','.go','.rs','.java','.cs','.c','.cpp','.cc','.h','.hpp','.css','.scss','.html','.json','.md','.txt','.yaml','.yml','.toml','.xml','.sql','.sh','.ps1','.swift','.kt','.vue','.svelte','.rb','.php']);
const EXCLUDED = new Set(['node_modules','.git','.hg','.svn','.ssh','.aws','.azure','.gnupg','.cache','.next','.nuxt','dist','build','target','vendor','__pycache__','.venv','venv','coverage']);
const digest = text => createHash('sha256').update(text).digest('hex');
class WorkspaceError extends Error { constructor(status,message){super(message);this.status=status;} }
const fail=(status,message)=>{throw new WorkspaceError(status,message);};
const within=(root,candidate)=>candidate===root || candidate.startsWith(`${root}${path.sep}`);
const sameFile=(a,b)=>a.dev===b.dev && a.ino===b.ino;
function forbidden(name) {
  const lower=name.toLowerCase();
  return EXCLUDED.has(lower) || lower.startsWith('.env') || /^(?:secrets?|credentials?)(?:[._-]|$)/.test(lower) || /\.(?:pem|key|p12|pfx|keystore)$/i.test(name) || /^id_(?:rsa|ed25519|ecdsa)/i.test(name);
}
function relativePath(value) {
  if(typeof value!=='string' || !value || value.length>2048 || /[\x00-\x1f\\:]/.test(value) || value.startsWith('/')) fail(400,'Choose a relative project file path.');
  const segments=value.split('/');
  if(segments.some(p=>!p || p==='.' || p==='..' || forbidden(p))) fail(403,'This path is outside the permitted source files.');
  if(!EXTENSIONS.has(path.extname(segments.at(-1)).toLowerCase()) && !['Dockerfile','Makefile','LICENSE'].includes(segments.at(-1))) fail(415,'This file type is not supported by the code workspace.');
  return segments;
}
function decode(bytes) {
  if(bytes.length>MAX_CODE_BYTES) fail(413,'Choose a source file smaller than 128 KB.');
  if(bytes.includes(0)) fail(415,'Binary files are not supported.');
  try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail(415,'Choose a UTF-8 source file.');}
}
function previewDiff(filename,before,after) {
  const a=before.split('\n'),b=after.split('\n');let start=0,end=0;
  while(start<a.length && start<b.length && a[start]===b[start])start++;
  while(end<a.length-start && end<b.length-start && a[a.length-1-end]===b[b.length-1-end])end++;
  const removed=a.slice(start,a.length-end),added=b.slice(start,b.length-end),output=[`--- ${filename}`,`+++ ${filename}`,`@@ line ${start+1} @@`];
  output.push(...a.slice(Math.max(0,start-3),start).map(l=>` ${l}`));
  output.push(...removed.slice(0,150).map(l=>`-${l}`),...added.slice(0,150).map(l=>`+${l}`));
  if(removed.length>150 || added.length>150)output.push('… Changed-line preview limited. Review the complete proposed file before applying.');
  output.push(...a.slice(a.length-end,a.length-end+3).map(l=>` ${l}`));
  return {text:output.join('\n').slice(0,40000),truncated:removed.length>150 || added.length>150,removedLines:removed.length,addedLines:added.length};
}

/** Local-owner API only. Mount behind the desktop/session administrator gate. */
export function createWorkspaceRouter({rootDirectory}={}) {
  const router=express.Router();
  let root=null,rootStat=null,epoch=0,queue=Promise.resolve();
  const proposals=new Map();
  const exclusive=fn=>{const pending=queue.then(fn,fn);queue=pending.catch(()=>{});return pending;};
  const respond=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){res.status(error instanceof WorkspaceError?error.status:error.code==='ENOENT'?404:500).json({error:error instanceof WorkspaceError?error.message:error.code==='ENOENT'?'The file or folder no longer exists.':'The project operation could not be completed.'});}};
  async function selectRoot(directory) {
    if(typeof directory!=='string' || !path.isAbsolute(directory) || directory.length>4096 || /[\x00-\x1f]/.test(directory))fail(400,'Choose an existing project folder.');
    const selected=await fs.lstat(directory);
    if(selected.isSymbolicLink() || !selected.isDirectory())fail(403,'Choose a real project folder, not a symbolic link.');
    const canonical=await fs.realpath(directory);
    const stat=await fs.stat(canonical);
    root=canonical;rootStat=stat;epoch++;proposals.clear();
    return status();
  }
  const initialized=rootDirectory?selectRoot(rootDirectory):Promise.resolve();
  function status(){return {open:!!root,name:root?path.basename(root):null,path:root,maxFileBytes:MAX_CODE_BYTES,limits:{files:MAX_TREE_FILES,writeApprovalRequired:true,shellExecution:false}};}
  async function checkRoot() {
    await initialized;
    if(!root)fail(409,'Choose a project folder first.');
    const current=await fs.lstat(root);
    if(current.isSymbolicLink() || !current.isDirectory() || !sameFile(current,rootStat) || await fs.realpath(root)!==root)fail(409,'The project folder changed. Choose it again.');
  }
  async function readSource(relative) {
    await checkRoot();const parts=relativePath(relative);let current=root;
    for(const part of parts){current=path.join(current,part);const info=await fs.lstat(current);if(info.isSymbolicLink())fail(403,'Symbolic links are not available in the code workspace.');}
    const canonical=await fs.realpath(current);
    if(!within(root,canonical))fail(403,'The file is outside the selected project.');
    const handle=await fs.open(canonical,constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try{
      const stat=await handle.stat();
      if(!stat.isFile() || stat.nlink!==1)fail(403,'Choose a regular source file without hard links.');
      if(stat.size>MAX_CODE_BYTES)fail(413,'Choose a source file smaller than 128 KB.');
      const bytes=await handle.readFile();
      const latest=await fs.lstat(canonical);
      if(latest.isSymbolicLink() || !sameFile(latest,stat))fail(409,'The file changed while it was being opened. Try again.');
      const content=decode(bytes);
      return {path:parts.join('/'),fullPath:canonical,parent:path.dirname(canonical),content,sha256:digest(bytes),bytes:bytes.length,stat};
    }finally{await handle.close();}
  }
  async function replaceSource(record,content,expectedHash) {
    const current=await readSource(record.path);
    if(current.sha256!==expectedHash)fail(409,'This file changed outside Mother. Reopen it and review a new proposal.');
    let parentHandle=null;
    try{
      // Linux directory descriptors pin the actual parent across path-renaming races.
      // Other platforms retain source/root identity checks immediately before rename.
      let directory=current.parent;
      if(process.platform==='linux'){
        parentHandle=await fs.open(directory,constants.O_RDONLY|constants.O_DIRECTORY|(constants.O_NOFOLLOW||0));
        const linked=await fs.realpath(`/proc/self/fd/${parentHandle.fd}`);
        if(linked!==directory || !within(root,linked))fail(409,'The source folder changed. Reopen the project.');
        directory=`/proc/self/fd/${parentHandle.fd}`;
      }
      const temporary=path.join(directory,`.mother-${randomUUID()}.tmp`),target=path.join(directory,path.basename(current.fullPath));
      const temporaryHandle=await fs.open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL, current.stat.mode & 0o777);
      try{await temporaryHandle.writeFile(content,'utf8');await temporaryHandle.sync();await temporaryHandle.chmod(current.stat.mode & 0o777);}finally{await temporaryHandle.close();}
      try{
        await checkRoot();
        const beforeRename=await readSource(record.path);
        const targetStat=await fs.lstat(target);
        if(beforeRename.sha256!==expectedHash || !sameFile(targetStat,current.stat) || targetStat.isSymbolicLink())fail(409,'The file changed before approval was applied. Reopen it.');
        await fs.rename(temporary,target);
      }finally{await fs.unlink(temporary).catch(()=>{});}
      return digest(content);
    }finally{await parentHandle?.close();}
  }
  const publicProposal=p=>({id:p.id,path:p.path,status:p.status,diff:p.diff,createdAt:p.createdAt,expiresAt:p.expiresAt,sha256:p.appliedHash || p.originalHash});
  function getProposal(id){const p=proposals.get(id);if(!p || p.epoch!==epoch)fail(404,'This proposal is no longer available.');if(Date.now()>p.expiresAt){proposals.delete(id);fail(410,'This proposal expired. Create a new review.');}return p;}

  router.get('/status',respond(async(_req,res)=>{await initialized;res.json(status());}));
  router.post('/open',respond(async(req,res)=>{res.json(await exclusive(()=>selectRoot(req.body?.path)));}));
  router.post('/close',respond(async(_req,res)=>{await exclusive(async()=>{root=null;rootStat=null;epoch++;proposals.clear();});res.json(status());}));
  router.get('/tree',respond(async(_req,res)=>{
    await checkRoot();const files=[];let visited=0,truncated=false;
    async function walk(directory,prefix='',depth=0){
      if(depth>12 || files.length>=MAX_TREE_FILES || visited>4000){truncated=true;return;}
      const entries=(await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
      for(const entry of entries){
        visited++;if(visited>4000 || files.length>=MAX_TREE_FILES){truncated=true;break;}
        if(forbidden(entry.name) || entry.isSymbolicLink())continue;
        const relative=prefix?`${prefix}/${entry.name}`:entry.name;
        if(entry.isDirectory()){await walk(path.join(directory,entry.name),relative,depth+1);continue;}
        if(!entry.isFile())continue;
        try{relativePath(relative);}catch{continue;}
        const info=await fs.lstat(path.join(directory,entry.name));
        if(info.isSymbolicLink() || !info.isFile() || info.nlink!==1 || info.size>MAX_CODE_BYTES)continue;
        files.push({path:relative,bytes:info.size});
      }
    }
    await walk(root);await checkRoot();res.json({...status(),files,truncated});
  }));
  router.get('/file',respond(async(req,res)=>{const file=await readSource(req.query.path);res.json({path:file.path,content:file.content,sha256:file.sha256,bytes:file.bytes});}));
  router.post('/proposals',respond(async(req,res)=>{res.status(201).json(await exclusive(async()=>{
    const {path:relative,content,expectedSha256}=req.body || {};
    if(typeof content!=='string')fail(400,'A proposed source file must be text.');
    decode(Buffer.from(content));
    if(typeof expectedSha256!=='string' || !/^[a-f0-9]{64}$/i.test(expectedSha256))fail(400,'Reopen the file to obtain its current fingerprint.');
    const original=await readSource(relative);
    if(original.sha256!==expectedSha256.toLowerCase())fail(409,'This file changed. Reopen it before reviewing an edit.');
    if(original.content===content)fail(400,'The proposal does not change this file.');
    for(const [id,p]of proposals)if(Date.now()>p.expiresAt)proposals.delete(id);
    if(proposals.size>=20)fail(429,'Close and reopen the project to clear old proposals before creating more.');
    const proposal={id:randomUUID(),epoch,path:original.path,originalHash:original.sha256,original:original.content,content,status:'pending',createdAt:new Date().toISOString(),expiresAt:Date.now()+30*60*1000,diff:previewDiff(original.path,original.content,content)};
    proposals.set(proposal.id,proposal);return publicProposal(proposal);
  }));}));
  router.post('/proposals/:id/apply',respond(async(req,res)=>{res.json(await exclusive(async()=>{
    const proposal=getProposal(req.params.id);if(proposal.status!=='pending')fail(409,'This proposal has already been processed.');
    proposal.appliedHash=await replaceSource(proposal,proposal.content,proposal.originalHash);proposal.status='applied';return publicProposal(proposal);
  }));}));
  router.post('/proposals/:id/rollback',respond(async(req,res)=>{res.json(await exclusive(async()=>{
    const proposal=getProposal(req.params.id);if(proposal.status!=='applied')fail(409,'Only an applied proposal can be restored.');
    await replaceSource(proposal,proposal.original,proposal.appliedHash);proposal.status='restored';return publicProposal(proposal);
  }));}));
  return router;
}
