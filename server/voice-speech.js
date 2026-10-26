import os from 'node:os';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {phonemize} from 'phonemizer';
import {phonemeTokens} from './voice-phonemes.js';

const VOICES={af_heart:'d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b',af_bella:'f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b',bf_emma:'669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73'};
export const nativeVoiceSupported=(platform=process.platform,arch=process.arch)=>['linux:x64','linux:arm64','win32:x64','win32:arm64','darwin:arm64'].includes(`${platform}:${arch}`);
export function validateSpeech(body={}){
  if(typeof body.text!=='string'||!body.text.trim()||body.text.length>500)throw Error('Provide a short speech passage of at most 500 characters.');
  if(!Object.hasOwn(VOICES,body.voice)||!Number.isFinite(body.speed)||body.speed<.8||body.speed>1.2)throw Error('Choose an included voice and a supported speaking speed.');
  return {text:body.text.trim(),voice:body.voice,speed:body.speed};
}

/** Native CPU inference stays on the desktop host. No user text is sent to a
 * voice provider, model URL or external executable. Unsupported hosts use WASM. */
export function createNativeSpeech({ensureModel,voiceRoot,importOrt=()=>import('onnxruntime-node')}={}){
  let session,ort,pending,busy=false,closed=false;
  const voices=new Map();
  async function prepare(){
    if(closed)throw Error('The voice session is closed.');
    if(session)return;
    pending ||= (async()=>{
      const filename=await ensureModel();
      ort=await importOrt();ort.env.logLevel='error';
      session=await ort.InferenceSession.create(filename,{executionProviders:['cpu'],intraOpNumThreads:Math.max(1,Math.min(4,os.cpus().length)),interOpNumThreads:1,graphOptimizationLevel:'all',enableProfiling:false});
    })().finally(()=>{pending=null;});
    await pending;
    if(closed){await session?.release();session=null;throw Error('The voice session is closed.');}
  }
  return {
    prepare,
    async synthesize(input){
      const {text,voice,speed}=validateSpeech(input);
      if(busy){const error=Error('Mother is already preparing a spoken passage. Please try again shortly.');error.status=429;throw error;}
      busy=true;
      try{
        await prepare();
        const {ids,length}=await phonemeTokens(text,{voice,phonemize});
        let embedding=voices.get(voice);
        if(!embedding){
          const bytes=await readFile(path.join(voiceRoot,`${voice}.bin`));
          if(bytes.byteLength!==522240||createHash('sha256').update(bytes).digest('hex')!==VOICES[voice])throw Error('The selected voice failed its integrity check. Reinstall Mother.');
          embedding=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);voices.set(voice,embedding);
        }
        const output=await session.run({input_ids:new ort.Tensor('int64',ids,[1,ids.length]),style:new ort.Tensor('float32',embedding.slice(256*length,256*(length+1)),[1,256]),speed:new ort.Tensor('float32',Float32Array.of(speed),[1])});
        const samples=Float32Array.from(output.waveform.data);
        if(!samples.length||samples.length>24000*90||samples.some(value=>!Number.isFinite(value)))throw Error('The voice engine could not produce valid audio. Try another short sentence.');
        return {samples,sampleRate:24000};
      }finally{busy=false;if(closed&&session){const owned=session;session=null;await owned.release();}}
    },
    ready:()=>!!session,
    async close(){closed=true;voices.clear();if(!busy&&session){const owned=session;session=null;await owned.release();}},
  };
}
