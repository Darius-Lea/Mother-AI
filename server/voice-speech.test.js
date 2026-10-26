import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createNativeSpeech,nativeVoiceSupported,validateSpeech} from './voice-speech.js';

test('speech accepts only bounded text and bundled voice profiles, without arbitrary models or code',()=>{
  assert.throws(()=>validateSpeech({text:'Hello',voice:'../secret',speed:1}),/included voice/);
  assert.throws(()=>validateSpeech({text:'x'.repeat(501),voice:'af_heart',speed:1}),/500/);
  assert.throws(()=>validateSpeech({text:'Hello',voice:'af_heart',speed:10}),/speed/);
  assert.deepEqual(validateSpeech({text:' Hello ',voice:'af_heart',speed:1}),{text:'Hello',voice:'af_heart',speed:1});
  assert.equal(nativeVoiceSupported('darwin','x64'),false);assert.equal(nativeVoiceSupported('win32','arm64'),true);
});

test('native speech verifies the bundled voice, coalesces preparation and bounds concurrent inference',async()=>{
  let creations=0,release=0,finish;
  const gate=new Promise(resolve=>finish=resolve);
  class Tensor{constructor(type,data,dims){Object.assign(this,{type,data,dims});}}
  const session={async run(feeds){assert.equal(feeds.style.data.length,256);assert.ok(feeds.input_ids.data.length>2);await gate;return {waveform:{data:Float32Array.of(.1,.2,-.1)}};},async release(){release++;}};
  const voice=createNativeSpeech({ensureModel:async()=>'/verified-model.onnx',voiceRoot:fileURLToPath(new URL('../public/voices',import.meta.url)),importOrt:async()=>({env:{},Tensor,InferenceSession:{async create(){creations++;return session;}}})});
  await Promise.all([voice.prepare(),voice.prepare()]);assert.equal(creations,1);
  const speaking=voice.synthesize({text:'Hello.',voice:'af_heart',speed:1});
  await assert.rejects(voice.synthesize({text:'Another.',voice:'af_heart',speed:1}),error=>error.status===429);
  await voice.close();finish();const result=await speaking;
  assert.equal(result.sampleRate,24000);assert.equal(result.samples.length,3);assert.equal(release,1);
  await assert.rejects(voice.prepare(),/closed/);
});
