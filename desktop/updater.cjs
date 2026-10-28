'use strict';
const {createHash, randomBytes} = require('node:crypto');
const {createReadStream} = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');

const CATALOG = 'https://github.com/Darius-Lea/Mother-AI/releases/download/mother-preview/downloads.json';
const MAX_INSTALLER = 2 * 1024 ** 3;
const HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com']);
const abortError = () => Object.assign(new Error('Update cancelled.'), {name:'AbortError'});

function versionParts(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value || '');
  return match ? [Number(match[1]),Number(match[2]),Number(match[3]),match[4]?.split('.') || []] : null;
}
function compareVersions(left, right) {
  const a=versionParts(left), b=versionParts(right);
  if(!a || !b) throw Error('Invalid application version.');
  for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i]?1:-1;
  if(!a[3].length || !b[3].length)return a[3].length===b[3].length?0:a[3].length?-1:1;
  for(let i=0;i<Math.max(a[3].length,b[3].length);i++) {
    const x=a[3][i],y=b[3][i];
    if(x===y)continue;
    if(x===undefined)return -1;if(y===undefined)return 1;
    const nx=/^\d+$/.test(x),ny=/^\d+$/.test(y);
    if(nx&&ny)return Number(x)>Number(y)?1:-1;
    if(nx!==ny)return nx?-1:1;
    return x>y?1:-1;
  }
  return 0;
}
function approvedUrl(value) {
  const url=new URL(value);
  if(url.protocol!=='https:' || url.username || url.password || url.port || !HOSTS.has(url.hostname))throw Error('Unapproved update host.');
  return url;
}
function installerHeader(bytes, format) {
  return format==='exe' ? bytes.subarray(0,2).toString()==='MZ' : format==='pkg' ? bytes.subarray(0,4).toString()==='xar!' : bytes.subarray(0,8).toString()==='!<arch>\n';
}

/** Only Mother's fixed preview catalog can nominate an installer. No URL or file
 * path is supplied by the renderer. Normal OS installation and signing checks
 * remain in force; checksums do not establish publisher identity. */
