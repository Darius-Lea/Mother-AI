import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('audio-thread capture preserves contiguous microphone samples and sample rate across render blocks',async()=>{
  let Capture;
  const source=await readFile(new URL('./recognition-worklet.js',import.meta.url),'utf8');
  vm.runInNewContext(source,{
    AudioWorkletProcessor:class{constructor(){this.port={};}},sampleRate:48000,Float32Array,
    registerProcessor(name,Processor){assert.equal(name,'mother-speech-capture');Capture=Processor;},
  });
  const capture=new Capture(),packets=[];
  capture.port.onmessage({data:{recognizerId:'owned-recognizer',port:{postMessage(message,options){
    packets.push(structuredClone(message,{transfer:options.transfer}));
  }}}});
  const samples=Float32Array.from({length:8192},(_,index)=>Math.sin(index/31)*.25);
  for(let start=0;start<samples.length;start+=128)assert.equal(capture.process([[samples.slice(start,start+128)]]),true);
  const actual=packets.flatMap(packet=>Array.from(packet.data));
  assert.equal(actual.length,samples.length);
  assert.ok(packets.every(packet=>packet.recognizerId==='owned-recognizer'&&packet.sampleRate===48000&&packet.action==='audioChunk'));
  for(let index=0;index<samples.length;index++)assert.equal(actual[index],samples[index]*32768);
  assert.equal(capture.process([]),true);
  assert.equal(packets.length,2,'An empty render block must not invent microphone audio.');
});
