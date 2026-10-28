import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalRecognizer,RECOGNITION_BYTES,RECOGNITION_SHA256} from './local-recognition.js';

test('local speech input requires consent and never opens a microphone before setup',async()=>{
  let network=0,microphone=0;
  const recognizer=createLocalRecognizer({fetchImpl:async()=>{network++;},mediaDevices:{getUserMedia:async()=>{microphone++;}}});
  await assert.rejects(recognizer.prepare(),/Approve the free/);
  await assert.rejects(recognizer.create(),/Download and load/);
  assert.equal(network,0);assert.equal(microphone,0);await recognizer.dispose();
});

test('invalid or truncated model downloads cannot reach the WASM loader',async()=>{
  let loaded=0;const states=[];
  const recognizer=createLocalRecognizer({onState:state=>states.push(state),cacheStorage:null,fetchImpl:async url=>{assert.equal(url,'/api/recognition/model.tar.gz');return new Response(new Uint8Array([1,2,3]));},loadVosk:async()=>{loaded++;}});
  await assert.rejects(recognizer.prepare({consent:true}),/incomplete/);assert.equal(loaded,0);assert.equal(recognizer.getStatus().state,'error');assert.equal(recognizer.getStatus().total,RECOGNITION_BYTES);await recognizer.dispose();
});

test('the recognition service uses a fixed versioned Apache model and exposes no generic URL input',async()=>{
  const {RECOGNITION_MODEL}=await import('../../server/recognition.js');
  assert.equal(RECOGNITION_MODEL.bytes,RECOGNITION_BYTES);assert.match(RECOGNITION_MODEL.url,/raw\.githubusercontent\.com\/ccoreilly\/vosk-browser\/[a-f0-9]{40}\/models\/vosk-model-small-en-us-0\.15\.tar\.gz$/);assert.equal(RECOGNITION_MODEL.license,'Apache-2.0');
});

test('disposing during a delayed engine import cannot create a late recognition worker',async()=>{
  let finishImport,beginImport,workers=0;
  const importing=new Promise(resolve=>{beginImport=resolve;});
  const engine=new Promise(resolve=>{finishImport=resolve;});
  const digest=Uint8Array.from(RECOGNITION_SHA256.match(/../g),value=>Number.parseInt(value,16));
  const recognizer=createLocalRecognizer({
    cacheStorage:null,
    fetchImpl:async()=>new Response(new Uint8Array(RECOGNITION_BYTES)),
    cryptoImpl:{subtle:{digest:async()=>digest.buffer}},
    loadVosk:()=>{beginImport();return engine;},
  });
  const preparing=recognizer.prepare({consent:true});
  const stopped=assert.rejects(preparing,{name:'AbortError'});
  await importing;await recognizer.dispose();
  finishImport({Model:class {constructor(){workers++;throw Error('A disposed session cannot create a worker.');}}});
  await stopped;assert.equal(workers,0);
});
