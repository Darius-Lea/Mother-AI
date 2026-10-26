import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMotherVoice,normalizeVoiceSettings,preferredSystemVoice,speechChunks,speechText} from './voice.js';

test('speech excludes executable examples and unreadable links, and preserves bounded spoken chunks',()=>{
  const text=speechText('Hello **Darius**. [Learn more](https://example.com) ```js\nsecret();\n``` https://example.com/private');
  assert.match(text,/Hello Darius/);assert.doesNotMatch(text,/https:|secret\(\)|\*|```/);
  const chunks=speechChunks('A sentence. '+ 'Longer words '.repeat(80));
  assert.ok(chunks.every(chunk=>chunk.length<=180));
  assert.equal(normalizeVoiceSettings({voiceEngine:'remote',voiceName:'unapproved',voiceSpeed:500}).voiceSpeed,1.2);
});

test('device fallback prefers a natural English female voice without becoming the neural default',async()=>{
  const selected=preferredSystemVoice([{name:'Default robot',lang:'en-US',default:true,localService:true},{name:'Microsoft Jenny Natural',lang:'en-US',localService:true},{name:'Other language',lang:'fr-FR',default:true}]);
  assert.equal(selected.name,'Microsoft Jenny Natural');
  let spoken;
  const controller=createMotherVoice({speechSynthesis:{cancel(){},getVoices:()=>[selected],speak(utterance){spoken=utterance;queueMicrotask(()=>utterance.onend());}},utteranceFactory:text=>({text}),workerFactory:()=>{throw Error('No implicit download');}});
  await assert.rejects(controller.speak('Hello'),/download.*voice first/i);
  await controller.speak('Hello',{engine:'system',speed:1});
  assert.equal(spoken.voice,selected);assert.equal(spoken.pitch,1);controller.dispose();
});

test('neural preparation requires consent and never silently invokes device speech on failure',async()=>{
  let workers=0,robot=0;
  const controller=createMotherVoice({workerFactory:()=>{workers++;throw Error('Worker unavailable');},audioContextFactory:()=>({state:'running',close:async()=>{}}),speechSynthesis:{cancel(){},speak(){robot++;}}});
  await assert.rejects(controller.prepare(),/Approve/);assert.equal(workers,0);
  await assert.rejects(controller.prepare({consent:true}),/unavailable/);assert.equal(controller.getStatus().state,'error');assert.equal(robot,0);controller.dispose();
});

test('stopping a pending neural passage rejects playback and disposes the owned worker',async()=>{
  const listeners={};let terminated=false;
  const worker={addEventListener:(name,callback)=>listeners[name]=callback,postMessage(message){if(message.type==='prepare')queueMicrotask(()=>listeners.message({data:{id:message.id,result:{ready:true}}}));},terminate(){terminated=true;}};
  const controller=createMotherVoice({workerFactory:()=>worker,audioContextFactory:()=>({state:'running',close:async()=>{}}),speechSynthesis:{cancel(){}}});
  await controller.prepare({consent:true});
  const speaking=controller.speak('A sentence');controller.stop();await assert.rejects(speaking,{name:'AbortError'});
  controller.dispose();assert.equal(terminated,true);
});
