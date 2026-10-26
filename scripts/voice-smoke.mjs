/** Actual neural synthesis through the production browser worker and voice UI.
 * The model cache is verified by the same server and worker as normal playback.
 */
import {chromium,expect} from '@playwright/test';
import {createApp} from '../server/index.js';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const temporary=await mkdtemp(path.join(os.tmpdir(),'mother-voice-smoke-'));
const native=process.env.MOTHER_VOICE_NATIVE==='1';
const app=createApp({mode:native?'local':'hosted-preview',dataDirectory:temporary,voiceOptions:{directory:process.env.MOTHER_VOICE_CACHE || path.join(temporary,'voice')}});
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
let browser;
let monitor;
try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']});
  const page=await browser.newPage();
  page.on('console',message=>{if(message.type()==='error')console.log(`Browser: ${message.text().slice(0,1000)}`);});
  page.on('pageerror',error=>console.log(`Page: ${error.message.slice(0,1000)}`));
  await page.addInitScript(()=>{
    window.__voiceSamples=[];
    const copy=AudioBuffer.prototype.copyToChannel;
    AudioBuffer.prototype.copyToChannel=function(samples,...args){
      if(args[0]===0)window.__voiceSamples.push({sampleRate:this.sampleRate,samples:Array.from(samples)});
      return copy.call(this,samples,...args);
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'Mother’s voice',exact:true}).click();
  monitor=setInterval(async()=>{
    try{console.log((await page.locator('.voice-settings').innerText()).slice(-700));}catch{}
  },10000);
  await page.getByRole('checkbox',{name:'I approve downloading the free voice pack and using storage on this device.',exact:true}).check();
  await page.getByRole('button',{name:'Download or load human voice',exact:true}).click();
  await Promise.race([
    expect(page.getByText('Mother’s neural voice is ready on this device. No voice subscription is required.',{exact:true})).toBeVisible({timeout:240000}),
    page.locator('.voice-settings [role="alert"]').waitFor({timeout:240000}).then(async()=>{throw Error(await page.locator('.voice-settings [role="alert"]').innerText());}),
  ]);
  const synthesisStarted=Date.now();
  await page.getByRole('button',{name:'Hear Mother’s voice',exact:true}).click();
  await Promise.race([
    expect(page.getByRole('button',{name:'Hear Mother’s voice',exact:true})).toBeEnabled({timeout:180000}),
    page.locator('.voice-settings [role="alert"]').waitFor({timeout:180000}).then(async()=>{throw Error(await page.locator('.voice-settings [role="alert"]').innerText());}),
  ]);
  const chunks=await page.evaluate(()=>window.__voiceSamples);
  assert.ok(chunks.length>0,'No generated neural audio reached playback.');
  const sampleRate=24000;
  assert.ok(chunks.every(chunk=>chunk.sampleRate===sampleRate));
  const samples=chunks.flatMap(chunk=>chunk.samples);
  assert.ok(samples.length>sampleRate,'Neural voice is shorter than one second.');
  assert.ok(samples.every(Number.isFinite));
  const rms=Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length);
  assert.ok(rms>.001,'Neural speech is silent.');
  const wav=Buffer.alloc(44+samples.length*2);
  wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples.length*2,40);
  for(let i=0;i<samples.length;i++)wav.writeInt16LE(Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),44+i*2);
  const output=process.env.MOTHER_VOICE_SAMPLE || '/tmp/mother-voice-preview.wav';
  await writeFile(output,wav);
  console.log(JSON.stringify({voice:'af_heart',engine:native?'Kokoro 82M native CPU':'Kokoro 82M int8 / ONNX WASM',chunks:chunks.length,seconds:samples.length/sampleRate,rms,synthesisAndPlaybackSeconds:(Date.now()-synthesisStarted)/1000,wav:output}));
}finally{
  clearInterval(monitor);
  await browser?.close();app.locals.shutdown();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await rm(temporary,{recursive:true,force:true});
}
