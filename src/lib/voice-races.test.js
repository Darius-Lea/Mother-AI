import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMotherVoice} from './voice.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
function harness(context) {
  const listeners={};
  const worker={addEventListener:(name,fn)=>listeners[name]=fn,terminate(){},postMessage(message){queueMicrotask(()=>listeners.message({data:{id:message.id,result:message.type==='prepare'?{ready:true}:{samples:Float32Array.of(.1,.2),sampleRate:24000}}}));}};
  return createMotherVoice({workerFactory:()=>worker,audioContextFactory:()=>context,speechSynthesis:{cancel(){}},fetchImpl:async()=>Response.json({nativeSynthesis:false})});
}
test('stopping during audio resume never starts a stale passage after the microphone can resume',async()=>{
  const resume=deferred(),resuming=deferred();let started=0;
  const context={state:'running',resume(){resuming.resolve();return resume.promise;},close:async()=>{},createBuffer:()=>({copyToChannel(){}}),destination:{},createBufferSource(){const source={connect(){},stop(){source.onended?.();},start(){started++;queueMicrotask(()=>source.onended?.());}};return source;}};
  const voice=harness(context);await voice.prepare({consent:true});
  const speaking=voice.speak('This passage must never start.');
  await resuming.promise;voice.stop();resume.resolve();
  await assert.rejects(speaking,{name:'AbortError'});
  assert.equal(started,0);voice.dispose();
});
test('stop releases speech immediately even when a producer never sends another token',async()=>{
  const context={state:'running',resume:async()=>{},close:async()=>{}};
  const voice=harness(context);await voice.prepare({consent:true});
  const queue={async *[Symbol.asyncIterator](){await new Promise(()=>{});yield 'Never delivered.';}};
  const speaking=voice.speakStream(queue);await tick();voice.stop();
  await assert.rejects(speaking,{name:'AbortError'});voice.dispose();
});
