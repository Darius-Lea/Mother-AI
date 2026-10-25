import express from 'express';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import net from 'node:net';
import os from 'node:os';

const TOOLS = Object.freeze([
  {id:'nmap',label:'Nmap',command:'nmap',versionArgs:['--version'],operations:['version','single-host-tcp-check']},
  {id:'nikto',label:'Nikto',command:'nikto',versionArgs:['-Version'],operations:['version']},
  {id:'sqlmap',label:'sqlmap',command:'sqlmap',versionArgs:['--version'],operations:['version']},
]);
export const NMAP_ARGUMENTS = Object.freeze(['-sT','-Pn','--unprivileged','--max-retries','1','--host-timeout','30s','--top-ports','20']);
const PLAN_TTL=5*60*1000;
const LIMIT=256*1024;
const cleanOutput=value=>value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'');

export class SecurityToolError extends Error {
  constructor(message,status=400){super(message);this.status=status;}
}

/** One hostname or literal address. Nmap range/list/file/option syntax is rejected. */
export function validateTarget(input) {
  if(typeof input!=='string'||!input||input.length>253||input.trim()!==input)throw new SecurityToolError('Enter one host name or IP address, without a URL, network range, or extra options.');
  if(net.isIP(input))return input;
  const host=input.endsWith('.')?input.slice(0,-1):input;
  if(!host||host.startsWith('-')||!host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))||!/[a-z]/i.test(host)||/^\d/.test(host.split('.').at(-1)))throw new SecurityToolError('Choose a single valid host name or IP address. URLs, ranges, lists, flags, and command syntax are not accepted.');
  return host.toLowerCase();
}

/** Fixed executable + arguments only. No shell, input files, elevation, or arbitrary command API. */
export function runTool(command,args,{spawnImpl=spawn,timeout=45000,maxOutputBytes=LIMIT,children=new Set()}={}) {
  return new Promise(resolve=>{
    let child,done=false,timedOut=false,truncated=false,outputBytes=0,stdout=[],stderr=[],timer,killTimer,fallbackTimer;
    const finish=(extra={})=>{
      if(done)return;done=true;clearTimeout(timer);clearTimeout(killTimer);clearTimeout(fallbackTimer);if(child)children.delete(child);
      resolve({exitCode:null,signal:null,timedOut,truncated,outputBytes,stdout:cleanOutput(Buffer.concat(stdout).toString('utf8')),stderr:cleanOutput(Buffer.concat(stderr).toString('utf8')),...extra});
    };
    const stop=()=>{
      try{child?.kill('SIGTERM');}catch{}
      killTimer=setTimeout(()=>{try{child?.kill('SIGKILL');}catch{}},250);killTimer.unref?.();
      fallbackTimer=setTimeout(()=>finish({error:timedOut?'Tool execution timed out.':'Tool output exceeded the limit.'}),600);fallbackTimer.unref?.();
    };
    try {
      child=spawnImpl(command,[...args],{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],cwd:os.tmpdir()});children.add(child);
      const collect=target=>chunk=>{
        if(done)return;const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);const remaining=Math.max(0,maxOutputBytes-outputBytes);
        if(remaining)target.push(bytes.subarray(0,remaining));outputBytes+=Math.min(remaining,bytes.length);
        if(bytes.length>remaining&&!truncated){truncated=true;stop();}
      };
      child.stdout?.on('data',collect(stdout));child.stderr?.on('data',collect(stderr));
      child.once('error',error=>finish({error:error.code==='ENOENT'?'Tool is not installed on the Mother server.':'The tool could not be started.',missing:error.code==='ENOENT'}));
      child.once('close',(code,signal)=>finish({exitCode:Number.isInteger(code)?code:null,signal:signal||null}));
      timer=setTimeout(()=>{timedOut=true;stop();},timeout);timer.unref?.();
    }catch(error){finish({error:error.code==='ENOENT'?'Tool is not installed on the Mother server.':'The tool could not be started.',missing:error.code==='ENOENT'});}
  });
}

