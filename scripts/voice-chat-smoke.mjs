/** Real local ASR + Kokoro playback. Only the language-model response is a
 * deterministic streamed fixture; this does not measure LLM inference speed.
 * npm run build first. Set MOTHER_RECOGNITION_MODEL to the pinned Vosk archive
 * and MOTHER_VOICE_CACHE to a directory containing the verified Kokoro model.
 */
import {chromium,expect} from '@playwright/test';
import {createApp} from '../server/index.js';
import {createMemory,MEMORY_KEY} from '../src/lib/memory.js';
import {RECOGNITION_MODEL} from '../server/recognition.js';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const sourceModel=process.env.MOTHER_RECOGNITION_MODEL;
if(!sourceModel)throw Error('Set MOTHER_RECOGNITION_MODEL to the verified Vosk English .tar.gz model.');
const temporary=await mkdtemp(path.join(os.tmpdir(),'mother-voice-chat-'));
await mkdir(path.join(temporary,'recognition'));await copyFile(sourceModel,path.join(temporary,'recognition',RECOGNITION_MODEL.filename));
const sample=await readFile(new URL('../public/voices/mother-preview.wav',import.meta.url));
const padded=Buffer.concat([sample,Buffer.alloc(24000*2*3)]);padded.writeUInt32LE(padded.length-8,4);padded.writeUInt32LE(padded.length-44,40);
const microphoneFile=path.join(temporary,'microphone.wav');await writeFile(microphoneFile,padded);
const calls=[];let streamFinishedAt;
const fetchImpl=async(url,options={})=>{
  if(url==='http://127.0.0.1:11434/api/tags')return Response.json({models:[{name:'voice-smoke-fixture',size:1}]});
  if(url!=='http://127.0.0.1:11434/api/chat')throw Error('Unexpected local-model request.');
  const payload=JSON.parse(options.body);calls.push(payload);assert.equal(payload.stream,true);
  const encoder=new TextEncoder();let timer;
  return new Response(new ReadableStream({
    start(controller){
      controller.enqueue(encoder.encode(JSON.stringify({message:{content:'I can hear you clearly. '},done:false})+'\n'));
      timer=setTimeout(()=>{streamFinishedAt=Date.now();controller.enqueue(encoder.encode(JSON.stringify({message:{content:'We can keep talking.'},done:true})+'\n'));controller.close();},15000);
      options.signal?.addEventListener('abort',()=>{clearTimeout(timer);try{controller.error(options.signal.reason);}catch{}},{once:true});
    },cancel(){clearTimeout(timer);},
  }),{headers:{'Content-Type':'application/x-ndjson'}});
};
const app=createApp({mode:'local',dataDirectory:temporary,fetchImpl,voiceOptions:{directory:process.env.MOTHER_VOICE_CACHE||path.join(temporary,'voice')}});
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
let browser,monitor;
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${microphoneFile}`]});
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const memory=createMemory();memory.settings={...memory.settings,model:'voice-smoke-fixture',reducedMotion:true,setupVisited:true};
  await page.addInitScript(({memory,key})=>{
    localStorage.setItem(key,JSON.stringify(memory));window.__voiceChatProbe={microphones:[],audio:[]};
    const getUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await getUserMedia(constraints);for(const track of stream.getAudioTracks()){const probe={opened:Date.now(),ended:null};window.__voiceChatProbe.microphones.push(probe);const stop=track.stop.bind(track);track.stop=()=>{probe.ended=Date.now();return stop();};}return stream;};
    const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args){window.__voiceChatProbe.audio.push({at:Date.now(),seconds:this.buffer?.duration||0});return start.apply(this,args);};
  },{memory,key:MEMORY_KEY});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  monitor=setInterval(async()=>{try{console.log(JSON.stringify({status:(await page.locator('.voice-chat-status, [role="dialog"], .toast').allTextContents()).join(' ').slice(0,900),calls:calls.length}));}catch{}},10000);
  await expect(page.getByRole('button',{name:/LOCAL NEURAL MODEL/})).toBeVisible({timeout:15000});
  await page.getByRole('button',{name:'Start voice chat',exact:true}).click();
  const setup=page.getByRole('dialog',{name:'A conversation, without typing.'});
  await setup.getByRole('checkbox',{name:'I approve the free speech packs and microphone use for voice chat.'}).check();
  const started=Date.now();await setup.getByRole('button',{name:'Start voice chat',exact:true}).click();
  await expect(page.locator('.composer [aria-pressed="true"]')).toBeVisible({timeout:120000});
  await expect(page.locator('.voice-chat-status')).toContainText('Listening',{timeout:120000});
  await page.waitForFunction(()=>window.__voiceChatProbe.audio.length>0,null,{timeout:90000});
  assert.equal(calls.length,1,'A spoken utterance should automatically submit exactly one turn.');
  assert.match(calls[0].messages.at(-1).content,/mother|hello/i,'Actual microphone audio did not become the user turn.');
  await expect(page.locator('.composer [aria-pressed="true"]')).toBeVisible();
  await page.waitForFunction(()=>window.__voiceChatProbe.microphones.length>=2,null,{timeout:90000});
  const probe=await page.evaluate(()=>window.__voiceChatProbe);
  assert.ok(probe.audio[0].seconds>.5,'No real synthesized speech reached playback.');
  assert.ok(streamFinishedAt&&probe.audio[0].at<streamFinishedAt,'Speech waited for the entire model response.');
  assert.ok(probe.microphones[0].ended&&probe.microphones[0].ended<=probe.audio[0].at,'The microphone stayed open during Mother’s speech.');
  await expect(page.locator('.voice-chat-status')).toContainText('Listening');
  await page.locator('.composer [aria-pressed="true"]').click();
  await expect(page.locator('.composer [aria-pressed="false"]')).toBeVisible();
  await page.waitForFunction(()=>window.__voiceChatProbe.microphones.every(microphone=>microphone.ended));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({speechInput:'Vosk English WASM (real fake-microphone WAV)',speechOutput:'Kokoro native CPU (real audio)',languageModel:'deterministic streaming fixture, not LLM inference',firstAudioBeforeStreamEndMs:streamFinishedAt-probe.audio[0].at,turns:calls.length,microphoneResumed:probe.microphones.length>=2,totalSeconds:(Date.now()-started)/1000}));
}catch(error){console.error(error.stack||error.message);process.exitCode=1;}
finally{clearInterval(monitor);await browser?.close();app.locals.shutdown();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await rm(temporary,{recursive:true,force:true});}
