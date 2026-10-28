import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceConversation} from './voice-chat.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function harness(submitTurn=async()=>{}) {
  const inputs=[],states=[],errors=[];
  const conversation=createVoiceConversation({
    recognizerFactory:callbacks=>{const input={callbacks,started:false,stopped:false,start(){this.started=true;},stop(){this.stopped=true;}};inputs.push(input);return input;},
    submitTurn,onState:state=>states.push(state),onError:error=>errors.push(error.message),
  });return {conversation,inputs,states,errors};
}

test('one click keeps voice chat enabled and serializes microphone, reply and playback',async()=>{
  const audio=deferred();let submitted=0;
  const {conversation,inputs}=harness(async({text})=>{assert.equal(text,'hello mother');assert.equal(inputs[0].stopped,true);submitted++;await audio.promise;});
  await conversation.start();assert.equal(conversation.getStatus().state,'listening');
  inputs[0].callbacks.onPartial('hello');assert.equal(conversation.getStatus().transcript,'hello');
  inputs[0].callbacks.onResult('hello mother');inputs[0].callbacks.onResult('hello mother');await tick();
  assert.equal(submitted,1);assert.equal(inputs.length,1);assert.equal(conversation.getStatus().enabled,true);
  assert.equal(conversation.getStatus().state,'thinking');
  audio.resolve();await tick();assert.equal(inputs.length,2);assert.equal(inputs[1].started,true);assert.equal(conversation.getStatus().state,'listening');
  await conversation.dispose();
});

test('stop aborts a pending reply and never restarts the microphone',async()=>{
  const audio=deferred();let signal;
  const {conversation,inputs}=harness(async args=>{signal=args.signal;await audio.promise;});
  await conversation.start();inputs[0].callbacks.onResult('a question');await tick();
  await conversation.stop();assert.equal(signal.aborted,true);audio.resolve();await tick();
  assert.equal(inputs.length,1);assert.equal(conversation.getStatus().enabled,false);assert.equal(conversation.getStatus().state,'off');
});

test('permission failures remain visible and do not retry automatically',async()=>{
  let attempts=0;const errors=[];
  const conversation=createVoiceConversation({recognizerFactory:()=>({start(){attempts++;throw Error('Permission denied');},stop(){}}),submitTurn:async()=>{},onError:error=>errors.push(error.message)});
  await conversation.start();await tick();assert.equal(attempts,1);assert.equal(conversation.getStatus().enabled,false);assert.equal(conversation.getStatus().state,'error');assert.deepEqual(errors,['Permission denied']);
  await conversation.dispose();
});

test('stopping while a recognizer is being created releases the late microphone',async()=>{
  const factory=deferred();let stopped=false,started=false;
  const conversation=createVoiceConversation({recognizerFactory:()=>factory.promise,submitTurn:async()=>{throw Error('Must not submit');}});
  const starting=conversation.start();await tick();await conversation.stop();factory.resolve({start(){started=true;},stop(){stopped=true;}});await starting;
  assert.equal(stopped,true);assert.equal(started,false);assert.equal(conversation.getStatus().state,'off');
});

test('talk now aborts playback and resumes listening without accepting stale transcripts',async()=>{
  const audio=deferred();const turns=[];
  const {conversation,inputs}=harness(async args=>{turns.push(args);await audio.promise;});
  await conversation.start();inputs[0].callbacks.onResult('first');await tick();
  const interrupting=conversation.interrupt();await tick();assert.equal(turns[0].signal.aborted,true);assert.equal(inputs.length,1);
  audio.resolve();await interrupting;assert.equal(inputs.length,2);
  inputs[0].callbacks.onResult('stale echo');await tick();assert.equal(turns.length,1);assert.equal(conversation.getStatus().state,'listening');
  await tick();assert.equal(inputs.length,2);await conversation.dispose();
});

test('a recognizer ending unexpectedly stops visibly instead of flashing or looping',async()=>{
  const {conversation,inputs}=harness();await conversation.start();inputs[0].callbacks.onEnd();await tick();
  assert.equal(inputs.length,1);assert.equal(inputs[0].stopped,true);assert.equal(conversation.getStatus().state,'error');assert.match(conversation.getStatus().error,/Click Start voice chat/);
});

test('stop then start waits for old reply cleanup and a second stop prevents late listening',async()=>{
  for(const stopDuringWait of [false,true]){
    const cleanup=deferred();let turnSignal;
    const {conversation,inputs}=harness(async({signal})=>{turnSignal=signal;await cleanup.promise;});
    await conversation.start();inputs[0].callbacks.onResult('an unfinished reply');await tick();
    await conversation.stop();assert.equal(turnSignal.aborted,true);
    const restarting=conversation.start();await tick();
    assert.equal(inputs.length,1,'The old reply must finish cleanup before another microphone opens.');
    assert.equal(conversation.getStatus().state,'starting');
    if(stopDuringWait)await conversation.stop();
    cleanup.resolve();await restarting;await tick();
    assert.equal(inputs.length,stopDuringWait?1:2);
    assert.equal(conversation.getStatus().state,stopDuringWait?'off':'listening');
    assert.equal(conversation.getStatus().enabled,!stopDuringWait);
    await conversation.dispose();
  }
});