/** Mount only behind Mother's owner/session authentication. Not an external-app capability. */
export function createKaliRouter({spawnImpl=spawn,now=Date.now,idFactory=randomUUID,probeTimeout=5000,scanTimeout=45000,maxOutputBytes=LIMIT}={}) {
  const router=express.Router(),plans=new Map(),children=new Set();
  let inventoryCache=null,inventoryPromise=null,cacheUntil=0,active=false;
  let acceptedRuns=[];
  const respond=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){res.status(error instanceof SecurityToolError?error.status:500).json({error:error instanceof SecurityToolError?error.message:'The security tool operation could not be completed.'});}};
  async function inventory(force=false){
    if(!force&&inventoryCache&&now()<cacheUntil)return inventoryCache;
    if(inventoryPromise)return inventoryPromise;
    inventoryPromise=Promise.all(TOOLS.map(async tool=>{
      const result=await runTool(tool.command,tool.versionArgs,{spawnImpl,timeout:probeTimeout,maxOutputBytes:16*1024,children});
      const installed=!result.error&&!result.timedOut&&!result.truncated&&result.exitCode===0;
      const version=installed?((result.stdout||result.stderr).split(/\r?\n/).map(line=>line.trim()).find(Boolean)||'Version command completed').slice(0,160):null;
      return {id:tool.id,label:tool.label,installed,version,operations:installed?tool.operations:[],status:installed?'available':result.missing?'not-installed':'unavailable'};
    })).then(tools=>{inventoryCache={tools,environment:{platform:process.platform,executionHost:'The computer running Mother',kaliBundled:false},capabilities:{singleHostTcpCheck:tools.some(tool=>tool.id==='nmap'&&tool.installed),exploitation:false,arbitraryCommands:false,fullKaliSuite:false},limitations:['This is a limited tool bridge, not Kali Linux or a full penetration-testing suite.','Only an authorized, explicitly approved, single-host TCP check can run.','Results are real tool output, not a guarantee that a host is secure.']};cacheUntil=now()+15000;return inventoryCache;}).finally(()=>{inventoryPromise=null;});
    return inventoryPromise;
  }
  function cleanup(){for(const [id,plan] of plans)if(now()>plan.expiresAt||plan.consumed)plans.delete(id);}
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  router.get('/capabilities',respond(async(req,res)=>res.json(await inventory(req.query.refresh==='true'))));
  router.post('/plan',respond(async(req,res)=>{
    if(req.body?.authorizationConfirmed!==true)throw new SecurityToolError('Confirm that you own this host or have explicit permission to test it.',403);
    if(req.body?.tool!=='nmap')throw new SecurityToolError('Only the supported Nmap single-host check can be planned.');
    const target=validateTarget(req.body.target);
    const capabilities=await inventory();
    if(!capabilities.capabilities.singleHostTcpCheck)throw new SecurityToolError('Nmap is not available on the Mother server. Install it through a trusted package manager or use a separately maintained Kali host.',503);
    cleanup();if(plans.size>=50)throw new SecurityToolError('Too many pending plans. Wait for an older plan to expire.',429);
    const args=[...(net.isIP(target)===6?['-6']:[]),...NMAP_ARGUMENTS,target];
    const plan={id:idFactory(),tool:'nmap',target,args,createdAt:now(),expiresAt:now()+PLAN_TTL,consumed:false};plans.set(plan.id,plan);
    res.status(201).json({id:plan.id,tool:plan.tool,target,args:[...args],expiresAt:new Date(plan.expiresAt).toISOString(),approvalRequired:true,description:'TCP connect check of the 20 most common ports on this one host. No exploitation, OS detection, privileged raw sockets, or broad network sweep.'});
  }));
  router.post('/plans/:id/run',respond(async(req,res)=>{
    if(req.body?.approved!==true)throw new SecurityToolError('Explicitly approve the reviewed plan before running it.',403);
    const plan=plans.get(req.params.id);
    if(!plan||plan.consumed)throw new SecurityToolError('This plan does not exist or has already been used. Create a new plan.',404);
    if(now()>plan.expiresAt){plans.delete(plan.id);throw new SecurityToolError('This plan expired. Review a fresh plan before running it.',410);}
    if(active)throw new SecurityToolError('Another security check is still running. Wait for its result.',409);
    acceptedRuns=acceptedRuns.filter(time=>time>now()-60000);
    if(acceptedRuns.length>=10)throw new SecurityToolError('The check limit is 10 runs per minute. Wait before trying again.',429);
    active=true;plan.consumed=true;acceptedRuns.push(now());
    try {
      const result=await runTool('nmap',plan.args,{spawnImpl,timeout:scanTimeout,maxOutputBytes,children});
      const completed=!result.error&&!result.timedOut&&!result.truncated&&result.exitCode===0;
      res.json({id:plan.id,tool:'nmap',target:plan.target,args:plan.args,state:completed?'completed':'failed',...result,limitation:'A port check is not a complete vulnerability assessment. Only actual captured tool output is shown.'});
    }finally{active=false;}
  }));
  router.shutdown=()=>{for(const child of children){try{child.kill('SIGKILL');}catch{}}children.clear();};
  return router;
}
