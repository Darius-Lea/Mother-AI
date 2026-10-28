/** Actual speech input on Electron's secure mother:// origin. Uses a fake
 * microphone WAV, not a mocked recognizer. No real AI model is implied.
 */
import {_electron as electron,expect} from '@playwright/test';
import {createMemory,MEMORY_KEY} from '../src/lib/memory.js';
import {RECOGNITION_MODEL} from '../server/recognition.js';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

if(!process.env.MOTHER_RECOGNITION_MODEL||!process.env.MOTHER_VOICE_MODEL)throw Error('Provide MOTHER_RECOGNITION_MODEL and MOTHER_VOICE_MODEL paths to verified speech models.');
const temporary=await mkdtemp(path.join(os.tmpdir(),'mother-desktop-recognition-'));
for(const name of ['recognition','voice'])await mkdir(path.join(temporary,'service',name),{recursive:true});
await copyFile(process.env.MOTHER_RECOGNITION_MODEL,path.join(temporary,'service','recognition',RECOGNITION_MODEL.filename));
await copyFile(process.env.MOTHER_VOICE_MODEL,path.join(temporary,'service','voice','kokoro-v1.0.int8.onnx'));
const wav=await readFile(new URL('../public/voices/mother-preview.wav',import.meta.url));
const padded=Buffer.concat([wav,Buffer.alloc(24000*2*3)]);padded.writeUInt32LE(padded.length-8,4);padded.writeUInt32LE(padded.length-44,40);
const microphoneFile=path.join(temporary,'microphone.wav');await writeFile(microphoneFile,padded);
let running,monitor;
try {
  const executablePath=process.env.MOTHER_DESKTOP_EXECUTABLE||path.resolve('node_modules/electron/dist/electron');
  running=await electron.launch({executablePath,args:[...(process.env.MOTHER_DESKTOP_EXECUTABLE?[]:[path.resolve('.')]),'--no-sandbox','--enable-unsafe-swiftshader','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${microphoneFile}`,...(process.env.DISPLAY?[]:['--ozone-platform=headless'])],env:{...process.env,MOTHER_DESKTOP_TEST:'1',MOTHER_DESKTOP_USER_DATA:temporary,XDG_CACHE_HOME:path.join(temporary,'cache')},timeout:60000});
  const page=await running.firstWindow();await page.waitForLoadState('domcontentloaded');const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const memory=createMemory();memory.settings={...memory.settings,voice:false,reducedMotion:true,setupVisited:true};
  await page.evaluate(({memory,key})=>{localStorage.setItem(key,JSON.stringify(memory));localStorage.setItem('mother-neural-voice-consent-v1','approved');localStorage.setItem('mother-local-speech-input-v1','approved');},{memory,key:MEMORY_KEY});
  await page.reload();await page.waitForLoadState('domcontentloaded');
  monitor=setInterval(async()=>{try{console.log(JSON.stringify({status:(await page.locator('.voice-chat-status, [role="dialog"], .toast').allTextContents()).join(' ').slice(0,900)}));}catch{}},10000);
  await page.evaluate(()=>{
    window.__microphones=[];const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async options=>{const stream=await get(options);for(const track of stream.getAudioTracks()){const probe={ended:false};window.__microphones.push(probe);const stop=track.stop.bind(track);track.stop=()=>{probe.ended=true;return stop();};}return stream;};
  });
  const started=Date.now();await page.getByRole('button',{name:'Start voice chat',exact:true}).click();
  await expect(page.locator('.composer [aria-pressed="true"]')).toBeVisible({timeout:120000});
  await expect(page.locator('.voice-chat-status')).toContainText('Listening',{timeout:120000});
  await page.waitForFunction(key=>{const memory=JSON.parse(localStorage.getItem(key));return memory?.conversations.some(message=>message.role==='user'&&/mother|hello/i.test(message.content));},MEMORY_KEY,{timeout:45000});
  const user=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).conversations.find(message=>message.role==='user'),MEMORY_KEY);
  await expect(page.locator('.composer [aria-pressed="true"]')).toBeVisible();
  await page.locator('.composer [aria-pressed="true"]').click();
  await page.waitForFunction(()=>window.__microphones.every(microphone=>microphone.ended));
  assert.ok(page.url().startsWith('mother://app/'));assert.deepEqual(errors,[]);
  console.log(JSON.stringify({origin:'mother://app',recognizer:'actual Vosk WASM',transcript:user.content,buttonStayedEnabled:true,microphoneReleased:true,seconds:(Date.now()-started)/1000}));
}catch(error){console.error(error.stack||error.message);process.exitCode=1;}
finally{clearInterval(monitor);await running?.close();await rm(temporary,{recursive:true,force:true});}