function createUpdateManager({userData,platform=process.platform,arch=process.arch,currentVersion,currentCommit='',currentBuiltAt='',fetchImpl=globalThis.fetch,onStatus=()=>{},openInstaller=async()=>{throw Error('Installer opening is unavailable.');},onInstallStarted=()=>{}}={}) {
  if(!userData || !path.isAbsolute(userData) || !versionParts(currentVersion))throw Error('A private update directory and application version are required.');
  const directory=path.join(userData,'updates');
  const targetPlatform=({win32:'windows',darwin:'mac',linux:'linux'})[platform];
  let state={source:'desktop',state:'idle',installedVersion:currentVersion,installedCommit:currentCommit,availableVersion:null,availableCommit:null,downloaded:0,total:0,progress:0,error:null,signing:null,nativeInstallTested:false};
  let artifact,verifiedPath,operation,task,disposed=false;
  const status=()=>({...state});
  const update=next=>{state={...state,...next};if(!disposed)onStatus(status());return status();};
  const checkAbort=signal=>{if(signal.aborted || disposed)throw abortError();};
  async function request(value,signal) {
    let url=approvedUrl(value);
    for(let redirects=0;redirects<=5;redirects++) {
      checkAbort(signal);
      const response=await fetchImpl(url.href,{signal,redirect:'manual',cache:'no-store',headers:{Accept:'application/octet-stream'}});
      if([301,302,303,307,308].includes(response.status)) {
        const location=response.headers.get('location');
        await response.body?.cancel();
        if(!location || redirects===5)throw Error('Invalid update redirect.');
        url=approvedUrl(new URL(location,url).href);continue;
      }
      if(!response.ok)throw Error('The update server is unavailable.');
      return response;
    }
    throw Error('Too many update redirects.');
  }
  async function readCatalog(signal) {
    const fresh=new URL(CATALOG);
    fresh.searchParams.set('mother_check',randomBytes(8).toString('hex'));
    const response=await request(fresh.href,signal), chunks=[];
    let size=0;
    if(Number(response.headers.get('content-length'))>256*1024){await response.body?.cancel();throw Error('Invalid update catalog.');}
    if(!response.body)throw Error('Empty update catalog.');
    for await(const chunk of response.body) {
      checkAbort(signal);size+=chunk.byteLength;
      if(size>256*1024)throw Error('Invalid update catalog.');
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  function run(action,timeout) {
    if(disposed)return Promise.resolve(status());
    if(task)return task;
    operation=new AbortController();
    const controller=operation;
    const timer=setTimeout(()=>controller.abort(),timeout);
    task=(async()=>{
      try{return await action(controller.signal);}
      catch(error){
        if(controller.signal.aborted || error.name==='AbortError')return update({state:'cancelled',error:null});
        verifiedPath=null;
        return update({state:'error',error:'Mother could not verify or complete this update. Check your connection and try again.'});
      }finally{clearTimeout(timer);if(operation===controller)operation=null;task=null;}
    })();
    return task;
  }
  async function privateDirectory() {
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    const info=await fs.lstat(directory);
    if(!info.isDirectory() || info.isSymbolicLink())throw Error('Invalid update cache.');
    if(process.platform!=='win32')await fs.chmod(directory,0o700);
  }
  async function verify(file,item,signal) {
    const info=await fs.lstat(file);
    if(!info.isFile() || info.isSymbolicLink() || info.size!==item.size)throw Error('Installer size differs.');
    const digest=createHash('sha256');let head=Buffer.alloc(0);
    for await(const chunk of createReadStream(file)) {
      checkAbort(signal);digest.update(chunk);
      if(head.length<8)head=Buffer.concat([head,chunk]).subarray(0,8);
    }
    if(digest.digest('hex')!==item.sha256 || !installerHeader(head,item.format))throw Error('Installer integrity check failed.');
  }
  async function check() {
    // Keep an explicitly downloaded, verified update ready. A periodic network
    // failure must not discard it or force another large download.
    if(['downloading','verifying','ready','installing'].includes(state.state))return status();
    return run(async signal=>{
      update({state:'checking',error:null});
      const catalog=await readCatalog(signal);
      if(catalog?.channel!=='preview' || !versionParts(catalog.version) || !/^[a-f0-9]{40}$/.test(catalog.sourceCommit || '') || !Number.isFinite(Date.parse(catalog.generatedAt)) || !Array.isArray(catalog.artifacts))throw Error('Invalid update catalog.');
      const comparison=compareVersions(catalog.version,currentVersion);
      const older=Number.isFinite(Date.parse(currentBuiltAt)) && Date.parse(catalog.generatedAt)<=Date.parse(currentBuiltAt);
      if(comparison<0 || older || comparison===0 && (!currentCommit || catalog.sourceCommit===currentCommit)) {
        artifact=null;verifiedPath=null;
        return update({state:'current',availableVersion:null,availableCommit:null,downloaded:0,total:0,progress:0,error:null});
      }
      const {normalizeInstaller}=await import('../server/downloads-validation.js');
      const matches=catalog.artifacts.map(item=>normalizeInstaller(item,{version:catalog.version,remoteOnly:true})).filter(item=>item && item.platform===targetPlatform && item.architecture===arch && item.size<=MAX_INSTALLER && /-[a-f0-9]{12}\.(exe|pkg|deb)$/.test(item.filename));
      if(matches.length!==1)throw Error('No unique compatible installer.');
      const selected=matches[0];
      if(artifact?.sha256!==selected.sha256)verifiedPath=null;
      artifact=selected;
      return update({state:verifiedPath?'ready':'available',availableVersion:catalog.version,availableCommit:catalog.sourceCommit,total:artifact.size,downloaded:verifiedPath?artifact.size:0,progress:verifiedPath?1:0,error:null,signing:artifact.signing,nativeInstallTested:artifact.nativeInstallTested});
    },30000);
  }
  async function download() {
    if(!artifact || !['available','error','cancelled','ready'].includes(state.state))return status();
    const item={...artifact};
    return run(async signal=>{
      await privateDirectory();
      const destination=path.join(directory,item.filename);
      const temporary=path.join(directory,`${item.filename}.${randomBytes(8).toString('hex')}.partial`);
      verifiedPath=null;
      update({state:'downloading',downloaded:0,total:item.size,progress:0,error:null});
      let handle;
      try {
        const response=await request(item.downloadUrl,signal);
        const length=response.headers.get('content-length');
        if(length!==null && Number(length)!==item.size)throw Error('Incorrect installer length.');
        if(!response.body)throw Error('Empty installer.');
        handle=await fs.open(temporary,'wx',0o600);
        let downloaded=0;
        for await(const chunk of response.body) {
          checkAbort(signal);downloaded+=chunk.byteLength;
          if(downloaded>item.size)throw Error('Installer is too large.');
          const buffer=Buffer.from(chunk);let offset=0;
          while(offset<buffer.length)offset+=(await handle.write(buffer,offset,buffer.length-offset)).bytesWritten;
          update({downloaded,progress:downloaded/item.size});
        }
        await handle.sync();await handle.close();handle=null;
        update({state:'verifying'});await verify(temporary,item,signal);checkAbort(signal);
        // A previous complete cache entry may be replaced, never an arbitrary path.
        const previous=await fs.lstat(destination).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
        if(previous && (!previous.isFile() || previous.isSymbolicLink()))throw Error('Invalid cached installer.');
        if(previous)await fs.unlink(destination);
        await fs.rename(temporary,destination);verifiedPath=destination;
        return update({state:'ready',downloaded:item.size,total:item.size,progress:1});
      } finally {await handle?.close().catch(()=>{});await fs.unlink(temporary).catch(()=>{});}
    },10*60*1000);
  }
  async function install() {
    if(!artifact || !verifiedPath || state.state!=='ready')return status();
    const file=verifiedPath,item={...artifact};
    return run(async signal=>{
      update({state:'verifying',error:null});await verify(file,item,signal);checkAbort(signal);
      update({state:'installing'});
      await openInstaller(file,{platform,filename:item.filename});
      await onInstallStarted();
      return status();
    },60000);
  }
  function cancel(){operation?.abort();if(!disposed && state.state!=='installing')update({state:'cancelled',error:null});return status();}
  function stop(){disposed=true;operation?.abort();}
  return {status,check,download,install,cancel,stop};
}
module.exports={createUpdateManager,compareVersions};
